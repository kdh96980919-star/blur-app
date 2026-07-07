const STORAGE_KEY = "blur-service-state-v2";
const app = document.querySelector("#app");
const photoInput = document.querySelector("#photo-input");
const avatarInput = document.querySelector("#avatar-input");

const today = new Date();
const topicDate = today.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }).replace(/\.$/, "");
const topic = "오늘 내가 지나친 작은 장면";

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
const emojiOptions = ["☁️", "🫶", "🌙", "🍑", "✨"];

const users = [
  { id: "yuna", name: "유나", color: "#b06a92", public: true, mutual: "친구 6명" },
  { id: "sora", name: "소라", color: "#6aa392", public: false, mutual: "친구 3명" },
  { id: "taeho", name: "태호", color: "#7b89b8", public: true, mutual: "친구 2명" },
  { id: "arin", name: "아린", color: "#d48b72", public: false, mutual: "같은 학교" },
  { id: "minji", name: "민지", color: "#8f7cc2", public: true, mutual: "친구 4명" },
  { id: "jiwoo", name: "지우", color: "#c17f9f", public: false, mutual: "친구 1명" },
  { id: "hayul", name: "하율", color: "#6d8aaa", public: true, mutual: "동아리" }
];

const gallery = gradients.map((grad, index) => ({
  id: `g${index + 1}`,
  grad,
  label: String(index + 1).padStart(2, "0")
}));

function seedPosts() {
  return [
    {
      id: "p-yuna-1",
      authorId: "yuna",
      time: "08:12",
      caption: "등교길에 잠깐 멈춘 장면",
      ratio: "4 / 5",
      split: 1,
      grad: gradients[0],
      public: true,
      comments: [{ by: "sora", text: "색감 좋다" }]
    },
    {
      id: "p-sora-1",
      authorId: "sora",
      time: "09:40",
      caption: "조용한 책상",
      ratio: "1 / 1",
      split: 2,
      grad: gradients[2],
      public: false,
      comments: []
    },
    {
      id: "p-taeho-1",
      authorId: "taeho",
      time: "11:03",
      caption: "오늘의 하늘",
      ratio: "16 / 9",
      split: 1,
      grad: gradients[5],
      public: true,
      comments: [{ by: "me", text: "와 이건 열어봐야지" }]
    },
    {
      id: "p-minji-1",
      authorId: "minji",
      time: "12:28",
      caption: "점심 먹고 산책",
      ratio: "4 / 5",
      split: 4,
      grad: gradients[3],
      public: true,
      comments: []
    },
    {
      id: "p-jiwoo-1",
      authorId: "jiwoo",
      time: "13:05",
      caption: "",
      ratio: "1 / 1",
      split: 1,
      grad: gradients[4],
      public: false,
      comments: []
    },
    {
      id: "p-hayul-1",
      authorId: "hayul",
      time: "14:21",
      caption: "창밖 빛",
      ratio: "4 / 5",
      split: 2,
      grad: gradients[7],
      public: true,
      comments: [{ by: "yuna", text: "이거 완전 오늘 분위기" }]
    }
  ];
}

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
    auth: "app",
    tab: "home",
    profile: {
      name: "도현",
      id: "dohyun",
      color: palette[0],
      emoji: "흐",
      photo: ""
    },
    myPublic: true,
    notif: true,
    myPosted: false,
    friends: ["yuna", "sora", "taeho"],
    reqs: ["arin"],
    recs: ["minji", "jiwoo", "hayul"],
    sentRequests: {},
    posts: seedPosts(),
    revealed: {},
    extraComments: {},
    signup: { name: "", id: "" },
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
    socialBusy: ""
  };
}

let state = loadState();
let longPressTimer = null;
let longPressFired = false;
let toastTimer = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return defaultState();
    return { ...defaultState(), ...saved, upload: { ...blankUpload(), ...(saved.upload || {}), open: false } };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function update(mutator, persist = true) {
  mutator(state);
  if (persist) saveState();
  render();
}

function toast(message) {
  clearTimeout(toastTimer);
  update((s) => {
    s.toast = message;
  });
  toastTimer = setTimeout(() => {
    state.toast = "";
    saveState();
    render();
  }, 2600);
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
  return users.find((u) => u.id === id);
}

function initialFor(person) {
  if (!person) return "?";
  if (person.emoji) return person.emoji;
  return person.name.slice(0, 1);
}

function allTakenIds(includeCurrentProfile = false) {
  const ids = users.map((u) => u.id);
  if (includeCurrentProfile) ids.push(state.profile.id);
  return new Set(ids.map((id) => id.toLowerCase()));
}

function normalizeId(value) {
  return value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "").slice(0, 16);
}

function validId(value) {
  return /^[a-z0-9_]{3,16}$/.test(value);
}

function isIdAvailable(value, allowCurrent = false) {
  const id = normalizeId(value);
  if (!validId(id)) return false;
  if (allowCurrent && id === state.profile.id) return true;
  return !allTakenIds(!allowCurrent && state.auth !== "signup").has(id);
}

function icon(name) {
  const common = 'width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    sun: `<svg ${common}><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path></svg>`,
    grid: `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>`,
    users: `<svg ${common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    user: `<svg ${common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    camera: `<svg ${common.replace('width="23" height="23"', 'width="19" height="19"')}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`,
    image: `<svg ${common.replace('width="23" height="23"', 'width="15" height="15"')}><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>`,
    settings: `<svg ${common.replace('width="23" height="23"', 'width="17" height="17"')}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
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
  const label = post.authorId === "me" ? "내 사진" : "사진";
  const inner = post.image
    ? `<img class="media-img" src="${post.image}" alt="">`
    : `<div class="media-content" style="grid-template-columns:${columns}">
        ${Array.from({ length: tiles }, (_, i) => `<div style="background:${variantGradient(post, i)};filter:${toneFilter(post.filter)}"></div>`).join("")}
      </div>`;
  const overlay = revealed
    ? `<div class="photo-label">[ ${label} · ${escapeHtml(post.label || "today")} ]</div>`
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
  return [...(post.comments || []), ...(state.extraComments[post.id] || [])];
}

function postsForHome() {
  return state.posts.filter((post) => post.authorId === "me" || state.friends.includes(post.authorId));
}

function postsForAll() {
  return state.posts.filter((post) => post.public);
}

function postsByAuthor(authorId) {
  const base = state.posts.filter((post) => post.authorId === authorId);
  if (base.length) return base;
  const userIndex = users.findIndex((u) => u.id === authorId);
  return [0, 1, 2, 3, 4].map((n) => ({
    id: `archive-${authorId}-${n}`,
    authorId,
    time: "지난 허브",
    caption: "",
    ratio: "1 / 1",
    split: n % 3 === 0 ? 4 : 1,
    grad: gradients[(userIndex + n + gradients.length) % gradients.length],
    public: true,
    label: n === 0 ? "오늘" : `${n + 1}일 전`,
    comments: []
  }));
}

function render() {
  const content = state.auth === "welcome"
    ? welcomeView()
    : state.auth === "signup"
      ? signupView()
      : state.auth === "login"
        ? loginView()
        : appView();
  app.innerHTML = `<div class="phone">${content}${busyView()}${toastView()}</div>`;
  afterRender();
}

function welcomeView() {
  return `<section class="screen welcome">
    <div class="welcome-stack" aria-hidden="true">
      <div class="welcome-card" style="background:${gradients[1]}"></div>
      <div class="welcome-card" style="background:${gradients[4]}"></div>
      <div class="welcome-card" style="background:${gradients[0]}"></div>
    </div>
    <h1>blur</h1>
    <p>오늘의 주제 아래에서, 흐릿하게 도착한 친구의 장면을 탭해 선명하게 만나보세요.</p>
    <div class="auth-stack">
      <button class="btn" data-action="go-signup">시작하기</button>
      <button class="btn secondary" data-action="go-login">이미 계정이 있어요</button>
    </div>
    <div class="hint">가입하면 서비스 이용약관과 개인정보 처리방침에 동의한 것으로 간주돼요.</div>
  </section>`;
}

function signupView() {
  const nameOk = state.signup.name.trim().length > 0 && state.signup.name.trim().length <= 12;
  const id = normalizeId(state.signup.id);
  const idOk = validId(id);
  const available = isIdAvailable(id);
  const enabled = nameOk && available;
  let idHint = "영문 소문자, 숫자, _ 조합 3-16자";
  let hintClass = "";
  if (id) {
    if (!idOk) {
      idHint = "아이디는 3-16자의 영문/숫자/_만 가능해요";
      hintClass = "bad";
    } else if (!available) {
      idHint = "이미 사용 중인 아이디예요";
      hintClass = "bad";
    } else {
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
      <div class="hub-date">TODAY'S HUB · ${escapeHtml(topicDate)}</div>
      <div style="flex:1;display:flex;justify-content:flex-end">
        ${state.myPosted
          ? `<div class="icon-btn" style="background:rgba(224,121,180,.16);color:var(--deep);box-shadow:none">✓</div>`
          : `<button class="icon-btn" aria-label="사진 올리기" data-action="open-upload">${icon("camera")}</button>`}
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
              <div class="post-name">${escapeHtml(person?.name || "알 수 없음")} <span class="post-time">· ${escapeHtml(post.time)}</span></div>
              <button class="text-link" style="background:transparent" data-action="open-comments" data-post="${post.id}">댓글 ${postComments(post).length}</button>
            </div>
            ${post.caption ? `<div class="caption">${escapeHtml(post.caption)}</div>` : ""}
          </div>
        </article>`;
      }).join("")}
    </div>
    <div class="dots">${posts.map((_, index) => `<span class="dot ${index === 0 ? "active" : ""}"></span>`).join("")}</div>` : `<div class="empty">아직 응답한 친구가 없어요</div>`}
  </section>`;
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
        <button class="post-name" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;text-align:left;cursor:pointer" data-action="open-person" data-user="${post.authorId}">${escapeHtml(person?.name || "알 수 없음")}</button>
        <button class="text-link" style="background:transparent;font-size:10.5px" data-action="open-comments" data-post="${post.id}">댓글 ${postComments(post).length}</button>
      </div>
    </article>`;
  };
  return `<section class="screen">
    <div class="topbar centered">
      <div>
        <h1 class="title">모두</h1>
        <div class="subtitle">"${escapeHtml(topic)}"</div>
      </div>
    </div>
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
  const friendUsers = state.friends
    .map((id) => personById(id))
    .filter((u) => !query || u.name.includes(query) || u.id.includes(query));
  return `<section class="screen">
    <div class="topbar centered" style="display:block;padding-left:26px;padding-right:26px">
      <h1 class="title">친구 <span style="font-size:14px;color:var(--point)">${state.friends.length}</span></h1>
      <input class="input pill" style="margin-top:12px" data-field="search" value="${escapeHtml(state.search)}" placeholder="이름 또는 아이디 검색">
    </div>
    <div class="screen-scroll">
      ${state.reqs.length ? `<section class="section">
        <h2 class="section-title">받은 친구 요청</h2>
        <div class="row-list">${state.reqs.map((id) => personRow(personById(id), "request")).join("")}</div>
      </section>` : ""}
      <section class="section">
        <h2 class="section-title">추천 친구</h2>
        <div class="row-list">${state.recs.map((id) => personRow(personById(id), "recommend")).join("") || `<div class="empty">추천할 친구를 찾는 중이에요</div>`}</div>
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
        <div class="person-id">@${escapeHtml(user.id)} · ${escapeHtml(user.mutual || "")}</div>
      </div>
      <button class="mini-btn" data-action="accept-request" data-user="${user.id}">수락</button>
      <button class="mini-btn ghost" data-action="decline-request" data-user="${user.id}">거절</button>
    </div>`;
  }
  if (mode === "recommend") {
    const sent = state.sentRequests[user.id];
    return `<div class="person-row">
      ${avatar(user)}
      <div class="person-main">
        <div class="person-name">${escapeHtml(user.name)}</div>
        <div class="person-id">@${escapeHtml(user.id)} · ${escapeHtml(user.mutual || "")}</div>
      </div>
      <button class="mini-btn ${sent ? "ghost" : ""}" data-action="send-request" data-user="${user.id}">${sent ? "요청 보냄" : "추가"}</button>
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
  const myPosts = state.posts.filter((post) => post.authorId === "me");
  const archive = myPosts.length ? myPosts : [0, 1, 2, 3, 4, 5].map((n) => ({
    id: `my-sample-${n}`,
    authorId: "me",
    time: n === 0 ? "오늘" : `${n + 1}일 전`,
    caption: "",
    ratio: "1 / 1",
    split: n % 2 ? 4 : 1,
    grad: gradients[(n + 1) % gradients.length],
    public: false,
    label: n === 0 ? "오늘" : `${n + 1}일 전`,
    comments: []
  }));
  return `<section class="screen">
    <div class="topbar centered"><h1 class="title">마이</h1></div>
    <div class="profile-head">
      ${avatar(my, "profile-avatar")}
      <div style="flex:1;min-width:0">
        <div class="profile-name">${escapeHtml(state.profile.name)}</div>
        <div class="profile-sub">@${escapeHtml(state.profile.id)} · 친구 ${state.friends.length}명</div>
      </div>
      <button class="btn secondary" style="min-height:36px;padding:0 13px;font-size:11.5px;white-space:nowrap" data-action="open-edit">프로필 수정</button>
      <button class="ghost-icon" aria-label="설정" data-action="open-settings">${icon("settings")}</button>
    </div>
    <div class="glass-card stats-card">
      <div style="display:flex;align-items:baseline;gap:8px">
        <div class="stat-num">${37 + myPosts.length * 9}</div>
        <div style="font-size:13px;font-weight:800;color:#5c4a54">명이 오늘 내 응답을 열어봤어요</div>
      </div>
      <div class="hint">방문자 수는 나만 볼 수 있어요</div>
    </div>
    <div class="grid-title">
      <div class="section-title" style="margin:0">내 허브 응답</div>
      <div class="hint-line">탭: 주제 보기 · 길게 누르기: 크게 보기</div>
    </div>
    <div class="screen-scroll">
      <div class="photo-grid">${archive.map((post, index) => gridTile(post, index)).join("")}</div>
      ${!state.myPosted ? `<div class="hint" style="text-align:center;margin-top:-82px">오늘의 허브에 아직 응답하지 않았어요</div>` : ""}
    </div>
  </section>`;
}

function gridTile(post, index) {
  const isToday = index === 0;
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
    ["all", "모두", "grid"],
    ["friends", "친구", "users"],
    ["my", "마이", "user"]
  ];
  return `<nav class="tabbar" aria-label="주 메뉴">
    ${tabs.map(([tab, label, iconName]) => `<button class="tab ${state.tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}" aria-label="${label}">
      <i></i>${icon(iconName)}
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
      <div style="font-weight:800;font-size:14px">${titles[up.step]}</div>
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
    <div class="fixed-cta"><button class="btn" style="width:100%" ${selected || state.upload.selectedImage ? "" : "disabled"} data-action="upload-next">다음</button></div>
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
        <input style="flex:1;accent-color:var(--brand)" type="range" min="1" max="1.5" step="0.05" data-field="upload.zoom" value="${up.zoom}">
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
      <div style="font-weight:800;font-size:14px">${isPublic ? "프로필" : "친구 프로필"}</div>
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
      <div class="photo-grid">${posts.map((post, index) => {
        const forceReveal = isPublic && index > 0;
        return `<div>${mediaFrame({ ...post, ratio: "1 / 1" }, "square", { forceReveal, square: true, short: true })}<div class="photo-label">${escapeHtml(index === 0 ? "오늘" : post.label || "지난 허브")}</div></div>`;
      }).join("")}</div>
      <div class="hint" style="text-align:center;margin-top:14px">${isPublic ? "공개 계정의 지난 허브는 누구나 볼 수 있어요" : "오늘의 응답은 탭해서 blur를 풀 수 있어요"}</div>
    </div>
  </section>`;
}

function editView() {
  const edit = state.edit;
  const id = normalizeId(edit.id);
  const available = isIdAvailable(id, true);
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-edit">←</button>
      <div style="font-weight:800;font-size:14px">프로필 수정</div>
      <div style="width:36px"></div>
    </div>
    <div class="screen-scroll" style="padding:24px 26px 40px;display:grid;gap:18px">
      <div style="display:grid;justify-items:center;gap:12px">
        ${edit.photo ? `<div class="profile-avatar" style="width:88px;height:88px;background:${edit.color}"><img src="${edit.photo}" alt=""></div>` : `<div class="profile-avatar" style="width:88px;height:88px;background:${edit.color};font-size:30px">${escapeHtml(edit.emoji || edit.name.slice(0, 1))}</div>`}
        <div class="hint">프로필 사진 · 색, 이모지, 앨범 사진으로 꾸며보세요</div>
        <div style="display:flex;gap:9px">${palette.map((color) => `<button class="round-btn" style="width:32px;height:32px;background:${color};box-shadow:${edit.color === color ? "0 0 0 3px rgba(74,53,64,.2)" : "none"}" data-action="set-edit-color" data-color="${color}" aria-label="색 선택"></button>`).join("")}</div>
        <div style="display:flex;gap:8px">${emojiOptions.map((emoji) => `<button class="round-btn" style="width:36px;height:36px;border-radius:12px;background:${edit.emoji === emoji ? "rgba(224,121,180,.18)" : "rgba(255,255,255,.72)"};border:1px solid rgba(74,53,64,.1)" data-action="set-edit-emoji" data-emoji="${emoji}">${emoji}</button>`).join("")}</div>
        <input class="input" style="text-align:center" data-field="edit.emojiFree" value="${escapeHtml(edit.emojiFree || "")}" placeholder="키보드로 아무 이모지나 입력해 보세요 🫶">
        <button class="btn secondary" style="width:100%;border-style:dashed" data-action="pick-avatar">${icon("image")}<span style="margin-left:8px">앨범에서 사진 선택</span></button>
        ${edit.photo ? `<button class="text-link" style="background:transparent;color:var(--danger)" data-action="clear-avatar">사진 지우기</button>` : ""}
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
      <button class="btn" data-action="save-edit">저장하기</button>
    </div>
  </section>`;
}

function settingsView() {
  return `<section class="overlay">
    <div class="topbar">
      <button class="ghost-icon" data-action="close-settings">←</button>
      <div style="font-weight:800;font-size:14px">설정</div>
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
          <button class="setting-row" style="text-align:left;cursor:pointer;color:var(--danger)" data-action="open-leave"><div><div class="person-name" style="color:var(--danger)">회원 탈퇴</div><div class="person-id">모든 로컬 데이터 삭제</div></div><span>›</span></button>
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
      <div style="min-height:80px">
        ${comments.length ? comments.map((c) => `<div class="comment-row ${c.by === "me" ? "mine" : ""}"><div class="comment-bubble">${escapeHtml(c.text)}</div></div>`).join("") : `<div class="empty" style="min-height:80px">아직 댓글이 없어요</div>`}
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
      <div style="font-weight:800;font-size:14px">회원 탈퇴</div>
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
  if (!state.socialBusy) return "";
  return `<div class="busy">
    <div class="busy-card">
      <div class="spinner"></div>
      <div>${escapeHtml(state.socialBusy)} 계정으로 연결하는 중…</div>
    </div>
  </div>`;
}

function toastView() {
  return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : "";
}

function afterRender() {
  const carousel = document.querySelector("[data-carousel]");
  if (carousel) {
    carousel.addEventListener("scroll", () => {
      const slides = [...carousel.querySelectorAll(".home-slide")];
      const index = Math.max(0, slides.findIndex((slide) => slide.getBoundingClientRect().left > 20));
      document.querySelectorAll(".dot").forEach((dot, i) => dot.classList.toggle("active", i === Math.max(0, index)));
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
    if (field === "login.id") s.login.id = String(value);
    if (field === "login.password") s.login.password = String(value);
    if (field === "search") s.search = String(value);
    if (field === "upload.zoom") s.upload.zoom = Number(value);
    if (field === "upload.caption") s.upload.caption = String(value).slice(0, 60);
    if (field === "edit.name") s.edit.name = String(value).slice(0, 12);
    if (field === "edit.id") s.edit.id = normalizeId(value);
    if (field === "edit.emojiFree") {
      s.edit.emojiFree = String(value);
      const last = lastGrapheme(value);
      if (last) s.edit.emoji = last;
    }
    if (field === "leave.agree") s.leave.agree = Boolean(value);
  });
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
      return update((s) => { s.sentRequests[id] = true; }, true), toast("친구 요청을 보냈어요");
    case "accept-request":
      return update((s) => { s.reqs = s.reqs.filter((x) => x !== id); if (!s.friends.includes(id)) s.friends.push(id); }), toast("친구가 되었어요");
    case "decline-request":
      return update((s) => { s.reqs = s.reqs.filter((x) => x !== id); }), toast("요청을 거절했어요");
    case "friend-actions":
      return update((s) => { s.overlays.actionsFor = id; });
    case "close-actions":
      return update((s) => { s.overlays.actionsFor = ""; });
    case "remove-friend":
      return update((s) => { s.friends = s.friends.filter((x) => x !== id); s.overlays.actionsFor = ""; }), toast("친구를 삭제했어요");
    case "block-friend":
      return update((s) => { s.friends = s.friends.filter((x) => x !== id); s.overlays.actionsFor = ""; }), toast("차단했어요");
    case "open-edit":
      return update((s) => { s.edit = { ...s.profile, emojiFree: "" }; });
    case "close-edit":
      return update((s) => { s.edit = null; });
    case "set-edit-color":
      return update((s) => { s.edit.color = el.dataset.color; s.edit.photo = ""; });
    case "set-edit-emoji":
      return update((s) => { s.edit.emoji = el.dataset.emoji; s.edit.emojiFree = ""; s.edit.photo = ""; });
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
      return update((s) => { s.auth = "welcome"; s.overlays.logout = false; s.overlays.settings = false; }), toast("로그아웃했어요");
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
      return localStorage.removeItem(STORAGE_KEY), state = defaultState(), state.leave = { open: true, reason: "", agree: false, confirm: false, done: true }, render();
    case "finish-leave":
      return state = defaultState(), saveState(), render();
    case "my-topic":
      return toast(`${topicDate} 허브 · ${topic}`);
    case "close-viewer":
      return update((s) => { s.overlays.viewerPost = ""; });
    default:
      return undefined;
  }
}

function signup() {
  const name = state.signup.name.trim().slice(0, 12);
  const id = normalizeId(state.signup.id);
  if (!name || !isIdAvailable(id)) return toast("이름과 아이디를 확인해 주세요");
  update((s) => {
    s.profile.name = name;
    s.profile.id = id;
    s.auth = "app";
  });
  toast("blur에 오신 걸 환영해요");
}

function login() {
  const id = normalizeId(state.login.id);
  if (!id || !state.login.password) {
    return update((s) => { s.login.error = "아이디와 비밀번호를 모두 입력해 주세요"; });
  }
  update((s) => {
    s.login.error = "";
    s.profile.id = id || s.profile.id;
    s.auth = "app";
  });
  toast("다시 만났네요");
}

function socialLogin(provider) {
  update((s) => { s.socialBusy = provider; });
  setTimeout(() => {
    update((s) => {
      s.socialBusy = "";
      s.auth = "app";
    });
    toast(`${provider} 계정으로 연결했어요`);
  }, 1100);
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

function publishPost() {
  const up = state.upload;
  if (!up.selectedId && !up.selectedImage) return toast("사진을 먼저 선택해 주세요");
  const post = {
    id: `me-${Date.now()}`,
    authorId: "me",
    time: "방금",
    caption: up.caption.trim().slice(0, 60),
    ratio: up.ratio,
    split: up.split,
    grad: up.selectedGrad || gradients[0],
    image: up.selectedImage,
    filter: up.filter,
    public: Boolean(up.shareAll),
    label: up.selectedLabel || "업로드",
    comments: []
  };
  update((s) => {
    s.posts = [post, ...s.posts];
    s.myPosted = true;
    s.upload = blankUpload();
    s.revealed[post.id] = true;
    s.tab = "home";
  });
  toast("오늘의 허브에 올렸어요");
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

function sendComment() {
  const input = document.querySelector("#comment-input");
  const text = input?.value.trim().slice(0, 100);
  const postId = state.overlays.commentsFor;
  if (!text || !postId) return;
  update((s) => {
    if (!s.extraComments[postId]) s.extraComments[postId] = [];
    s.extraComments[postId].push({ by: "me", text });
  });
}

function saveEdit() {
  const edit = state.edit;
  const id = normalizeId(edit.id);
  if (!edit.name.trim()) return toast("이름을 입력해 주세요");
  if (!isIdAvailable(id, true)) return toast("아이디를 확인해 주세요");
  update((s) => {
    s.profile = {
      name: edit.name.trim().slice(0, 12),
      id,
      color: edit.color,
      emoji: edit.emoji || edit.name.trim().slice(0, 1),
      photo: edit.photo || ""
    };
    s.edit = null;
  });
  toast("프로필을 저장했어요");
}

function toggleSetting(key) {
  update((s) => {
    s[key] = !s[key];
  });
  if (key === "myPublic") {
    toast(state.myPublic ? "공개 계정으로 전환했어요" : "비공개 계정으로 전환했어요");
  }
}

function lastGrapheme(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if ("Segmenter" in Intl) {
    const parts = [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(trimmed)];
    return parts.at(-1)?.segment || "";
  }
  return [...trimmed].at(-1) || "";
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
