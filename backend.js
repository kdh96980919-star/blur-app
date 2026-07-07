// Supabase 백엔드 어댑터 — app.js가 사용하는 서버 API 경계
// 설계: docs/backend-plan.md, 스키마: supabase/schema.sql + migration-02.sql
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 가입 시 아이디로 합성하는 인증용 이메일 (사용자에게 노출되지 않음)
const AUTH_DOMAIN = "blur-app.test";
const emailFor = (handle) => `${handle}@${AUTH_DOMAIN}`;

// 허브 날짜는 서버(current_date, UTC) 기준 — 한국시간 오전 9시에 새 허브가 열림
export function hubDateToday() {
  return new Date().toISOString().slice(0, 10);
}

// 날짜 기반 결정론적 주제 — 모든 클라이언트가 같은 값을 계산
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

export async function signUp(name, handle, password) {
  const { data, error } = await supabase.auth.signUp({
    email: emailFor(handle),
    password,
    options: { data: { name, handle } }
  });
  if (error) fail(error);
  return data.session;
}

export async function signIn(handle, password) {
  let email = emailFor(handle);
  // 아이디를 바꾼 계정도 로그인되도록 서버에서 인증 이메일 조회 (migration-02)
  const { data: mapped, error: rpcError } = await supabase.rpc("email_for_handle", { candidate: handle });
  if (!rpcError && mapped) email = mapped;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(error);
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function deleteAccount() {
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

export async function ensureTodayHub() {
  const hubDate = hubDateToday();
  const { data } = await supabase.from("hubs").select("topic").eq("hub_date", hubDate).maybeSingle();
  if (data) return data.topic;
  const topic = topicForDate(hubDate);
  // migration-02의 hubs_insert_today 정책 필요 — 실패해도 결정론적 주제로 동작
  await supabase.from("hubs").insert({ hub_date: hubDate, topic }).select().maybeSingle();
  return topic;
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

export async function addReveal(uid, postId) {
  await supabase.from("reveals").upsert({ user_id: uid, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true });
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

// ---------------- 프로필 ----------------

export async function updateProfile(uid, patch) {
  const { error } = await supabase.from("profiles").update(patch).eq("user_id", uid);
  if (error) {
    if (error.code === "23505") throw new Error("이미 사용 중인 아이디예요");
    fail(error);
  }
}
