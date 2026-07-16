import * as api from "./backend.js";

const LEGACY_STORAGE_KEY = "blur-service-state-v2";
const NOTIF_SEEN_KEY = "blur-notif-seen";
const app = document.querySelector("#app");
const photoInput = document.querySelector("#photo-input");
const albumInput = document.querySelector("#album-input");
const avatarInput = document.querySelector("#avatar-input");

// 허브 날짜는 서버(UTC) 기준 — 한국시간 오전 9시에 새 허브가 열림
const HUB_DATE = api.hubDateToday();
const topicDate = `${HUB_DATE.slice(5, 7)}. ${HUB_DATE.slice(8, 10)}`;
// 주제는 운영자가 미리 승인한 것만 서버에서 내려옴 (없으면 빈 값 = 게시 잠금)
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

function blankUpload() {
  return {
    open: false,
    step: "pick",
    selectedId: null,
    selectedImage: "",
    selectedLabel: "",
    selectedGrad: "",
    ratio: "4 / 5",
    zoom: 1,
    rot: 0,
    x: 0,
    y: 0,
    filter: "none",
    split: 1,
    caption: "",
    shareAll: true,
    saveRoom: true
  };
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
    sentRequests: {},
    posts: [],
    revealed: {},
    hubTopics: {},
    messages: [],
    notifSeen: Number(localStorage.getItem(NOTIF_SEEN_KEY) || 0),
    signup: { name: "", id: "", pw: "", avail: null },
    login: { id: "", password: "", error: "" },
    search: "",
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
      chatWith: "",
      logout: false,
      viewerPost: ""
    },
    leave: { open: false, reason: "", agree: false, confirm: false, done: false },
    toast: "",
    busy: ""
  };
}

let state = defaultState();
let longPressTimer = null;
let longPressFired = false;
let toastTimer = null;
let handleCheckTimer = null;
let lastViewSig = "";

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
    image: isGrad ? "" : row.image_url,
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
  const [profiles, posts, friendRows, revealIds, hubTopics, suggestions, messageRows] = await Promise.all([
    api.fetchProfiles(),
    api.fetchPosts(),
    api.fetchFriendships(),
    api.fetchMyReveals(uid),
    api.fetchHubs(),
    api.fetchSuggestions().catch(() => null),
    api.fetchMessages().catch(() => [])
  ]);
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
  try {
    const session = await api.getSession();
    if (!session) {
      state = defaultState();
      state.auth = "welcome";
      return render();
    }
    await loadAll(session.user.id);
    state.auth = "app";
    render();
    api.subscribeRealtime(() => scheduleRefresh());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    });
  } catch (error) {
    state = defaultState();
    state.auth = "welcome";
    render();
    toast(error.message || "연결에 실패했어요");
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

function initialFor(person) {
  if (!person) return "?";
  if (person.emoji) return person.emoji;
  return person.name.slice(0, 1);
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
  } else if (field === "signup.pw") {
    const hint = signupPwHintState();
    setHint("signup.pw", hint.text, hint.cls);
    patchSignupSubmit();
  } else if (field === "edit.id") {
    const norm = normalizeId(state.edit.id);
    if (el.value !== norm) el.value = norm;
    scheduleHandleCheck("edit");
  } else if (field === "edit.bio") {
    setHint("edit.bio", `${(state.edit.bio || "").length}/80`);
  } else if (field === "search") {
    const box = app.querySelector('[data-results="friends"]');
    if (box) box.innerHTML = friendsListHtml();
  } else if (field === "upload.zoom") {
    patchUploadTransform();
  }
}

// 업로드 편집 프리뷰의 변형만 부분 패치 (드래그/슬라이더 중 전체 재렌더 금지)
function patchUploadTransform() {
  const img = app.querySelector("[data-upload-img]");
  if (img) img.style.transform = uploadTransform(state.upload);
  const range = app.querySelector(".zoom-range");
  if (range && Number(range.value) !== state.upload.zoom) range.value = state.upload.zoom;
}

function icon(name, size = 23) {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    sun: `<svg ${common}><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path></svg>`,
    grid: `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>`,
    users: `<svg ${common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    user: `<svg ${common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    camera: `<svg ${common}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`,
    image: `<svg ${common}><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>`,
    message: `<svg ${common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`,
    bell: `<svg ${common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
    rotate: `<svg ${common}><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
    trash: `<svg ${common}><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    edit: `<svg ${common}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"></path></svg>`,
    send: `<svg ${common}><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4z"></path></svg>`,
    settings: `<svg ${common}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
  };
  return icons[name] || "";
}

function ratioWidth(ratio) {
  if (ratio === "16 / 9") return "320px";
  if (ratio === "1 / 1") return "280px";
  return "286px";
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
  const revealed = options.forceReveal || state.revealed[post.id];
  const hiddenClass = revealed ? "revealed" : "blurred";
  const action = options.noReveal ? "" : `data-action="reveal" data-post="${escapeHtml(post.id)}"`;
  const ratio = options.square ? "1 / 1" : post.ratio || "4 / 5";
  const split = Number(post.split || 1);
  const tiles = split === 4 ? 4 : split;
  const columns = split === 4 ? "repeat(2, 1fr)" : `repeat(${tiles}, 1fr)`;
  const inner = post.image
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
  </div>`;
}

function avatar(person, sizeClass = "avatar") {
  if (person?.photo) {
    return `<div class="${sizeClass}" style="background:${person.color}"><img src="${person.photo}" alt=""></div>`;
  }
  return `<div class="${sizeClass}" style="background:${person?.color || palette[0]}">${escapeHtml(initialFor(person))}</div>`;
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

// 화면 구성(어떤 뷰·오버레이가 떠 있는지) 서명 — 같으면 재렌더 시 진입 애니메이션을 끔
function viewSignature() {
  const o = state.overlays;
  return [
    state.auth, state.tab, state.entered,
    state.upload.open && state.upload.step,
    o.commentsFor, o.friendUser, o.publicUser, o.privateUser, o.actionsFor,
    o.settings, o.archive, o.purgeFor, o.notif, o.chatWith, o.logout, o.viewerPost,
    Boolean(state.edit), Boolean(state.postEdit), state.leave.open, state.leave.confirm, state.leave.done
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
  const sig = viewSignature();
  const noAnim = sig === lastViewSig;
  lastViewSig = sig;
  const content = state.auth === "loading"
    ? loadingView()
    : state.auth === "welcome"
      ? welcomeView()
      : state.auth === "signup"
        ? signupView()
        : state.auth === "login"
          ? loginView()
          : appView();
  app.innerHTML = `<div class="phone${noAnim ? " no-anim" : ""}">${content}${busyView()}${toastView()}</div>`;
  if (noAnim) {
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

function loadingView() {
  return `<section class="screen" style="justify-content:center;align-items:center;display:flex;flex-direction:column;gap:14px">
    <div class="spinner"></div>
    <div class="brand logo" style="font-size:26px">blur</div>
  </section>`;
}

function welcomeView() {
  return `<section class="screen welcome" ${state.entered ? "" : `data-action="welcome-enter"`}>
    <div class="welcome-hero">오늘이 선명해지는 순간,<br><span class="welcome-brand">blur</span></div>
    ${state.entered
      ? `<div class="welcome-auth">
          <div class="auth-stack">
            <button class="btn" data-action="go-signup">시작하기</button>
            <button class="btn secondary" data-action="go-login">이미 계정이 있어요</button>
          </div>
          <div class="hint" style="margin-top:18px">가입하면 서비스 이용약관과 개인정보 처리방침에 동의한 것으로 간주돼요.</div>
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

function signupPwHintState() {
  return state.signup.pw && state.signup.pw.length < 6
    ? { text: "비밀번호는 6자 이상이어야 해요", cls: "bad" }
    : { text: "", cls: "" };
}

function signupEnabled() {
  const nameOk = state.signup.name.trim().length > 0 && state.signup.name.trim().length <= 12;
  return nameOk && validId(normalizeId(state.signup.id)) && state.signup.avail === true && state.signup.pw.length >= 6;
}

function editIdHintState() {
  const avail = state.edit?.avail;
  if (avail === "checking") return { text: "아이디 확인 중…", cls: "" };
  if (avail === false) return { text: "이미 사용 중이거나 형식이 맞지 않아요", cls: "bad" };
  return { text: "사용할 수 있는 아이디예요", cls: "good" };
}

function signupView() {
  const id = normalizeId(state.signup.id);
  const enabled = signupEnabled();
  const idHint = signupIdHintState();
  const pwHint = signupPwHintState();
  return `<section class="screen">
    <div class="auth-card">
      <h1>blur 시작하기</h1>
      <div class="subtitle">친구들이 알아볼 이름과 고유 아이디를 정해주세요.</div>
      <div class="auth-stack">
        <label>
          <input class="input" data-field="signup.name" maxlength="12" value="${escapeHtml(state.signup.name)}" placeholder="이름">
          <div class="hint" data-hint="signup.name">${state.signup.name.length}/12</div>
        </label>
        <label>
          <input class="input" data-field="signup.id" maxlength="16" value="${escapeHtml(id)}" placeholder="@아이디">
          <div class="hint ${idHint.cls}" data-hint="signup.id">${idHint.text}</div>
        </label>
        <label>
          <input class="input" type="password" data-field="signup.pw" value="${escapeHtml(state.signup.pw)}" placeholder="비밀번호 (6자 이상)">
          <div class="hint ${pwHint.cls}" data-hint="signup.pw" ${pwHint.text ? "" : `style="display:none"`}>${pwHint.text}</div>
        </label>
        <button class="btn ${enabled ? "" : "disabled"}" ${enabled ? "" : "disabled"} data-submit="signup" data-action="signup-submit">시작하기</button>
        <button class="btn secondary" data-action="go-login">이미 계정이 있어요</button>
      </div>
    </div>
  </section>`;
}

function loginView() {
  return `<section class="screen">
    <div class="auth-card">
      <h1>다시 blur</h1>
      <div class="subtitle">아이디로 로그인하거나 소셜 계정으로 계속하세요.</div>
      <div class="auth-stack">
        <input class="input" data-field="login.id" value="${escapeHtml(state.login.id)}" placeholder="@아이디">
        <input class="input" data-field="login.password" value="${escapeHtml(state.login.password)}" type="password" placeholder="비밀번호">
        ${state.login.error ? `<div class="hint bad">${escapeHtml(state.login.error)}</div>` : ""}
        <button class="btn" data-action="login-submit">로그인</button>
        <button class="text-link" style="background:transparent;text-align:center" data-action="forgot">비밀번호를 잊었어요</button>
        <div class="divider">또는</div>
        <button class="btn social kakao" data-action="social" data-provider="카카오"><span class="social-mark">K</span>카카오로 계속하기</button>
        <button class="btn social naver" data-action="social" data-provider="네이버"><span class="social-mark">N</span>네이버로 계속하기</button>
        <button class="btn social google" data-action="social" data-provider="Google"><span class="social-mark">G</span>Google로 계속하기</button>
        <button class="btn secondary" data-action="go-signup">처음이라면 가입하기</button>
      </div>
    </div>
  </section>`;
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
function cardWidth(ratio) {
  const ar = { "1 / 1": 1, "16 / 9": 16 / 9, "4 / 5": 0.8 }[ratio] || 0.8;
  return `min(${ratioWidth(ratio)}, calc((100svh - 415px) * ${ar.toFixed(4)}), 100%)`;
}

function firstCommentHtml(post, cls = "") {
  const first = (post.comments || [])[0];
  if (!first) return "";
  const person = personById(first.by);
  return `<button class="comment-preview ${cls}" data-action="open-comments" data-post="${post.id}">
    <b>${escapeHtml(person?.name || "")}</b> ${escapeHtml(first.text)}
  </button>`;
}

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
      <div style="flex:1" class="brand logo">blur</div>
      <div class="hub-date">${escapeHtml(topicDate)}</div>
      <div style="flex:1;display:flex;justify-content:flex-end;gap:8px">
        ${state.myPosted
          ? `<div class="posted-badge" title="오늘 게시 완료"><span class="check">✓</span></div>`
          : `<button class="icon-btn plus" aria-label="사진 올리기" data-action="open-upload">＋</button>`}
        ${bellButton()}
      </div>
    </div>
    <div class="hub-card">
      <div class="hub-kicker">오늘의 허브</div>
      <div class="hub-topic">${topic ? escapeHtml(topic) : `<span style="color:var(--soft)">주제를 준비하고 있어요</span>`}</div>
    </div>
    ${posts.length ? `<div class="home-carousel" data-carousel>
      ${posts.map((post) => {
        const person = personById(post.authorId);
        const mine = post.authorId === "me";
        return `<article class="home-slide">
          <div class="post-card" style="width:${cardWidth(post.ratio)};margin:0 auto">
            ${mediaFrame(post, "large", { person })}
            <div class="post-meta">
              <div class="post-name">${escapeHtml(person?.name || "알 수 없음")} <span class="post-time">${escapeHtml(post.time)}</span></div>
              <div class="meta-actions">
                ${firstCommentHtml(post)}
                <button class="msg-btn" aria-label="댓글" data-action="open-comments" data-post="${post.id}">${icon("message", 16)}</button>
                ${mine ? `<button class="msg-btn" aria-label="게시물 관리" data-action="post-menu" data-post="${post.id}">${icon("edit", 14)}</button>` : ""}
              </div>
            </div>
            ${post.caption ? `<div class="caption">${escapeHtml(post.caption)}</div>` : ""}
          </div>
        </article>`;
      }).join("")}
    </div>
    ${carouselIndicator(posts.length, 0)}` : `<div class="empty">아직 응답한 친구가 없어요</div>`}
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
    return `<article>
      ${mediaFrame(post, "small", { person })}
      <div class="post-meta" style="margin-top:6px">
        <button class="post-name sm" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;text-align:left;cursor:pointer" data-action="open-person" data-user="${post.authorId}">${escapeHtml(person?.name || "알 수 없음")}</button>
        <div class="meta-actions">
          ${firstCommentHtml(post, "sm")}
          <button class="msg-btn sm" aria-label="댓글" data-action="open-comments" data-post="${post.id}">${icon("message", 13)}</button>
        </div>
      </div>
    </article>`;
  };
  return `<section class="screen">
    <div class="topbar centered">
      <h1 class="title">전체</h1>
    </div>
    <div class="topic-sub">${topic ? `"${escapeHtml(topic)}"` : "오늘의 주제를 준비하고 있어요"}</div>
    <div class="screen-scroll">
      <div class="masonry">
        <div class="masonry-col">${colA.map(card).join("")}</div>
        <div class="masonry-col">${colB.map(card).join("")}</div>
      </div>
    </div>
  </section>`;
}

function friendsView() {
  return `<section class="screen">
    <div class="topbar centered" style="display:block;padding:20px 26px 12px">
      <h1 class="title">친구 <span style="font-size:14px;color:var(--point)">${state.friends.length}</span></h1>
      <input class="input pill" style="margin-top:12px" data-field="search" value="${escapeHtml(state.search)}" placeholder="이름 또는 아이디 검색">
    </div>
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
      return { ...u, mutual: mutual ? `함께 아는 친구 ${mutual}명` : "" };
    })
    .filter((u) => u && matches(u));
  const recsShown = query ? recUsers : recUsers.slice(0, 5);
  return `${state.reqs.length ? `<section class="section">
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
      <button class="act-btn accept" aria-label="수락" title="수락" data-action="accept-request" data-user="${user.id}">✓</button>
      <button class="act-btn decline" aria-label="거절" title="거절" data-action="decline-request" data-user="${user.id}">✕</button>
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
      <button class="act-btn ${sent ? "sent" : "add"}" aria-label="${sent ? "요청 보냄" : "친구 추가"}" title="${sent ? "요청 보냄" : "친구 추가"}" data-action="send-request" data-user="${user.id}">${sent ? "✓" : "＋"}</button>
    </div>`;
  }
  return `<div class="person-row">
    <button style="background:transparent;padding:0" data-action="open-friend-profile" data-user="${user.id}">${avatar(user)}</button>
    <button class="person-main" style="background:transparent;text-align:left;cursor:pointer" data-action="open-friend-profile" data-user="${user.id}">
      <div class="person-name">${escapeHtml(user.name)}</div>
      <div class="person-id">@${escapeHtml(user.id)}</div>
    </button>
    <button class="ghost-icon" aria-label="더보기" data-action="friend-actions" data-user="${user.id}">⋯</button>
  </div>`;
}

function myView() {
  const my = personById("me");
  const archive = state.posts.filter((post) => post.authorId === "me" && !post.archived);
  const bio = (state.profile.bio || "").trim();
  return `<section class="screen">
    <div class="topbar centered"><h1 class="title">룸</h1></div>
    <div class="room-head">
      ${avatar(my, "profile-avatar room-avatar")}
      <div class="room-name">${escapeHtml(state.profile.name)}</div>
      <div class="room-id">@${escapeHtml(state.profile.id)}</div>
      ${bio
        ? `<div class="room-bio">${escapeHtml(bio)}</div>`
        : `<button class="room-bio empty" data-action="open-edit">나를 한 줄로 소개해보세요 ✎</button>`}
      <div class="room-actions">
        <button class="btn secondary" style="min-height:34px;padding:0 16px;font-size:12px;white-space:nowrap" data-action="open-edit">프로필 수정</button>
        <button class="ghost-icon" aria-label="설정" data-action="open-settings">${icon("settings", 17)}</button>
      </div>
      <div class="room-stat"><b>${state.visitors}</b>명이 내 오늘을 열어봤어요</div>
    </div>
    <div style="height:18px"></div>
    <div class="screen-scroll">
      ${archive.length
        ? `<div class="photo-grid">${archive.map((post, index) => gridTile(post, index)).join("")}</div>`
        : `<div class="empty">아직 올린 응답이 없어요</div>`}
      ${!state.myPosted ? `<div class="hint" style="text-align:center;margin-top:10px">오늘의 허브에 아직 응답하지 않았어요</div>` : ""}
    </div>
  </section>`;
}

// 룸 사진 탭 → 확대 뷰(날짜+허브 주제), 다시 탭하면 원래대로 (베타 피드백 10)
function gridTile(post) {
  const isToday = post.hubDate === HUB_DATE;
  const displayPost = { ...post, ratio: "1 / 1" };
  const revealForce = !isToday || post.authorId !== "me" || state.revealed[post.id];
  return `<div data-long-post="${post.id}" data-action="open-viewer" data-post="${post.id}" style="position:relative">
    ${mediaFrame(displayPost, "square", { forceReveal: revealForce, noReveal: true, square: true })}
    <div class="photo-label">${escapeHtml(isToday ? "오늘" : post.label || post.time)}</div>
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
    ["friends", "친구", "users"],
    ["my", "룸", "user"]
  ];
  const unread = unreadDmCount();
  return `<nav class="tabbar" aria-label="주 메뉴">
    ${tabs.map(([tab, label, iconName]) => `<button class="tab ${state.tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}" aria-label="${label}" style="position:relative">
      ${icon(iconName, 20)}<span style="font-size:9px;font-weight:700">${label}</span>
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
    state.overlays.logout ? logoutSheet() : ""
  ].join("");
}

function uploadView() {
  const titles = { pick: "사진 고르기", edit: "사진 수정", caption: "마지막 확인" };
  const up = state.upload;
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="upload-back">←</button>
      <div class="overlay-title">${titles[up.step]}</div>
      <div style="width:36px"></div>
    </div>
    <div style="padding:12px 26px 0;text-align:center">
      <span class="badge" style="background:rgba(255,255,255,.72);color:var(--point);letter-spacing:.08em">${escapeHtml(topic)}</span>
    </div>
    ${up.step === "pick" ? uploadPick() : up.step === "edit" ? uploadEdit() : uploadCaption()}
  </section>`;
}

function uploadPick() {
  const selected = state.upload.selectedId;
  return `<div class="screen-scroll" style="padding:18px 22px 110px">
    <div class="upload-grid">
      <button class="camera-tile" data-action="pick-photo">${icon("camera", 20)}<span style="font-size:10.5px">카메라</span></button>
      <button class="camera-tile" data-action="pick-album">${icon("image", 20)}<span style="font-size:10.5px">앨범</span></button>
      ${gallery.map((item) => `<button class="gallery-tile ${selected === item.id ? "selected" : ""}" style="background:${item.grad}" data-action="pick-gallery" data-gallery="${item.id}">
        <span class="photo-label">${item.label}</span><span class="tile-check">✓</span>
      </button>`).join("")}
    </div>
    <div class="fixed-cta"><button class="btn ${selected || state.upload.selectedImage ? "" : "disabled"}" style="width:100%" ${selected || state.upload.selectedImage ? "" : "disabled"} data-action="upload-next">다음</button></div>
  </div>`;
}

// 인스타 스토리처럼 드래그·핀치·슬라이더·회전으로 사진을 조정한 상태 (베타 피드백 1)
function uploadTransform(up) {
  return `translate(${up.x || 0}px, ${up.y || 0}px) rotate(${up.rot || 0}deg) scale(${up.zoom || 1})`;
}

function uploadPreview(interactive = false) {
  const up = state.upload;
  if (up.selectedImage) {
    return `<div style="width:${ratioWidth(up.ratio)};max-width:100%;margin:0 auto">
      <div class="media-frame large revealed upload-frame" data-upload-frame style="aspect-ratio:${up.ratio};--tone:${toneFilter(up.filter)}" ${interactive ? `data-drag-canvas` : ""}>
        <img class="media-img" src="${up.selectedImage}" alt="" draggable="false"
          style="transform:${uploadTransform(up)};transition:none" data-upload-img>
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
      <div class="chip-row">${chips("ratio", [["1 / 1", "1:1"], ["4 / 5", "4:5"], ["16 / 9", "16:9"]])}</div>
    </div>
    <div>
      <div class="section-title">필터</div>
      <div class="chip-row">${chips("filter", [["none", "원본"], ["warm", "따뜻"], ["vivid", "선명"], ["calm", "차분"], ["mono", "모노"]])}</div>
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
      <div>🔒</div>
    </div>
    <div class="setting-row">
      <div><div class="person-name">'모두'에도 공개</div><div class="person-id">전체 이용자의 모두 탭에 보여요</div></div>
      <button class="toggle ${up.shareAll ? "on" : ""}" data-action="toggle-upload" data-key="shareAll" aria-label="모두에도 공개"></button>
    </div>
    <div class="setting-row">
      <div><div class="person-name">내 룸에 저장</div><div class="person-id">허브가 닫혀도 내 아카이브에 남아요</div></div>
      <button class="toggle ${up.saveRoom ? "on" : ""}" data-action="toggle-upload" data-key="saveRoom" aria-label="내 룸에 저장"></button>
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
      <button class="ghost-icon" data-action="${isPublic ? "close-public-profile" : "close-friend-profile"}">←</button>
      <div class="overlay-title">${isPublic ? "프로필" : "친구 프로필"}</div>
      <div style="width:36px"></div>
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
        return `<div>${mediaFrame({ ...post, ratio: "1 / 1" }, "square", { forceReveal, square: true, short: true })}<div class="photo-label">${escapeHtml(post.label || "지난 허브")}</div></div>`;
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
      <button class="ghost-icon" data-action="close-edit">←</button>
      <div class="overlay-title">프로필 수정</div>
      <div style="width:36px"></div>
    </div>
    <div class="screen-scroll" style="padding:24px 26px 40px;display:grid;gap:18px">
      <div style="display:grid;justify-items:center;gap:12px">
        ${edit.photo ? `<div class="profile-avatar" style="width:88px;height:88px;background:${edit.color}"><img src="${edit.photo}" alt=""></div>` : `<div class="profile-avatar" style="width:88px;height:88px;background:${edit.color};font-size:30px">${escapeHtml(edit.emoji || edit.name.slice(0, 1))}</div>`}
        <div class="hint">프로필 사진은 앨범에서만 선택할 수 있어요</div>
        <button class="btn secondary" style="width:100%;border-style:dashed" data-action="pick-avatar">${icon("image", 15)}<span style="margin-left:8px">앨범에서 사진 선택</span></button>
        ${edit.photo ? `<button class="text-link" style="color:var(--danger)" data-action="clear-avatar">사진 지우기</button>` : ""}
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
      <button class="ghost-icon" data-action="close-settings">←</button>
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
          <div class="setting-row"><div><div class="person-name">알림</div><div class="person-id">친구 요청과 댓글 알림</div></div><button class="toggle ${state.notif ? "on" : ""}" data-action="toggle-setting" data-key="notif"></button></div>
          <div class="setting-row"><div><div class="person-name">공개 계정</div><div class="person-id">누구나 프로필과 지난 허브를 볼 수 있어요</div></div><button class="toggle ${state.myPublic ? "on" : ""}" data-action="toggle-setting" data-key="myPublic"></button></div>
        </div>
      </div>
      <div>
        <div class="section-title">보관함</div>
        <div style="display:grid;gap:8px">
          <button class="setting-row" style="text-align:left;cursor:pointer" data-action="open-archive"><div><div class="person-name">보관</div><div class="person-id">룸에서 삭제한 허브 사진 보기·영구 삭제</div></div><span>›</span></button>
        </div>
      </div>
      <div>
        <div class="section-title">계정</div>
        <div style="display:grid;gap:8px">
          <button class="setting-row" style="text-align:left;cursor:pointer" data-action="open-logout"><div><div class="person-name">로그아웃</div><div class="person-id">다시 로그인하면 그대로 이어서 쓸 수 있어요</div></div><span>›</span></button>
          <button class="setting-row" style="text-align:left;cursor:pointer;color:var(--danger)" data-action="open-leave"><div><div class="person-name" style="color:var(--danger)">회원 탈퇴</div><div class="person-id">모든 데이터 삭제</div></div><span>›</span></button>
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
        <button class="ghost-icon" data-action="close-comments">✕</button>
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
                ${mine && c.id ? `<button class="comment-del" aria-label="댓글 삭제" data-action="delete-comment" data-comment="${c.id}" data-post="${post.id}">✕</button>` : ""}
              </div>
              <div class="comment-bubble">${escapeHtml(c.text)}</div>
            </div>
          </div>`;
        }).join("") : `<div class="empty" style="min-height:80px">아직 댓글이 없어요</div>`}
      </div>
      <form data-action="send-comment" style="display:flex;gap:8px;margin-top:12px">
        <input id="comment-input" class="input pill" maxlength="100" placeholder="댓글을 남겨보세요">
        <button class="mini-btn" type="submit">전송</button>
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
        <button class="setting-row" data-action="remove-friend" data-user="${user.id}"><span>친구 삭제</span><span>›</span></button>
        <button class="setting-row" style="color:var(--danger)" data-action="block-friend" data-user="${user.id}"><span>차단</span><span>›</span></button>
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
      <button class="ghost-icon" data-action="close-leave">←</button>
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

// 룸 사진 확대 뷰 — 사진 아래 날짜·허브 주제, 사진(화면)을 다시 탭하면 닫힘 (베타 피드백 10)
function viewerView() {
  const post = state.posts.find((p) => p.id === state.overlays.viewerPost) || { id: "viewer", authorId: "me", hubDate: HUB_DATE, ratio: "4 / 5", split: 1, grad: gradients[0], label: "sample" };
  const dateLabel = `${post.hubDate.slice(5, 7)}. ${post.hubDate.slice(8, 10)}`;
  const hubTopic = state.hubTopics[post.hubDate] || "";
  const mine = post.authorId === "me";
  return `<section class="viewer" data-action="close-viewer">
    <div class="viewer-zoom">
      ${mediaFrame(post, "large", { forceReveal: true, noReveal: true })}
      <div style="text-align:center">
        <div style="font-size:12px;color:rgba(255,255,255,.64)">${escapeHtml(dateLabel)} 허브</div>
        <div style="font-size:19px;font-weight:800;margin-top:4px">${escapeHtml(hubTopic)}</div>
      </div>
      ${mine && !post.archived ? `<button class="btn secondary viewer-archive" data-action="archive-post" data-post="${post.id}">${icon("trash", 15)}<span style="margin-left:7px">룸에서 삭제 (보관으로 이동)</span></button>` : ""}
    </div>
  </section>`;
}

// 설정 > 보관 — 룸에서 삭제한 사진 열람·복원·영구 삭제 (베타 피드백 6)
function archiveView() {
  const archived = state.posts.filter((post) => post.authorId === "me" && post.archived);
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-archive">←</button>
      <div class="overlay-title">보관</div>
      <div style="width:36px"></div>
    </div>
    <div class="hint" style="padding:10px 26px 0;text-align:center">룸에서 삭제한 사진이에요. 나에게만 보이고, 여기서 영구 삭제할 수 있어요.</div>
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
  return `<div>
    <div class="dim" data-action="close-notif"></div>
    <section class="sheet">
      <div class="handle"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">알림</div>
        <button class="ghost-icon" data-action="close-notif">✕</button>
      </div>
      <div style="min-height:80px;max-height:320px;overflow-y:auto;display:grid;gap:8px">
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
  const threads = threadList();
  const threadHandles = threads.map((t) => t.handle);
  const otherFriends = state.friends.filter((id) => !threadHandles.includes(id));
  return `<section class="screen">
    <div class="topbar centered"><h1 class="title">대화</h1></div>
    <div class="screen-scroll">
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
        <h2 class="section-title">친구에게 메시지</h2>
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
    </div>
  </section>`;
}

function chatRoomView() {
  const other = personById(state.overlays.chatWith);
  if (!other) return "";
  const msgs = state.messages
    .filter((m) => m.from === state.overlays.chatWith || m.to === state.overlays.chatWith)
    .sort((a, b) => a.at - b.at);
  return `<section class="overlay">
    <div class="topbar" style="padding-bottom:10px;border-bottom:1px solid rgba(74,53,64,.08)">
      <button class="ghost-icon" data-action="close-chat">←</button>
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
          <div class="dm-bubble">${escapeHtml(m.body)}</div>
        </div>`).join("") : `<div class="empty">첫 메시지를 보내보세요</div>`}
    </div>
    <form class="chat-input-row" data-action="send-dm">
      <input id="dm-input" class="input pill" maxlength="500" placeholder="메시지 보내기" autocomplete="off">
      <button class="icon-btn" style="width:44px;height:44px;flex:none" type="submit" aria-label="전송">${icon("send", 18)}</button>
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
  if (field === "signup.pw") s.signup.pw = String(value);
  if (field === "login.id") s.login.id = String(value);
  if (field === "login.password") s.login.password = String(value);
  if (field === "search") s.search = String(value);
  if (field === "upload.caption") s.upload.caption = String(value).slice(0, 60);
  if (field === "upload.zoom") s.upload.zoom = Math.min(3, Math.max(1, Number(value) || 1));
  if (field === "postEdit.caption" && s.postEdit) s.postEdit.caption = String(value).slice(0, 60);
  if (field === "edit.name") s.edit.name = String(value).slice(0, 12);
  if (field === "edit.id") s.edit.id = normalizeId(value);
  if (field === "edit.bio") s.edit.bio = String(value).slice(0, 80);
  if (field === "leave.agree") s.leave.agree = Boolean(value);
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
    case "go-signup":
      return update((s) => { s.auth = "signup"; });
    case "go-login":
      return update((s) => { s.auth = "login"; s.login.error = ""; });
    case "signup-submit":
      return signup();
    case "login-submit":
      return login();
    case "forgot":
      return toast("비밀번호 재설정은 서버 연결 단계에서 활성화돼요");
    case "social":
      return socialLogin(el.dataset.provider);
    case "tab":
      return update((s) => { s.tab = el.dataset.tab; });
    case "open-upload":
      if (!topic) return toast("오늘의 주제가 아직 공개되지 않았어요");
      return update((s) => { s.upload = { ...blankUpload(), open: true }; });
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
      return update((s) => { s.overlays.notif = false; });
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
    default:
      return undefined;
  }
}

async function signup() {
  const name = state.signup.name.trim().slice(0, 12);
  const id = normalizeId(state.signup.id);
  const pw = state.signup.pw;
  if (!name || !validId(id)) return toast("이름과 아이디를 확인해 주세요");
  if (pw.length < 6) return toast("비밀번호는 6자 이상이어야 해요");
  update((s) => { s.busy = "계정을 만드는 중…"; });
  try {
    const available = await api.isHandleAvailable(id);
    if (!available) {
      update((s) => { s.busy = ""; s.signup.avail = false; });
      return toast("이미 사용 중인 아이디예요");
    }
    const session = await api.signUp(name, id, pw);
    await loadAll(session.user.id);
    state.busy = "";
    state.auth = "app";
    render();
    toast("blur에 오신 걸 환영해요");
  } catch (error) {
    update((s) => { s.busy = ""; });
    toast(error.message || "가입에 실패했어요");
  }
}

async function login() {
  const id = normalizeId(state.login.id);
  if (!id || !state.login.password) {
    return update((s) => { s.login.error = "아이디와 비밀번호를 모두 입력해 주세요"; });
  }
  update((s) => { s.busy = "로그인하는 중…"; });
  try {
    const session = await api.signIn(id, state.login.password);
    await loadAll(session.user.id);
    state.busy = "";
    state.auth = "app";
    state.login = { id: "", password: "", error: "" };
    render();
    toast("다시 만났네요");
  } catch {
    update((s) => { s.busy = ""; s.login.error = "아이디 또는 비밀번호가 맞지 않아요"; });
  }
}

function socialLogin(provider) {
  toast(`${provider} 로그인은 앱 출시 단계에서 열려요`);
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
    await api.deleteAccount();
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
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

// 편집 화면에서 조정한 확대·회전·이동을 캔버스로 구워 최종 이미지를 만든다 (베타 피드백 1)
// 프리뷰의 CSS transform(translate → rotate → scale)과 동일한 순서로 그린다.
async function bakeUploadImage() {
  const up = state.upload;
  const img = await loadImageEl(up.selectedImage);
  const [rw, rh] = up.ratio === "1 / 1" ? [1, 1] : up.ratio === "16 / 9" ? [16, 9] : [4, 5];
  const outW = 1080;
  const outH = Math.round((outW * rh) / rw);
  const frame = app.querySelector("[data-upload-frame]");
  const previewW = frame?.getBoundingClientRect().width || parseInt(ratioWidth(up.ratio), 10);
  const k = outW / previewW;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.translate(outW / 2 + (up.x || 0) * k, outH / 2 + (up.y || 0) * k);
  ctx.rotate(((up.rot || 0) * Math.PI) / 180);
  ctx.scale(up.zoom || 1, up.zoom || 1);
  const cover = Math.max(outW / img.width, outH / img.height);
  ctx.drawImage(img, (-img.width * cover) / 2, (-img.height * cover) / 2, img.width * cover, img.height * cover);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function publishPost() {
  const up = state.upload;
  if (!up.selectedId && !up.selectedImage) return toast("사진을 먼저 선택해 주세요");
  update((s) => { s.busy = "오늘의 허브에 올리는 중…"; });
  try {
    let imageUrl;
    if (up.selectedImage) {
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
    update((s) => {
      const post = s.posts.find((p) => p.id === postId);
      if (post) post.comments.push({ id: row?.id, by: "me", text, at: Date.now() });
    });
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

// 룸에서 삭제 → 보관으로 이동 / 보관에서 복원 (베타 피드백 6)
async function setPostArchived(postId, archived) {
  try {
    await api.updatePost(postId, { archived });
    update((s) => {
      const post = s.posts.find((p) => p.id === postId);
      if (post) post.archived = archived;
      s.overlays.viewerPost = "";
    });
    toast(archived ? "보관으로 옮겼어요 — 설정 > 보관에서 볼 수 있어요" : "룸으로 복원했어요");
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
    if (post.image) api.removePhotoByUrl(post.image).catch(() => {});
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
    const name = edit.name.trim().slice(0, 12);
    const emoji = edit.emoji || name.slice(0, 1);
    const bio = (edit.bio || "").trim().slice(0, 80);
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
  try {
    const dataUrl = await fileToDataUrl(file);
    update((s) => {
      s.upload.open = true;
      s.upload.step = "edit";
      s.upload.selectedId = "";
      s.upload.selectedImage = dataUrl;
      s.upload.selectedGrad = gradients[0];
      s.upload.selectedLabel = label;
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

photoInput.addEventListener("change", () => handlePickedPhoto(photoInput, "카메라"));
albumInput.addEventListener("change", () => handlePickedPhoto(albumInput, "앨범"));

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

render();
boot();
