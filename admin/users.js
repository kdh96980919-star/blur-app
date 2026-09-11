
const PROV = {kakao:'카카오', google:'Google', apple:'Apple', email:'이메일', unknown:'?'};
const SOURCE = {rpc:'dashboard_users', key:'users'};
const $ = s => document.querySelector(s);
let DATA = {generated_at:null, users:[]};
let sortK = 'signed_up', sortDir = 'desc', days = 30;

const kstToday = () => new Date(Date.now() + 9*3600e3).toISOString().slice(0,10);
const dayStr = d => d.toISOString().slice(0,10);

// auth.js 가 로그아웃·조회 실패 때 부른다. 화면에 남은 이용자 데이터를 지운다.
function clearView(){
  $('#rows').replaceChildren(); $('#stats').replaceChildren(); $('#chart').replaceChildren();
  $('#q').value = ''; $('#prov').innerHTML = '<option value="">로그인 계정 전체</option>';
}

function render(){
  const u = DATA.users;
  $('#meta').textContent = DATA.generated_at
    ? `이용자 ${u.length}명 · 데이터 기준 ${new Date(DATA.generated_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})}`
    : '로그인하면 최신 데이터를 불러옵니다.';
  ['#summary','#trend','#listSec'].forEach(s => $(s).hidden = !DATA.generated_at);
  if (!DATA.generated_at) return;
  renderStats(); renderChart(); fillProviders(); renderRows();
}

function renderStats(){
  const u = DATA.users, today = kstToday();
  const y = dayStr(new Date(Date.parse(today) - 864e5));
  const w = dayStr(new Date(Date.parse(today) - 6*864e5));
  const on = d => u.filter(x => (x.signed_up||'').slice(0,10) === d).length;
  const cells = [
    ['총 이용자', u.length, `프로필 완료 ${u.filter(x=>!raw(x)).length}명`],
    ['오늘 신규', on(today), today],
    ['어제 신규', on(y), y],
    ['최근 7일', u.filter(x => (x.signed_up||'').slice(0,10) >= w).length, `${w} ~`],
    ['사진 올린 사람', u.filter(x => +x.posts > 0).length, `총 ${u.reduce((s,x)=>s+ +x.posts,0)}장`],
    ['친구 0명', u.filter(x => +x.friends === 0).length, '연결 없는 계정'],
    ['최근 3일 게시', u.filter(x => (x.last_post||'') >= dayStr(new Date(Date.parse(kstToday()) - 2*864e5))).length, '살아 있는 계정'],
  ];
  $('#stats').innerHTML = cells.map(([k,v,n]) =>
    `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span><span class="n">${n}</span></div>`).join('');
}

function series(){
  const u = DATA.users.filter(x => x.signed_up);
  if (!u.length) return [];
  const dates = u.map(x => x.signed_up.slice(0,10)).sort();
  const end = Date.parse(kstToday());
  const start = days ? Math.max(Date.parse(dates[0]), end - (days-1)*864e5) : Date.parse(dates[0]);
  const before = u.filter(x => Date.parse(x.signed_up.slice(0,10)) < start).length;
  const out = []; let cum = before;
  for (let t = start; t <= end; t += 864e5){
    const d = dayStr(new Date(t));
    const n = dates.filter(x => x === d).length;
    cum += n;
    out.push({d, n, cum});
  }
  return out;
}

function renderChart(){
  const s = series(), svg = $('#chart');
  if (!s.length){ svg.innerHTML = ''; return; }
  const W = 1000, H = 240, L = 40, R = 44, T = 14, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const maxN = Math.max(1, ...s.map(x => x.n));
  const maxC = Math.max(1, ...s.map(x => x.cum));
  const bw = Math.max(2, Math.min(26, iw / s.length - 3));
  const x = i => L + iw * (s.length === 1 ? 0.5 : i / (s.length - 1)) - (s.length === 1 ? 0 : 0);
  const cx = i => L + (iw / s.length) * (i + 0.5);
  const yN = v => T + ih - (v / maxN) * ih;
  const yC = v => T + ih - (v / maxC) * ih;
  let g = '';
  // 가로 기준선
  for (let i = 0; i <= 2; i++){
    const yy = T + (ih * i) / 2;
    g += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#E6E4DD"/>`;
    g += `<text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="10" fill="#71717A">${Math.round(maxN*(1-i/2))}</text>`;
    g += `<text x="${W-R+8}" y="${yy+4}" font-size="10" fill="#B4713F">${Math.round(maxC*(1-i/2))}</text>`;
  }
  // 일별 막대
  s.forEach((p,i) => {
    const h = (p.n / maxN) * ih;
    if (p.n) g += `<rect x="${cx(i)-bw/2}" y="${T+ih-h}" width="${bw}" height="${h}" rx="2" fill="#97A4E2"><title>${p.d} 신규 ${p.n}명</title></rect>`;
  });
  // 누적 선
  g += `<polyline fill="none" stroke="#B4713F" stroke-width="1.6" points="${s.map((p,i)=>`${cx(i)},${yC(p.cum)}`).join(' ')}"/>`;
  const last = s[s.length-1];
  g += `<circle cx="${cx(s.length-1)}" cy="${yC(last.cum)}" r="3.5" fill="#B4713F"/>`;
  g += `<text x="${cx(s.length-1)}" y="${yC(last.cum)-10}" text-anchor="end" font-size="11" font-weight="600" fill="#B4713F">${last.cum}명</text>`;
  // 날짜 라벨
  const step = Math.ceil(s.length / 10);
  s.forEach((p,i) => {
    if (i % step === 0 || i === s.length-1)
      g += `<text x="${cx(i)}" y="${H-14}" text-anchor="middle" font-size="10" fill="#71717A">${p.d.slice(5)}</text>`;
  });
  svg.innerHTML = g;
}

function fillProviders(){
  const sel = $('#prov'), cur = sel.value;
  const set = [...new Set(DATA.users.map(x => x.provider || 'unknown'))].sort();
  sel.innerHTML = '<option value="">로그인 계정 전체</option>' +
    set.map(p => `<option value="${esc(p)}">${esc(PROV[p]||p)}</option>`).join('');
  sel.value = cur;
}

function filtered(){
  const q = $('#q').value.trim().toLowerCase(), p = $('#prov').value, st = $('#state').value;
  return DATA.users.filter(x => {
    if (p && (x.provider||'unknown') !== p) return false;
    if (st === 'profile' && raw(x)) return false;
    if (st === 'noprofile' && !raw(x)) return false;
    if (st === 'nofriend' && +x.friends !== 0) return false;
    if (st === 'poster' && !(+x.posts > 0)) return false;
    if (st === 'silent' && +x.posts > 0) return false;
    if (!q) return true;
    return [x.name, x.handle, x.email, x.bio].some(v => (v||'').toLowerCase().includes(q));
  }).sort((a,b) => {
    const av = a[sortK], bv = b[sortK];
    const num = ['posts','comments','friends'].includes(sortK);
    const c = num ? (+av||0) - (+bv||0) : String(av||'').localeCompare(String(bv||''), 'ko');
    return sortDir === 'asc' ? c : -c;
  });
}

function renderRows(){
  const rows = filtered();
  $('#count').textContent = `${rows.length}명 표시 / 전체 ${DATA.users.length}명`;
  $('#noRows').hidden = rows.length > 0;
  $('#rows').innerHTML = rows.map(x => {
    const provs = (x.providers || x.provider || '').split(',').filter(Boolean)
      .map(p => `<span class="pill">${esc(PROV[p]||p)}</span>`).join(' ');
    return `<tr>
      <td class="name">${esc(x.name || '이름없음')}${raw(x) ? ' <span class="pill warn">미완료</span>' : ''}</td>
      <td class="handle">${x.handle ? '@'+esc(x.handle) : '—'}</td>
      <td>${provs || '—'}</td>
      <td class="mono">${esc(x.email || '—')}</td>
      <td class="mono">${esc(x.signed_up || '—')}</td>
      <td class="mono">${esc(x.last_post || '—')}</td>
      <td class="mono">${esc(x.last_sign_in || '—')}</td>
      <td class="num">${+x.posts ? '<b>'+Number(x.posts)+'</b>' : 0}</td>
      <td class="num">${+x.comments ? '<b>'+Number(x.comments)+'</b>' : 0}</td>
      <td class="num">${+x.friends ? '<b>'+Number(x.friends)+'</b>' : 0}</td>
      <td class="bio">${esc(x.bio || '')}</td>
    </tr>`;
  }).join('');
}
// 프로필 설정을 끝내지 않은 계정: profiles 행이 없거나 아이디가 자동 생성값
const raw = x => !x.has_profile || /^user_[0-9a-f]{10}$/.test(x.handle || '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// 이벤트
$('#q').oninput = $('#prov').onchange = $('#state').onchange = renderRows;
$('#range').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  days = +b.dataset.days;
  [...$('#range').children].forEach(c => c.setAttribute('aria-pressed', c === b));
  renderChart();
};
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
  const k = th.dataset.k;
  sortDir = (sortK === k && sortDir === 'desc') ? 'asc' : 'desc';
  sortK = k;
  document.querySelectorAll('th[data-k]').forEach(t => t.removeAttribute('data-dir'));
  th.dataset.dir = sortDir;
  renderRows();
});
