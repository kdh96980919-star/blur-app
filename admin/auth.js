// Only the PKCE verifier survives the OAuth redirect. Sessions and user data stay in memory.
const API = 'https://nzrfzxpqvhdkmogpsscz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56cmZ6eHBxdmhka21vZ3Bzc2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Mjc3NjYsImV4cCI6MjA5OTAwMzc2Nn0.9QP6B46co4109frO-H_PYX_f4fvoPwEwz6HbIHGJuz8';
const VERIFIER_KEY = 'blur-dashboard-pkce';
let session = null, generation = 0, busy = false;
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function request(path, body, token) {
  const response = await fetch(API + path, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: {apikey: ANON_KEY, 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = new Error(response.status === 403 ? '이 계정에는 대시보드 조회 권한이 없습니다.'
      : response.status === 401 ? '로그인이 만료됐습니다. 다시 로그인해 주세요.'
      : response.status === 429 ? '잠시 기다린 뒤 다시 조회해 주세요.'
      : '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function clearData() {
  DATA = {generated_at: null, users: []};
  $('#rows').replaceChildren(); $('#stats').replaceChildren(); $('#chart').replaceChildren();
  $('#q').value = ''; $('#prov').innerHTML = '<option value="">로그인 계정 전체</option>';
  render();
}

function resetSession() {
  generation++; session = null; clearData();
  $('#loginButtons').hidden = false; $('#sessionButtons').hidden = true;
  $('#authNote').textContent = '접근 권한이 등록된 blur 계정으로 로그인하세요.';
}

async function signIn(provider) {
  if (!['google', 'kakao'].includes(provider)) return;
  try {
    if (!/^https?:$/.test(location.protocol)) throw new Error('공유된 대시보드 웹 주소에서 로그인해 주세요.');
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({verifier, createdAt: Date.now()}));
    const url = new URL(API + '/auth/v1/authorize');
    url.search = new URLSearchParams({provider, redirect_to: location.origin + location.pathname,
      code_challenge: challenge, code_challenge_method: 's256'});
    location.assign(url);
  } catch (error) { $('#err').textContent = error.message; }
}

async function refresh() {
  if (!session || busy) return;
  busy = true; $('#refresh').disabled = true; $('#err').textContent = '최신 데이터를 불러오는 중…';
  const current = generation;
  try {
    if (session.expires_at * 1000 < Date.now() + 60000) {
      const next = await request('/auth/v1/token?grant_type=refresh_token', {refresh_token: session.refresh_token});
      if (current !== generation) return;
      session = next;
    }
    const data = await request('/rest/v1/rpc/dashboard_users', {}, session.access_token);
    if (current !== generation) return;
    if (!Array.isArray(data?.users) || !data.generated_at) throw new Error('데이터 형식이 올바르지 않습니다.');
    DATA = data; render(); $('#err').textContent = '최신 데이터입니다.';
  } catch (error) {
    if (current !== generation) return;
    clearData();
    if (error.status === 401 || error.status === 400) resetSession();
    $('#err').textContent = error.message;
  } finally { busy = false; $('#refresh').disabled = false; }
}

$('#loginButtons').onclick = event => {
  const button = event.target.closest('[data-provider]');
  if (button) signIn(button.dataset.provider);
};
$('#refresh').onclick = refresh;
$('#logout').onclick = async () => {
  const token = session?.access_token;
  resetSession(); $('#err').textContent = '로그아웃했습니다.';
  if (token) {
    try { await request('/auth/v1/logout?scope=local', {}, token); }
    catch { $('#err').textContent = '이 창에서 로그아웃했습니다. 서버 세션 종료는 연결 문제로 확인하지 못했습니다.'; }
  }
};
window.addEventListener('pagehide', resetSession);

async function init() {
  // Remove snapshots created by the old manual dashboard on this origin.
  try { localStorage.removeItem('blur-admin-users-v1'); } catch {}
  render();
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const failed = params.has('error') || new URLSearchParams(location.hash.slice(1)).has('error');
  history.replaceState(null, '', location.pathname);
  if (!code && !failed) return;
  try {
    const saved = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    const pending = saved ? JSON.parse(saved) : null;
    if (failed || !code || !pending || Date.now() - pending.createdAt > 600000) {
      throw new Error('로그인을 완료하지 못했습니다. 로그인 버튼을 다시 눌러 주세요.');
    }
    session = await request('/auth/v1/token?grant_type=pkce', {auth_code: code, code_verifier: pending.verifier});
    $('#loginButtons').hidden = true; $('#sessionButtons').hidden = false;
    $('#authNote').textContent = `${session.user.email || 'blur 계정'}으로 로그인했습니다.`;
    await refresh();
  } catch (error) { resetSession(); $('#err').textContent = error.message; }
}
init();
