import * as api from "./backend.js";
import { VAPID_PUBLIC_KEY } from "./config.js";

const LEGACY_STORAGE_KEY = "blur-service-state-v2";
const NOTIF_SEEN_KEY = "blur-notif-seen";
const app = document.querySelector("#app");
const photoInput = document.querySelector("#photo-input");
const albumInput = document.querySelector("#album-input");
const avatarInput = document.querySelector("#avatar-input");

// 허브 날짜는 매일 한국시간 오전 6시에 갱신 (backend.hubDateToday — KST 06:00 롤오버)
const HUB_DATE = api.hubDateToday();
const topicDate = `${HUB_DATE.slice(5, 7)}. ${HUB_DATE.slice(8, 10)}`;
// 허브는 운영자가 미리 승인한 것만 서버에서 내려옴 (없으면 빈 값 = 게시 잠금)
let topic = "";

const gradients = [
  "linear-gradient(135deg,#f7cedd,#b8d7d6 55%,#6c8093)",
  "linear-gradient(135deg,#e8b9cf,#ffe4a3 55%,#8f6f96)",
  "linear-gradient(135deg,#c6dae4,#f5d2c2 55%,#a87b86)",
  "linear-gradient(135deg,#f3b3c8,#c9e6c7 58%,#706c8c)",
  "linear-gradient(135deg,#e2d1f4,#f4c0bc 52%,#6aa392)",
  "linear-gradient(135deg,#b8cfe9,#f5d3e2 56%,#ad7b9a)",
  "linear-gradient(135deg,#ffd9b5,#dfbddc 50%,#7a8d9e)",
  "linear-gradient(135deg,#bdded6,#f0cada 57%,#9b6d82)"
];

const palette = ["#b06a92", "#6aa392", "#8f7cc2", "#d48b72", "#6d8aaa"];

const gallery = gradients.map((grad, index) => ({
  id: `g${index + 1}`,
  grad,
  label: String(index + 1).padStart(2, "0")
}));

// 동영상은 5초까지 — 이용자 부담을 줄이는 의도적 제한. 6초 이상은 선택 즉시 거부된다.
const MAX_VIDEO_SEC = 5;

function blankUpload() {
  return {
    open: false,
    step: "pick",
    selectedId: null,
    selectedImage: "",
    selectedVideo: "",
    videoDuration: 0,
    selectedLabel: "",
    selectedGrad: "",
    ratio: "4 / 5",
    srcRatio: "", // 고른 사진·영상의 실제 비율 ("원본" 칩의 값)
    zoom: 1,
    rot: 0,
    x: 0,
    y: 0,
    filter: "none",
    artPreviews: {},
    split: 1,
    caption: "",
    shareAll: true,
    saveRoom: true
  };
}

// ---------------- 배경 커스터마이징 (설정 > 배경) ----------------
// 시그니처 그라데이션의 두 색을 기기별로 바꾼다 — localStorage에 저장, 계정과 무관
const BG_STORE_KEY = "blur-bg";
const BG_DEFAULT = { c1: "#6cc8f7", c2: "#7bffba" };

function applyBg(c1, c2, save = true) {
  state.bgC1 = c1;
  state.bgC2 = c2;
  document.documentElement.style.setProperty("--bg-c1", c1);
  document.documentElement.style.setProperty("--bg-c2", c2);
  if (save) {
    try { localStorage.setItem(BG_STORE_KEY, JSON.stringify({ c1, c2 })); } catch {}
  }
}

function restoreBg() {
  try {
    const saved = JSON.parse(localStorage.getItem(BG_STORE_KEY) || "null");
    if (saved?.c1 && saved?.c2) applyBg(saved.c1, saved.c2, false);
  } catch {}
}

function defaultState() {
  return {
    auth: "loading",
    tab: "home",
    entered: false,
    me: "",
    people: [],
    profile: { name: "", id: "", color: palette[0], emoji: "", photo: "", bio: "" },
    myPublic: false,
    notif: true,
    myPosted: false,
    visitors: 0,
    friends: [],
    reqs: [],
    reqAt: {},
    acceptedAt: [],
    recs: [],
    fofMutual: {},
    contactHit: {},
    myPhoneSet: false,
    phoneSheet: null,
    push: false,
    sentRequests: {},
    posts: [],
    revealed: {},
    hubTopics: {},
    messages: [],
    notifSeen: Number(localStorage.getItem(NOTIF_SEEN_KEY) || 0),
    signup: { name: "", id: "", avail: null },
    onboard: null,
    provider: "",
    search: "",
    chatSearch: "",
    bgC1: BG_DEFAULT.c1,
    bgC2: BG_DEFAULT.c2,
    upload: blankUpload(),
    edit: null,
    postEdit: null,
    overlays: {
      commentsFor: "",
      privateUser: "",
      publicUser: "",
      friendUser: "",
      actionsFor: "",
      settings: false,
      archive: false,
      purgeFor: "",
      notif: false,
      notifFull: false,
      reportFor: null,
      chatWith: "",
      logout: false,
      viewerPost: "",
      dmDelete: ""
    },
    leave: { open: false, reason: "", agree: false, confirm: false, done: false },
    toast: "",
    busy: "",
    offline: typeof navigator !== "undefined" && navigator.onLine === false
  };
}

let state = defaultState();
restoreBg();
let longPressTimer = null;
let longPressFired = false;
let toastTimer = null;
let handleCheckTimer = null;
let lastMainSig = "";
let lastOvSig = "";

// 데모(localStorage) 시절 데이터 정리 — 이제 데이터는 서버에 있음
localStorage.removeItem(LEGACY_STORAGE_KEY);

function update(mutator) {
  mutator(state);
  render();
}

function toast(message) {
  clearTimeout(toastTimer);
  update((s) => {
    s.toast = message;
  });
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 2600);
}

// ---------------- 서버 데이터 매핑 ----------------

function mapProfile(row) {
  return {
    uid: row.user_id,
    id: row.handle,
    name: row.name,
    color: row.color || palette[0],
    emoji: row.emoji || "",
    photo: row.avatar_url || "",
    bio: row.bio || "",
    public: row.is_public
  };
}

function uidOf(handle) {
  if (handle === "me") return state.me;
  return state.people.find((p) => p.id === handle)?.uid || "";
}

function handleOf(uid) {
  if (uid === state.me) return "me";
  return state.people.find((p) => p.uid === uid)?.id || "";
}

function dayLabel(hubDate) {
  const diff = Math.round((Date.parse(HUB_DATE) - Date.parse(hubDate)) / 86400000);
  return diff <= 0 ? "오늘" : `${diff}일 전`;
}

function mapPost(row) {
  const isGrad = String(row.image_url).startsWith("grad:");
  const gradIndex = isGrad ? Number(row.image_url.slice(5)) : 0;
  // 동영상도 image_url 한 칼럼을 그대로 쓴다 — 확장자로 구분 (스키마 변경 없음)
  const isVideo = /\.(webm|mp4)($|\?)/i.test(String(row.image_url || ""));
  return {
    id: row.id,
    authorId: handleOf(row.author_id),
    hubDate: row.hub_date,
    time: new Date(row.created_at).toTimeString().slice(0, 5),
    at: Date.parse(row.created_at) || 0,
    caption: row.caption || "",
    ratio: row.ratio || "4 / 5",
    split: Number(row.split || 1),
    filter: row.filter || "none",
    grad: gradients[((gradIndex % gradients.length) + gradients.length) % gradients.length],
    image: isGrad || isVideo ? "" : row.image_url,
    video: isVideo ? row.image_url : "",
    public: Boolean(row.share_all),
    archived: Boolean(row.archived),
    label: dayLabel(row.hub_date),
    comments: (row.comments || [])
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((c) => ({
        id: c.id,
        by: c.author_id === state.me ? "me" : handleOf(c.author_id),
        text: c.body,
        at: Date.parse(c.created_at) || 0
      }))
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    from: row.sender_id === state.me ? "me" : handleOf(row.sender_id),
    to: row.recipient_id === state.me ? "me" : handleOf(row.recipient_id),
    body: row.body,
    at: Date.parse(row.created_at) || 0,
    read: Boolean(row.read_at)
  };
}

function applySocial(s, rows) {
  const friends = [];
  const reqs = [];
  const reqAt = {};
  const accepted = [];
  const sent = {};
  rows.forEach((row) => {
    const otherUid = row.user_a === s.me ? row.user_b : row.user_a;
    const handle = s.people.find((p) => p.uid === otherUid)?.id;
    if (!handle) return;
    if (row.status === "accepted") {
      friends.push(handle);
      if (row.requested_by === s.me) accepted.push({ handle, at: Date.parse(row.created_at) || 0 });
    } else if (row.status === "pending" && row.requested_by === s.me) sent[handle] = true;
    else if (row.status === "pending") {
      reqs.push(handle);
      reqAt[handle] = Date.parse(row.created_at) || 0;
    }
  });
  s.friends = friends;
  s.reqs = reqs;
  s.reqAt = reqAt;
  s.acceptedAt = accepted;
  s.sentRequests = sent;
  // 추천 풀: 친구의 친구(RPC)가 우선, 그 뒤에 나머지 사용자 (applySuggestions에서 병합)
  s.recs = s.people
    .filter((p) => p.uid !== s.me && !friends.includes(p.id) && !reqs.includes(p.id))
    .map((p) => p.id);
}

// 친구의 친구를 추천 목록 맨 앞에 배치 (겹치는 친구 수 포함)
function applySuggestions(s, suggestions) {
  s.fofMutual = {};
  if (!suggestions || !suggestions.length) return;
  const fofHandles = [];
  suggestions.forEach((row) => {
    const handle = s.people.find((p) => p.uid === row.user_id)?.id;
    if (!handle || s.friends.includes(handle) || s.reqs.includes(handle)) return;
    fofHandles.push(handle);
    s.fofMutual[handle] = Number(row.mutual_count || 0);
  });
  s.recs = [...fofHandles, ...s.recs.filter((id) => !fofHandles.includes(id))];
}

async function loadAll(uid) {
  const [profiles, posts, friendRows, revealIds, hubTopics, suggestions, messageRows, myPhoneHash] = await Promise.all([
    api.fetchProfiles(),
    api.fetchPosts(),
    api.fetchFriendships(),
    api.fetchMyReveals(uid),
    api.fetchHubs(),
    api.fetchSuggestions().catch(() => null),
    api.fetchMessages().catch(() => []),
    api.fetchMyContactHash(uid).catch(() => null)
  ]);
  state.myPhoneSet = Boolean(myPhoneHash);
  state.me = uid;
  state.hubTopics = hubTopics || {};
  topic = state.hubTopics[HUB_DATE] || "";
  state.people = profiles.map(mapProfile);
  const rawMine = profiles.find((row) => row.user_id === uid);
  if (rawMine) {
    const mine = mapProfile(rawMine);
    state.profile = { name: mine.name, id: mine.id, color: mine.color, emoji: mine.emoji, photo: mine.photo, bio: mine.bio };
    state.myPublic = mine.public;
    state.notif = rawMine.notif !== false;
    // OAuth 첫 로그인이면 아직 이름·아이디를 정하지 않은 상태 (migration-09의 setup_done)
    state.setupNeeded = rawMine.setup_done === false;
  }
  state.posts = posts.map(mapPost);
  applySocial(state, friendRows);
  applySuggestions(state, suggestions);
  state.messages = messageRows.map(mapMessage);
  state.revealed = Object.fromEntries(revealIds.map((id) => [id, true]));
  state.posts.filter((p) => p.authorId === "me").forEach((p) => { state.revealed[p.id] = true; });
  const myToday = state.posts.find((p) => p.authorId === "me" && p.hubDate === HUB_DATE);
  state.myPosted = Boolean(myToday);
  state.visitors = myToday ? await api.countPostReveals(myToday.id, uid) : 0;
}

// 실시간 이벤트·탭 복귀 시 서버 데이터 재적재 (연타 방지 디바운스)
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshData, 450);
}

async function refreshData() {
  if (state.auth !== "app" || !state.me) return;
  try {
    await loadAll(state.me);
    render();
  } catch {}
}

async function boot() {
  // OAuth 리다이렉트 복귀 처리 — 에러 파라미터는 안내하고, 인증 잔여물은 주소창에서 지운다
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const oauthError = search.get("error_description") || hash.get("error_description");
  try {
    const session = await api.getSession();
    if (/[?#&](code|access_token|error)=/.test(location.search + location.hash) || search.has("code")) {
      history.replaceState(null, "", location.pathname);
    }
    if (!session) {
      // 오프라인이면 세션 갱신이 실패해 null이 올 수 있다 — 웰컴(로그인 불가) 대신 오프라인 화면
      if (navigator.onLine === false) {
        state = defaultState();
        state.auth = "offline";
        state.offline = true;
        render();
        return;
      }
      state = defaultState();
      state.auth = "welcome";
      render();
      if (oauthError) toast("로그인이 취소되었거나 실패했어요");
      return;
    }
    await loadAll(session.user.id);
    state.provider = session.user.app_metadata?.provider || "";
    if (state.setupNeeded) {
      // OAuth 첫 로그인 — 이름·아이디를 정하는 화면으로 (이름은 소셜 프로필에서 미리 채움)
      state.auth = "setup";
      const prefill = state.profile.name === "이름없음" ? "" : state.profile.name;
      state.signup = { name: prefill.slice(0, 12), id: "", avail: null };
      return render();
    }
    state.auth = "app";
    render();
    startLive();
  } catch (error) {
    // 연결이 없어 데이터를 못 받은 경우 — 웰컴으로 튕기지 않고 오프라인 화면을 보여준다.
    // (세션은 로컬에 있어 getSession은 통과하고, loadAll의 서버 요청만 실패하는 상황)
    if (navigator.onLine === false) {
      state = defaultState();
      state.auth = "offline";
      state.offline = true;
      render();
      return;
    }
    state = defaultState();
    state.auth = "welcome";
    render();
    toast(error.message || "연결에 실패했어요");
  }
}

// 실시간 구독·탭 복귀 재적재 — 앱 화면에 들어갈 때 한 번만 등록
let liveStarted = false;
function startLive() {
  if (liveStarted) return;
  liveStarted = true;
  api.subscribeRealtime(() => scheduleRefresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleRefresh();
  });
  syncPushOnLoad();
}

// ---------------- 웹 푸시 (migration-11 + notify Edge Function) ----------------
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!pushSupported()) { toast("이 기기는 잠금화면 알림을 지원하지 않아요"); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("알림 권한이 꺼져 있어요 — 기기 설정에서 허용해주세요"); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await api.savePushSubscription(state.me, sub);
    return true;
  } catch (e) {
    toast("알림을 켜지 못했어요");
    return false;
  }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.deletePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { /* 무시 */ }
}

// 로그인 후 — 이미 권한이 허용돼 있으면 구독을 조용히 갱신(엔드포인트가 만료·회전될 수 있음)
async function syncPushOnLoad() {
  if (!pushSupported() || Notification.permission !== "granted") {
    if (state.push) update((s) => { s.push = false; });
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api.savePushSubscription(state.me, sub); }
    update((s) => { s.push = Boolean(sub); });
  } catch (e) { /* 무시 */ }
}

async function togglePush() {
  if (state.push) {
    await disablePush();
    update((s) => { s.push = false; });
    toast("잠금화면 알림을 껐어요");
  } else {
    const ok = await enablePush();
    update((s) => { s.push = ok; });
    if (ok) toast("잠금화면 알림을 켰어요");
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function personById(id) {
  if (id === "me") {
    return {
      id: state.profile.id,
      name: state.profile.name,
      color: state.profile.color,
      public: state.myPublic,
      photo: state.profile.photo,
      emoji: state.profile.emoji
    };
  }
  return state.people.find((u) => u.id === id);
}

function normalizeId(value) {
  return value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "").slice(0, 16);
}

function validId(value) {
  return /^[a-z0-9_]{3,16}$/.test(value);
}

// 아이디 중복 검사 — 서버 RPC를 디바운스 호출, 결과는 signup.avail / edit.avail에 저장.
// 재렌더 없이 힌트/버튼만 부분 패치 (타이핑 중 입력창을 교체하면 모바일 IME가 끊김)
function scheduleHandleCheck(kind) {
  clearTimeout(handleCheckTimer);
  const target = () => (kind === "signup" ? state.signup : state.edit);
  const value = normalizeId(target()?.id || "");
  const apply = (v) => {
    const t = target();
    if (!t) return;
    t.avail = v;
    patchHandleHint(kind);
  };
  if (!value) return apply(null);
  if (!validId(value)) return apply(false);
  if (kind === "edit" && value === state.profile.id) return apply(true);
  apply("checking");
  handleCheckTimer = setTimeout(async () => {
    const ok = await api.isHandleAvailable(value);
    const t = target();
    if (t && normalizeId(t.id) === value) {
      t.avail = ok;
      patchHandleHint(kind);
    }
  }, 350);
}

// ---------------- 타이핑 중 부분 패치 (전체 재렌더 금지) ----------------

function setHint(key, text, cls = "") {
  const el = app.querySelector(`[data-hint="${key}"]`);
  if (!el) return;
  el.className = `hint ${cls}`.trim();
  el.textContent = text;
  el.style.display = text ? "" : "none";
}

function patchSignupSubmit() {
  const btn = app.querySelector('[data-submit="signup"]');
  if (!btn) return;
  const on = signupEnabled();
  btn.disabled = !on;
  btn.classList.toggle("disabled", !on);
}

function patchHandleHint(kind) {
  if (kind === "signup") {
    const hint = signupIdHintState();
    setHint("signup.id", hint.text, hint.cls);
    patchSignupSubmit();
  } else {
    const hint = editIdHintState();
    setHint("edit.id", hint.text, hint.cls);
  }
}

function patchAfterInput(field, el) {
  if (field === "signup.name") {
    setHint("signup.name", `${state.signup.name.length}/12`);
    patchSignupSubmit();
  } else if (field === "signup.id") {
    const norm = normalizeId(state.signup.id);
    if (el.value !== norm) el.value = norm;
    scheduleHandleCheck("signup");
  } else if (field === "edit.id") {
    const norm = normalizeId(state.edit.id);
    if (el.value !== norm) el.value = norm;
    scheduleHandleCheck("edit");
  } else if (field === "edit.bio") {
    setHint("edit.bio", `${(state.edit.bio || "").length}/80`);
  } else if (field === "search") {
    const box = app.querySelector('[data-results="friends"]');
    if (box) box.innerHTML = friendsListHtml();
  } else if (field === "chatSearch") {
    const box = app.querySelector('[data-results="chat"]');
    if (box) box.innerHTML = chatListHtml();
  } else if (field === "upload.zoom") {
    patchUploadTransform();
  } else if (field === "onboard.color" || field === "edit.color") {
    // 그라데이션 색을 직접 고를 때도 사진 프로필은 즉시 내려놓는다
    if (field === "edit.color" && state.edit?.photo) {
      state.edit.photo = "";
      return render();
    }
    // 색 드래그 중 전체 재렌더 금지 — 미리보기와 점 선택 상태만 부분 패치
    patchColorPick(field.split(".")[0]);
  } else if (field.startsWith("bgC")) {
    // 배경 두 색 즉시 적용
    applyBg(state.bgC1, state.bgC2);
  }
}

// 프로필 색 선택 — 미리보기 원·팔레트 점·상단 아바타만 부분 패치
function patchColorPick(scope) {
  const box = app.querySelector(`[data-color-pick="${scope}"]`);
  if (!box) return;
  const color = scope === "onboard" ? state.onboard?.color : state.edit?.color;
  const preview = box.querySelector("[data-color-preview]");
  if (preview) preview.style.background = avatarFill(color);
  box.querySelectorAll(".color-dot").forEach((dot) => dot.classList.toggle("on", dot.dataset.color === color));
  const custom = box.querySelector(".color-custom");
  if (custom && custom.value !== color && /^#[0-9a-fA-F]{6}$/.test(color || "")) custom.value = color;
  const bigPreview = app.querySelector("[data-edit-avatar]");
  if (bigPreview && scope === "edit" && !state.edit?.photo) bigPreview.style.background = avatarFill(color);
}

// 업로드 편집 프리뷰의 변형만 부분 패치 (드래그/슬라이더 중 전체 재렌더 금지)
function patchUploadTransform() {
  const img = app.querySelector("[data-upload-img]");
  if (img) img.style.transform = uploadTransform(state.upload);
  const range = app.querySelector(".zoom-range");
  if (range && Number(range.value) !== state.upload.zoom) range.value = state.upload.zoom;
}

function icon(name, size = 23) {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    plus: `<svg ${common}><path d="M12 5v14M5 12h14"></path></svg>`,
    check: `<svg ${common}><path d="M20 6 9 17l-5-5"></path></svg>`,
    x: `<svg ${common}><path d="M18 6 6 18M6 6l12 12"></path></svg>`,
    "arrow-left": `<svg ${common}><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg>`,
    dots: `<svg ${common}><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>`,
    chevron: `<svg ${common}><path d="m9 18 6-6-6-6"></path></svg>`,
    search: `<svg ${common}><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.35-4.35"></path></svg>`,
    pencil: `<svg ${common}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>`,
    lock: `<svg ${common}><rect x="4" y="11" width="16" height="10" rx="2.5"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>`,
    "arrow-up": `<svg ${common}><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>`,
    sun: `<svg ${common}><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path></svg>`,
    grid: `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>`,
    users: `<svg ${common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    heart: `<svg ${common}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"></path></svg>`,
    cloud: `<svg ${common}><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>`,
    "wifi-off": `<svg ${common}><path d="M1 1l22 22"></path><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><path d="M12 20h.01"></path></svg>`,
    user: `<svg ${common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    camera: `<svg ${common}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`,
    image: `<svg ${common}><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>`,
    message: `<svg ${common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`,
    bell: `<svg ${common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
    rotate: `<svg ${common}><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
    trash: `<svg ${common}><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    edit: `<svg ${common}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"></path></svg>`,
    send: `<svg ${common}><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4z"></path></svg>`,
    flag: `<svg ${common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><path d="M4 22v-7"></path></svg>`,
    settings: `<svg ${common}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
  };
  return icons[name] || "";
}

/* "16 / 9" 같은 비율 문자열 → [가로, 세로]. 프리셋뿐 아니라 사진 원본 비율
   ("1.778 / 1")도 그대로 다루기 위해 일반 파서로 둔다. */
function parseRatio(ratio) {
  const [w, h] = String(ratio || "").split("/").map((n) => parseFloat(n));
  if (!(w > 0) || !(h > 0)) return [4, 5];
  return [w, h];
}

/* 사진 원본 비율을 그대로 쓰되, 파노라마·초장방형이 카드 레이아웃을 무너뜨리지
   않도록 가로:세로 0.4~2.5 범위로만 제한한다. 일반적인 사진은 전부 이 안에 든다. */
function ratioOf(w, h) {
  if (!(w > 0) || !(h > 0)) return "4 / 5";
  const ar = Math.min(2.5, Math.max(0.4, w / h));
  return `${Math.round(ar * 1000) / 1000} / 1`;
}

/* 자르기 칩 — '원본'이 맨 앞이자 기본. 원본이 프리셋과 사실상 같은 비율이면
   같은 칩이 둘로 보이지 않게 그 프리셋은 뺀다(정사각 사진 = 1:1). */
function ratioChoices(srcRatio) {
  const presets = [["1 / 1", "1:1"], ["4 / 5", "4:5"], ["16 / 9", "16:9"]];
  if (!srcRatio) return presets;
  const [sw, sh] = parseRatio(srcRatio);
  const src = sw / sh;
  const same = ([value]) => {
    const [w, h] = parseRatio(value);
    return Math.abs(w / h - src) < 0.01;
  };
  return [[srcRatio, "원본"], ...presets.filter((p) => !same(p))];
}

// 업로드 프리뷰 폭 — 어떤 비율이든 세로가 380px을 넘지 않게 폭을 잡는다
function ratioWidth(ratio) {
  const [w, h] = parseRatio(ratio);
  return `${Math.round(Math.min(320, 380 * (w / h)))}px`;
}

// 필터는 CSS 변수(--tone)로 실제 이미지에도 적용된다.
// 값은 "none" 대신 saturate(1)을 기본으로 — blur()와 합성할 때 유효한 필터 목록을 유지하기 위함
function toneFilter(name) {
  return {
    warm: "sepia(.28) saturate(1.2) brightness(1.04) hue-rotate(-8deg)",
    vivid: "saturate(1.5) contrast(1.14)",
    calm: "saturate(.68) brightness(1.08) contrast(.94)",
    mono: "grayscale(1) contrast(1.06)",
    none: "saturate(1)"
  }[name] || "saturate(1)";
}

function variantGradient(post, index) {
  if (index === 0) return post.grad;
  return gradients[(gradients.indexOf(post.grad) + index + gradients.length) % gradients.length] || post.grad;
}

function mediaFrame(post, size = "large", options = {}) {
  // blur는 오늘 사진에만 — 지난 허브의 사진은 어디서든 바로 선명하게 보인다
  const pastPost = post.hubDate && post.hubDate !== HUB_DATE;
  const revealed = options.forceReveal || pastPost || state.revealed[post.id];
  const hiddenClass = revealed ? "revealed" : "blurred";
  const action = options.noReveal ? "" : `data-action="reveal" data-post="${escapeHtml(post.id)}"`;
  const ratio = options.square ? "1 / 1" : post.ratio || "4 / 5";
  const split = Number(post.split || 1);
  const tiles = split === 4 ? 4 : split;
  const columns = split === 4 ? "repeat(2, 1fr)" : `repeat(${tiles}, 1fr)`;
  const inner = post.video
    ? `<video class="media-img" src="${post.video}" autoplay muted loop playsinline></video>`
    : post.image
      ? `<img class="media-img" src="${post.image}" alt="">`
      : `<div class="media-content" style="grid-template-columns:${columns}">
        ${Array.from({ length: tiles }, (_, i) => `<div style="background:${variantGradient(post, i)}"></div>`).join("")}
      </div>`;
  // 블러 상태 표시는 작성자 프로필 사진 원형만 — 사진 어디를 탭해도 풀린다
  const overlay = revealed || !options.person
    ? ""
    : `<div class="media-overlay">${avatar(options.person, "avatar-chip")}</div>`;
  return `<div class="media-frame ${size} ${hiddenClass}" ${action} style="aspect-ratio:${ratio};--tone:${toneFilter(post.filter)}">
    ${inner}
    ${overlay}
    ${options.chrome || ""}
  </div>`;
}

// 기본 프로필 — 선택한 색이 중심에서 흰색으로 자연스럽게 스며드는 가우시안 라디얼
// (참조: gradient_customizer_circle_1 — weight = e^(-r²/2σ²), σ = 반지름의 42%)
function avatarFill(color) {
  const c = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : palette[0];
  const v = parseInt(c.slice(1), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const stops = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = Math.exp(-(t * t) / (2 * 0.42 * 0.42));
    const rr = Math.round(255 + (r - 255) * w);
    const gg = Math.round(255 + (g - 255) * w);
    const bb = Math.round(255 + (b - 255) * w);
    stops.push(`rgb(${rr},${gg},${bb}) ${Math.round(t * 100)}%`);
  }
  return `radial-gradient(circle closest-side, ${stops.join(", ")})`;
}

function avatar(person, sizeClass = "avatar") {
  if (person?.photo) {
    return `<div class="${sizeClass}" style="background:${person.color}"><img src="${person.photo}" alt=""></div>`;
  }
  // 기본 프로필은 그라데이션만 — 이니셜·이모지 글자는 넣지 않는다
  return `<div class="${sizeClass}" style="background:${avatarFill(person?.color)}"></div>`;
}

function postComments(post) {
  return post.comments || [];
}

function postsForHome() {
  return state.posts.filter((post) => post.hubDate === HUB_DATE && !post.archived && (post.authorId === "me" || state.friends.includes(post.authorId)));
}

function postsForAll() {
  // 베타 피드백 12: '모두 공개' 글은 친구를 포함한 모든 이용자의 것이 전체 탭에 보인다
  return state.posts.filter((post) => post.hubDate === HUB_DATE && post.public && !post.archived);
}

function postsByAuthor(authorId) {
  return state.posts.filter((post) => post.authorId === authorId && !post.archived);
}

// 화면 구성 서명 — 주 화면과 오버레이를 따로 비교해, 바뀌지 않은 층의
// 진입 애니메이션을 끈다 (시트를 열 때 뒤 화면이 흔들리는 문제 방지)
function mainSignature() {
  return [state.auth, state.tab, state.entered].join("|");
}

function overlaySignature() {
  const o = state.overlays;
  return [
    state.upload.open && state.upload.step,
    o.commentsFor, o.friendUser, o.publicUser, o.privateUser, o.actionsFor,
    o.settings, o.archive, o.purgeFor, o.notif, o.chatWith, o.logout, o.viewerPost,
    Boolean(state.edit), Boolean(state.postEdit), state.leave.open, state.leave.confirm, state.leave.done,
    Boolean(o.reportFor), o.dmDelete, Boolean(state.phoneSheet),
    state.onboard ? `ob${state.onboard.step}` : ""
  ].join("|");
}

function render() {
  const active = document.activeElement;
  const activeField = active && app.contains(active) ? active.dataset.field : "";
  const selStart = activeField && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const selEnd = activeField && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  const scrolls = [...app.querySelectorAll(".screen-scroll")].map((el) => el.scrollTop);
  const oldCarousel = app.querySelector("[data-carousel]");
  const carouselLeft = oldCarousel ? oldCarousel.scrollLeft : 0;
  const oldChat = app.querySelector("[data-chat-scroll]");
  const chatState = oldChat
    ? { top: oldChat.scrollTop, nearBottom: oldChat.scrollHeight - oldChat.scrollTop - oldChat.clientHeight < 140 }
    : null;
  const mainSig = mainSignature();
  const ovSig = overlaySignature();
  const mainSame = mainSig === lastMainSig;
  const ovSame = ovSig === lastOvSig;
  lastMainSig = mainSig;
  lastOvSig = ovSig;
  const content = state.auth === "loading"
    ? loadingView()
    : state.auth === "offline"
      ? offlineView()
      : state.auth === "welcome"
        ? welcomeView()
        : state.auth === "setup"
          ? setupView()
          : appView();
  app.innerHTML = `<div class="phone${mainSame ? " no-anim-main" : ""}${ovSame ? " no-anim-ov" : ""}">${content}${offlineBanner()}${busyView()}${toastView()}</div>`;
  if (mainSame) {
    [...app.querySelectorAll(".screen-scroll")].forEach((el, i) => {
      if (scrolls[i]) el.scrollTop = scrolls[i];
    });
    const newCarousel = app.querySelector("[data-carousel]");
    if (newCarousel && carouselLeft) newCarousel.scrollLeft = carouselLeft;
  }
  if (activeField) {
    const el = app.querySelector(`[data-field="${activeField}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart !== null && typeof el.setSelectionRange === "function") {
        try { el.setSelectionRange(Math.min(selStart, el.value.length), Math.min(selEnd, el.value.length)); } catch {}
      }
    }
  }
  const newChat = app.querySelector("[data-chat-scroll]");
  if (newChat) {
    // 새로 열렸거나 바닥 근처를 보고 있었다면 최신 메시지로, 위로 스크롤해 읽는 중이면 그 자리 유지
    if (!chatState || chatState.nearBottom) newChat.scrollTop = newChat.scrollHeight;
    else newChat.scrollTop = chatState.top;
  }
  afterRender();
}

// 로딩 화면 — 흐릿한 색 방울이 초점으로 서서히 맺혔다 풀리며(앱의 blur 해제 은유),
// 그 위에 유리 디스크가 떠 있는 리퀴드 글라스. 스피너 대신 blur다운 미감.
function loadingView() {
  return `<section class="screen load-scene">
    <div class="load-stage">
      <div class="load-orb"></div>
      <div class="load-glass"></div>
    </div>
    <div class="load-word brand logo">blur</div>
  </section>`;
}

// 오프라인 전용 화면 — 로그인 상태로 앱을 열었는데 연결이 없어 데이터를 못 받을 때.
// 앱 껍데기(HTML/CSS/JS)는 서비스 워커 캐시로 뜨므로 이 화면까지는 항상 보인다.
function offlineView() {
  return `<section class="screen offline-screen">
    <div class="offline-box">
      <div class="offline-icon">${icon("wifi-off", 30)}</div>
      <h2 class="offline-title">인터넷 연결이 없어요</h2>
      <p class="offline-sub">연결 상태를 확인하고<br>다시 시도해 주세요.</p>
      <button class="btn" style="min-width:150px" data-action="retry-boot">다시 시도</button>
    </div>
  </section>`;
}

// 앱을 쓰는 도중 연결이 끊기면 위에 얇게 걸리는 안내 배너 (연결되면 자동으로 사라짐)
function offlineBanner() {
  if (!state.offline || state.auth !== "app") return "";
  return `<div class="offline-banner">${icon("wifi-off", 13)}<span>오프라인 · 자동으로 다시 연결돼요</span></div>`;
}

function welcomeView() {
  return `<section class="screen welcome" ${state.entered ? "" : `data-action="welcome-enter"`}>
    <div class="welcome-hero">
      <div class="wordmark">blur</div>
      <p class="welcome-sub">오늘이 선명해지는 순간</p>
    </div>
    ${state.entered
      ? `<div class="welcome-auth">
          <div class="auth-stack">
            <button class="btn social kakao" data-action="social" data-provider="kakao"><span class="social-mark">K</span>카카오로 계속하기</button>
            <button class="btn social google" data-action="social" data-provider="google"><span class="social-mark">G</span>Google로 계속하기</button>
          </div>
          <div class="hint" style="margin-top:16px">처음이면 계정이 만들어지고, 이미 가입했다면 바로 로그인돼요.<br>계속하면 <a href="./legal/terms.html" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">이용약관</a>과 <a href="./legal/privacy.html" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">개인정보 처리방침</a>에 동의한 것으로 간주돼요.</div>
        </div>`
      : `<div class="welcome-tap">화면을 탭해 시작하기</div>`}
  </section>`;
}

// 가입 폼 상태 헬퍼 — 렌더와 타이핑 중 부분 패치가 같은 로직을 공유
function signupIdHintState() {
  const id = normalizeId(state.signup.id);
  const avail = state.signup.avail;
  if (!id) return { text: "영문 소문자, 숫자, _ 조합 3-16자", cls: "" };
  if (!validId(id)) return { text: "아이디는 3-16자의 영문/숫자/_만 가능해요", cls: "bad" };
  if (avail === "checking") return { text: "아이디 확인 중…", cls: "" };
  if (avail === false) return { text: "이미 사용 중인 아이디예요", cls: "bad" };
  if (avail === true) return { text: "사용할 수 있는 아이디예요 · 나만 쓰는 고유한 이름이 돼요", cls: "good" };
  return { text: "영문 소문자, 숫자, _ 조합 3-16자", cls: "" };
}

function signupEnabled() {
  const nameOk = state.signup.name.trim().length > 0 && state.signup.name.trim().length <= 12;
  return nameOk && validId(normalizeId(state.signup.id)) && state.signup.avail === true;
}

function editIdHintState() {
  const avail = state.edit?.avail;
  if (avail === "checking") return { text: "아이디 확인 중…", cls: "" };
  if (avail === false) return { text: "이미 사용 중이거나 형식이 맞지 않아요", cls: "bad" };
  return { text: "사용할 수 있는 아이디예요", cls: "good" };
}

// 프로필 색 선택 — 가입·프로필 수정이 공유. 미리보기 원 + 팔레트 점 + 직접 선택
function colorPicker(scope, color, { preview = true } = {}) {
  return `<div class="color-pick" data-color-pick="${scope}">
    ${preview ? `<div class="color-preview" data-color-preview style="background:${avatarFill(color)}"></div>` : ""}
    <div class="hint" style="text-align:center">선택한 색이 기본 프로필 사진이 돼요</div>
    <div class="color-dots">
      ${palette.map((c) => `<button type="button" class="color-dot ${c === color ? "on" : ""}" style="background:${avatarFill(c)}" data-action="pick-color" data-scope="${scope}" data-color="${c}" aria-label="프로필 색 ${c}"></button>`).join("")}
      <input type="color" class="bg-swatch color-custom" data-field="${scope}.color" value="${escapeHtml(color)}" aria-label="직접 색 선택">
    </div>
  </div>`;
}

// OAuth 첫 로그인 직후 — 친구들이 알아볼 이름과 고유 아이디를 정하는 화면
function setupView() {
  const id = normalizeId(state.signup.id);
  const enabled = signupEnabled();
  const idHint = signupIdHintState();
  return `<section class="screen">
    <div class="auth-card">
      <h1>blur 시작하기</h1>
      <div class="subtitle">${providerLabel(state.provider)} 계정으로 연결됐어요.<br>친구들이 알아볼 이름과 고유 아이디를 정해주세요.</div>
      <div class="auth-stack">
        <label>
          <input class="input" data-field="signup.name" maxlength="12" value="${escapeHtml(state.signup.name)}" placeholder="이름">
          <div class="hint" data-hint="signup.name">${state.signup.name.length}/12</div>
        </label>
        <label>
          <input class="input" data-field="signup.id" maxlength="16" value="${escapeHtml(id)}" placeholder="@아이디">
          <div class="hint ${idHint.cls}" data-hint="signup.id">${idHint.text}</div>
        </label>
        <button class="btn ${enabled ? "" : "disabled"}" ${enabled ? "" : "disabled"} data-submit="signup" data-action="setup-submit">시작하기</button>
        <button class="text-link" style="background:transparent;text-align:center" data-action="setup-cancel">다른 계정으로 할래요</button>
      </div>
    </div>
  </section>`;
}

function providerLabel(provider) {
  return { kakao: "카카오", google: "Google" }[provider] || "소셜";
}

function appView() {
  return `${tabView()}${tabbar()}${overlayViews()}`;
}

function tabView() {
  if (state.tab === "all") return allView();
  if (state.tab === "chat") return chatListView();
  if (state.tab === "friends") return friendsView();
  if (state.tab === "my") return myView();
  return homeView();
}

// 화면 높이에 따라 사진 폭을 줄여 이름·댓글이 잘리지 않게 하는 카드 폭 계산 (베타 피드백 3)
function bellButton() {
  const unseen = notifItems().filter((n) => n.at > state.notifSeen).length;
  return `<button class="icon-btn bell" aria-label="알림" data-action="open-notif" data-unseen="${unseen}">
    ${icon("bell", 18)}${unseen ? `<span class="bell-dot"></span>` : ""}
  </button>`;
}

function homeView() {
  const posts = postsForHome();
  return `<section class="screen">
    <div class="topbar">
      <div class="wordmark">blur</div>
      <div style="flex:1"></div>
      ${state.myPosted
        ? `<div class="circ posted" title="오늘 게시 완료">${icon("check", 17)}</div>`
        : `<button class="circ yellow icon-btn plus" aria-label="사진 올리기" data-action="quick-upload">${icon("plus", 19)}</button>`}
      ${bellButton()}
    </div>
    <div class="home-body">
    <div class="h-big"><div class="topic-callout">${topic ? escapeHtml(topic) : `<span style="color:var(--muted)">허브를 준비하고 있어요</span>`}</div></div>
    ${posts.length ? `<div class="home-carousel" data-carousel>
      ${posts.map((post) => {
        const person = personById(post.authorId);
        const mine = post.authorId === "me";
        const count = (post.comments || []).length;
        return `<article class="home-slide">
          <div class="post-card">
            ${mediaFrame(post, "large", { person })}
            <div class="post-meta">
              <div class="post-name">${escapeHtml(person?.name || "알 수 없음")} <span class="post-time">${escapeHtml(post.time)}</span></div>
              <div class="meta-actions">
                <button class="cmt-count" aria-label="댓글" data-action="open-comments" data-post="${post.id}">${icon("message", 15)}${count ? `<b>${count}</b>` : ""}</button>
                ${mine ? `<button class="msg-btn" aria-label="게시물 관리" data-action="post-menu" data-post="${post.id}">${icon("pencil", 14)}</button>` : ""}
              </div>
            </div>
            ${post.caption ? `<div class="caption">${escapeHtml(post.caption)}</div>` : ""}
          </div>
        </article>`;
      }).join("")}
    </div>
    ${carouselIndicator(posts.length, 0)}` : `<div class="empty">아직 응답한 친구가 없어요</div>`}
    </div>
  </section>`;
}

/* 사진 수가 많아지면 점 대신 진행 바로 유연하게 전환 */
function carouselIndicator(count, active) {
  if (count <= 1) return `<div class="dots"></div>`;
  if (count <= 7) {
    return `<div class="dots" data-indicator data-count="${count}">
      ${Array.from({ length: count }, (_, i) => `<span class="dot ${i === active ? "active" : ""}"></span>`).join("")}
    </div>`;
  }
  const width = Math.max(14, 120 / count);
  const left = (120 - width) * (active / (count - 1));
  return `<div class="dots" data-indicator data-count="${count}">
    <div class="progress-track"><div class="progress-thumb" style="width:${width}px;left:${left}px"></div></div>
    <span class="progress-count">${active + 1} / ${count}</span>
  </div>`;
}

function allView() {
  const posts = postsForAll();
  const colA = posts.filter((_, i) => i % 2 === 0);
  const colB = posts.filter((_, i) => i % 2 === 1);
  const card = (post) => {
    const person = personById(post.authorId);
    const count = (post.comments || []).length;
    return `<article>
      ${mediaFrame(post, "small", { person })}
      <div class="post-meta" style="margin-top:6px">
        <button class="post-name sm" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;text-align:left;cursor:pointer;padding:0" data-action="open-person" data-user="${post.authorId}">${escapeHtml(person?.name || "알 수 없음")}<span class="pid">@${escapeHtml(person?.id || "")}</span></button>
        <button class="cmt-count sm" aria-label="댓글" data-action="open-comments" data-post="${post.id}">${icon("message", 13)}${count ? `<b>${count}</b>` : ""}</button>
      </div>
    </article>`;
  };
  return `<section class="screen">
    <div class="topbar">
      <div style="flex:1"></div>
      ${bellButton()}
    </div>
    <div class="page-title">전체</div>
    <div class="topic-sub">${topic ? escapeHtml(topic) : "오늘의 허브를 준비하고 있어요"}</div>
    <div class="screen-scroll">
      <div class="masonry">
        <div class="masonry-col">${colA.map(card).join("")}</div>
        <div class="masonry-col">${colB.map(card).join("")}</div>
      </div>
    </div>
  </section>`;
}

// ---------------- 연락처 친구 찾기 (migration-10) ----------------
// 번호를 한국 기준 표준형으로 — 숫자만 남기고 +82 → 0 로 치환. 내 번호와 상대 연락처가
// 같은 문자열로 정규화돼야 해시가 일치한다.
function normalizePhone(raw) {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return d;
}

// 정규화한 번호의 SHA-256 해시(16진). 원본 번호는 서버로 보내지 않는다.
async function hashPhone(raw) {
  const norm = normalizePhone(raw);
  if (norm.length < 9) return null; // 유효하지 않은 번호는 건너뜀
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("blur:" + norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 내 번호 등록/변경
async function savePhone() {
  const raw = state.phoneSheet?.value || "";
  const norm = normalizePhone(raw);
  if (norm.length < 9) { toast("전화번호를 정확히 입력해주세요"); return; }
  update((s) => { s.busy = "phone"; });
  try {
    const hash = await hashPhone(raw);
    await api.setMyContactHash(state.me, hash);
    update((s) => { s.busy = ""; s.myPhoneSet = true; s.phoneSheet = null; });
    toast("전화번호를 등록했어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "등록하지 못했어요");
  }
}

// 내 번호 삭제
async function deletePhone() {
  update((s) => { s.busy = "phone"; });
  try {
    await api.deleteMyContactHash(state.me);
    update((s) => { s.busy = ""; s.myPhoneSet = false; s.phoneSheet = null; });
    toast("전화번호를 삭제했어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "삭제하지 못했어요");
  }
}

// 기기 연락처를 읽어 가입한 지인을 추천 친구 맨 앞에 올림
async function loadContacts() {
  // 웹 표준 Contact Picker API — 안드로이드 크롬만 지원. iOS 사파리·데스크톱 미지원.
  if (!("contacts" in navigator) || !navigator.contacts?.select) {
    toast("이 브라우저는 연락처 접근을 지원하지 않아요. 앱 출시 후 iPhone에서 지원돼요.");
    return;
  }
  let picked;
  try {
    picked = await navigator.contacts.select(["tel"], { multiple: true });
  } catch {
    return; // 사용자가 취소
  }
  if (!picked || !picked.length) return;
  const numbers = [];
  picked.forEach((c) => (c.tel || []).forEach((t) => numbers.push(t)));
  const hashes = [...new Set((await Promise.all(numbers.map(hashPhone))).filter(Boolean))];
  if (!hashes.length) { toast("연락처에서 번호를 찾지 못했어요"); return; }
  update((s) => { s.busy = "contacts"; });
  try {
    const uids = await api.matchContacts(hashes);
    let found = 0;
    update((s) => {
      s.busy = "";
      const hits = [];
      uids.forEach((uid) => {
        const p = s.people.find((x) => x.uid === uid);
        if (!p || p.uid === s.me) return;
        if (s.friends.includes(p.id) || s.reqs.includes(p.id)) return;
        s.contactHit[p.id] = true;
        hits.push(p.id);
      });
      s.recs = [...hits, ...s.recs.filter((rid) => !hits.includes(rid))];
      found = hits.length;
    });
    toast(found
      ? `연락처에서 친구 ${found}명을 찾았어요`
      : "연락처에 blur를 쓰는 친구가 아직 없어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "연락처를 확인하지 못했어요");
  }
}

// 내 번호 등록 시트
function phoneSheet() {
  const p = state.phoneSheet || {};
  return `<div class="report-layer">
    <div class="dim" data-action="close-phone"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">전화번호 등록</div>
      <div class="hint" style="margin-bottom:12px">연락처에 내 번호를 저장한 지인이 blur에서 나를 찾을 수 있어요. 번호는 암호화(해시)되어 저장되고 원본은 서버에 남지 않아요.</div>
      <input class="input" inputmode="tel" data-field="phoneSheet.value" value="${escapeHtml(p.value || "")}" placeholder="010-0000-0000">
      <div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn" data-action="save-phone">${state.myPhoneSet ? "번호 변경" : "등록하기"}</button>
        ${state.myPhoneSet ? `<button class="btn secondary" data-action="delete-phone">번호 삭제</button>` : ""}
        <button class="btn secondary" data-action="close-phone">취소</button>
      </div>
    </section>
  </div>`;
}

function friendsView() {
  return `<section class="screen">
    <div class="topbar">
      <div style="flex:1"></div>
      ${bellButton()}
    </div>
    <div class="page-title">친구</div>
    <label class="search">
      ${icon("search", 16)}
      <input data-field="search" value="${escapeHtml(state.search)}" placeholder="이름 또는 아이디 검색">
    </label>
    <div class="screen-scroll" data-results="friends">${friendsListHtml()}</div>
  </section>`;
}

// 검색 결과 영역만 따로 그림 — 타이핑 중에는 이 영역만 부분 갱신 (입력창은 건드리지 않음)
function friendsListHtml() {
  const query = state.search.trim().toLowerCase();
  const matches = (u) => !query || u.name.toLowerCase().includes(query) || u.id.includes(query);
  const friendUsers = state.friends
    .map((id) => personById(id))
    .filter((u) => u && matches(u));
  const recUsers = state.recs
    .map((id) => {
      const u = personById(id);
      if (!u) return null;
      const mutual = state.fofMutual[id];
      const label = state.contactHit[id]
        ? "연락처에 있는 친구"
        : (mutual ? `함께 아는 친구 ${mutual}명` : "");
      return { ...u, mutual: label };
    })
    .filter((u) => u && matches(u));
  const recsShown = query ? recUsers : recUsers.slice(0, 5);
  const contactCard = query ? "" : `<section class="section">
      <div class="contact-find">
        <div class="contact-find-title">연락처로 친구 찾기</div>
        <div class="contact-find-sub">${state.myPhoneSet
          ? "내 번호 등록됨 · 연락처에 나를 저장한 지인이 나를 찾을 수 있어요"
          : "연락처에 저장된 지인 중 blur를 쓰는 사람을 추천 친구에 올려드려요"}</div>
        <div class="contact-find-actions">
          <button class="btn" data-action="load-contacts">연락처 불러오기</button>
          <button class="btn secondary" data-action="open-phone">${state.myPhoneSet ? "내 번호 변경" : "내 번호 등록"}</button>
        </div>
      </div>
    </section>`;
  return `${contactCard}${state.reqs.length ? `<section class="section">
      <h2 class="section-title">받은 친구 요청</h2>
      <div class="row-list">${state.reqs.map((id) => personRow(personById(id), "request")).join("")}</div>
    </section>` : ""}
    <section class="section">
      <h2 class="section-title">${query ? "사용자 검색" : "추천 친구"}</h2>
      <div class="row-list">${recsShown.map((u) => personRow(u, "recommend")).join("") || `<div class="empty">${query ? "검색 결과가 없어요" : "추천할 친구를 찾는 중이에요"}</div>`}</div>
    </section>
    <section class="section">
      <h2 class="section-title">내 친구</h2>
      <div class="row-list">${friendUsers.map((u) => personRow(u, "friend")).join("") || `<div class="empty">검색 결과가 없어요</div>`}</div>
    </section>`;
}

function personRow(user, mode) {
  if (!user) return "";
  if (mode === "request") {
    return `<div class="person-row hot">
      ${avatar(user)}
      <div class="person-main">
        <div class="person-name">${escapeHtml(user.name)}</div>
        <div class="person-id">@${escapeHtml(user.id)}${user.mutual ? ` · ${escapeHtml(user.mutual)}` : ""}</div>
      </div>
      <button class="act-btn decline" aria-label="거절" title="거절" data-action="decline-request" data-user="${user.id}">${icon("x", 15)}</button>
      <button class="act-btn accept" aria-label="수락" title="수락" data-action="accept-request" data-user="${user.id}">${icon("check", 15)}</button>
    </div>`;
  }
  if (mode === "recommend") {
    const sent = state.sentRequests[user.id];
    return `<div class="person-row">
      <button style="background:transparent;padding:0" data-action="open-person" data-user="${user.id}">${avatar(user)}</button>
      <button class="person-main" style="background:transparent;text-align:left;cursor:pointer" data-action="open-person" data-user="${user.id}">
        <div class="person-name">${escapeHtml(user.name)}</div>
        <div class="person-id">@${escapeHtml(user.id)}${user.mutual ? ` · ${escapeHtml(user.mutual)}` : ""}</div>
      </button>
      <button class="act-btn ${sent ? "sent" : "add"}" aria-label="${sent ? "요청 보냄" : "친구 추가"}" title="${sent ? "요청 보냄" : "친구 추가"}" data-action="send-request" data-user="${user.id}">${sent ? icon("check", 14) : icon("plus", 15)}</button>
    </div>`;
  }
  return `<div class="person-row">
    <button style="background:transparent;padding:0" data-action="open-friend-profile" data-user="${user.id}">${avatar(user)}</button>
    <button class="person-main" style="background:transparent;text-align:left;cursor:pointer" data-action="open-friend-profile" data-user="${user.id}">
      <div class="person-name">${escapeHtml(user.name)}</div>
      <div class="person-id">@${escapeHtml(user.id)}</div>
    </button>
    <button class="ghost-icon" aria-label="더보기" data-action="friend-actions" data-user="${user.id}">${icon("dots", 17)}</button>
  </div>`;
}

function myView() {
  const my = personById("me");
  const archive = state.posts.filter((post) => post.authorId === "me" && !post.archived);
  const bioRaw = state.profile.bio || "";
  const bio = bioRaw.trim();
  return `<section class="screen sage">
    <div class="topbar">
      <div style="flex:1"></div>
      <button class="circ" aria-label="프로필 수정" data-action="open-edit">${icon("pencil", 17)}</button>
      <button class="circ" aria-label="설정" data-action="open-settings">${icon("settings", 17)}</button>
    </div>
    <div class="room-head">
      ${avatar(my, "profile-avatar room-avatar")}
      <div class="room-name">${escapeHtml(state.profile.name)}</div>
      <div class="room-id">@${escapeHtml(state.profile.id)}</div>
      ${bio
        ? `<div class="room-bio">${escapeHtml(bio)}</div>`
        : bioRaw.length
          ? ``
          : `<button class="room-bio room-bio-empty" data-action="open-edit">나를 한 줄로 소개해보세요 ${icon("pencil", 11)}</button>`}
    </div>
    <div class="screen-scroll" style="margin-top:22px">
      ${archive.length
        ? `<div class="photo-grid">${archive.map((post, index) => gridTile(post, index)).join("")}</div>`
        : `<div class="empty">아직 올린 응답이 없어요</div>`}
    </div>
  </section>`;
}

// 프로필 사진 탭 → 확대 뷰(날짜+허브), 다시 탭하면 원래대로 (베타 피드백 10)
function gridTile(post) {
  const isToday = post.hubDate === HUB_DATE;
  const displayPost = { ...post, ratio: "1 / 1" };
  const revealForce = !isToday || post.authorId !== "me" || state.revealed[post.id];
  return `<div data-long-post="${post.id}" data-action="open-viewer" data-post="${post.id}" style="position:relative">
    ${mediaFrame(displayPost, "square", { forceReveal: revealForce, noReveal: true, square: true })}
  </div>`;
}

function unreadDmCount() {
  return state.messages.filter((m) => m.to === "me" && !m.read).length;
}

function tabbar() {
  const tabs = [
    ["home", "오늘", "sun"],
    ["all", "전체", "grid"],
    ["chat", "대화", "message"],
    ["friends", "친구", "cloud"],
    ["my", "프로필", "user"]
  ];
  const unread = unreadDmCount();
  return `<nav class="tabbar" aria-label="주 메뉴">
    ${tabs.map(([tab, label, iconName]) => `<button class="tab ${state.tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}" aria-label="${label}" title="${label}">
      ${icon(iconName, 19)}
      ${tab === "chat" && unread ? `<span class="tab-dot"></span>` : ""}
    </button>`).join("")}
  </nav>`;
}

function overlayViews() {
  return [
    state.upload.open ? uploadView() : "",
    state.overlays.friendUser ? profileView(state.overlays.friendUser, "friend") : "",
    state.overlays.publicUser ? profileView(state.overlays.publicUser, "public") : "",
    state.edit ? editView() : "",
    state.overlays.settings ? settingsView() : "",
    state.overlays.archive ? archiveView() : "",
    state.overlays.chatWith ? chatRoomView() : "",
    state.leave.open ? leaveView() : "",
    state.overlays.viewerPost ? viewerView() : "",
    state.overlays.commentsFor ? commentsSheet() : "",
    state.overlays.notif ? notifSheet() : "",
    state.postEdit ? postMenuSheet() : "",
    state.overlays.purgeFor ? purgeSheet() : "",
    state.overlays.privateUser ? privateProfileSheet() : "",
    state.overlays.actionsFor ? friendActionsSheet() : "",
    state.overlays.logout ? logoutSheet() : "",
    state.overlays.reportFor ? reportSheet() : "",
    state.overlays.dmDelete ? dmDeleteSheet() : "",
    state.phoneSheet ? phoneSheet() : "",
    state.onboard ? onboardView() : ""
  ].join("");
}

// 신고 사유 선택 시트 — 게시물·댓글·사용자 공용 (스토어 심사 요건)
const REPORT_REASONS = ["스팸·광고", "불쾌하거나 부적절한 콘텐츠", "사칭·개인정보 침해", "기타"];

function reportSheet() {
  const target = state.overlays.reportFor;
  const labels = { post: "게시물", comment: "댓글", user: "사용자" };
  return `<div class="report-layer">
    <div class="dim" data-action="close-report"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">${labels[target.type] || ""} 신고</div>
      <div class="hint" style="margin-bottom:12px">신고는 운영자가 검토하고, 필요하면 조치해요. 신고 사실은 상대에게 알리지 않아요.</div>
      <div style="display:grid;gap:8px">
        ${REPORT_REASONS.map((reason) => `<button class="setting-row" style="text-align:left;cursor:pointer" data-action="submit-report" data-reason="${escapeHtml(reason)}"><span>${escapeHtml(reason)}</span><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></button>`).join("")}
      </div>
    </section>
  </div>`;
}

// ---------------- 첫 만남 안내 (온보딩) ----------------
// 가입 직후(또는 설정 > 앱 안내 다시 보기) 핵심 규칙 3장 + 프로필 색 선택
// 내 DM 말풍선 탭 → 삭제 확인 시트 (migration-08)
function dmDeleteSheet() {
  return `<div class="report-layer">
    <div class="dim" data-action="close-dm-delete"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">메시지 삭제</div>
      <div class="hint" style="margin-bottom:12px">삭제하면 상대방 화면에서도 사라져요. 되돌릴 수 없어요.</div>
      <div style="display:grid;gap:8px">
        <button class="btn danger" data-action="confirm-dm-delete">삭제하기</button>
        <button class="btn secondary" data-action="close-dm-delete">취소</button>
      </div>
    </section>
  </div>`;
}

const ONBOARD_SLIDES = [
  { icon: "sun", title: "매일 오전 6시, 새로운 허브", body: "24시간마다 허브가 바뀌어요 — 갱신은 매일 오전 6시.<br>오늘의 허브에 하루 한 번 응답해 보세요." },
  { icon: "camera", title: "사진 한 장, 혹은 5초 동영상", body: "오늘을 담은 사진이나 5초 이하 동영상으로 응답해요.<br>아트 필터로 나만의 질감도 입힐 수 있어요." },
  { icon: "cloud", title: "탭하면 선명해져요", body: "친구의 응답은 흐릿하게 도착해요.<br>탭해서 blur를 풀고 선명하게 감상하세요." }
];

// 온보딩 단계: 정보 슬라이드 3장 → 프로필 색 → 알림 켜기
const ONBOARD_COLOR_STEP = ONBOARD_SLIDES.length;       // 색 고르기
const ONBOARD_PUSH_STEP = ONBOARD_SLIDES.length + 1;    // 알림 켜기(마지막)
const ONBOARD_TOTAL = ONBOARD_SLIDES.length + 2;

function onboardView() {
  const ob = state.onboard;
  const dots = Array.from({ length: ONBOARD_TOTAL }, (_, i) => `<span class="dot ${i === ob.step ? "active" : ""}"></span>`).join("");
  let inner;
  if (ob.step === ONBOARD_PUSH_STEP) {
    // 마지막 — 알림 켜기 선택 (기본값은 꺼짐이라 여기서 권유). 켜면 폰 알림 권한을 요청한다.
    inner = `<div class="onboard-body">
        <div class="onboard-icon">${icon("bell", 40)}</div>
        <div class="onboard-title">알림 켜기</div>
        <div class="subtitle">친구의 새 응답·댓글·메시지를<br>폰 알림으로 바로 받아보세요.</div>
      </div>
      <div style="display:grid;gap:8px;width:100%">
        <button class="btn" style="width:100%" data-action="onboard-enable-push">알림 켜기</button>
        <button class="btn secondary" style="width:100%" data-action="onboard-done">나중에 할게요</button>
      </div>`;
  } else if (ob.step === ONBOARD_COLOR_STEP) {
    inner = `<div class="onboard-body">
        <div class="onboard-title">프로필 색 고르기</div>
        <div class="subtitle">선택한 색이 내 기본 프로필 사진이 돼요.<br>언제든 프로필 수정에서 바꿀 수 있어요.</div>
        ${colorPicker("onboard", ob.color)}
      </div>
      <button class="btn" style="width:100%" data-action="onboard-next">다음</button>`;
  } else {
    inner = `<div class="onboard-body">
        <div class="onboard-icon">${icon(ONBOARD_SLIDES[ob.step].icon, 40)}</div>
        <div class="onboard-title">${ONBOARD_SLIDES[ob.step].title}</div>
        <div class="subtitle">${ONBOARD_SLIDES[ob.step].body}</div>
      </div>
      <button class="btn" style="width:100%" data-action="onboard-next">다음</button>`;
  }
  return `<section class="overlay onboard">
    <div class="onboard-card">
      ${inner}
      <div class="dots" style="margin-top:6px">${dots}</div>
    </div>
  </section>`;
}

function uploadView() {
  const titles = { pick: "사진 고르기", edit: "사진 수정", caption: "마지막 확인" };
  const up = state.upload;
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="upload-back">${icon("arrow-left", 17)}</button>
      <div class="overlay-title">${titles[up.step]}</div>
      <div style="width:36px"></div>
    </div>
    <div class="topicchip">${escapeHtml(topic)}</div>
    ${up.step === "pick" ? uploadPick() : up.step === "edit" ? uploadEdit() : uploadCaption()}
  </section>`;
}

function uploadPick() {
  const picked = state.upload.selectedId || state.upload.selectedImage;
  return `<div class="screen-scroll" style="padding:18px 22px 110px">
    <div class="upload-grid">
      <button class="camera-tile" data-action="pick-photo">${icon("camera", 20)}<span style="font-size:10.5px">카메라</span></button>
      <button class="camera-tile" data-action="pick-album">${icon("image", 20)}<span style="font-size:10.5px">앨범</span></button>
    </div>
    <div class="hint" style="margin-top:14px;text-align:center">촬영하거나 앨범에서 사진·동영상(${MAX_VIDEO_SEC}초까지)을 골라주세요</div>
    <div class="fixed-cta"><button class="btn ${picked ? "" : "disabled"}" style="width:100%" ${picked ? "" : "disabled"} data-action="upload-next">다음</button></div>
  </div>`;
}

// 인스타 스토리처럼 드래그·핀치·슬라이더·회전으로 사진을 조정한 상태 (베타 피드백 1)
function uploadTransform(up) {
  return `translate(${up.x || 0}px, ${up.y || 0}px) rotate(${up.rot || 0}deg) scale(${up.zoom || 1})`;
}

function uploadPreview(interactive = false) {
  const up = state.upload;
  if (up.selectedImage) {
    // 아트 필터는 CSS로 흉내낼 수 없어 프리뷰도 캔버스로 구운 이미지를 보여준다
    const artUrl = (up.artPreviews || {})[up.filter];
    const building = ART_FILTERS.includes(up.filter) && !artUrl;
    // 동영상은 원본 필터일 땐 재생하며 보여주고, 아트 필터를 고르면 구운 첫 프레임으로 미리 본다
    const media = up.selectedVideo && !ART_FILTERS.includes(up.filter)
      ? `<video class="media-img" src="${up.selectedVideo}" autoplay muted loop playsinline draggable="false"
          style="transform:${uploadTransform(up)};transition:none" data-upload-img></video>`
      : `<img class="media-img" src="${artUrl || up.selectedImage}" alt="" draggable="false"
          style="transform:${uploadTransform(up)};transition:none${building ? ";opacity:.55" : ""}" data-upload-img>`;
    return `<div style="width:${ratioWidth(up.ratio)};max-width:100%;margin:0 auto">
      <div class="media-frame large revealed upload-frame" data-upload-frame style="aspect-ratio:${up.ratio};--tone:${toneFilter(up.filter)}" ${interactive ? `data-drag-canvas` : ""}>
        ${media}
      </div>
    </div>`;
  }
  const post = {
    id: "upload-preview",
    authorId: "me",
    ratio: up.ratio,
    split: up.split,
    grad: up.selectedGrad || gradients[0],
    image: "",
    filter: up.filter,
    label: up.selectedLabel || "선택"
  };
  return `<div style="width:${ratioWidth(up.ratio)};max-width:100%;margin:0 auto">
    ${mediaFrame(post, "large", { forceReveal: true, noReveal: true })}
  </div>`;
}

function uploadEdit() {
  const up = state.upload;
  const chips = (name, values) => values.map(([value, label]) => `<button class="chip ${up[name] == value ? "active" : ""}" data-action="set-upload" data-key="${name}" data-value="${value}">${label}</button>`).join("");
  return `<div class="screen-scroll" style="padding:16px 24px 34px;display:grid;gap:14px">
    ${uploadPreview(true)}
    ${up.selectedVideo ? `<div class="hint" style="text-align:center">${Math.round(up.videoDuration * 10) / 10}초 동영상 — 필터는 게시할 때 영상 전체에 입혀져요</div>` : ""}
    ${up.selectedImage ? `<div>
      <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">크기·회전
        <span style="display:flex;gap:6px">
          <button class="chip" data-action="rotate-upload">${icon("rotate", 13)}<span style="margin-left:5px">90°</span></button>
          <button class="chip" data-action="reset-transform">초기화</button>
        </span>
      </div>
      <input type="range" class="zoom-range" min="1" max="3" step="0.01" value="${up.zoom || 1}" data-field="upload.zoom" aria-label="확대">
      <div class="hint" style="margin-top:4px">사진을 드래그해 위치를 옮기고, 두 손가락으로 확대할 수 있어요</div>
    </div>` : ""}
    <div>
      <div class="section-title">자르기</div>
      <div class="chip-row">${chips("ratio", ratioChoices(up.srcRatio))}</div>
    </div>
    <div>
      <div class="section-title">필터</div>
      <div class="chip-row">${chips("filter", [["none", "원본"], ["grain", "그레인 블러"], ["glass", "리퀴드 글라스"], ["halftone", "하프톤"], ["naive", "나이브"], ["data", "데이터"]])}</div>
    </div>
    <button class="btn" data-action="upload-next">다음</button>
  </div>`;
}

function uploadCaption() {
  const up = state.upload;
  return `<div class="screen-scroll" style="padding:18px 26px 40px;display:grid;gap:13px">
    ${uploadPreview()}
    <input class="input" maxlength="60" data-field="upload.caption" value="${escapeHtml(up.caption)}" placeholder="한 줄 남기기 (선택)">
    <div class="setting-row">
      <div><div class="person-name">친구 공개</div><div class="person-id">오늘 탭에서 내 친구들에게 보여요</div></div>
      <div style="color:var(--muted)">${icon("lock", 16)}</div>
    </div>
    <div class="setting-row">
      <div><div class="person-name">'모두'에도 공개</div><div class="person-id">전체 이용자의 모두 탭에 보여요</div></div>
      <button class="toggle ${up.shareAll ? "on" : ""}" data-action="toggle-upload" data-key="shareAll" aria-label="모두에도 공개"></button>
    </div>
    <div class="setting-row">
      <div><div class="person-name">내 프로필에 저장</div><div class="person-id">허브가 닫혀도 내 아카이브에 남아요</div></div>
      <button class="toggle ${up.saveRoom ? "on" : ""}" data-action="toggle-upload" data-key="saveRoom" aria-label="내 프로필에 저장"></button>
    </div>
    <button class="btn" data-action="publish">오늘의 허브에 올리기</button>
  </div>`;
}

function profileView(userId, mode) {
  const user = personById(userId);
  if (!user) return "";
  const isPublic = mode === "public";
  const sent = state.sentRequests[userId];
  const posts = postsByAuthor(userId);
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="${isPublic ? "close-public-profile" : "close-friend-profile"}">${icon("arrow-left", 17)}</button>
      <div class="overlay-title">${isPublic ? "프로필" : "친구 프로필"}</div>
      <button class="ghost-icon" aria-label="사용자 신고" data-action="open-report" data-type="user" data-target="${user.uid || user.id}">${icon("flag", 15)}</button>
    </div>
    <div class="profile-head" style="padding-top:22px">
      ${avatar(user, "profile-avatar")}
      <div style="flex:1;min-width:0">
        <div class="profile-name">${escapeHtml(user.name)}</div>
        <div style="display:flex;align-items:center;gap:7px;margin-top:3px">
          <div class="profile-sub">@${escapeHtml(user.id)}</div>
          ${isPublic ? `<span class="badge public">공개 계정</span>` : `<span class="profile-sub">친구</span>`}
        </div>
      </div>
      ${state.friends.includes(userId)
        ? `<button class="msg-btn" style="width:38px;height:38px" aria-label="메시지" data-action="open-chat" data-user="${userId}">${icon("message", 17)}</button>`
        : isPublic ? `<button class="mini-btn ${sent ? "ghost" : ""}" data-action="send-request" data-user="${userId}">${sent ? "요청 보냄" : "친구 요청"}</button>` : ""}
    </div>
    <div class="grid-title"><div class="section-title" style="margin:0">${escapeHtml(user.name)}님의 허브 응답</div></div>
    <div class="screen-scroll">
      <div class="photo-grid">${posts.map((post) => {
        const forceReveal = post.hubDate !== HUB_DATE;
        // 지난 허브(또는 이미 blur를 푼 사진)는 탭하면 확대 뷰어로 — 오늘의 미공개 사진만 탭=blur 해제
        const canView = forceReveal || state.revealed[post.id];
        return `<div ${canView ? `data-action="open-viewer" data-post="${post.id}" style="cursor:pointer"` : ""}>${mediaFrame({ ...post, ratio: "1 / 1" }, "square", { forceReveal, square: true, short: true, noReveal: canView })}<div class="photo-label">${escapeHtml(post.label || "지난 허브")}</div></div>`;
      }).join("")}</div>
      <div class="hint" style="text-align:center;margin-top:14px">${isPublic ? "공개 계정의 지난 허브는 누구나 볼 수 있어요" : "오늘의 응답은 탭해서 blur를 풀 수 있어요"}</div>
    </div>
  </section>`;
}

function editView() {
  const edit = state.edit;
  const id = normalizeId(edit.id);
  const idHint = editIdHintState();
  const bio = edit.bio || "";
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-edit">${icon("arrow-left", 17)}</button>
      <div class="overlay-title">프로필 수정</div>
      <div style="width:36px"></div>
    </div>
    <div class="screen-scroll" style="padding:24px 26px 40px;display:grid;gap:18px">
      <div style="display:grid;justify-items:center;gap:12px">
        ${edit.photo ? `<div class="profile-avatar" data-edit-avatar style="width:88px;height:88px;background:${edit.color}"><img src="${edit.photo}" alt=""></div>` : `<div class="profile-avatar" data-edit-avatar style="width:88px;height:88px;background:${avatarFill(edit.color)}"></div>`}
        <div class="hint">프로필 사진은 앨범에서만 선택할 수 있어요</div>
        <button class="btn secondary" style="width:100%;border-style:dashed" data-action="pick-avatar">${icon("image", 15)}<span style="margin-left:8px">앨범에서 사진 선택</span></button>
        ${edit.photo ? `<button class="text-link" style="color:var(--danger)" data-action="clear-avatar">사진 지우기</button>` : ""}
      </div>
      <div>
        <div class="section-title">프로필 색</div>
        ${colorPicker("edit", edit.color, { preview: false })}
      </div>
      <label>
        <div class="section-title">이름</div>
        <input class="input" maxlength="12" data-field="edit.name" value="${escapeHtml(edit.name)}">
      </label>
      <label>
        <div class="section-title">아이디</div>
        <input class="input" maxlength="16" data-field="edit.id" value="${escapeHtml(id)}">
        <div class="hint ${idHint.cls}" data-hint="edit.id">${idHint.text}</div>
      </label>
      <label>
        <div class="section-title">소개</div>
        <textarea class="textarea" rows="3" maxlength="80" data-field="edit.bio" placeholder="하고 싶은 말, 직업, 나를 어필하는 한마디를 적어보세요">${escapeHtml(bio)}</textarea>
        <div class="hint" style="text-align:right" data-hint="edit.bio">${bio.length}/80</div>
      </label>
      <button class="btn" data-action="save-edit">저장하기</button>
    </div>
  </section>`;
}

function settingsView() {
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-settings">${icon("arrow-left", 17)}</button>
      <div class="overlay-title">설정</div>
      <div style="width:36px"></div>
    </div>
    <div class="screen-scroll" style="padding:18px 24px 40px;display:grid;gap:16px">
      <div class="person-row">
        ${avatar(personById("me"))}
        <div class="person-main">
          <div class="person-name">${escapeHtml(state.profile.name)}</div>
          <div class="person-id">@${escapeHtml(state.profile.id)}</div>
        </div>
      </div>
      <div>
        <div class="section-title">앱</div>
        <div style="display:grid;gap:8px">
          <div class="setting-row"><div><div class="person-name">알림</div><div class="person-id">새 소식이 폰 알림으로 와요</div></div><button class="toggle ${state.push ? "on" : ""}" data-action="toggle-push"></button></div>
          <div class="setting-row"><div><div class="person-name">공개 계정</div><div class="person-id">누구나 프로필과 지난 허브를 볼 수 있어요</div></div><button class="toggle ${state.myPublic ? "on" : ""}" data-action="toggle-setting" data-key="myPublic"></button></div>
        </div>
      </div>
      <div>
        <div class="section-title">배경</div>
        <div style="display:grid;gap:8px">
          <div class="setting-row">
            <div><div class="person-name">위쪽 색</div></div>
            <span class="bg-pick">
              <input type="color" class="bg-swatch" data-field="bgC1" value="${escapeHtml(state.bgC1)}" aria-label="위쪽 색 선택">
            </span>
          </div>
          <div class="setting-row">
            <div><div class="person-name">아래쪽 색</div></div>
            <span class="bg-pick">
              <input type="color" class="bg-swatch" data-field="bgC2" value="${escapeHtml(state.bgC2)}" aria-label="아래쪽 색 선택">
            </span>
          </div>
          <button class="setting-row" style="text-align:left;cursor:pointer" data-action="bg-reset"><div><div class="person-name">기본 색으로 되돌리기</div><div class="person-id">스카이 + 민트</div></div><span style="color:var(--faint);display:inline-flex">${icon("rotate", 14)}</span></button>
        </div>
      </div>
      <div>
        <div class="section-title">보관함</div>
        <div style="display:grid;gap:8px">
          <button class="setting-row" style="text-align:left;cursor:pointer" data-action="open-archive"><div><div class="person-name">보관</div><div class="person-id">프로필에서 삭제한 허브 사진 보기·영구 삭제</div></div><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></button>
        </div>
      </div>
      <div>
        <div class="section-title">계정</div>
        <div style="display:grid;gap:8px">
          <div class="setting-row"><div><div class="person-name">로그인 연결</div><div class="person-id">${providerLabel(state.provider)} 계정으로 로그인 중이에요</div></div></div>
          <button class="setting-row" style="text-align:left;cursor:pointer" data-action="open-logout"><div><div class="person-name">로그아웃</div><div class="person-id">다시 로그인하면 그대로 이어서 쓸 수 있어요</div></div><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></button>
          <button class="setting-row" style="text-align:left;cursor:pointer;color:var(--danger)" data-action="open-leave"><div><div class="person-name" style="color:var(--danger)">회원 탈퇴</div><div class="person-id">모든 데이터 삭제</div></div><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></button>
        </div>
      </div>
      <div>
        <div class="section-title">지원·정책</div>
        <div style="display:grid;gap:8px">
          <a class="setting-row" style="text-decoration:none;cursor:pointer" href="./legal/support.html" target="_blank" rel="noopener"><div><div class="person-name">고객지원·도움말</div></div><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></a>
          <a class="setting-row" style="text-decoration:none;cursor:pointer" href="./legal/terms.html" target="_blank" rel="noopener"><div><div class="person-name">이용약관</div></div><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></a>
          <a class="setting-row" style="text-decoration:none;cursor:pointer" href="./legal/privacy.html" target="_blank" rel="noopener"><div><div class="person-name">개인정보 처리방침</div></div><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></a>
        </div>
      </div>
      <div class="hint" style="text-align:center">blur 1.0.0</div>
    </div>
  </section>`;
}

function commentsSheet() {
  const post = state.posts.find((p) => p.id === state.overlays.commentsFor);
  if (!post) return "";
  const comments = postComments(post);
  return `<div>
    <div class="dim" data-action="close-comments"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">댓글 ${comments.length}</div>
        <button class="ghost-icon" data-action="close-comments">${icon("x", 15)}</button>
      </div>
      <div style="min-height:80px;max-height:260px;overflow-y:auto">
        ${comments.length ? comments.map((c) => {
          const person = personById(c.by);
          const mine = c.by === "me";
          return `<div class="comment-item">
            ${avatar(person)}
            <div class="comment-body">
              <div class="comment-head">
                <span class="comment-author">${escapeHtml(person?.name || "알 수 없음")}</span>
                <span class="comment-handle">@${escapeHtml(person?.id || "")}</span>
                ${mine && c.id ? `<button class="comment-del" aria-label="댓글 삭제" data-action="delete-comment" data-comment="${c.id}" data-post="${post.id}">${icon("x", 12)}</button>` : ""}
                ${!mine && c.id ? `<button class="comment-del" aria-label="댓글 신고" data-action="open-report" data-type="comment" data-target="${c.id}">${icon("flag", 11)}</button>` : ""}
              </div>
              <div class="comment-bubble">${escapeHtml(c.text)}</div>
            </div>
          </div>`;
        }).join("") : `<div class="empty" style="min-height:80px">아직 댓글이 없어요</div>`}
      </div>
      <form class="cinput" data-action="send-comment">
        <input id="comment-input" maxlength="100" placeholder="댓글을 남겨보세요">
        <button class="circ ink sm" type="submit" aria-label="전송">${icon("arrow-up", 15)}</button>
      </form>
    </section>
  </div>`;
}

function privateProfileSheet() {
  const user = personById(state.overlays.privateUser);
  if (!user) return "";
  const sent = state.sentRequests[user.id];
  return `<div>
    <div class="dim" data-action="close-private"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div style="display:flex;align-items:center;gap:14px">
        ${avatar(user, "profile-avatar")}
        <div style="flex:1">
          <div class="profile-name">${escapeHtml(user.name)}</div>
          <div style="display:flex;align-items:center;gap:7px;margin-top:3px">
            <div class="profile-sub">@${escapeHtml(user.id)}</div>
            <span class="badge private">비공개 계정</span>
          </div>
        </div>
        <button class="mini-btn ${sent ? "ghost" : ""}" data-action="send-request" data-user="${user.id}">${sent ? "요청 보냄" : "친구 요청"}</button>
      </div>
      <div style="margin-top:16px;padding:12px 16px;border-radius:14px;background:rgba(224,121,180,.08);font-size:11.5px;line-height:1.6;color:var(--muted)">
        비공개 계정이에요. 프로필과 지난 허브는 친구가 된 후에 볼 수 있어요. 지금은 허브 응답에 댓글만 남길 수 있어요.
      </div>
    </section>
  </div>`;
}

function friendActionsSheet() {
  const user = personById(state.overlays.actionsFor);
  if (!user) return "";
  return `<div>
    <div class="dim" data-action="close-actions"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">${escapeHtml(user.name)}</div>
      <div style="display:grid;gap:8px">
        <button class="setting-row" data-action="remove-friend" data-user="${user.id}"><span>친구 삭제</span><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></button>
        <button class="setting-row" data-action="open-report" data-type="user" data-target="${user.uid || user.id}"><span>신고</span><span style="color:var(--faint);display:inline-flex">${icon("flag", 14)}</span></button>
        <button class="setting-row" style="color:var(--danger)" data-action="block-friend" data-user="${user.id}"><span>차단</span><span style="color:var(--faint);display:inline-flex">${icon("chevron", 15)}</span></button>
      </div>
    </section>
  </div>`;
}

function logoutSheet() {
  return `<div>
    <div class="dim" data-action="close-logout"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">로그아웃할까요?</div>
      <p class="hint" style="line-height:1.6">다시 로그인하면 그대로 이어서 쓸 수 있어요.</p>
      <div style="display:grid;gap:8px;margin-top:18px">
        <button class="btn" data-action="confirm-logout">로그아웃</button>
        <button class="btn secondary" data-action="close-logout">계속 사용하기</button>
      </div>
    </section>
  </div>`;
}

function leaveView() {
  if (state.leave.done) {
    return `<section class="overlay" style="justify-content:center;text-align:center;padding:26px">
      <h1 class="title">탈퇴가 완료됐어요</h1>
      <p class="hint" style="line-height:1.7">기기에 저장된 blur 데이터가 삭제됐습니다.</p>
      <button class="btn" data-action="finish-leave">처음으로</button>
    </section>`;
  }
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-leave">${icon("arrow-left", 17)}</button>
      <div class="overlay-title">회원 탈퇴</div>
      <div style="width:36px"></div>
    </div>
    <div class="screen-scroll" style="padding:22px 24px 40px;display:grid;gap:14px">
      <div class="glass-card" style="padding:16px;border-color:rgba(192,69,69,.18);background:rgba(192,69,69,.08)">
        <div class="person-name" style="color:var(--danger)">복구할 수 없어요</div>
        <div class="hint" style="line-height:1.6">프로필, 게시물, 댓글, 친구 관계, 설정이 이 기기에서 모두 삭제됩니다.</div>
      </div>
      <div>
        <div class="section-title">이유 선택</div>
        <div class="chip-row">
          ${["잠시 쉬고 싶어요", "사용이 어려워요", "친구가 없어요", "다른 앱을 써요"].map((reason) => `<button class="chip ${state.leave.reason === reason ? "active" : ""}" data-action="set-leave-reason" data-reason="${reason}">${reason}</button>`).join("")}
        </div>
      </div>
      <label class="setting-row" style="justify-content:flex-start;cursor:pointer">
        <input type="checkbox" data-field="leave.agree" ${state.leave.agree ? "checked" : ""}>
        <span class="person-name">삭제 후 복구할 수 없다는 점을 이해했어요</span>
      </label>
      <button class="btn danger" ${state.leave.agree ? "" : "disabled"} data-action="ask-leave-confirm">탈퇴하기</button>
    </div>
    ${state.leave.confirm ? `<div>
      <div class="dim" data-action="cancel-leave-confirm"></div>
      <section class="sheet">
        <div class="handle"></div>
        <div class="section-title">정말 탈퇴할까요?</div>
        <p class="hint">이 작업은 되돌릴 수 없어요.</p>
        <div style="display:grid;gap:8px;margin-top:18px">
          <button class="btn danger" data-action="confirm-leave">탈퇴하기</button>
          <button class="btn secondary" data-action="cancel-leave-confirm">돌아가기</button>
        </div>
      </section>
    </div>` : ""}
  </section>`;
}

// 프로필 사진 확대 뷰 — 사진 아래 날짜·허브, 사진(화면)을 다시 탭하면 닫힘 (베타 피드백 10)
function viewerView() {
  const post = state.posts.find((p) => p.id === state.overlays.viewerPost) || { id: "viewer", authorId: "me", hubDate: HUB_DATE, ratio: "4 / 5", split: 1, grad: gradients[0], label: "sample" };
  const dateLabel = `${post.hubDate.slice(5, 7)}. ${post.hubDate.slice(8, 10)}`;
  const hubTopic = state.hubTopics[post.hubDate] || "";
  const mine = post.authorId === "me";
  return `<section class="viewer" data-action="close-viewer">
    <div class="viewer-zoom">
      ${mediaFrame(post, "large", { forceReveal: true, noReveal: true })}
      <div style="text-align:center">
        <div class="viewer-date">${escapeHtml(dateLabel)} 허브</div>
        <div class="viewer-topic">${escapeHtml(hubTopic)}</div>
      </div>
      ${mine && !post.archived ? `<button class="btn secondary viewer-archive" data-action="archive-post" data-post="${post.id}">${icon("trash", 15)}<span style="margin-left:7px">프로필에서 삭제 (보관으로 이동)</span></button>` : ""}
      ${!mine ? `<button class="text-link" style="color:var(--danger)" data-action="open-report" data-type="post" data-target="${post.id}">${icon("flag", 13)}<span style="margin-left:6px">게시물 신고</span></button>` : ""}
    </div>
  </section>`;
}

// 설정 > 보관 — 프로필에서 삭제한 사진 열람·복원·영구 삭제 (베타 피드백 6)
function archiveView() {
  const archived = state.posts.filter((post) => post.authorId === "me" && post.archived);
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-archive">${icon("arrow-left", 17)}</button>
      <div class="overlay-title">보관</div>
      <div style="width:36px"></div>
    </div>
    <div class="hint" style="padding:10px 26px 0;text-align:center">프로필에서 삭제한 사진이에요. 나에게만 보이고, 여기서 영구 삭제할 수 있어요.</div>
    <div class="screen-scroll" style="padding-top:16px">
      ${archived.length ? `<div class="photo-grid">${archived.map((post) => `
        <div style="position:relative">
          ${mediaFrame({ ...post, ratio: "1 / 1" }, "square", { forceReveal: true, noReveal: true, square: true })}
          <div class="photo-label">${escapeHtml(post.label || "")}</div>
          <div class="archive-actions">
            <button class="chip" data-action="restore-post" data-post="${post.id}">복원</button>
            <button class="chip danger" data-action="ask-purge" data-post="${post.id}">삭제</button>
          </div>
        </div>`).join("")}</div>` : `<div class="empty">보관된 사진이 없어요</div>`}
    </div>
  </section>`;
}

function purgeSheet() {
  return `<div>
    <div class="dim" data-action="cancel-purge"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">사진을 영구 삭제할까요?</div>
      <p class="hint" style="line-height:1.6">삭제한 사진은 되돌릴 수 없어요. 댓글도 함께 삭제됩니다.</p>
      <div style="display:grid;gap:8px;margin-top:18px">
        <button class="btn danger" data-action="confirm-purge">영구 삭제</button>
        <button class="btn secondary" data-action="cancel-purge">돌아가기</button>
      </div>
    </section>
  </div>`;
}

// 알림 목록 — 친구 요청·수락, 친구의 오늘 게시, 내 게시물 댓글 (베타 피드백 8)
function notifItems() {
  const items = [];
  state.reqs.forEach((handle) => items.push({
    type: "req", by: handle, at: state.reqAt[handle] || 0, text: "친구 요청을 보냈어요"
  }));
  state.acceptedAt.forEach(({ handle, at }) => items.push({
    type: "accept", by: handle, at, text: "친구 요청을 수락했어요"
  }));
  state.posts
    .filter((p) => p.hubDate === HUB_DATE && !p.archived && p.authorId !== "me" && state.friends.includes(p.authorId))
    .forEach((p) => items.push({ type: "post", by: p.authorId, at: p.at, post: p.id, text: "오늘의 허브에 응답했어요" }));
  state.posts
    .filter((p) => p.authorId === "me")
    .forEach((p) => (p.comments || []).filter((c) => c.by !== "me").forEach((c) => items.push({
      type: "comment", by: c.by, at: c.at, post: p.id, text: `내 게시물에 댓글: “${c.text.slice(0, 24)}”`
    })));
  return items.sort((a, b) => b.at - a.at).slice(0, 30);
}

function timeAgo(at) {
  if (!at) return "";
  const diff = Date.now() - at;
  if (diff < 60000) return "방금";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${Math.floor(diff / 86400000)}일 전`;
}

function notifSheet() {
  const items = notifItems();
  const full = state.overlays.notifFull;
  return `<div>
    <div class="dim" data-action="close-notif"></div>
    <section class="sheet notif-sheet ${full ? "full" : ""}">
      <div class="notif-grab" data-notif-grab>
        <div class="handle" style="margin-bottom:0"></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">알림</div>
        <button class="ghost-icon" data-action="close-notif">${icon("x", 15)}</button>
      </div>
      <div class="notif-list">
        ${items.length ? items.map((item) => {
          const person = personById(item.by);
          const action = item.type === "req" || item.type === "accept"
            ? `data-action="notif-friends"`
            : `data-action="notif-post" data-post="${item.post}" data-kind="${item.type}"`;
          return `<button class="person-row" style="cursor:pointer;text-align:left" ${action}>
            ${avatar(person)}
            <div class="person-main">
              <div class="person-name" style="font-weight:500"><b>${escapeHtml(person?.name || "알 수 없음")}</b>님이 ${escapeHtml(item.text)}</div>
              <div class="person-id">${timeAgo(item.at)}</div>
            </div>
          </button>`;
        }).join("") : `<div class="empty" style="min-height:80px">아직 알림이 없어요</div>`}
      </div>
    </section>
  </div>`;
}

// 내 게시물 관리 — 글(캡션) 수정·게시물 삭제 (베타 피드백 11)
function postMenuSheet() {
  const pe = state.postEdit;
  const post = state.posts.find((p) => p.id === pe?.id);
  if (!post) return "";
  return `<div>
    <div class="dim" data-action="close-post-menu"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div class="section-title">내 게시물 관리</div>
      <div style="display:grid;gap:10px;margin-top:6px">
        <label>
          <div class="hint" style="margin:0 0 6px">한 줄 글 (수정·추가·삭제)</div>
          <input class="input" maxlength="60" data-field="postEdit.caption" value="${escapeHtml(pe.caption)}" placeholder="한 줄 남기기 (비우면 삭제)">
        </label>
        <button class="btn" data-action="save-post-edit">글 저장</button>
        <button class="btn secondary" style="color:var(--danger);border-color:rgba(192,69,69,.3)" data-action="delete-post" data-post="${post.id}">${icon("trash", 15)}<span style="margin-left:7px">사진 삭제</span></button>
      </div>
    </section>
  </div>`;
}

// ---------------- 대화(DM) ----------------

function threadList() {
  const map = new Map();
  state.messages.forEach((m) => {
    const other = m.from === "me" ? m.to : m.from;
    if (!other || other === "me") return;
    const cur = map.get(other) || { handle: other, last: null, unread: 0 };
    if (!cur.last || m.at > cur.last.at) cur.last = m;
    if (m.to === "me" && !m.read) cur.unread += 1;
    map.set(other, cur);
  });
  return [...map.values()].sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
}

function chatListView() {
  return `<section class="screen">
    <div class="topbar">
      <div style="flex:1"></div>
      ${bellButton()}
    </div>
    <div class="page-title">대화</div>
    <label class="search">
      ${icon("search", 16)}
      <input data-field="chatSearch" value="${escapeHtml(state.chatSearch || "")}" placeholder="친구 검색">
    </label>
    <div class="screen-scroll" data-results="chat">${chatListHtml()}</div>
  </section>`;
}

// 검색 결과 영역만 따로 그림 — 타이핑 중에는 이 영역만 부분 갱신 (입력창은 건드리지 않음)
function chatListHtml() {
  const query = (state.chatSearch || "").trim().toLowerCase();
  const matches = (u) => u && (!query || u.name.toLowerCase().includes(query) || u.id.includes(query));
  const threads = threadList().filter((t) => matches(personById(t.handle)));
  const threadHandles = threads.map((t) => t.handle);
  const otherFriends = state.friends.filter((id) => !threadHandles.includes(id) && matches(personById(id)));
  return `<div>
      <section class="section">
        ${threads.length ? `<div class="row-list">${threads.map((t) => {
          const person = personById(t.handle);
          if (!person) return "";
          return `<button class="person-row" style="cursor:pointer;text-align:left" data-action="open-chat" data-user="${t.handle}">
            ${avatar(person)}
            <div class="person-main">
              <div class="person-name">${escapeHtml(person.name)}</div>
              <div class="person-id" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.last ? escapeHtml(`${t.last.from === "me" ? "나: " : ""}${t.last.body}`) : ""}</div>
            </div>
            ${t.unread ? `<span class="unread-badge">${t.unread}</span>` : `<span class="person-id">${timeAgo(t.last?.at)}</span>`}
          </button>`;
        }).join("")}</div>` : `<div class="empty">아직 대화가 없어요<br>친구 프로필에서 메시지를 시작해보세요</div>`}
      </section>
      ${otherFriends.length ? `<section class="section">
        <h2 class="section-title">친구에게</h2>
        <div class="row-list">${otherFriends.map((id) => {
          const person = personById(id);
          if (!person) return "";
          return `<button class="person-row" style="cursor:pointer;text-align:left" data-action="open-chat" data-user="${id}">
            ${avatar(person)}
            <div class="person-main">
              <div class="person-name">${escapeHtml(person.name)}</div>
              <div class="person-id">@${escapeHtml(person.id)}</div>
            </div>
            ${icon("message", 16)}
          </button>`;
        }).join("")}</div>
      </section>` : ""}
    </div>`;
}

function chatRoomView() {
  const other = personById(state.overlays.chatWith);
  if (!other) return "";
  const msgs = state.messages
    .filter((m) => m.from === state.overlays.chatWith || m.to === state.overlays.chatWith)
    .sort((a, b) => a.at - b.at);
  return `<section class="overlay">
    <div class="topbar" style="padding-bottom:10px;border-bottom:1px solid rgba(74,53,64,.08)">
      <button class="ghost-icon" data-action="close-chat">${icon("arrow-left", 17)}</button>
      <div style="display:flex;align-items:center;gap:9px;min-width:0">
        ${avatar(other)}
        <div style="min-width:0">
          <div class="person-name">${escapeHtml(other.name)}</div>
          <div class="person-id">@${escapeHtml(other.id)}</div>
        </div>
      </div>
      <div style="width:36px"></div>
    </div>
    <div class="chat-scroll" data-chat-scroll>
      ${msgs.length ? msgs.map((m) => `
        <div class="dm-row ${m.from === "me" ? "mine" : ""}">
          ${m.from === "me" ? "" : avatar(other)}
          <div class="dm-bubble"${m.from === "me" && m.id ? ` data-action="dm-actions" data-msg="${m.id}" style="cursor:pointer" title="탭해서 삭제"` : ""}>${escapeHtml(m.body)}</div>
        </div>`).join("") : `<div class="empty">첫 메시지를 보내보세요</div>`}
    </div>
    <form class="chat-input-row" data-action="send-dm">
      <input id="dm-input" class="input pill" maxlength="500" placeholder="메시지 보내기" autocomplete="off">
      <button class="circ ink" style="width:44px;height:44px" type="submit" aria-label="전송">${icon("send", 17)}</button>
    </form>
  </section>`;
}

function busyView() {
  if (!state.busy) return "";
  return `<div class="busy">
    <div class="busy-card">
      <div class="spinner"></div>
      <div>${escapeHtml(state.busy)}</div>
    </div>
  </div>`;
}

function toastView() {
  return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : "";
}

// 종 아이콘 흔들림 — 새 알림이 생겼을 때 한 번만 (베타 피드백 8)
let lastUnseenNotif = 0;

function afterRender() {
  const bell = app.querySelector(".icon-btn.bell");
  if (bell) {
    const unseen = Number(bell.dataset.unseen || 0);
    if (unseen > lastUnseenNotif) {
      bell.classList.add("ring");
      setTimeout(() => bell.classList.remove("ring"), 1500);
    }
    lastUnseenNotif = unseen;
  }
  const carousel = document.querySelector("[data-carousel]");
  const indicator = document.querySelector("[data-indicator]");
  if (carousel && indicator) {
    const count = Number(indicator.dataset.count);
    carousel.addEventListener("scroll", () => {
      const slide = carousel.querySelector(".home-slide");
      const step = slide ? slide.offsetWidth + 16 : carousel.clientWidth;
      const active = Math.min(count - 1, Math.max(0, Math.round(carousel.scrollLeft / step)));
      const dots = indicator.querySelectorAll(".dot");
      if (dots.length) {
        dots.forEach((dot, i) => dot.classList.toggle("active", i === active));
        return;
      }
      const width = Math.max(14, 120 / count);
      const left = (120 - width) * (active / (count - 1));
      const thumb = indicator.querySelector(".progress-thumb");
      const label = indicator.querySelector(".progress-count");
      if (thumb) {
        thumb.style.width = `${width}px`;
        thumb.style.left = `${left}px`;
      }
      if (label) label.textContent = `${active + 1} / ${count}`;
    }, { passive: true });
  }
}

app.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-action]");
  if (!form) return;
  event.preventDefault();
  handleAction(form.dataset.action, form);
});

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || !app.contains(target)) return;
  if (target.tagName === "FORM") return;
  const action = target.dataset.action;
  if (action === "open-viewer" && longPressFired) {
    longPressFired = false;
    return;
  }
  handleAction(action, target);
});

app.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const el = event.target;
  if (el.type === "checkbox") {
    setField(field, el.checked);
    return render();
  }
  // 텍스트·슬라이더 입력은 재렌더 금지 — 입력창 교체 시 모바일 키보드 리셋/한글 조합 끊김, 슬라이더 드래그 끊김
  setField(field, el.value);
  patchAfterInput(field, el);
});

app.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  if (!field || event.target.type !== "checkbox") return;
  setField(field, event.target.checked);
  render();
});

app.addEventListener("pointerdown", (event) => {
  const target = event.target.closest("[data-long-post]");
  if (!target) return;
  longPressFired = false;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressFired = true;
    update((s) => {
      s.overlays.viewerPost = target.dataset.longPost;
    });
  }, 450);
});

["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
  app.addEventListener(type, () => clearTimeout(longPressTimer));
});

// 상태만 갱신 — 렌더/패치는 호출한 쪽에서 결정
function setField(field, value) {
  const s = state;
  if (field === "signup.name") s.signup.name = String(value).slice(0, 12);
  if (field === "signup.id") s.signup.id = normalizeId(value);
  if (field === "search") s.search = String(value);
  if (field === "chatSearch") s.chatSearch = String(value);
  if (field === "upload.caption") s.upload.caption = String(value).slice(0, 60);
  if (field === "upload.zoom") s.upload.zoom = Math.min(3, Math.max(1, Number(value) || 1));
  if (field === "postEdit.caption" && s.postEdit) s.postEdit.caption = String(value).slice(0, 60);
  if (field === "edit.name") s.edit.name = String(value).slice(0, 12);
  if (field === "edit.id") s.edit.id = normalizeId(value);
  if (field === "edit.bio") s.edit.bio = String(value).slice(0, 80);
  if (field === "phoneSheet.value" && s.phoneSheet) s.phoneSheet.value = String(value).slice(0, 20);
  if (field === "leave.agree") s.leave.agree = Boolean(value);
  if (field === "onboard.color" && s.onboard) s.onboard.color = String(value);
  if (field === "edit.color" && s.edit) s.edit.color = String(value);
  if (field === "bgC1" || field === "bgC2") s[field] = String(value).toLowerCase();
}

function handleAction(action, el) {
  const id = el.dataset.user;
  const postId = el.dataset.post;
  const closeAllProfiles = (s) => {
    s.overlays.publicUser = "";
    s.overlays.privateUser = "";
    s.overlays.friendUser = "";
  };
  switch (action) {
    case "welcome-enter":
      return update((s) => { s.entered = true; });
    case "setup-submit":
      return completeSetup();
    case "setup-cancel":
      // 아이디를 정하기 전에 나가기 — 세션을 끊고 처음으로 (프로필 행은 다음 로그인 때 이어서 설정)
      return doLogout();
    case "social":
      return socialLogin(el.dataset.provider);
    case "tab":
      return update((s) => { s.tab = el.dataset.tab; });
    case "open-upload":
      if (!topic) return toast("오늘의 허브가 아직 공개되지 않았어요");
      return update((s) => { s.upload = { ...blankUpload(), open: true }; });
    case "quick-upload":
      // 홈 상단 + 버튼 — 바로 앨범에서 사진 선택, 고르면 편집 단계로 진입
      if (!topic) return toast("오늘의 허브가 아직 공개되지 않았어요");
      state.upload = blankUpload();
      return albumInput.click();
    case "bg-reset":
      applyBg(BG_DEFAULT.c1, BG_DEFAULT.c2);
      return render();
    case "upload-back":
      return uploadBack();
    case "pick-photo":
      return photoInput.click();
    case "pick-album":
      return albumInput.click();
    case "pick-gallery":
      return pickGallery(el.dataset.gallery);
    case "upload-next":
      return uploadNext();
    case "set-upload":
      return setUpload(el.dataset.key, el.dataset.value);
    case "toggle-upload":
      return update((s) => { s.upload[el.dataset.key] = !s.upload[el.dataset.key]; });
    case "rotate-upload":
      state.upload.rot = ((state.upload.rot || 0) + 90) % 360;
      return patchUploadTransform();
    case "reset-transform":
      Object.assign(state.upload, { zoom: 1, rot: 0, x: 0, y: 0 });
      return patchUploadTransform();
    case "publish":
      return publishPost();
    case "reveal": {
      // 재렌더 대신 해당 프레임의 클래스만 바꿔 blur가 서서히 풀리게 한다 (베타 피드백 5)
      if (state.revealed[postId]) return;
      api.addReveal(state.me, postId).catch(() => {});
      state.revealed[postId] = true;
      app.querySelectorAll(`.media-frame[data-post="${CSS.escape(postId)}"]`).forEach((frame) => {
        frame.classList.remove("blurred");
        frame.classList.add("revealed");
      });
      return;
    }
    case "open-comments":
      return update((s) => { s.overlays.commentsFor = postId; });
    case "close-comments":
      return update((s) => { s.overlays.commentsFor = ""; });
    case "send-comment":
      return sendComment();
    case "delete-comment":
      return deleteComment(el.dataset.comment, postId);
    case "post-menu": {
      const target = state.posts.find((p) => p.id === postId);
      return update((s) => { s.postEdit = { id: postId, caption: target?.caption || "" }; });
    }
    case "close-post-menu":
      return update((s) => { s.postEdit = null; });
    case "save-post-edit":
      return savePostEdit();
    case "delete-post":
      return update((s) => { s.overlays.purgeFor = postId; });
    case "open-viewer":
      return update((s) => { s.overlays.viewerPost = postId; });
    case "archive-post":
      return setPostArchived(postId, true);
    case "restore-post":
      return setPostArchived(postId, false);
    case "open-archive":
      return update((s) => { s.overlays.archive = true; s.overlays.settings = false; });
    case "close-archive":
      return update((s) => { s.overlays.archive = false; s.overlays.settings = true; });
    case "ask-purge":
      return update((s) => { s.overlays.purgeFor = postId; });
    case "cancel-purge":
      return update((s) => { s.overlays.purgeFor = ""; });
    case "confirm-purge":
      return purgePost();
    case "open-notif":
      state.notifSeen = Date.now();
      localStorage.setItem(NOTIF_SEEN_KEY, String(state.notifSeen));
      return update((s) => { s.overlays.notif = true; });
    case "close-notif":
      return update((s) => { s.overlays.notif = false; s.overlays.notifFull = false; });
    case "dm-actions":
      return update((s) => { s.overlays.dmDelete = el.dataset.msg; });
    case "close-dm-delete":
      return update((s) => { s.overlays.dmDelete = ""; });
    case "confirm-dm-delete":
      return deleteDm();
    case "load-contacts":
      return loadContacts();
    case "open-phone":
      return update((s) => { s.phoneSheet = { value: "" }; });
    case "close-phone":
      return update((s) => { s.phoneSheet = null; });
    case "save-phone":
      return savePhone();
    case "delete-phone":
      return deletePhone();
    case "open-report":
      return update((s) => { s.overlays.reportFor = { type: el.dataset.type, id: el.dataset.target }; });
    case "close-report":
      return update((s) => { s.overlays.reportFor = null; });
    case "submit-report":
      return submitReport(el.dataset.reason);
    case "notif-friends":
      return update((s) => { s.overlays.notif = false; s.tab = "friends"; });
    case "notif-post":
      return update((s) => {
        s.overlays.notif = false;
        s.tab = "home";
        // 댓글 알림만 댓글창까지 열어줌 — 게시 알림은 오늘 탭으로 이동
        s.overlays.commentsFor = el.dataset.kind === "comment" ? postId || "" : "";
      });
    case "open-chat":
      return openChat(id);
    case "close-chat":
      return update((s) => { s.overlays.chatWith = ""; });
    case "send-dm":
      return sendDm();
    case "open-person":
      return openPerson(id);
    case "close-private":
      return update((s) => { s.overlays.privateUser = ""; });
    case "close-public-profile":
      return update((s) => { s.overlays.publicUser = ""; });
    case "open-friend-profile":
      return update((s) => { closeAllProfiles(s); s.overlays.friendUser = id; });
    case "close-friend-profile":
      return update((s) => { s.overlays.friendUser = ""; });
    case "send-request":
      return friendAction("request", id);
    case "accept-request":
      return friendAction("accept", id);
    case "decline-request":
      return friendAction("decline", id);
    case "friend-actions":
      return update((s) => { s.overlays.actionsFor = id; });
    case "close-actions":
      return update((s) => { s.overlays.actionsFor = ""; });
    case "remove-friend":
      return friendAction("remove", id);
    case "block-friend":
      return friendAction("block", id);
    case "open-edit":
      return update((s) => { s.edit = { ...s.profile, avail: true }; });
    case "close-edit":
      return update((s) => { s.edit = null; });
    case "pick-color": {
      const scope = el.dataset.scope;
      if (scope === "onboard" && state.onboard) state.onboard.color = el.dataset.color;
      else if (scope === "edit" && state.edit) {
        state.edit.color = el.dataset.color;
        // 그라데이션 색을 고르면 사진 프로필은 즉시 내려놓는다 — 사진 위에 겹치는 문제 방지
        if (state.edit.photo) { state.edit.photo = ""; return render(); }
      }
      return patchColorPick(scope);
    }
    case "onboard-next":
      return update((s) => { s.onboard.step += 1; });
    case "onboard-enable-push":
      return onboardEnablePush();
    case "onboard-done":
      return finishOnboard();
    case "pick-avatar":
      return avatarInput.click();
    case "clear-avatar":
      return update((s) => { s.edit.photo = ""; });
    case "save-edit":
      return saveEdit();
    case "open-settings":
      return update((s) => { s.overlays.settings = true; });
    case "close-settings":
      return update((s) => { s.overlays.settings = false; });
    case "toggle-setting":
      return toggleSetting(el.dataset.key);
    case "toggle-push":
      return togglePush();
    case "open-logout":
      return update((s) => { s.overlays.logout = true; });
    case "close-logout":
      return update((s) => { s.overlays.logout = false; });
    case "confirm-logout":
      return doLogout();
    case "open-leave":
      return update((s) => { s.leave = { open: true, reason: "", agree: false, confirm: false, done: false }; });
    case "close-leave":
      return update((s) => { s.leave.open = false; s.leave.confirm = false; });
    case "set-leave-reason":
      return update((s) => { s.leave.reason = el.dataset.reason; });
    case "ask-leave-confirm":
      return update((s) => { if (s.leave.agree) s.leave.confirm = true; });
    case "cancel-leave-confirm":
      return update((s) => { s.leave.confirm = false; });
    case "confirm-leave":
      return confirmLeave();
    case "finish-leave":
      return state = defaultState(), state.auth = "welcome", render();
    case "close-viewer":
      return update((s) => { s.overlays.viewerPost = ""; });
    case "retry-boot":
      state.auth = "loading";
      render();
      return boot();
    default:
      return undefined;
  }
}

// OAuth 첫 로그인 후 이름·아이디 확정 — setup_done을 켜면 다음부터는 바로 앱으로
async function completeSetup() {
  const name = state.signup.name.trim().slice(0, 12);
  const id = normalizeId(state.signup.id);
  if (!name || !validId(id)) return toast("이름과 아이디를 확인해 주세요");
  update((s) => { s.busy = "계정을 준비하는 중…"; });
  try {
    const available = await api.isHandleAvailable(id);
    if (!available) {
      update((s) => { s.busy = ""; s.signup.avail = false; });
      return toast("이미 사용 중인 아이디예요");
    }
    await api.updateProfile(state.me, { handle: id, name, setup_done: true });
    await loadAll(state.me);
    state.busy = "";
    state.auth = "app";
    // 가입 직후 첫 만남 안내 — 마지막 단계에서 프로필 그라데이션 색을 고른다
    state.onboard = { step: 0, color: palette[Math.floor(Math.random() * palette.length)] };
    render();
    startLive();
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "계정을 준비하지 못했어요");
  }
}

// 온보딩 알림 단계 — 폰 알림 권한을 요청·구독하고 앱으로. 거부/미지원이어도 온보딩은 끝낸다.
async function onboardEnablePush() {
  const ok = await enablePush();
  state.push = ok;
  return finishOnboard();
}

// 온보딩 마지막 단계 — 고른 프로필 색을 저장하고 앱으로
async function finishOnboard() {
  const color = state.onboard?.color || palette[0];
  update((s) => { s.onboard = null; });
  try {
    await api.updateProfile(state.me, { color });
    update((s) => {
      s.profile.color = color;
      const mine = personById("me");
      if (mine) mine.color = color;
    });
  } catch { /* 색 저장 실패는 치명적이지 않음 — 프로필 수정에서 다시 바꿀 수 있다 */ }
  toast("blur에 오신 걸 환영해요");
}

// 카카오/구글 인증 페이지로 이동 — 돌아오면 boot()가 세션을 받아 이어간다
async function socialLogin(provider) {
  update((s) => { s.busy = `${providerLabel(provider)}로 이동하는 중…`; });
  try {
    await api.signInWithProvider(provider);
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "로그인을 시작하지 못했어요");
  }
}

async function doLogout() {
  update((s) => { s.busy = "로그아웃하는 중…"; });
  await api.signOut();
  state = defaultState();
  state.auth = "welcome";
  render();
  toast("로그아웃했어요");
}

async function confirmLeave() {
  update((s) => { s.busy = "탈퇴 처리 중…"; });
  try {
    await api.deleteAccount(state.me);
    state = defaultState();
    state.auth = "app";
    state.leave = { open: true, reason: "", agree: false, confirm: false, done: true };
    render();
  } catch {
    update((s) => { s.busy = ""; s.leave.confirm = false; });
    toast("탈퇴 처리에 실패했어요 — 잠시 후 다시 시도해 주세요");
  }
}

async function friendAction(kind, handle) {
  const uid = uidOf(handle);
  if (!uid) return;
  try {
    if (kind === "request") await api.sendFriendRequest(state.me, uid);
    else if (kind === "accept") await api.acceptFriend(state.me, uid);
    else if (kind === "decline" || kind === "remove") await api.removeFriendship(state.me, uid);
    else if (kind === "block") await api.blockFriend(state.me, uid);
    const rows = await api.fetchFriendships();
    update((s) => {
      applySocial(s, rows);
      if (kind !== "request") s.overlays.actionsFor = "";
    });
    const messages = {
      request: "친구 요청을 보냈어요",
      accept: "친구가 되었어요",
      decline: "요청을 거절했어요",
      remove: "친구를 삭제했어요",
      block: "차단했어요"
    };
    toast(messages[kind]);
    // 잠금화면 알림 발송 (상대가 구독돼 있으면) — 파이어 앤 포겟
    if (kind === "request") api.notify("request", uid);
    else if (kind === "accept") api.notify("accept", uid);
    // 수락하면 새 친구의 오늘 허브가 새로고침 없이 바로 보이도록 전체 재적재 (베타 피드백 8)
    if (kind === "accept") scheduleRefresh();
  } catch (error) {
    toast(error.message || "요청에 실패했어요");
  }
}

function uploadBack() {
  update((s) => {
    if (s.upload.step === "caption") s.upload.step = "edit";
    else if (s.upload.step === "edit") s.upload.step = "pick";
    else s.upload = blankUpload();
  });
}

function pickGallery(id) {
  const item = gallery.find((g) => g.id === id);
  if (!item) return;
  update((s) => {
    s.upload.selectedId = id;
    s.upload.selectedImage = "";
    s.upload.selectedGrad = item.grad;
    s.upload.selectedLabel = item.label;
  });
}

function uploadNext() {
  update((s) => {
    if (s.upload.step === "pick" && (s.upload.selectedId || s.upload.selectedImage)) s.upload.step = "edit";
    else if (s.upload.step === "edit") s.upload.step = "caption";
  });
}

function setUpload(key, value) {
  update((s) => {
    if (key === "split") s.upload.split = Number(value);
    else s.upload[key] = value;
  });
  // 아트 필터 프리뷰는 비동기로 한 번만 구워 캐시한다
  if (key === "filter" && ART_FILTERS.includes(value) && state.upload.selectedImage && !(state.upload.artPreviews || {})[value]) {
    buildArtPreview(value).catch(() => {});
  }
}

async function buildArtPreview(name) {
  const source = state.upload.selectedImage;
  if (!source) return;
  const img = await loadImageEl(source);
  const w = 420;
  const h = Math.max(1, Math.round((img.height / img.width) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  applyArtFilter(canvas, name);
  const url = canvas.toDataURL("image/jpeg", .9);
  if (state.upload.selectedImage !== source) return; // 그 사이 다른 사진을 골랐다면 버린다
  update((s) => { s.upload.artPreviews = { ...s.upload.artPreviews, [name]: url }; });
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

// ---------------- 아트 필터 5종 (리디자인 v4) ----------------
// 전부 캔버스 픽셀 처리로 실제 이미지에 굽는다 — CSS 필터로는 낼 수 없는 질감.
// 프리뷰(420px)와 발행 베이크(1080px)가 같은 함수를 공유해 결과가 항상 일치한다.
const ART_FILTERS = ["grain", "glass", "halftone", "naive", "data"];

function applyArtFilter(canvas, name) {
  const fn = { grain: artGrain, glass: artGlass, halftone: artHalftone, naive: artNaive, data: artData }[name];
  if (fn) fn(canvas);
}

// 그레인 블러 — Gaussian Blur + Film Grain + Soft Focus
function artGrain(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const soft = document.createElement("canvas");
  soft.width = w;
  soft.height = h;
  const sctx = soft.getContext("2d");
  sctx.filter = `blur(${Math.max(2, Math.round(w / 200))}px) brightness(1.07)`;
  sctx.drawImage(canvas, 0, 0);
  // 소프트 포커스 — 밝은 블러 레이어를 lighten으로 겹쳐 글로우를 만든다
  ctx.globalCompositeOperation = "lighten";
  ctx.globalAlpha = .6;
  ctx.drawImage(soft, 0, 0);
  // 전체를 은은하게 흐려 몽환적인 톤으로
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = .35;
  ctx.drawImage(soft, 0, 0);
  ctx.globalAlpha = 1;
  // 필름 그레인 — 실제 필름처럼 어두운 영역에 더 진하게 앉는 휘도 가중 노이즈
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 765;
    const n = (Math.random() - .5) * (22 + 26 * (1 - lum));
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// 리퀴드 글라스 — 굴절 변위 + 유리 광택 (Glass Morphism / Optical Refraction)
function artGlass(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const sd = src.data;
  const od = out.data;
  const amp = Math.max(6, w * .022);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = amp * Math.sin(y / (h * .052) + x / (w * .13)) + amp * .5 * Math.sin(y / (h * .017));
      const dy = amp * .8 * Math.cos(x / (w * .06) + y / (h * .11));
      // 바이리니어 샘플링 — 굴절 경계의 계단 현상 없이 유리처럼 매끈하게
      const fx = Math.min(w - 1.001, Math.max(0, x + dx));
      const fy = Math.min(h - 1.001, Math.max(0, y + dy));
      const x0 = fx | 0;
      const y0 = fy | 0;
      const tx = fx - x0;
      const ty = fy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + w * 4;
      const i11 = i01 + 4;
      const oi = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] * (1 - tx) + sd[i10 + c] * tx;
        const bot = sd[i01 + c] * (1 - tx) + sd[i11 + c] * tx;
        od[oi + c] = top * (1 - ty) + bot * ty;
      }
      od[oi + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  // 유리 광택 — 대각선 하이라이트 두 줄
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(.18, "rgba(255,255,255,0)");
  sheen.addColorStop(.26, "rgba(255,255,255,.38)");
  sheen.addColorStop(.33, "rgba(255,255,255,0)");
  sheen.addColorStop(.55, "rgba(255,255,255,0)");
  sheen.addColorStop(.62, "rgba(255,255,255,.22)");
  sheen.addColorStop(.7, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  // 유리 너머의 쨍한 채도
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d").drawImage(canvas, 0, 0);
  ctx.filter = "saturate(1.3) contrast(1.06) brightness(1.02)";
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = "none";
}

// 자동 레벨 보정 — 밝기 대비가 약한 사진(역광·하이키·저조도)에서도
// 하프톤·디더 패턴이 반드시 살아나도록 2–98 퍼센타일을 0–1로 늘린다
function stretchLevels(arr) {
  const sorted = Float32Array.from(arr).sort();
  const lo = sorted[Math.floor(sorted.length * .02)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .98))];
  const range = Math.max(1e-4, hi - lo);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, Math.max(0, (arr[i] - lo) / range));
}

// 하프톤 도트 — 리소그래프 2도 인쇄 (AM Halftone / Risograph Print)
function artHalftone(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const lum = new Float32Array(n);
  const mag = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    lum[p] = (src[i] * .299 + src[i + 1] * .587 + src[i + 2] * .114) / 255;
    mag[p] = src[i + 1] / 255; // 마젠타판 ≈ 1 - green
  }
  stretchLevels(lum);
  stretchLevels(mag);
  const at = (arr, x, y) => {
    const cx = Math.min(w - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(h - 1, Math.max(0, Math.round(y)));
    return arr[cy * w + cx];
  };
  const lumAt = (x, y) => at(lum, x, y);
  const greenAt = (x, y) => at(mag, x, y);
  ctx.fillStyle = "#f6f1e6"; // 리소 종이색
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "multiply";
  const cell = Math.max(4, Math.round(w / 96));
  const pass = (deg, color, alpha, valueAt) => {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const half = Math.hypot(w, h) / 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let v = -half; v < half; v += cell) {
      for (let u = -half; u < half; u += cell) {
        const x = cos * u - sin * v + w / 2;
        const y = sin * u + cos * v + h / 2;
        if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
        // 감마 보정 — 밝은 사진도 어두운 사진도 도트 톤이 살아있게
        const r = cell * .62 * Math.pow(1 - valueAt(x, y), .85);
        if (r > .4) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };
  pass(15, "#2b45c4", 1, lumAt);       // 리소 블루 본판
  pass(45, "#ff5e97", .5, greenAt);    // 핑크 오프셋판 (마젠타 ≈ 1 - green)
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// 나이브 디자인 — 형태 단순화 + 플랫 포스터라이즈 + 잉크 외곽선 (Childlike Illustration)
function artNaive(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  // 1) 뭉개기 — 작은 캔버스로 내렸다 올려 형태를 그림처럼 단순화
  const sw = Math.max(48, Math.round(w / 7));
  const sh = Math.max(48, Math.round((sw * h) / w));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");
  sctx.filter = "saturate(1.7) brightness(1.06)";
  sctx.drawImage(canvas, 0, 0, sw, sh);
  ctx.drawImage(small, 0, 0, w, h);
  // 2) 포스터라이즈 — 채널을 4단계 플랫 컬러로
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, Math.round(d[i] / 64) * 64 + 20);
    d[i + 1] = Math.min(255, Math.round(d[i + 1] / 64) * 64 + 20);
    d[i + 2] = Math.min(255, Math.round(d[i + 2] / 64) * 64 + 20);
  }
  // 3) 색면 경계에 잉크 외곽선
  const lum = new Float32Array(w * h);
  for (let p = 0; p < lum.length; p++) {
    const i = p * 4;
    lum[p] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
  }
  const edges = [];
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const p = y * w + x;
      if (Math.abs(lum[p] - lum[p - 1]) + Math.abs(lum[p] - lum[p - w]) > 42) edges.push(p);
    }
  }
  for (const p of edges) {
    const i = p * 4;
    d[i] = 44;
    d[i + 1] = 41;
    d[i + 2] = 55;
  }
  ctx.putImageData(img, 0, 0);
  // 4) 옅은 종이 톤
  ctx.globalAlpha = .07;
  ctx.fillStyle = "#fff8e7";
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

// 데이터 디자인 — Atkinson 디더링 듀오톤 (dithered halftone / generative data art)
function artData(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  // 낮은 해상도에서 디더링해 도트가 굵게 보이게 한 뒤 픽셀 그대로 확대한다
  const dw = Math.max(96, Math.round(w / 3));
  const dh = Math.max(96, Math.round((dw * h) / w));
  const small = document.createElement("canvas");
  small.width = dw;
  small.height = dh;
  const sctx = small.getContext("2d");
  sctx.filter = "contrast(1.12)"; // 디더 패턴이 뭉개지지 않게 대비 확보
  sctx.drawImage(canvas, 0, 0, dw, dh);
  const img = sctx.getImageData(0, 0, dw, dh);
  const d = img.data;
  const gray = new Float32Array(dw * dh);
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    gray[p] = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255;
  }
  stretchLevels(gray); // 밝기만 있는 사진에서도 디더 패턴이 나오게
  for (let p = 0; p < gray.length; p++) gray[p] *= 255;
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  const ink = [16, 42, 66];      // 딥 네이비 잉크
  const paper = [236, 244, 242]; // 옅은 민트 종이 — 시그니처 톤
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const p = y * dw + x;
      const on = gray[p] > 128;
      const err = (gray[p] - (on ? 255 : 0)) / 8;
      for (const [ox, oy] of spread) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && nx < dw && ny < dh) gray[ny * dw + nx] += err;
      }
      const c = on ? paper : ink;
      const i = p * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
}

// 편집 프리뷰의 CSS transform(translate → rotate → scale)과 동일한 순서로
// 소스(이미지든 동영상 프레임이든)를 캔버스에 그린다 — 사진·동영상 베이크 공용
function bakeGeometry(up, outW) {
  const [rw, rh] = parseRatio(up.ratio);
  const outH = Math.round((outW * rh) / rw);
  const frame = app.querySelector("[data-upload-frame]");
  const previewW = frame?.getBoundingClientRect().width || parseInt(ratioWidth(up.ratio), 10);
  return { outW, outH, k: outW / previewW };
}

function drawUploadSource(ctx, source, sw, sh, geo, up) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, geo.outW, geo.outH);
  ctx.translate(geo.outW / 2 + (up.x || 0) * geo.k, geo.outH / 2 + (up.y || 0) * geo.k);
  ctx.rotate(((up.rot || 0) * Math.PI) / 180);
  ctx.scale(up.zoom || 1, up.zoom || 1);
  const cover = Math.max(geo.outW / sw, geo.outH / sh);
  ctx.drawImage(source, (-sw * cover) / 2, (-sh * cover) / 2, sw * cover, sh * cover);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// 편집 화면에서 조정한 확대·회전·이동을 캔버스로 구워 최종 이미지를 만든다 (베타 피드백 1)
async function bakeUploadImage() {
  const up = state.upload;
  const img = await loadImageEl(up.selectedImage);
  const geo = bakeGeometry(up, 1080);
  const canvas = document.createElement("canvas");
  canvas.width = geo.outW;
  canvas.height = geo.outH;
  const ctx = canvas.getContext("2d");
  drawUploadSource(ctx, img, img.width, img.height, geo, up);
  // 아트 필터는 크롭·회전이 끝난 최종 프레임 전체에 굽는다.
  // 필터가 실패해도 업로드는 절대 깨지지 않는다 — 변형만 구운 원본으로 폴백
  if (ART_FILTERS.includes(up.filter)) {
    try {
      applyArtFilter(canvas, up.filter);
    } catch { /* 필터 실패 → 무필터 이미지로 게시 */ }
  }
  return canvas.toDataURL("image/jpeg", 0.88);
}

// 동영상 베이크 — 재생하면서 프레임마다 변형·아트 필터를 캔버스에 굽고
// MediaRecorder로 최대 5초를 재인코딩한다. 소리는 싣지 않는다(무음 클립).
async function bakeUploadVideo() {
  const up = state.upload;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = up.selectedVideo;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("동영상을 읽지 못했어요"));
  });
  // 픽셀 연산이 무거운 필터는 해상도를 한 단계 낮춰 프레임 드랍(뚝뚝 끊김)을 막는다
  // — 픽셀 질감 필터라 낮은 해상도가 오히려 스타일에 자연스럽다
  const heavy = ["glass", "halftone", "naive"].includes(up.filter);
  const geo = bakeGeometry(up, heavy ? 540 : 720);
  const canvas = document.createElement("canvas");
  canvas.width = geo.outW;
  canvas.height = geo.outH;
  const ctx = canvas.getContext("2d");
  const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("이 브라우저는 동영상 게시를 지원하지 않아요");
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { rec.onstop = resolve; });
  let filterBroken = false; // 필터가 한 번이라도 실패하면 남은 프레임은 무필터로 — 업로드는 계속된다
  const tick = () => {
    drawUploadSource(ctx, video, video.videoWidth, video.videoHeight, geo, up);
    if (!filterBroken && ART_FILTERS.includes(up.filter)) {
      try {
        applyArtFilter(canvas, up.filter);
      } catch {
        filterBroken = true;
      }
    }
    if (video.ended || video.currentTime >= MAX_VIDEO_SEC) {
      video.pause();
      rec.stop();
      return;
    }
    requestAnimationFrame(tick);
  };
  await video.play();
  rec.start(250);
  tick();
  await done;
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext: mime.includes("mp4") ? "mp4" : "webm" };
}

async function publishPost() {
  const up = state.upload;
  if (!up.selectedId && !up.selectedImage) return toast("사진을 먼저 선택해 주세요");
  update((s) => { s.busy = up.selectedVideo ? "동영상에 필터를 굽는 중… (몇 초 걸려요)" : "오늘의 허브에 올리는 중…"; });
  try {
    let imageUrl;
    if (up.selectedVideo) {
      const { blob, ext } = await bakeUploadVideo();
      imageUrl = await api.uploadMedia(state.me, blob, ext);
    } else if (up.selectedImage) {
      let source = up.selectedImage;
      try {
        source = await bakeUploadImage();
      } catch {}
      imageUrl = await api.uploadPhoto(state.me, source);
    } else {
      const gradIndex = gallery.findIndex((g) => g.id === up.selectedId);
      imageUrl = `grad:${Math.max(0, gradIndex)}`;
    }
    const row = await api.createPost(state.me, {
      imageUrl,
      caption: up.caption.trim().slice(0, 60),
      ratio: up.ratio,
      split: up.split,
      filter: up.filter,
      shareAll: Boolean(up.shareAll),
      saveRoom: Boolean(up.saveRoom)
    });
    const post = mapPost(row);
    update((s) => {
      s.busy = "";
      s.posts = [post, ...s.posts];
      s.myPosted = true;
      s.upload = blankUpload();
      s.revealed[post.id] = true;
      s.tab = "home";
    });
    toast("오늘의 허브에 올렸어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "올리지 못했어요");
  }
}

function openPerson(userId) {
  const user = personById(userId);
  if (!user || userId === "me") return;
  update((s) => {
    s.overlays.publicUser = "";
    s.overlays.privateUser = "";
    if (user.public) s.overlays.publicUser = userId;
    else s.overlays.privateUser = userId;
  });
}

async function sendComment() {
  const input = document.querySelector("#comment-input");
  const text = input?.value.trim().slice(0, 100);
  const postId = state.overlays.commentsFor;
  if (!text || !postId) return;
  try {
    const row = await api.addComment(state.me, postId, text);
    const post = state.posts.find((p) => p.id === postId);
    update((s) => {
      const p = s.posts.find((x) => x.id === postId);
      if (p) p.comments.push({ id: row?.id, by: "me", text, at: Date.now() });
    });
    // 내 댓글이 아니면 게시물 작성자에게 잠금화면 알림
    if (post && post.authorId !== "me") api.notify("comment", uidOf(post.authorId));
  } catch (error) {
    toast(error.message || "댓글을 남기지 못했어요");
  }
}

async function deleteComment(commentId, postId) {
  if (!commentId) return;
  try {
    await api.deleteComment(commentId);
    update((s) => {
      const post = s.posts.find((p) => p.id === postId);
      if (post) post.comments = post.comments.filter((c) => c.id !== commentId);
    });
    toast("댓글을 삭제했어요");
  } catch (error) {
    toast(error.message || "댓글을 삭제하지 못했어요");
  }
}

// 프로필에서 삭제 → 보관으로 이동 / 보관에서 복원 (베타 피드백 6)
async function setPostArchived(postId, archived) {
  try {
    await api.updatePost(postId, { archived });
    update((s) => {
      const post = s.posts.find((p) => p.id === postId);
      if (post) post.archived = archived;
      s.overlays.viewerPost = "";
    });
    toast(archived ? "보관으로 옮겼어요 — 설정 > 보관에서 볼 수 있어요" : "프로필로 복원했어요");
  } catch (error) {
    toast(error.message || "처리하지 못했어요");
  }
}

// 영구 삭제 — 오늘 게시물 삭제(피드백 11)와 보관함 삭제(피드백 6)가 공유
async function purgePost() {
  const postId = state.overlays.purgeFor;
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return update((s) => { s.overlays.purgeFor = ""; });
  update((s) => { s.busy = "삭제하는 중…"; });
  try {
    await api.deletePost(postId);
    // 사진·동영상 원본 파일도 스토리지에서 정리 (고아 파일 방지)
    const mediaUrl = post.image || post.video;
    if (mediaUrl) api.removePhotoByUrl(mediaUrl).catch(() => {});
    update((s) => {
      s.busy = "";
      s.posts = s.posts.filter((p) => p.id !== postId);
      delete s.revealed[postId];
      s.overlays.purgeFor = "";
      s.postEdit = null;
      s.overlays.viewerPost = "";
      if (post.authorId === "me" && post.hubDate === HUB_DATE) {
        s.myPosted = false;
        s.visitors = 0;
      }
    });
    toast("사진을 삭제했어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "삭제하지 못했어요");
  }
}

// 오늘 게시물의 한 줄 글 수정·추가·삭제 (베타 피드백 11)
async function savePostEdit() {
  const pe = state.postEdit;
  if (!pe) return;
  const caption = (pe.caption || "").trim().slice(0, 60);
  try {
    await api.updatePost(pe.id, { caption });
    update((s) => {
      const post = s.posts.find((p) => p.id === pe.id);
      if (post) post.caption = caption;
      s.postEdit = null;
    });
    toast("글을 저장했어요");
  } catch (error) {
    toast(error.message || "저장하지 못했어요");
  }
}

// ---------------- 대화(DM) ----------------

async function openChat(handle) {
  const otherUid = uidOf(handle);
  if (!otherUid) return;
  update((s) => {
    s.overlays.chatWith = handle;
    s.overlays.friendUser = "";
    s.overlays.publicUser = "";
    s.overlays.privateUser = "";
  });
  // 읽음 처리 (서버 + 로컬)
  api.markMessagesRead(state.me, otherUid).catch(() => {});
  let changed = false;
  state.messages.forEach((m) => {
    if (m.from === handle && m.to === "me" && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) render();
}

async function sendDm() {
  const input = document.querySelector("#dm-input");
  const body = input?.value.trim().slice(0, 500);
  const handle = state.overlays.chatWith;
  const otherUid = uidOf(handle);
  if (!body || !otherUid) return;
  try {
    const row = await api.sendMessage(state.me, otherUid, body);
    update((s) => {
      s.messages.push({ id: row?.id, from: "me", to: handle, body, at: Date.now(), read: false });
    });
    api.notify("message", otherUid); // 상대에게 잠금화면 알림
    document.querySelector("#dm-input")?.focus({ preventScroll: true });
  } catch (error) {
    toast(error.message || "메시지를 보내지 못했어요 — 친구끼리만 대화할 수 있어요");
  }
}

async function saveEdit() {
  const edit = state.edit;
  const id = normalizeId(edit.id);
  if (!edit.name.trim()) return toast("이름을 입력해 주세요");
  if (!validId(id) || edit.avail === false) return toast("아이디를 확인해 주세요");
  update((s) => { s.busy = "저장하는 중…"; });
  try {
    let avatarUrl = edit.photo || "";
    if (avatarUrl.startsWith("data:")) {
      avatarUrl = await api.uploadPhoto(state.me, avatarUrl, "avatar");
    }
    // 프로필 사진을 바꾸거나 지웠으면 이전 아바타 파일은 스토리지에서 정리
    const prevAvatar = state.profile.photo;
    if (prevAvatar && prevAvatar !== avatarUrl && !prevAvatar.startsWith("data:")) {
      api.removePhotoByUrl(prevAvatar).catch(() => {});
    }
    const name = edit.name.trim().slice(0, 12);
    const emoji = edit.emoji || name.slice(0, 1);
    // 공백만 입력해 저장하면 '한 줄 소개 없음'으로 처리 — 안내 문구가 사라지도록 공백 1칸을 저장
    const bioInput = (edit.bio || "").slice(0, 80);
    const bio = bioInput.trim() ? bioInput.trim() : (bioInput.length ? " " : "");
    await api.updateProfile(state.me, { handle: id, name, color: edit.color, emoji, avatar_url: avatarUrl || null, bio });
    update((s) => {
      s.busy = "";
      s.profile = { name, id, color: edit.color, emoji, photo: avatarUrl, bio };
      const mine = s.people.find((p) => p.uid === s.me);
      if (mine) Object.assign(mine, { id, name, color: edit.color, emoji, photo: avatarUrl, bio });
      s.edit = null;
    });
    toast("프로필을 저장했어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "저장하지 못했어요");
  }
}

// 내가 보낸 DM 삭제 — 서버에서 지우고 로컬 상태에서도 제거
async function deleteDm() {
  const msgId = state.overlays.dmDelete;
  if (!msgId) return;
  update((s) => { s.overlays.dmDelete = ""; s.busy = "삭제하는 중…"; });
  try {
    await api.deleteMessage(msgId);
    update((s) => {
      s.busy = "";
      s.messages = s.messages.filter((m) => m.id !== msgId);
    });
    toast("메시지를 삭제했어요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "메시지를 삭제하지 못했어요");
  }
}

async function submitReport(reason) {
  const target = state.overlays.reportFor;
  if (!target) return;
  update((s) => { s.overlays.reportFor = null; s.busy = "신고를 접수하는 중…"; });
  try {
    await api.reportContent(state.me, target.type, target.id, reason);
    update((s) => { s.busy = ""; });
    toast("신고가 접수됐어요. 운영자가 검토 후 조치할게요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "신고를 접수하지 못했어요");
  }
}

async function toggleSetting(key) {
  const next = !state[key];
  update((s) => { s[key] = next; });
  try {
    await api.updateProfile(state.me, key === "myPublic" ? { is_public: next } : { notif: next });
    if (key === "myPublic") {
      const mine = state.people.find((p) => p.uid === state.me);
      if (mine) mine.public = next;
      toast(next ? "공개 계정으로 전환했어요" : "비공개 계정으로 전환했어요");
    }
  } catch (error) {
    update((s) => { s[key] = !next; });
    toast(error.message || "설정을 바꾸지 못했어요");
  }
}

async function fileToDataUrl(file, maxSide = 1400) {
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = raw;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .82);
}

// 카메라·앨범 공용 — 선택한 사진을 업로드 편집 단계로 (베타 피드백 9)
async function handlePickedPhoto(input, label) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.type.startsWith("video/")) return handlePickedVideo(input, file, label);
  try {
    const dataUrl = await fileToDataUrl(file);
    // 고른 사진의 실제 비율을 기본값으로 — 예전엔 무조건 4:5로 구워서
    // 가로로 긴 사진은 올리는 순간 양옆이 잘려 나갔다
    const el = await loadImageEl(dataUrl).catch(() => null);
    const srcRatio = ratioOf(el?.naturalWidth, el?.naturalHeight);
    update((s) => {
      s.upload.open = true;
      s.upload.step = "edit";
      s.upload.selectedId = "";
      s.upload.selectedImage = dataUrl;
      s.upload.selectedVideo = "";
      s.upload.videoDuration = 0;
      s.upload.srcRatio = srcRatio;
      s.upload.ratio = srcRatio;
      s.upload.selectedGrad = gradients[0];
      s.upload.selectedLabel = label;
      s.upload.filter = "none";
      s.upload.artPreviews = {};
      s.upload.zoom = 1;
      s.upload.rot = 0;
      s.upload.x = 0;
      s.upload.y = 0;
    });
  } catch {
    toast("사진을 불러오지 못했어요");
  } finally {
    input.value = "";
  }
}

// 동영상 선택 — 길이를 즉시 검사해 6초 이상은 편집 단계에 들어가지도 못한다 (부담 줄이기).
// 첫 프레임을 캡처해 selectedImage로 두면 크기·회전·아트 필터 프리뷰가 사진과 똑같이 동작한다.
async function handlePickedVideo(input, file, label) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error());
      video.src = url;
    });
    if (!Number.isFinite(video.duration) || video.duration >= MAX_VIDEO_SEC + 1) {
      URL.revokeObjectURL(url);
      return toast(`동영상은 ${MAX_VIDEO_SEC}초까지만 올릴 수 있어요`);
    }
    // 첫 프레임 캡처 (미리보기·아트 필터 프리뷰용 포스터)
    await new Promise((resolve, reject) => {
      video.onseeked = resolve;
      video.onerror = () => reject(new Error());
      video.currentTime = 0.01;
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const poster = canvas.toDataURL("image/jpeg", .85);
    update((s) => {
      s.upload.open = true;
      s.upload.step = "edit";
      s.upload.selectedId = "";
      s.upload.selectedImage = poster;
      s.upload.selectedVideo = url;
      s.upload.videoDuration = Math.min(video.duration, MAX_VIDEO_SEC);
      s.upload.srcRatio = ratioOf(video.videoWidth, video.videoHeight);
      s.upload.ratio = s.upload.srcRatio;
      s.upload.selectedGrad = gradients[0];
      s.upload.selectedLabel = label;
      s.upload.filter = "none";
      s.upload.artPreviews = {};
      s.upload.zoom = 1;
      s.upload.rot = 0;
      s.upload.x = 0;
      s.upload.y = 0;
    });
  } catch {
    URL.revokeObjectURL(url);
    toast("동영상을 불러오지 못했어요");
  } finally {
    input.value = "";
  }
}

photoInput.addEventListener("change", () => handlePickedPhoto(photoInput, "카메라"));
albumInput.addEventListener("change", () => handlePickedPhoto(albumInput, "앨범"));

// ---------------- 알림 시트 확장 ----------------
// 핸들을 위로 끌면(또는 탭하면) 전체 화면, 아래로 끌면 반 시트로 복귀 → 한 번 더 끌면 닫힘
let notifDrag = null;

app.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("[data-notif-grab]")) return;
  notifDrag = { y: event.clientY, id: event.pointerId };
});

["pointerup", "pointercancel"].forEach((type) => {
  app.addEventListener(type, (event) => {
    if (!notifDrag || event.pointerId !== notifDrag.id) return;
    const dy = event.clientY - notifDrag.y;
    notifDrag = null;
    if (type === "pointercancel") return;
    if (dy < -24) return update((s) => { s.overlays.notifFull = true; });
    if (dy > 24) {
      return update((s) => {
        if (s.overlays.notifFull) s.overlays.notifFull = false;
        else s.overlays.notif = false;
      });
    }
    // 살짝 탭 — 반 시트 ↔ 전체 화면 토글
    update((s) => { s.overlays.notifFull = !s.overlays.notifFull; });
  });
});

// ---------------- 업로드 프리뷰 드래그·핀치 (베타 피드백 1) ----------------
// 한 손가락: 위치 이동, 두 손가락: 확대/축소. 전체 재렌더 없이 transform만 패치.
const dragCtx = { pointers: new Map(), base: null };

function dragBaseline() {
  const pts = [...dragCtx.pointers.values()];
  dragCtx.base = {
    x: state.upload.x || 0,
    y: state.upload.y || 0,
    zoom: state.upload.zoom || 1,
    pts: pts.map((p) => ({ ...p }))
  };
}

app.addEventListener("pointerdown", (event) => {
  const frame = event.target.closest("[data-drag-canvas]");
  if (!frame || !state.upload.open || !state.upload.selectedImage) return;
  event.preventDefault();
  dragCtx.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  frame.setPointerCapture?.(event.pointerId);
  dragBaseline();
});

app.addEventListener("pointermove", (event) => {
  if (!dragCtx.pointers.has(event.pointerId) || !dragCtx.base) return;
  dragCtx.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const pts = [...dragCtx.pointers.values()];
  const base = dragCtx.base;
  if (pts.length >= 2 && base.pts.length >= 2) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const d0 = dist(base.pts[0], base.pts[1]) || 1;
    const d1 = dist(pts[0], pts[1]);
    state.upload.zoom = Math.min(3, Math.max(1, base.zoom * (d1 / d0)));
  } else {
    state.upload.x = base.x + (pts[0].x - base.pts[0].x);
    state.upload.y = base.y + (pts[0].y - base.pts[0].y);
  }
  patchUploadTransform();
});

["pointerup", "pointercancel"].forEach((type) => {
  app.addEventListener(type, (event) => {
    if (!dragCtx.pointers.has(event.pointerId)) return;
    dragCtx.pointers.delete(event.pointerId);
    if (dragCtx.pointers.size) dragBaseline();
    else dragCtx.base = null;
  });
});

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files?.[0];
  if (!file || !state.edit) return;
  try {
    const dataUrl = await fileToDataUrl(file, 700);
    update((s) => {
      s.edit.photo = dataUrl;
    });
  } catch {
    toast("프로필 사진을 불러오지 못했어요");
  } finally {
    avatarInput.value = "";
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// 네트워크 상태 변화 대응 — 끊기면 배너/오프라인 화면, 복구되면 자동으로 데이터를 다시 받는다
window.addEventListener("offline", () => {
  state.offline = true;
  if (state.auth === "app") render();
});
window.addEventListener("online", () => {
  state.offline = false;
  if (state.auth === "offline") {
    state.auth = "loading";
    render();
    boot();
  } else if (state.auth === "app") {
    render();
    refreshData();
  }
});

render();
boot();
