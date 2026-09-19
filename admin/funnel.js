
// 가입 퍼널. auth.js 가 이 상수들을 보고 users.html·topics.html 과 같은 로그인 흐름을 돌린다.
// 계산은 전부 여기서 한다 — RPC 는 iOS 계정 한 줄씩만 주고 묶는 일은 하지 않는다.
// 단계 정의는 blur-service/supabase/funnel.sql 과 글자 그대로 같게 유지한다.
const SOURCE = {rpc:'dashboard_funnel', key:'funnel'};
// 김 본인·심사 데모·테스트 계정. blur 는 친구 41명이라 넣고 빼는 것만으로 코호트가 흔들린다.
const OPS = ['blur', 'demo', 'test'];
const $ = s => document.querySelector(s);
let DATA = {generated_at:null, excluded:0, funnel:[]};
let withOps = false, stageF = '', sortK = 'signed_up', sortDir = 'desc';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const t = s => s ? Date.parse(s) : null;
const days = ms => ms / 864e5;
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
// 프로필 설정을 끝내지 않은 계정: profiles 행이 없거나 아이디가 자동 생성값 (users.js 와 같은 규칙)
const rawProfile = r => !r.has_profile || /^user_[0-9a-f]{10}$/.test(r.handle || '');

function people(){
  return DATA.funnel.filter(r => withOps || !OPS.includes(r.handle));
}

// funnel.sql 3번 쿼리의 case 문과 같은 순서·같은 조건.
function stageOf(r, now){
  if (!r.has_profile)                       return '① 프로필 안 만듦';
  if (!r.friends && r.pending)              return '② 친구 요청만 걸어둠';
  if (!r.friends)                           return '② 친구 0명';
  if (!r.posts)                             return '③ 사진 0장';
  if (r.posts === 1)                        return '④ 사진 1장에서 멈춤';
  if (!r.last_active || days(now - t(r.last_active)) > 14) return '⑥ 2주 넘게 조용';
  return '⑤ 쓰는 중';
}
const STAGES = ['① 프로필 안 만듦','② 친구 요청만 걸어둠','② 친구 0명','③ 사진 0장',
                '④ 사진 1장에서 멈춤','⑤ 쓰는 중','⑥ 2주 넘게 조용'];

// 1~5단계는 누적 조건이다. 6단계만 누적이 아니라 '지금 살아 있는 사람' 수다.
function steps(rows, now){
  const ok = r => r.has_profile, f = r => ok(r) && r.friends > 0;
  return [
    {name:'가입',                 n: rows.length},
    {name:'프로필 만듦',           n: rows.filter(ok).length},
    {name:'친구 1명 이상',         n: rows.filter(f).length},
    {name:'사진 1장',             n: rows.filter(r => f(r) && r.posts > 0).length},
    {name:'사진 2장 이상 (재방문)', n: rows.filter(r => f(r) && r.posts > 1).length},
    {name:'최근 7일 활동',         n: rows.filter(r => r.last_active && days(now - t(r.last_active)) <= 7).length,
     loose:true}
  ];
}

const BANDS = [[0,0,'0명'], [1,1,'1명'], [2,3,'2~3명'], [4,Infinity,'4명 이상']];
function cohorts(rows){
  return BANDS.map(([lo,hi,label]) => {
    const g = rows.filter(r => r.friends >= lo && r.friends <= hi);
    const kept = g.filter(r => r.posts > 1).length;
    return {label, n:g.length, kept, rate:pct(kept, g.length),
            avg: g.length ? g.reduce((s,r) => s + r.posts, 0) / g.length : 0};
  });
}

// percentile_cont(0.5) 과 같게 선형 보간한다.
function median(xs){
  if (!xs.length) return null;
  const a = [...xs].sort((x,y) => x - y), i = (a.length - 1) / 2;
  return a.length % 2 ? a[i] : a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) / 2;
}

function firstPost(rows){
  const hrs = rows.filter(r => r.first_post)
    .map(r => (t(r.first_post) - t(r.signed_up)) / 36e5);
  const within = (lo, hi) => hrs.filter(h => h >= lo && h < hi).length;
  return {
    none: rows.filter(r => !r.first_post).length,
    h1: within(-Infinity, 1), d1: within(1, 24), w1: within(24, 168), over: within(168, Infinity),
    med: median(hrs)
  };
}

function clearView(){
  ['#outside','#stageRows','#cohortRows','#firstPost','#rows'].forEach(s => $(s).replaceChildren());
  $('#funnel').replaceChildren();
  $('#q').value = ''; $('#stage').innerHTML = '<option value="">단계 전체</option>';
}

function render(){
  const rows = people(), now = Date.now();
  $('#meta').textContent = DATA.generated_at
    ? `iOS ${rows.length}명${DATA.excluded ? ` · 웹 베타 ${DATA.excluded}명 제외` : ''}`
      + ` · 데이터 기준 ${new Date(DATA.generated_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})}`
    : '로그인하면 최신 데이터를 불러옵니다.';
  ['#funnelSec','#stageSec','#cohortSec','#firstSec','#listSec'].forEach(s => $(s).hidden = !DATA.generated_at);
  if (!DATA.generated_at) return;
  renderFunnel(rows, now); renderStages(rows, now); renderCohorts(rows);
  renderFirstPost(rows); fillStages(rows, now); renderRows(rows, now);
}

// 깔때기 도형. 누적 5단계만 그린다 — '최근 7일 활동'은 누적이 아니라서 아래 숫자로 뺀다.
// 칸 너비 = 인원 비율, 칸 사이 사다리꼴에 빠져나간 인원을 적는다.
const FILL = ['#C3C9EE', '#AEB6E7', '#97A4E2', '#7686D8', '#B4713F'];
function renderFunnel(rows, now){
  const s = steps(rows, now).filter(x => !x.loose), top = s[0].n || 1;
  const W = 752, barH = 54, gapH = 32, padT = 16;
  const cx = 300, halfMax = 258, labelX = 596;
  const H = padT * 2 + s.length * barH + (s.length - 1) * gapH;
  const half = n => Math.max(5, halfMax * (n / top));
  const yTop = i => padT + i * (barH + gapH);
  let g = '';
  s.forEach((x, i) => {
    const h = half(x.n), y = yTop(i);
    g += `<rect x="${cx - h}" y="${y}" width="${h * 2}" height="${barH}" fill="${FILL[i]}"/>`;
    if (i < s.length - 1) {
      const h2 = half(s[i + 1].n), y2 = y + barH;
      g += `<path d="M${cx - h} ${y2} L${cx + h} ${y2} L${cx + h2} ${y2 + gapH} L${cx - h2} ${y2 + gapH} Z" fill="#E7EAF8"/>`;
      const lost = x.n - s[i + 1].n;
      if (lost > 0) g += `<text x="${cx}" y="${y2 + gapH / 2 + 4}" text-anchor="middle" font-size="11.5"
        font-weight="600" fill="#8A6A4E">−${lost}명 · 통과 ${pct(s[i + 1].n, x.n)}%</text>`;
    }
    // 오른쪽 지시선 + 라벨
    const my = y + barH / 2;
    g += `<circle cx="${cx + h + 10}" cy="${my}" r="3" fill="${FILL[i]}"/>`
      +  `<line x1="${cx + h + 14}" y1="${my}" x2="${labelX - 12}" y2="${my}" stroke="#D8D5CC"/>`
      +  `<text x="${labelX}" y="${my - 3}" font-size="12.5" fill="#71717A">${esc(x.name)}</text>`
      +  `<text x="${labelX}" y="${my + 17}" font-size="17" font-weight="600" fill="#101014">${x.n}명`
      +  `<tspan font-size="12.5" font-weight="500" fill="#5E6FCE" dx="7">${pct(x.n, top)}%</tspan></text>`;
  });
  const svg = $('#funnel');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;

  // 깔때기 밖 숫자 — 누적 단계가 아닌 것들.
  const live = steps(rows, now).find(x => x.loose).n;
  const dead = rows.filter(r => !r.last_active).length;
  $('#outside').innerHTML = [
    ['최근 7일 활동', live, `iOS ${rows.length}명 중 ${pct(live, rows.length)}% · 누적 단계 아님`],
    ['흔적 없는 계정', dead, '사진·댓글·블러 해제 0'],
    ['웹 베타 제외', DATA.excluded, 'iOS 신호 없는 계정'],
  ].map(([k, v, n]) =>
    `<div class="stat"><span class="k">${esc(k)}</span><span class="v">${v}</span><span class="n">${esc(n)}</span></div>`).join('');
}

function renderStages(rows, now){
  $('#stageRows').innerHTML = STAGES.map(name => {
    const g = rows.filter(r => stageOf(r, now) === name);
    if (!g.length) return '';
    const act7 = g.filter(r => r.last_active && days(now - t(r.last_active)) <= 7).length;
    const dead = g.filter(r => !r.last_active).length;
    const age = g.reduce((s,r) => s + days(now - t(r.signed_up)), 0) / g.length;
    return `<tr>
      <td class="name">${esc(name)}</td>
      <td class="num"><b>${g.length}</b></td>
      <td class="num">${g.filter(r => r.apns).length}</td>
      <td class="num">${g.filter(r => !r.apns).length}</td>
      <td class="num">${act7}</td>
      <td class="num">${dead || ''}</td>
      <td class="num">${age.toFixed(1)}</td>
    </tr>`;
  }).join('');
}

function renderCohorts(rows){
  $('#cohortRows').innerHTML = cohorts(rows).map(c => `<tr>
    <td class="name">친구 ${esc(c.label)}</td>
    <td class="num">${c.n}</td>
    <td class="num">${c.kept}</td>
    <td><span class="sbar sm"><i style="width:${c.rate}%"></i></span><span class="rate">${c.rate}%</span></td>
    <td class="num">${c.avg.toFixed(1)}</td>
  </tr>`).join('');
}

function renderFirstPost(rows){
  const f = firstPost(rows);
  const cells = [
    ['아직 안 올림', f.none, '사진 0장'],
    ['1시간 내', f.h1, '가입한 자리에서'],
    ['하루 내', f.d1, '1~24시간'],
    ['일주일 내', f.w1, '1~7일'],
    ['일주일 넘김', f.over, '7일 초과'],
    ['중앙값', f.med === null ? '—' : (f.med < 1 ? Math.round(f.med * 60) + '분' : f.med.toFixed(1) + '시간'), '올린 사람만'],
  ];
  $('#firstPost').innerHTML = cells.map(([k,v,n]) =>
    `<div class="stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="n">${esc(n)}</span></div>`).join('');
}

function fillStages(rows, now){
  const sel = $('#stage'), cur = sel.value;
  const seen = STAGES.filter(s => rows.some(r => stageOf(r, now) === s));
  sel.innerHTML = '<option value="">단계 전체</option>' +
    seen.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value = cur;
}

function renderRows(rows, now){
  const q = $('#q').value.trim().toLowerCase();
  const list = rows.filter(r => {
    if (stageF && stageOf(r, now) !== stageF) return false;
    return !q || (r.handle || '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const num = ['friends','pending','posts'].includes(sortK);
    const c = num ? (a[sortK] || 0) - (b[sortK] || 0)
      : sortK === 'stage' ? stageOf(a, now).localeCompare(stageOf(b, now), 'ko')
      : String(a[sortK] || '').localeCompare(String(b[sortK] || ''), 'ko');
    return sortDir === 'asc' ? c : -c;
  });
  $('#count').textContent = `${list.length}명 표시 / iOS ${rows.length}명`;
  $('#noRows').hidden = list.length > 0;
  $('#rows').innerHTML = list.map(r => {
    const hrs = r.first_post ? (t(r.first_post) - t(r.signed_up)) / 36e5 : null;
    const la = r.last_active
      ? new Date(r.last_active).toLocaleString('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'})
      : '—';
    return `<tr>
      <td class="handle">${r.handle ? '@' + esc(r.handle) : '—'}${rawProfile(r) ? ' <span class="pill warn">미완료</span>' : ''}</td>
      <td class="mono">${new Date(r.signed_up).toLocaleDateString('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit'})}</td>
      <td class="num">${Math.floor(days(now - t(r.signed_up)))}</td>
      <td class="name">${esc(stageOf(r, now))}</td>
      <td class="num">${r.friends || 0}</td>
      <td class="num">${r.pending || 0}</td>
      <td class="num">${r.posts ? '<b>' + r.posts + '</b>' : 0}</td>
      <td>${r.apns ? '<span class="pill">켬</span>' : ''}</td>
      <td class="num">${hrs === null ? '—' : hrs < 1 ? Math.round(hrs * 60) + '분' : hrs.toFixed(1) + 'h'}</td>
      <td class="mono">${esc(la)}</td>
    </tr>`;
  }).join('');
}

$('#q').oninput = () => render();
$('#stage').onchange = e => { stageF = e.target.value; render(); };
$('#ops').onclick = e => {
  withOps = !withOps;
  e.target.setAttribute('aria-pressed', withOps);
  e.target.textContent = withOps ? `운영 계정 포함 중 (${OPS.join(', ')})` : '운영 계정 제외 중';
  render();
};
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
  const k = th.dataset.k;
  sortDir = (sortK === k && sortDir === 'desc') ? 'asc' : 'desc';
  sortK = k;
  document.querySelectorAll('th[data-k]').forEach(x => x.removeAttribute('data-dir'));
  th.dataset.dir = sortDir;
  render();
});
