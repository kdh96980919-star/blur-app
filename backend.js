// Supabase 백엔드 어댑터 — app.js가 사용하는 서버 API 경계
// 설계: docs/backend-plan.md, 스키마: supabase/schema.sql + migration-02.sql
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 허브 날짜는 서버(current_date, UTC) 기준 — 한국시간 오전 9시에 새 허브가 열림
// 허브 날짜 — 매일 한국시간 오전 6시에 새 주제로 갱신.
// KST(UTC+9)의 06:00 롤오버 = UTC 21:00이므로, (지금 + 3시간)의 UTC 날짜가 그날의 허브 날짜가 된다.
export function hubDateToday() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// 주제 아이디어 풀 — topics-weekly.sql 채울 때 참고용 (클라이언트가 자동 게시하지 않음)
const TOPIC_POOL = [
  "오늘 내가 지나친 작은 장면",
  "오늘 가장 오래 머문 자리",
  "지금 창밖의 빛",
  "오늘 마신 것",
  "걷다가 멈춘 순간",
  "오늘의 하늘 한 조각",
  "손에 들고 있던 것",
  "오늘 나를 웃게 한 장면",
  "집으로 가는 길",
  "오늘의 저녁 풍경",
  "책상 위 한 뼘",
  "기다리는 동안 본 것",
  "오늘 처음 본 것",
  "발밑의 풍경",
  "지금 이 순간의 소음"
];

export function topicForDate(dateStr) {
  const days = Math.floor(Date.parse(dateStr + "T00:00:00Z") / 86400000);
  return TOPIC_POOL[((days % TOPIC_POOL.length) + TOPIC_POOL.length) % TOPIC_POOL.length];
}

function fail(error) {
  throw new Error(error.message || "서버 요청에 실패했어요");
}

// ---------------- 인증 ----------------

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// 소셜 로그인(카카오·구글) — Supabase OAuth 페이지로 이동, 인증 후 이 앱 주소로 돌아온다.
// 계정 생성·비밀번호·복구는 전부 프로바이더(카카오/구글) 쪽 이메일 계정이 담당한다.
// 주의: Supabase는 카카오에 닉네임·이메일·프로필 사진 3개 동의를 항상 요청한다
// (클라이언트 scopes 옵션은 병합만 되고 제거 불가) — 카카오 콘솔 동의항목에서
// 세 항목이 모두 설정돼 있어야 KOE205가 나지 않는다. docs/oauth-setup.md 참고.
export async function signInWithProvider(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) fail(error);
}

export async function signOut() {
  await supabase.auth.signOut();
}

// 신고 접수 — 관리자(대시보드)가 검토 (migration-06)
export async function reportContent(uid, targetType, targetId, reason) {
  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    target_type: targetType,
    target_id: String(targetId),
    reason
  });
  // 같은 대상 중복 신고(unique 제약)는 이미 접수된 것으로 본다
  if (error && error.code !== "23505") fail(error);
}

// 탈퇴 시 내 Storage 폴더(사진·동영상·아바타) 비우기 — 계정 삭제 뒤에도
// JWT가 유효한 동안 photos_delete_own 정책으로 지울 수 있다. 실패해도 탈퇴는 진행.
export async function clearMyStorage(uid) {
  const bucket = supabase.storage.from("photos");
  for (let round = 0; round < 20; round++) {
    const { data, error } = await bucket.list(uid, { limit: 100 });
    if (error || !data?.length) break;
    const names = data.filter((f) => f.id).map((f) => `${uid}/${f.name}`);
    if (!names.length) break;
    await bucket.remove(names);
    if (data.length < 100) break;
  }
}

export async function deleteAccount(uid) {
  // 계정 삭제 뒤에는 같은 JWT라도 Storage API가 거부한다(E2E 실증) — 폴더를 먼저 비운다
  if (uid) await clearMyStorage(uid).catch(() => {});
  const { error } = await supabase.rpc("delete_own_account");
  if (error) fail(error);
  await supabase.auth.signOut();
}

export async function isHandleAvailable(handle) {
  const { data, error } = await supabase.rpc("is_handle_available", { candidate: handle });
  if (error) return false;
  return Boolean(data);
}

// ---------------- 허브 ----------------

// 주제 승인제 (migration-04): 운영자가 supabase/topics-weekly.sql로 미리 승인한 주제만 읽는다.
// 오늘 주제가 없으면 null — 클라이언트는 "주제 준비 중" 상태로 동작하고 게시가 잠긴다.
export async function fetchTodayHub() {
  const { data } = await supabase.from("hubs").select("topic").eq("hub_date", hubDateToday()).maybeSingle();
  return data?.topic || null;
}

// 지난 허브 주제 전체 — 룸 사진 확대 뷰에서 날짜별 주제를 보여주기 위해 사용
export async function fetchHubs() {
  const { data, error } = await supabase.from("hubs").select("hub_date, topic");
  if (error) return {};
  return Object.fromEntries((data || []).map((row) => [row.hub_date, row.topic]));
}

// ---------------- 데이터 로드 ----------------

export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) fail(error);
  return data;
}

export async function fetchPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select("*, comments(id, author_id, body, created_at)")
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return data;
}

export async function fetchFriendships() {
  const { data, error } = await supabase.from("friendships").select("*");
  if (error) fail(error);
  return data;
}

export async function fetchMyReveals(uid) {
  const { data, error } = await supabase.from("reveals").select("post_id").eq("user_id", uid);
  if (error) fail(error);
  return data.map((row) => row.post_id);
}

export async function countPostReveals(postId, exceptUid) {
  const { count, error } = await supabase
    .from("reveals")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId)
    .neq("user_id", exceptUid);
  if (error) return 0;
  return count || 0;
}

// ---------------- 게시 ----------------

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

// 동영상 등 블롭 업로드 — 사진과 같은 photos 버킷, 확장자로 종류를 구분한다
export async function uploadMedia(uid, blob, ext) {
  const path = `${uid}/post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: blob.type || "video/webm" });
  if (error) fail(error);
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadPhoto(uid, dataUrl, prefix = "post") {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `${uid}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
  if (error) fail(error);
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}

export async function createPost(uid, payload) {
  const { data, error } = await supabase
    .from("posts")
    .insert({
      author_id: uid,
      hub_date: hubDateToday(),
      image_url: payload.imageUrl,
      caption: payload.caption,
      ratio: payload.ratio,
      split: payload.split,
      filter: payload.filter,
      share_all: payload.shareAll,
      save_room: payload.saveRoom
    })
    .select("*, comments(id, author_id, body, created_at)")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("오늘의 허브에는 이미 응답했어요");
    fail(error);
  }
  return data;
}

// 캡션 수정·보관 이동/복원 (migration-05의 posts_update_own 정책 필요)
export async function updatePost(postId, patch) {
  const { error } = await supabase.from("posts").update(patch).eq("id", postId);
  if (error) fail(error);
}

export async function deletePost(postId) {
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) fail(error);
}

// 게시물 영구 삭제 시 스토리지 원본도 정리 (실패해도 무시 — DB 행 삭제가 우선)
export async function removePhotoByUrl(url) {
  const marker = "/photos/";
  const at = String(url).indexOf(marker);
  if (at < 0) return;
  const path = decodeURIComponent(String(url).slice(at + marker.length));
  await supabase.storage.from("photos").remove([path]).catch(() => {});
}

export async function addReveal(uid, postId) {
  await supabase.from("reveals").upsert({ user_id: uid, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true });
}

export async function deleteComment(commentId) {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) fail(error);
}

export async function addComment(uid, postId, body) {
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, author_id: uid, body })
    .select()
    .single();
  if (error) fail(error);
  return data;
}

// ---------------- 친구 ----------------

const pairOf = (a, b) => (a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a });

export async function sendFriendRequest(uid, otherUid) {
  const { error } = await supabase
    .from("friendships")
    .insert({ ...pairOf(uid, otherUid), requested_by: uid, status: "pending" });
  if (error && error.code !== "23505") fail(error);
}

export async function acceptFriend(uid, otherUid) {
  const pair = pairOf(uid, otherUid);
  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b);
  if (error) fail(error);
}

export async function removeFriendship(uid, otherUid) {
  const pair = pairOf(uid, otherUid);
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b);
  if (error) fail(error);
}

export async function blockFriend(uid, otherUid) {
  const pair = pairOf(uid, otherUid);
  const { error } = await supabase
    .from("friendships")
    .update({ status: "blocked", requested_by: uid })
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b);
  if (error) fail(error);
}

// 친구의 친구 추천 (migration-05 RPC). 마이그레이션 전이면 null 반환 → 클라이언트가 기존 추천으로 폴백
export async function fetchSuggestions() {
  const { data, error } = await supabase.rpc("friend_suggestions");
  if (error) return null;
  return data || [];
}

// ---------------- 연락처 친구 찾기 (migration-10) ----------------
// 번호 원본은 절대 저장하지 않는다 — 정규화·해시는 app.js(클라이언트)에서 끝내고 해시만 오간다.

// 내 번호 해시 등록/갱신 (지인이 연락처로 나를 찾을 수 있게)
export async function setMyContactHash(uid, phoneHash) {
  const { error } = await supabase
    .from("contact_hashes")
    .upsert({ user_id: uid, phone_hash: phoneHash, updated_at: new Date().toISOString() });
  if (error) fail(error);
}

// 내 번호 등록 여부 — 테이블이 없거나(마이그레이션 전) 미등록이면 null
export async function fetchMyContactHash(uid) {
  const { data, error } = await supabase
    .from("contact_hashes").select("phone_hash").eq("user_id", uid).maybeSingle();
  if (error) return null;
  return data?.phone_hash || null;
}

// 내 번호 삭제
export async function deleteMyContactHash(uid) {
  const { error } = await supabase.from("contact_hashes").delete().eq("user_id", uid);
  if (error) fail(error);
}

// 연락처 번호 해시 목록으로 가입자 매칭 → user_id 배열. 마이그레이션 전이면 빈 배열
export async function matchContacts(hashes) {
  if (!hashes || !hashes.length) return [];
  const { data, error } = await supabase.rpc("match_contacts", { hashes });
  if (error) return [];
  return (data || []).map((r) => r.user_id);
}

// ---------------- 웹 푸시 (migration-11 + notify Edge Function) ----------------

// 브라우저 PushManager 구독을 저장 (endpoint 기준 upsert — 같은 기기 재구독 시 갱신)
export async function savePushSubscription(uid, sub) {
  const json = typeof sub.toJSON === "function" ? sub.toJSON() : sub;
  const row = {
    user_id: uid,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || ""
  };
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(row, { onConflict: "endpoint" });
  if (error) fail(error);
}

// 이 기기의 구독 삭제 (알림 끄기)
export async function deletePushSubscription(endpoint) {
  if (!endpoint) return;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) fail(error);
}

// 대상자에게 웹 푸시 발송 요청 — 실제 발송/서명은 서버(notify Edge Function)가 한다.
// 실패해도 앱 흐름은 막지 않는다(파이어 앤 포겟). 알림 문구는 서버가 type으로 생성.
export async function notify(type, toUid) {
  if (!toUid) return;
  try {
    await supabase.functions.invoke("notify", { body: { type, toUid } });
  } catch (e) {
    // 알림 발송 실패는 조용히 무시 (기능 미배포·오프라인 등)
  }
}

// ---------------- 메시지 (DM, migration-05) ----------------

// 내가 참여한 모든 메시지 — RLS가 당사자 것만 반환. 테이블이 없으면(마이그레이션 전) 빈 배열
export async function fetchMessages() {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return [];
  return data;
}

export async function sendMessage(uid, otherUid, body) {
  const { data, error } = await supabase
    .from("messages")
    .insert({ sender_id: uid, recipient_id: otherUid, body })
    .select()
    .single();
  if (error) fail(error);
  return data;
}

// 내가 보낸 메시지 삭제 — 상대 화면에서도 사라진다 (migration-08의 delete 정책 필요)
export async function deleteMessage(messageId) {
  const { error } = await supabase.from("messages").delete().eq("id", messageId);
  if (error) fail(error);
}

export async function markMessagesRead(uid, otherUid) {
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", uid)
    .eq("sender_id", otherUid)
    .is("read_at", null);
}

// ---------------- Realtime ----------------

// 게시물·친구·댓글·메시지 변경을 실시간 수신 (migration-05에서 publication에 추가)
// RLS가 적용되므로 내가 볼 수 있는 행의 변경만 온다. 실패해도 앱은 폴백(수동 새로고침)으로 동작.
export function subscribeRealtime(onChange) {
  const channel = supabase.channel("blur-live");
  ["posts", "friendships", "comments", "messages"].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => onChange(table, payload));
  });
  channel.subscribe();
  return channel;
}

// ---------------- 프로필 ----------------

export async function updateProfile(uid, patch) {
  const { error } = await supabase.from("profiles").update(patch).eq("user_id", uid);
  if (error) {
    if (error.code === "23505") throw new Error("이미 사용 중인 아이디예요");
    fail(error);
  }
}
