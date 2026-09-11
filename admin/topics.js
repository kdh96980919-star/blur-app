
// 이용자가 앱에서 보낸 주제 추천. auth.js 가 이 상수들을 보고 같은 로그인 흐름을 돌린다.
const SOURCE = {rpc:'dashboard_topic_suggestions', key:'suggestions'};
const $ = s => document.querySelector(s);
let DATA = {generated_at:null, suggestions:[]};
let sortK = 'created_at', sortDir = 'desc';

const kstToday = () => new Date(Date.now() + 9*3600e3).toISOString().slice(0,10);
const dayStr = d => d.toISOString().slice(0,10);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// auth.js 가 로그아웃·조회 실패 때 부른다. 화면에 남은 추천 내용을 지운다.
function clearView(){
  $('#rows').replaceChildren();
  $('#stats').replaceChildren();
  $('#q').value = '';
}

function render(){
  const rows = DATA.suggestions;
  $('#meta').textContent = DATA.generated_at
    ? `추천 ${rows.length}개 · 데이터 기준 ${new Date(DATA.generated_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})}`
    : '로그인하면 최신 데이터를 불러옵니다.';
  ['#summary','#listSec'].forEach(s => $(s).hidden = !DATA.generated_at);
  if (!DATA.generated_at) return;
  renderStats(); renderRows();
}

function renderStats(){
  const rows = DATA.suggestions, today = kstToday();
  const week = dayStr(new Date(Date.parse(today) - 6*864e5));
  const day = x => (x.created_at || '').slice(0,10);
  const people = new Set(rows.map(x => x.author_id)).size;
  const cells = [
    ['받은 주제', rows.length, rows.length ? `최근 ${day(latest())}` : '아직 없음'],
    ['오늘', rows.filter(x => day(x) === today).length, today],
    ['최근 7일', rows.filter(x => day(x) >= week).length, `${week} ~`],
    ['보낸 사람', people, people ? `1인 평균 ${(rows.length/people).toFixed(1)}개` : '—'],
  ];
  $('#stats').innerHTML = cells.map(([k,v,n]) =>
    `<div class="stat"><span class="k">${esc(k)}</span><span class="v">${v}</span><span class="n">${esc(n)}</span></div>`).join('');
}

// 서버가 최신순으로 주지만 정렬을 바꿔 둔 상태에서도 요약은 실제 최신을 가리켜야 한다.
function latest(){
  return DATA.suggestions.reduce((a,b) => (a.created_at||'') > (b.created_at||'') ? a : b, DATA.suggestions[0]);
}

function filtered(){
  const q = $('#q').value.trim().toLowerCase();
  return DATA.suggestions.filter(x =>
    !q || [x.body, x.name, x.handle].some(v => (v||'').toLowerCase().includes(q))
  ).sort((a,b) => {
    const c = sortK === 'nth'
      ? (+a.nth||0) - (+b.nth||0)
      : String(a[sortK]||'').localeCompare(String(b[sortK]||''), 'ko');
    return sortDir === 'asc' ? c : -c;
  });
}

function renderRows(){
  const rows = filtered();
  $('#count').textContent = `${rows.length}개 표시 / 전체 ${DATA.suggestions.length}개`;
  $('#noRows').hidden = rows.length > 0;
  $('#rows').innerHTML = rows.map(x => `<tr>
      <td class="mono">${esc(x.created_at || '—')}</td>
      <td class="name">${esc(x.name || '이름없음')}</td>
      <td class="handle">${x.handle ? '@'+esc(x.handle) : '—'}</td>
      <td class="nth">${+x.nth ? Number(x.nth)+'번째' : '—'}</td>
      <td class="body">${esc(x.body || '')}</td>
    </tr>`).join('');
}

$('#q').oninput = renderRows;
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
  const k = th.dataset.k;
  sortDir = (sortK === k && sortDir === 'desc') ? 'asc' : 'desc';
  sortK = k;
  document.querySelectorAll('th[data-k]').forEach(t => t.removeAttribute('data-dir'));
  th.dataset.dir = sortDir;
  renderRows();
});
