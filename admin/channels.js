// blur 유입 채널 대시보드 — App Store Connect 앱 분석 export 를 읽는다.
// 개인 데이터가 없다(캠페인 × 날짜 집계). 서버·DB·로그인 없이 브라우저 안에서만 돈다.
// 캠페인 이름 규칙은 blur-service/docs/campaign-links.md 2번과 같은 것을 쓴다.
//
// channels.html 전용 — 2026-09-19 부터 users.html 에서 떼어냈다(김 지시: 둘을 따로 본다).
// 자체 esc·el 을 들고 있어 users.js 에 기대는 것이 없다. IIFE 는 그대로 둔다 — 전역을 안 만든다.
(function(){
const PLATFORM = [
  ['인스타그램', ['insta','instagram','ig'],   '#97A4E2'],
  ['X',          ['x','twitter','tw'],          '#101014'],
  ['쓰레드',     ['threads','thread'],          '#B4713F'],
];
const AD_TOKENS  = ['ad','ads','paid','promo','sponsored','광고'];
const OWN_TOKENS = ['own','organic','post','posts','story','stories','bio','reels','feed','profile','직접'];
const ETC = '기타', ETC_COLOR = '#A7A39B';

const tokensOf = s => String(s).toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);

// 캠페인 이름 → 플랫폼 · 제작주체. 토막 단위로만 맞춰 'x' 가 다른 낱말에 걸리지 않게 한다.
function classify(campaign){
  const t = tokensOf(campaign);
  const hit = PLATFORM.find(([, toks]) => toks.some(x => t.includes(x)));
  if (!hit) return {platform: ETC, medium: '—', color: ETC_COLOR};
  const medium = AD_TOKENS.some(x => t.includes(x))  ? '광고'
               : OWN_TOKENS.some(x => t.includes(x)) ? '직접제작'
               : '미분류';
  return {platform: hit[0], medium, color: hit[2]};
}
const channelOf = c => { const k = classify(c); return k.platform === ETC ? ETC : `${k.platform} · ${k.medium}`; };

/* ---------- 투입 파일 읽기 ---------- */

const DATE_H    = ['date','날짜','일자','기간'];
const CAMP_H    = ['campaign','캠페인','source info','유입 경로'];
const VALUE_H   = ['counts','count','value','units','수량','합계'];
const ELAPSED_H = ['day','week','일차','주차','elapsed','since install','경과'];
const TYPE_H    = ['download type','event','type','page type','metric','지표','유형'];
// 치수(dimension) 열은 숫자처럼 보여도 지표가 아니다 — App Apple Identifier, Platform Version 같은 것.
const DIM_H     = ['identifier','app id','version','territory','device','app name','platform','country','지역','기기'];

const norm = h => String(h).trim().toLowerCase();
const matches = (h, keys) => keys.some(k => norm(h) === k || norm(h).includes(k));
const p2 = n => String(n).padStart(2, '0');

function splitCsv(line){
  const out = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++){
    const c = line[i];
    if (quoted){
      if (c === '"'){ if (line[i+1] === '"'){ cur += '"'; i++; } else quoted = false; }
      else cur += c;
    }
    else if (c === '"') quoted = true;
    else if (c === ','){ out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
const cellsOf = (line, d) => d === ',' ? splitCsv(line) : line.split(d).map(s => s.trim());
const numOf = v => { const s = String(v).replace(/[,\s%₩$원]/g, ''); return s !== '' && isFinite(+s) ? +s : null; };

function isoDate(v){
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // 미국식 MM/DD/YYYY
  if (m) return `${m[3]}-${p2(m[1])}-${p2(m[2])}`;
  return null;
}

// ASC 는 내보내는 화면마다 표 모양이 다르다. 헤더 이름으로만 열 역할을 잡고,
// 모르는 열은 조용히 버리는 대신 warnings 로 남긴다.
function parseReport(text){
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  const warnings = [];
  if (!lines.length) return {kind: null, rows: [], warnings: ['붙여넣은 내용이 비어 있다.']};

  const head = lines.findIndex(l => {
    const d = (l.split('\t').length >= l.split(',').length) ? '\t' : ',';
    const c = cellsOf(l, d);
    return c.length >= 2 && c.some(x => matches(x, DATE_H));
  });
  if (head < 0) return {kind: null, rows: [], warnings: ['날짜 열을 찾지 못했다. ASC 에서 내려받은 파일을 그대로 붙여넣었는지 확인할 것.']};

  const delim  = (lines[head].split('\t').length >= lines[head].split(',').length) ? '\t' : ',';
  const header = cellsOf(lines[head], delim);
  const iDate  = header.findIndex(h => matches(h, DATE_H));
  const iCamp  = header.findIndex(h => matches(h, CAMP_H));
  const iElap  = header.findIndex((h, i) => i !== iDate && matches(h, ELAPSED_H));
  if (iCamp < 0) warnings.push('캠페인 열이 없다. 전부 한 덩어리로 집계된다 — ASC 에서 캠페인별로 나눠 내려받을 것.');

  const body = lines.slice(head + 1).map(l => cellsOf(l, delim)).filter(c => isoDate(c[iDate]));
  if (!body.length) return {kind: null, rows: [], warnings: ['날짜가 든 줄이 하나도 없다.']};

  // 경과 일/주 열이 있으면 유지율 파일이다.
  if (iElap >= 0){
    const iVal = header.findIndex((h, i) => i !== iDate && i !== iElap && i !== iCamp && body.some(c => numOf(c[i]) !== null));
    if (iVal < 0) return {kind: null, rows: [], warnings: ['유지율 값 열을 찾지 못했다.']};
    const rows = body.map(c => ({
      cohort:   isoDate(c[iDate]),
      elapsed:  numOf(c[iElap]),
      value:    numOf(c[iVal]),
      campaign: iCamp >= 0 ? (c[iCamp] || '(없음)') : '(없음)',
    })).filter(r => r.elapsed !== null && r.value !== null);
    return {kind: 'cohort', rows, unit: norm(header[iElap]).includes('week') || header[iElap].includes('주') ? '주' : '일', warnings};
  }

  // 나머지는 지표 파일. Counts 같은 단일 값 열이 있으면 긴 형태, 없으면 넓은 형태다.
  const usable = i => i !== iDate && i !== iCamp && body.some(c => numOf(c[i]) !== null);
  const iCount = header.findIndex((h, i) => usable(i) && matches(h, VALUE_H));
  const valueCols = iCount >= 0
    ? [{h: header[iCount], i: iCount}]
    : header.map((h, i) => ({h, i})).filter(({h, i}) => usable(i) && !matches(h, DIM_H));
  if (!valueCols.length) return {kind: null, rows: [], warnings: ['숫자 지표 열을 찾지 못했다.']};

  // 긴 형태면 지표 이름이 따로 있는 열(Download Type 등)에 들어 있다.
  const iType = iCount >= 0 ? header.findIndex((h, i) => i !== iCount && matches(h, TYPE_H)) : -1;
  if (iCount >= 0 && iType < 0) warnings.push(`지표 이름 열이 없어 '${header[iCount].trim()}' 하나로 묶었다.`);

  const rows = [];
  for (const c of body){
    const date = isoDate(c[iDate]);
    const campaign = iCamp >= 0 ? (c[iCamp] || '(없음)') : '(없음)';
    for (const {h, i} of valueCols){
      const value = numOf(c[i]);
      if (value === null) continue;
      rows.push({date, campaign, metric: iType >= 0 ? (c[iType] || h.trim()) : h.trim(), value});
    }
  }
  return {kind: 'metrics', rows, warnings};
}

// "insta-ad 150000" / "insta-ad,150000" 줄들 → 캠페인별 광고비
function parseSpend(text){
  const out = new Map();
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')){
    const m = line.trim().match(/^(.+?)[\s,:=]+([\d,.\s₩원]+)$/);
    if (!m) continue;
    const v = numOf(m[2]);
    if (v !== null) out.set(m[1].trim(), (out.get(m[1].trim()) || 0) + v);
  }
  return out;
}

/* ---------- 집계 ---------- */

const sum = a => a.reduce((s, x) => s + x, 0);

// 캠페인별 지표 합 → 채널별로 접는다. 광고비는 캠페인 이름으로 붙는다.
function aggregate(rows, metric, spend = new Map()){
  const byCampaign = new Map();
  for (const r of rows){
    if (r.metric !== metric) continue;
    byCampaign.set(r.campaign, (byCampaign.get(r.campaign) || 0) + r.value);
  }
  for (const name of spend.keys()) if (!byCampaign.has(name)) byCampaign.set(name, 0);

  const byChannel = new Map();
  for (const [campaign, value] of byCampaign){
    const k = classify(campaign), name = channelOf(campaign);
    const cur = byChannel.get(name) || {name, platform: k.platform, medium: k.medium, color: k.color, value: 0, spend: 0, campaigns: []};
    cur.value += value;
    cur.spend += spend.get(campaign) || 0;
    cur.campaigns.push({campaign, value, spend: spend.get(campaign) || 0});
    byChannel.set(name, cur);
  }
  const channels = [...byChannel.values()].sort((a, b) => b.value - a.value);
  for (const c of channels) c.cpi = c.spend > 0 && c.value > 0 ? Math.round(c.spend / c.value) : null;
  return channels;
}

// 날짜 × 채널 누적 시계열. 빠진 날은 0 으로 메워 선이 끊기지 않게 한다.
function daily(rows, metric){
  const dates = [...new Set(rows.filter(r => r.metric === metric).map(r => r.date))].sort();
  const names = [...new Set(rows.filter(r => r.metric === metric).map(r => channelOf(r.campaign)))];
  const idx = new Map(dates.map((d, i) => [d, i]));
  const series = names.map(name => ({
    name,
    color: name === ETC ? ETC_COLOR : (PLATFORM.find(p => name.startsWith(p[0])) || [,, ETC_COLOR])[2],
    dashed: name.includes('직접제작'),
    points: dates.map(() => 0),
  }));
  for (const r of rows){
    if (r.metric !== metric) continue;
    series[names.indexOf(channelOf(r.campaign))].points[idx.get(r.date)] += r.value;
  }
  return {dates, series};
}

// 유지율 격자: 코호트(설치일) × 경과 기간. 채널 필터는 캠페인 이름으로 건다.
function cohortGrid(rows, channel = ''){
  const use = channel ? rows.filter(r => channelOf(r.campaign) === channel) : rows;
  const cohorts = [...new Set(use.map(r => r.cohort))].sort();
  const steps = [...new Set(use.map(r => r.elapsed))].sort((a, b) => a - b);
  const bucket = new Map();
  for (const r of use){
    const k = `${r.cohort}|${r.elapsed}`;
    (bucket.get(k) || bucket.set(k, []).get(k)).push(r.value);
  }
  const grid = cohorts.map(c => steps.map(s => {
    const v = bucket.get(`${c}|${s}`);
    return v ? sum(v) / v.length : null;   // 같은 칸에 캠페인이 여럿이면 평균
  }));
  return {cohorts, steps, grid};
}


const API = {classify, channelOf, parseReport, parseSpend, aggregate, daily, cohortGrid};
if (typeof module !== 'undefined') module.exports = API;
if (typeof document === 'undefined') return;   // node 검증은 순수 로직까지만 쓴다

/* ---------- 화면 ---------- */

const el = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => Number(n).toLocaleString('ko-KR');
const DL_HINT = ['download','install','다운로드','설치'];

let REPORT = {kind: null, rows: []}, COHORT = {rows: [], unit: '일'}, SPEND = new Map();

function readInput(){
  const text = el('#chanRaw').value.trim();
  SPEND = parseSpend(el('#chanSpend').value);
  if (!text){ REPORT = {kind: null, rows: []}; COHORT = {rows: [], unit: '일'}; return ['붙여넣은 내용이 없다.']; }
  const out = parseReport(text);
  if (out.kind === 'cohort') COHORT = out;
  else if (out.kind === 'metrics') REPORT = out;
  return out.warnings;
}

function fillMetrics(){
  const sel = el('#chanMetric'), cur = sel.value;
  const names = [...new Set(REPORT.rows.map(r => r.metric))];
  sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = names.includes(cur) ? cur
    : (names.find(n => DL_HINT.some(h => n.toLowerCase().includes(h))) || names[0] || '');
}

function renderChannels(){
  const metric = el('#chanMetric').value;
  const ch = aggregate(REPORT.rows, metric, SPEND);
  const total = sum(ch.map(c => c.value));
  const part = m => sum(ch.filter(c => c.medium === m).map(c => c.value));
  const adSpend = sum(ch.filter(c => c.medium === '광고').map(c => c.spend));
  const adValue = part('광고');

  el('#chanStats').innerHTML = [
    ['합계', fmt(total), metric],
    ['광고', fmt(adValue), total ? `${Math.round(adValue / total * 100)}%` : '—'],
    ['직접제작', fmt(part('직접제작')), total ? `${Math.round(part('직접제작') / total * 100)}%` : '—'],
    ['기타', fmt(sum(ch.filter(c => c.platform === ETC).map(c => c.value))), '카톡 · 에타 · 랜딩 등'],
    ['광고 단가', adSpend && adValue ? fmt(Math.round(adSpend / adValue)) + '원' : '—',
      adSpend ? `광고비 ${fmt(adSpend)}원` : '광고비를 넣으면 계산된다'],
  ].map(([k, v, n]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span><span class="n">${esc(n)}</span></div>`).join('');

  const max = Math.max(1, ...ch.map(c => c.value));
  el('#chanBars').innerHTML = ch.map(c => `<div class="bar">
      <span class="bl">${esc(c.name)}</span>
      <span class="bt"><i style="width:${(c.value / max * 100).toFixed(1)}%;background:${c.color};opacity:${c.medium === '직접제작' ? 0.55 : 1}"></i></span>
      <span class="bv">${fmt(c.value)}</span>
    </div>`).join('') || '<p class="empty">집계할 캠페인이 없다.</p>';

  el('#chanRows').innerHTML = ch.map(c => `<tr>
      <td class="name">${esc(c.name)}</td>
      <td class="mono">${c.campaigns.map(x => esc(x.campaign)).join(', ')}</td>
      <td class="num"><b>${fmt(c.value)}</b></td>
      <td class="num">${total ? (c.value / total * 100).toFixed(1) + '%' : '—'}</td>
      <td class="num">${c.spend ? fmt(c.spend) : '—'}</td>
      <td class="num">${c.cpi ? '<b>' + fmt(c.cpi) + '</b>' : '—'}</td>
    </tr>`).join('');
}

function renderTrend(){
  const metric = el('#chanMetric').value;
  const {dates, series} = daily(REPORT.rows, metric);
  const svg = el('#chanChart');
  if (dates.length < 2){ svg.innerHTML = ''; el('#chanLegend').innerHTML = ''; el('#chanTrend').hidden = true; return; }
  el('#chanTrend').hidden = false;
  const W = 1000, H = 260, L = 44, R = 16, T = 14, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...series.flatMap(s => s.points));
  const cx = i => L + iw * i / (dates.length - 1);
  const cy = v => T + ih - (v / max) * ih;
  let g = '';
  for (let i = 0; i <= 2; i++){
    const yy = T + ih * i / 2;
    g += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="#E6E4DD"/>`;
    g += `<text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#71717A">${Math.round(max * (1 - i / 2))}</text>`;
  }
  for (const s of series)
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="1.8" ${s.dashed ? 'stroke-dasharray="4 3"' : ''} points="${s.points.map((v, i) => `${cx(i)},${cy(v)}`).join(' ')}"/>`;
  const step = Math.ceil(dates.length / 10);
  dates.forEach((d, i) => {
    if (i % step === 0 || i === dates.length - 1)
      g += `<text x="${cx(i)}" y="${H - 14}" text-anchor="middle" font-size="10" fill="#71717A">${d.slice(5)}</text>`;
  });
  svg.innerHTML = g;
  el('#chanLegend').innerHTML = series.map(s =>
    `<span><i style="background:${s.color};opacity:${s.dashed ? 0.55 : 1}"></i>${esc(s.name)}</span>`).join('');
}

function renderCohort(){
  const sec = el('#cohortSec');
  if (!COHORT.rows.length){ sec.hidden = true; return; }
  sec.hidden = false;
  const sel = el('#cohortCh'), names = [...new Set(COHORT.rows.map(r => channelOf(r.campaign)))];
  if (sel.options.length !== names.length + 1){
    sel.innerHTML = '<option value="">채널 전체</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }
  const {cohorts, steps, grid} = cohortGrid(COHORT.rows, sel.value);
  const flat = grid.flat().filter(v => v !== null);
  const max = Math.max(1, ...flat);
  el('#cohortHead').innerHTML = '<th>설치 코호트</th>' + steps.map(s => `<th>${s}${COHORT.unit}</th>`).join('');
  el('#cohortRows').innerHTML = cohorts.map((c, i) => `<tr><td class="mono">${esc(c)}</td>` + grid[i].map(v =>
    v === null ? '<td class="heat"></td>'
      : `<td class="heat" style="background:rgba(94,111,206,${(v / max * 0.72).toFixed(2)})">${v % 1 ? v.toFixed(1) : v}</td>`
  ).join('') + '</tr>').join('');
}

function runChannels(){
  const warnings = readInput();
  el('#chanErr').textContent = warnings.join(' ');
  const has = REPORT.rows.length > 0;
  el('#chanSec').hidden = !has;
  if (has){ fillMetrics(); renderChannels(); renderTrend(); }
  else el('#chanTrend').hidden = true;
  renderCohort();
}

if (!el('#chanRun')) return;   // 유입 채널 섹션이 없는 페이지에 실려도 죽지 않는다
el('#chanRun').onclick = runChannels;
el('#chanMetric').onchange = () => { renderChannels(); renderTrend(); };
el('#cohortCh').onchange = renderCohort;
el('#chanClear').onclick = () => {
  el('#chanRaw').value = el('#chanSpend').value = el('#chanErr').textContent = '';
  REPORT = {kind: null, rows: []}; COHORT = {rows: [], unit: '일'};
  ['#chanSec', '#chanTrend', '#cohortSec'].forEach(s => el(s).hidden = true);
};
})();
