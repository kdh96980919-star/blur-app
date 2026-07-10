import * as api from "./backend.js";

const LEGACY_STORAGE_KEY = "blur-service-state-v2";
const app = document.querySelector("#app");
const photoInput = document.querySelector("#photo-input");
const avatarInput = document.querySelector("#avatar-input");

// 허브 날짜는 서버(UTC) 기준 — 한국시간 오전 9시에 새 허브가 열림
const HUB_DATE = api.hubDateToday();
const topicDate = `${HUB_DATE.slice(5, 7)}. ${HUB_DATE.slice(8, 10)}`;
let topic = api.topicForDate(HUB_DATE);

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
    recs: [],
    sentRequests: {},
    posts: [],
    revealed: {},
    signup: { name: "", id: "", pw: "", avail: null },
    login: { id: "", password: "", error: "" },
    search: "",
    upload: blankUpload(),
    edit: null,
    overlays: {
      commentsFor: "",
      privateUser: "",
      publicUser: "",
      friendUser: "",
      actionsFor: "",
      settings: false,
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
    caption: row.caption || "",
    ratio: row.ratio || "4 / 5",
    split: Number(row.split || 1),
    filter: row.filter || "none",
    grad: gradients[((gradIndex % gradients.length) + gradients.length) % gradients.length],
    image: isGrad ? "" : row.image_url,
    public: Boolean(row.share_all),
    label: dayLabel(row.hub_date),
    comments: (row.comments || [])
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((c) => ({ by: c.author_id === state.me ? "me" : handleOf(c.author_id), text: c.body }))
  };
}

function applySocial(s, rows) {
  const friends = [];
  const reqs = [];
  const sent = {};
  rows.forEach((row) => {
    const otherUid = row.user_a === s.me ? row.user_b : row.user_a;
    const handle = s.people.find((p) => p.uid === otherUid)?.id;
    if (!handle) return;
    if (row.status === "accepted") friends.push(handle);
    else if (row.status === "pending" && row.requested_by === s.me) sent[handle] = true;
    else if (row.status === "pending") reqs.push(handle);
  });
  s.friends = friends;
  s.reqs = reqs;
  s.sentRequests = sent;
  s.recs = s.people
    .filter((p) => p.uid !== s.me && !friends.includes(p.id) && !reqs.includes(p.id))
    .map((p) => p.id);
}

async function loadAll(uid) {
  const [profiles, posts, friendRows, revealIds, topicText] = await Promise.all([
    api.fetchProfiles(),
    api.fetchPosts(),
    api.fetchFriendships(),
    api.fetchMyReveals(uid),
    api.ensureTodayHub()
  ]);
  if (topicText) topic = topicText;
  state.me = uid;
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
  state.revealed = Object.fromEntries(revealIds.map((id) => [id, true]));
  state.posts.filter((p) => p.authorId === "me").forEach((p) => { state.revealed[p.id] = true; });
  const myToday = state.posts.find((p) => p.authorId === "me" && p.hubDate === HUB_DATE);
  state.myPosted = Boolean(myToday);
  state.visitors = myToday ? await api.countPostReveals(myToday.id, uid) : 0;
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

// 아이디 중복 검사 — 서버 RPC를 디바운스 호출, 결과는 signup.avail / edit.avail에 저장
function scheduleHandleCheck(kind) {
  clearTimeout(handleCheckTimer);
  const target = () => (kind === "signup" ? state.signup : state.edit);
  const value = normalizeId(target()?.id || "");
  const setAvail = (v) => update(() => { const t = target(); if (t) t.avail = v; });
  if (!value) return setAvail(null);
  if (!validId(value)) return setAvail(false);
  if (kind === "edit" && value === state.profile.id) return setAvail(true);
  setAvail("checking");
  handleCheckTimer = setTimeout(async () => {
    const ok = await api.isHandleAvailable(value);
    update(() => {
      const t = target();
      if (t && normalizeId(t.id) === value) t.avail = ok;
    });
  }, 350);
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
    settings: `<svg ${common}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
  };
  return icons[name] || "";
}

function ratioWidth(ratio) {
  if (ratio === "16 / 9") return "320px";
  if (ratio === "1 / 1") return "280px";
  return "286px";
}

function toneFilter(name) {
  return {
    warm: "saturate(1.08) sepia(.12)",
    vivid: "saturate(1.32) contrast(1.06)",
    calm: "saturate(.82) brightness(1.06)",
    mono: "grayscale(.62)",
    none: "none"
  }[name] || "none";
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
        ${Array.from({ length: tiles }, (_, i) => `<div style="background:${variantGradient(post, i)};filter:${toneFilter(post.filter)}"></div>`).join("")}
      </div>`;
  const overlay = revealed
    ? ""
    : `<div class="media-overlay">
        ${options.avatar ? `<div class="avatar-chip">${escapeHtml(options.avatar)}</div>` : ""}
        <div class="unlock-chip">${options.short ? "탭해서 풀기" : "탭해서 blur 풀기"}</div>
      </div>`;
  return `<div class="media-frame ${size} ${hiddenClass}" ${action} style="aspect-ratio:${ratio}">
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
  return state.posts.filter((post) => post.hubDate === HUB_DATE && (post.authorId === "me" || state.friends.includes(post.authorId)));
}

function postsForAll() {
  return state.posts.filter((post) => post.hubDate === HUB_DATE && post.public);
}

function postsByAuthor(authorId) {
  return state.posts.filter((post) => post.authorId === authorId);
}

function render() {
  const active = document.activeElement;
  const activeField = active && app.contains(active) ? active.dataset.field : "";
  const selStart = activeField && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const selEnd = activeField && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  const content = state.auth === "loading"
    ? loadingView()
    : state.auth === "welcome"
      ? welcomeView()
      : state.auth === "signup"
        ? signupView()
        : state.auth === "login"
          ? loginView()
          : appView();
  app.innerHTML = `<div class="phone">${content}${busyView()}${toastView()}</div>`;
  if (activeField) {
    const el = app.querySelector(`[data-field="${activeField}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart !== null && typeof el.setSelectionRange === "function") {
        try { el.setSelectionRange(Math.min(selStart, el.value.length), Math.min(selEnd, el.value.length)); } catch {}
      }
    }
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

function signupView() {
  const nameOk = state.signup.name.trim().length > 0 && state.signup.name.trim().length <= 12;
  const id = normalizeId(state.signup.id);
  const idOk = validId(id);
  const avail = state.signup.avail;
  const pwOk = state.signup.pw.length >= 6;
  const enabled = nameOk && idOk && avail === true && pwOk;
  let idHint = "영문 소문자, 숫자, _ 조합 3-16자";
  let hintClass = "";
  if (id) {
    if (!idOk) {
      idHint = "아이디는 3-16자의 영문/숫자/_만 가능해요";
      hintClass = "bad";
    } else if (avail === "checking") {
      idHint = "아이디 확인 중…";
    } else if (avail === false) {
      idHint = "이미 사용 중인 아이디예요";
      hintClass = "bad";
    } else if (avail === true) {
      idHint = "사용할 수 있는 아이디예요 · 나만 쓰는 고유한 이름이 돼요";
      hintClass = "good";
    }
  }
  return `<section class="screen">
    <div class="auth-card">
      <h1>blur 시작하기</h1>
      <div class="subtitle">친구들이 알아볼 이름과 고유 아이디를 정해주세요.</div>
      <div class="auth-stack">
        <label>
          <input class="input" data-field="signup.name" maxlength="12" value="${escapeHtml(state.signup.name)}" placeholder="이름">
          <div class="hint">${state.signup.name.length}/12</div>
        </label>
        <label>
          <input class="input" data-field="signup.id" maxlength="16" value="${escapeHtml(id)}" placeholder="@아이디">
          <div class="hint ${hintClass}">${idHint}</div>
        </label>
        <label>
          <input class="input" type="password" data-field="signup.pw" value="${escapeHtml(state.signup.pw)}" placeholder="비밀번호 (6자 이상)">
          ${state.signup.pw && !pwOk ? `<div class="hint bad">비밀번호는 6자 이상이어야 해요</div>` : ""}
        </label>
        <button class="btn ${enabled ? "" : "disabled"}" ${enabled ? "" : "disabled"} data-action="signup-submit">시작하기</button>
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
  if (state.tab === "friends") return friendsView();
  if (state.tab === "my") return myView();
  return homeView();
}

function homeView() {
  const posts = postsForHome();
  return `<section class="screen">
    <div class="topbar">
      <div style="flex:1" class="brand logo">blur</div>
      <div class="hub-date">${escapeHtml(topicDate)}</div>
      <div style="flex:1;display:flex;justify-content:flex-end">
        ${state.myPosted
          ? `<div class="posted-badge" title="오늘 게시 완료"><span class="check">✓</span></div>`
          : `<button class="icon-btn" aria-label="사진 올리기" data-action="open-upload">${icon("camera", 19)}</button>`}
      </div>
    </div>
    <div class="topic">${escapeHtml(topic)}</div>
    ${posts.length ? `<div class="home-carousel" data-carousel>
      ${posts.map((post) => {
        const person = personById(post.authorId);
        return `<article class="home-slide">
          <div class="post-card" style="width:${ratioWidth(post.ratio)};margin:0 auto">
            ${mediaFrame(post, "large", { avatar: initialFor(person) })}
            <div class="post-meta">
              <div class="post-name">${escapeHtml(person?.name || "알 수 없음")} <span class="post-time">${escapeHtml(post.time)}</span></div>
              <button class="msg-btn" aria-label="댓글" data-action="open-comments" data-post="${post.id}">${icon("message", 16)}</button>
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
      ${mediaFrame(post, "small", { short: true })}
      <div class="post-meta" style="margin-top:6px">
        <button class="post-name sm" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;text-align:left;cursor:pointer" data-action="open-person" data-user="${post.authorId}">${escapeHtml(person?.name || "알 수 없음")}</button>
        <button class="msg-btn sm" aria-label="댓글" data-action="open-comments" data-post="${post.id}">${icon("message", 13)}</button>
      </div>
    </article>`;
  };
  return `<section class="screen">
    <div class="topbar centered">
      <h1 class="title">전체</h1>
    </div>
    <div class="topic-sub">"${escapeHtml(topic)}"</div>
    <div class="screen-scroll">
      <div class="masonry">
        <div class="masonry-col">${colA.map(card).join("")}</div>
        <div class="masonry-col">${colB.map(card).join("")}</div>
      </div>
    </div>
  </section>`;
}

function friendsView() {
  const query = state.search.trim().toLowerCase();
  const matches = (u) => !query || u.name.toLowerCase().includes(query) || u.id.includes(query);
  const friendUsers = state.friends
    .map((id) => personById(id))
    .filter((u) => u && matches(u));
  const recUsers = state.recs
    .map((id) => personById(id))
    .filter((u) => u && matches(u));
  const recsShown = query ? recUsers : recUsers.slice(0, 5);
  return `<section class="screen">
    <div class="topbar centered" style="display:block;padding:20px 26px 12px">
      <h1 class="title">친구 <span style="font-size:14px;color:var(--point)">${state.friends.length}</span></h1>
      <input class="input pill" style="margin-top:12px" data-field="search" value="${escapeHtml(state.search)}" placeholder="이름 또는 아이디 검색">
    </div>
    <div class="screen-scroll">
      ${state.reqs.length ? `<section class="section">
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
      </section>
    </div>
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
      ${avatar(user)}
      <div class="person-main">
        <div class="person-name">${escapeHtml(user.name)}</div>
        <div class="person-id">@${escapeHtml(user.id)}${user.mutual ? ` · ${escapeHtml(user.mutual)}` : ""}</div>
      </div>
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
  const archive = state.posts.filter((post) => post.authorId === "me");
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

function gridTile(post) {
  const isToday = post.hubDate === HUB_DATE;
  const displayPost = { ...post, ratio: "1 / 1" };
  const revealForce = !isToday || post.authorId !== "me" || state.revealed[post.id];
  return `<div data-long-post="${post.id}" data-action="my-topic" data-post="${post.id}" style="position:relative">
    ${mediaFrame(displayPost, "square", { forceReveal: revealForce, noReveal: true, square: true, short: true })}
    <div class="photo-label">${escapeHtml(isToday ? "오늘" : post.label || post.time)}</div>
  </div>`;
}

function tabbar() {
  const tabs = [
    ["home", "오늘", "sun"],
    ["all", "전체", "grid"],
    ["friends", "친구", "users"],
    ["my", "룸", "user"]
  ];
  return `<nav class="tabbar" aria-label="주 메뉴">
    ${tabs.map(([tab, label, iconName]) => `<button class="tab ${state.tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}" aria-label="${label}">
      ${icon(iconName, 20)}<span style="font-size:9px;font-weight:700">${label}</span>
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
    state.leave.open ? leaveView() : "",
    state.overlays.viewerPost ? viewerView() : "",
    state.overlays.commentsFor ? commentsSheet() : "",
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
      <button class="camera-tile" data-action="pick-photo"><span style="font-size:22px">＋</span><span style="font-size:10.5px">카메라</span></button>
      ${gallery.map((item) => `<button class="gallery-tile ${selected === item.id ? "selected" : ""}" style="background:${item.grad}" data-action="pick-gallery" data-gallery="${item.id}">
        <span class="photo-label">${item.label}</span><span class="tile-check">✓</span>
      </button>`).join("")}
    </div>
    <div class="fixed-cta"><button class="btn ${selected || state.upload.selectedImage ? "" : "disabled"}" style="width:100%" ${selected || state.upload.selectedImage ? "" : "disabled"} data-action="upload-next">다음</button></div>
  </div>`;
}

function uploadPreview(extraClass = "") {
  const up = state.upload;
  const post = {
    id: "upload-preview",
    authorId: "me",
    ratio: up.ratio,
    split: up.split,
    grad: up.selectedGrad || gradients[0],
    image: up.selectedImage,
    filter: up.filter,
    label: up.selectedLabel || "선택"
  };
  return `<div style="width:${ratioWidth(up.ratio)};max-width:100%;margin:0 auto;transform:scale(${up.zoom});transform-origin:center" class="${extraClass}">
    ${mediaFrame(post, "large", { forceReveal: true, noReveal: true })}
  </div>`;
}

function uploadEdit() {
  const up = state.upload;
  const chips = (name, values) => values.map(([value, label]) => `<button class="chip ${up[name] == value ? "active" : ""}" data-action="set-upload" data-key="${name}" data-value="${value}">${label}</button>`).join("");
  return `<div class="screen-scroll" style="padding:16px 24px 34px;display:grid;gap:14px">
    ${uploadPreview()}
    <div>
      <div class="section-title">자르기</div>
      <div class="chip-row">${chips("ratio", [["1 / 1", "1:1"], ["4 / 5", "4:5"], ["16 / 9", "16:9"]])}</div>
    </div>
    <div>
      <div class="section-title">확대 · 축소</div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="hint">－</span>
        <input style="flex:1;accent-color:var(--accent)" type="range" min="1" max="1.5" step="0.05" data-field="upload.zoom" value="${up.zoom}">
        <span class="hint">＋</span>
      </div>
    </div>
    <div>
      <div class="section-title">필터</div>
      <div class="chip-row">${chips("filter", [["none", "원본"], ["warm", "따뜻"], ["vivid", "선명"], ["calm", "차분"], ["mono", "모노"]])}</div>
    </div>
    <div>
      <div class="section-title">화면 분할</div>
      <div class="chip-row">${chips("split", [[1, "없음"], [2, "2분할"], [4, "4분할"]])}</div>
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
      ${isPublic && !state.friends.includes(userId) ? `<button class="mini-btn ${sent ? "ghost" : ""}" data-action="send-request" data-user="${userId}">${sent ? "요청 보냄" : "친구 요청"}</button>` : ""}
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
  const available = edit.avail !== false;
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
        <div class="hint ${available ? "good" : "bad"}">${available ? "사용할 수 있는 아이디예요" : "이미 사용 중이거나 형식이 맞지 않아요"}</div>
      </label>
      <label>
        <div class="section-title">소개</div>
        <textarea class="textarea" rows="3" maxlength="80" data-field="edit.bio" placeholder="하고 싶은 말, 직업, 나를 어필하는 한마디를 적어보세요">${escapeHtml(bio)}</textarea>
        <div class="hint" style="text-align:right">${bio.length}/80</div>
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
          return `<div class="comment-item ${mine ? "mine" : ""}">
            ${avatar(person)}
            <div class="comment-body">
              <div class="comment-head">
                <span class="comment-author">${escapeHtml(person?.name || "알 수 없음")}</span>
                <span class="comment-handle">@${escapeHtml(person?.id || "")}</span>
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

function viewerView() {
  const post = state.posts.find((p) => p.id === state.overlays.viewerPost) || { id: "viewer", authorId: "me", ratio: "4 / 5", split: 1, grad: gradients[0], label: "sample" };
  return `<section class="viewer">
    <button class="ghost-icon" style="align-self:flex-start;background:rgba(255,255,255,.12);color:#fff" data-action="close-viewer">✕</button>
    ${mediaFrame(post, "large", { forceReveal: true, noReveal: true })}
    <div>
      <div style="font-size:12px;color:rgba(255,255,255,.64)">${escapeHtml(topicDate)} 허브</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">${escapeHtml(topic)}</div>
    </div>
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

function afterRender() {
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
  if (action === "my-topic" && longPressFired) {
    longPressFired = false;
    return;
  }
  handleAction(action, target);
});

app.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  setField(field, event.target.type === "checkbox" ? event.target.checked : event.target.value);
});

app.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  if (["text", "search", "password", "email", "tel", "url"].includes(event.target.type)) return;
  setField(field, event.target.type === "checkbox" ? event.target.checked : event.target.value);
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

function setField(field, value) {
  update((s) => {
    if (field === "signup.name") s.signup.name = String(value).slice(0, 12);
    if (field === "signup.id") s.signup.id = normalizeId(value);
    if (field === "signup.pw") s.signup.pw = String(value);
    if (field === "login.id") s.login.id = String(value);
    if (field === "login.password") s.login.password = String(value);
    if (field === "search") s.search = String(value);
    if (field === "upload.zoom") s.upload.zoom = Number(value);
    if (field === "upload.caption") s.upload.caption = String(value).slice(0, 60);
    if (field === "edit.name") s.edit.name = String(value).slice(0, 12);
    if (field === "edit.id") s.edit.id = normalizeId(value);
    if (field === "edit.bio") s.edit.bio = String(value).slice(0, 80);
    if (field === "leave.agree") s.leave.agree = Boolean(value);
  });
  if (field === "signup.id") scheduleHandleCheck("signup");
  if (field === "edit.id") scheduleHandleCheck("edit");
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
      return update((s) => { s.upload = { ...blankUpload(), open: true }; });
    case "upload-back":
      return uploadBack();
    case "pick-photo":
      return photoInput.click();
    case "pick-gallery":
      return pickGallery(el.dataset.gallery);
    case "upload-next":
      return uploadNext();
    case "set-upload":
      return setUpload(el.dataset.key, el.dataset.value);
    case "toggle-upload":
      return update((s) => { s.upload[el.dataset.key] = !s.upload[el.dataset.key]; });
    case "publish":
      return publishPost();
    case "reveal":
      api.addReveal(state.me, postId).catch(() => {});
      return update((s) => { s.revealed[postId] = true; });
    case "open-comments":
      return update((s) => { s.overlays.commentsFor = postId; });
    case "close-comments":
      return update((s) => { s.overlays.commentsFor = ""; });
    case "send-comment":
      return sendComment();
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
    case "my-topic":
      return toast(`${topicDate} 허브 · ${topic}`);
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

async function publishPost() {
  const up = state.upload;
  if (!up.selectedId && !up.selectedImage) return toast("사진을 먼저 선택해 주세요");
  update((s) => { s.busy = "오늘의 허브에 올리는 중…"; });
  try {
    let imageUrl;
    if (up.selectedImage) {
      imageUrl = await api.uploadPhoto(state.me, up.selectedImage);
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
    await api.addComment(state.me, postId, text);
    update((s) => {
      const post = s.posts.find((p) => p.id === postId);
      if (post) post.comments.push({ by: "me", text });
    });
  } catch (error) {
    toast(error.message || "댓글을 남기지 못했어요");
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

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    update((s) => {
      s.upload.open = true;
      s.upload.step = "edit";
      s.upload.selectedId = "";
      s.upload.selectedImage = dataUrl;
      s.upload.selectedGrad = gradients[0];
      s.upload.selectedLabel = "앨범";
    });
  } catch {
    toast("사진을 불러오지 못했어요");
  } finally {
    photoInput.value = "";
  }
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
