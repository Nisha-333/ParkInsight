/* ════════════════════════════════════════════════════════════════════════
   CORE.JS — Global state, helpers, theme toggle, auth, navigation, router
   ════════════════════════════════════════════════════════════════════════ */
const API = '';
let _role=null,_user=null,_summary={},_hotspots=[],_forecasts=[],_allocations=[],_myRoute=null;
let _citizenProfile=null,_communityFeed=[],_adminConfig={};
let leafMap=null,routeMap=null,dispatchMap=null,citizenMap=null,_policeMap=null;
let _mapLayers=[],_checkItems={},_selectedStop=0,_sevFilter='all',_activeLayer='impact';
let _clusterGroup=null, _currentTheme='light';

// ── Helpers ─────────────────────────────────────────────────────────────────
function toast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast'+(err?' err':'');
  t.style.display='block';
  setTimeout(()=>t.style.display='none',3200);
}
function epsColor(s){return s>=.80?'var(--danger)':s>=.65?'var(--warn)':'var(--accent)'}
function epsColorHex(s){return s>=.80?'#ef4444':s>=.65?'#f97316':'#00b87a'}
function sevColor(s){return s==='CRITICAL'?'var(--danger)':s==='HIGH'?'var(--warn)':s==='MEDIUM'?'#f59e0b':'var(--accent)'}
function sevColorHex(s){return s==='CRITICAL'?'#ef4444':s==='HIGH'?'#f97316':s==='MEDIUM'?'#f59e0b':'#00b87a'}

// ── Shared AI Copilot caller ──────────────────────────────────────────────────
async function askCopilot(question, page) {
  const token = getToken();
  const endpoint = token ? '/api/v1/copilot/authed' : '/api/v1/copilot';
  const body = { question, role: _role || 'guest', page };
  const data = await api(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.reply;
}

async function api(url,opts={}){
  const token = (typeof getToken==='function') ? getToken() : null;
  const headers = { ...(opts.headers||{}) };
  if (token && !headers['Authorization']) headers['Authorization'] = 'Bearer ' + token;
  const r=await fetch(API+url,{...opts,headers});
  if(!r.ok){
    let detail = '';
    try { detail = (await r.json()).detail || ''; } catch(e) {}
    throw new Error(`HTTP ${r.status}${detail ? ': '+detail : ''}`);
  }
  return r.json();
}

// ── Theme ───────────────────────────────────────────────────────────────────
function getTileUrl(){
  return _currentTheme==='dark'
    ?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    :'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}
function toggleTheme(){
  _currentTheme=_currentTheme==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',_currentTheme);
  document.getElementById('theme-btn').textContent=_currentTheme==='dark'?'☀️':'🌙';
  localStorage.setItem('parkinsight-theme', _currentTheme);
  updateMapTiles();
}
function updateMapTiles(){
  const tile=getTileUrl();
  [leafMap,routeMap,dispatchMap,citizenMap].forEach(m=>{
    if(!m) return;
    const toRemove=[];
    m.eachLayer(l=>{ if(l._url) toRemove.push(l); });
    toRemove.forEach(l=>m.removeLayer(l));
    L.tileLayer(tile,{maxZoom:19,subdomains:'abcd'}).addTo(m);
  });
}
function initTheme(){
  try{
    const saved=localStorage.getItem('parkinsight-theme');
    if(saved==='dark'){
      _currentTheme='dark';
      document.documentElement.setAttribute('data-theme','dark');
      document.getElementById('theme-btn').textContent='☀️';
    }
  }catch(e){}
}

// ── Auth ─────────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'parkinsight-token';

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch(e) { return null; } }
function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch(e) {} }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch(e) {} }

function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('login-form').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? 'flex' : 'none';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-submit-btn');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await api('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    await enterApp(data.user.role, data.user);
  } catch(e) {
    errEl.textContent = 'Invalid email or password.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In →';
  }
}

async function doSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl = document.getElementById('signup-error');
  const btn = document.getElementById('signup-submit-btn');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const data = await api('/api/v1/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    setToken(data.token);
    await enterApp(data.user.role, data.user);
  } catch(e) {
    errEl.textContent = e.message.includes('409') ? 'An account with this email already exists.'
      : e.message.includes('400') ? 'Check your details — password needs 8+ chars with letters & numbers.'
      : 'Could not create account. Please try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Create Free Account →';
  }
}

async function enterApp(role, user) {
  _user = user; _role = role;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-header').style.display = 'flex';
  document.getElementById('app-nav').style.display = 'flex';
  document.getElementById('hdr-user-name').textContent = _user.name;
  const rb = document.getElementById('hdr-role-badge');
  rb.textContent = role.toUpperCase(); rb.className = 'role-badge ' + role;
  document.getElementById('hdr-city').textContent = '10 Nov 2023 – 08 Apr 2024';
  document.getElementById('precinct-select').style.display = (role !== 'citizen' && role !== 'guest') ? 'block' : 'none';
  document.getElementById('hdr-junction-search').style.display = (role !== 'citizen' && role !== 'guest') ? 'block' : 'none';
  if (role === 'admin' || role === 'police') initHeaderJunctionSearch();
  document.getElementById('export-btn-group').style.display = (role === 'admin') ? 'flex' : 'none';
  buildNav(role);
  await loadData(role);
  showPage(role === 'admin' ? 'admin-cmd' : role === 'police' ? 'police-ops' : 'citizen-home');
}

async function tryRestoreSession() {
  const token = getToken();
  if (!token) return false;
  try {
    const user = await api('/api/v1/auth/me');
    await enterApp(user.role, user);
    return true;
  } catch(e) {
    clearToken();
    return false;
  }
}

// ── Role-card login → shows credential modal pre-filled for that role ─────────
const DEMO_CREDS = {
  admin:  { email: 'admin@parkinsight.ai',                       password: 'Admin@2024',  label: 'Admin' },
  police: { email: 'ramesh.kumar@bengalurupolice.gov.in',        password: 'Police@2024', label: 'Police Officer' },
  citizen:{ email: '',                                           password: '',            label: 'Citizen' },
};

function login(role) {
  const creds = DEMO_CREDS[role] || {};
  // Always remove old modal so role-specific footer links are rebuilt correctly
  const old = document.getElementById('auth-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:var(--surface,#1e293b);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 28px;width:100%;max-width:400px;position:relative;box-shadow:0 24px 60px rgba(0,0,0,.5)">
      <button onclick="document.getElementById('auth-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;line-height:1">✕</button>
      <div id="auth-modal-title" style="font-size:18px;font-weight:700;margin-bottom:6px;color:var(--text1,#f1f5f9)"></div>
      <div id="auth-modal-hint" style="font-size:12px;color:#64748b;margin-bottom:20px"></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Email</label>
          <input id="auth-modal-email" type="email" autocomplete="email"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/>
        </div>
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Password</label>
          <input id="auth-modal-password" type="password" autocomplete="current-password"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/>
        </div>
        <div id="auth-modal-error" style="color:#f87171;font-size:12px;min-height:16px"></div>
        <button id="auth-modal-btn" onclick="doModalLogin()"
          style="padding:12px;border-radius:10px;border:none;background:#00b87a;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font,inherit)">
          Sign In →
        </button>
        ${role==='citizen'?`<div style="text-align:center;font-size:12px;color:#64748b">New here? <a href="#" onclick="showSignupModal();return false" style="color:#00b87a;text-decoration:none">Create a free account</a></div>`:''}
        ${role==='police'?`<div style="text-align:center;font-size:12px;color:#64748b">New officer? <a href="#" onclick="showPoliceSignupModal();return false" style="color:#00b87a;text-decoration:none">Request access</a></div>`:''}
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Pre-fill title + credentials
  document.getElementById('auth-modal-title').textContent = 'Sign in as ' + (creds.label || role);
  const hint = document.getElementById('auth-modal-hint');
  if (creds.email) {
    hint.textContent = 'Demo credentials pre-filled — click Sign In to continue.';
    document.getElementById('auth-modal-email').value = creds.email;
    document.getElementById('auth-modal-password').value = creds.password;
  } else {
    hint.textContent = 'Enter your citizen account credentials or create a free account.';
    document.getElementById('auth-modal-email').value = '';
    document.getElementById('auth-modal-password').value = '';
  }
  document.getElementById('auth-modal-error').textContent = '';
  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

async function doModalLogin() {
  const email    = document.getElementById('auth-modal-email').value.trim();
  const password = document.getElementById('auth-modal-password').value;
  const errEl    = document.getElementById('auth-modal-error');
  const btn      = document.getElementById('auth-modal-btn');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await api('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    const m = document.getElementById('auth-modal'); if (m) m.remove();
    await enterApp(data.user.role, data.user);
  } catch(e) {
    errEl.textContent = e.message.includes('403') ? e.message.replace(/^HTTP \d+:\s*/, '') : 'Invalid email or password.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In →';
  }
}

function showSignupModal() {
  let modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
  let sm = document.getElementById('signup-modal');
  if (!sm) {
    sm = document.createElement('div');
    sm.id = 'signup-modal';
    sm.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)';
    sm.innerHTML = `
      <div style="background:var(--surface,#1e293b);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 28px;width:100%;max-width:400px;position:relative;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <button onclick="document.getElementById('signup-modal').style.display='none'" style="position:absolute;top:14px;right:16px;background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;line-height:1">✕</button>
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;color:var(--text1,#f1f5f9)">Create Citizen Account</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:20px">Join thousands of citizens helping enforce fair parking in Bengaluru</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Full Name</label>
            <input id="su-name" type="text" autocomplete="name"
              style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/>
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Email</label>
            <input id="su-email" type="email" autocomplete="email"
              style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/>
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Password <span style="color:#64748b">(8+ chars, letters & numbers)</span></label>
            <input id="su-password" type="password" autocomplete="new-password"
              style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/>
          </div>
          <div id="su-error" style="color:#f87171;font-size:12px;min-height:16px"></div>
          <button id="su-btn" onclick="doSignupModal()"
            style="padding:12px;border-radius:10px;border:none;background:#00b87a;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font,inherit)">
            Create Free Account →
          </button>
          <div style="text-align:center;font-size:12px;color:#64748b">Already have an account? <a href="#" onclick="login('citizen');return false" style="color:#00b87a;text-decoration:none">Sign in</a></div>
        </div>
      </div>`;
    document.body.appendChild(sm);
    sm.onclick = (e) => { if (e.target === sm) sm.style.display = 'none'; };
  }
  sm.style.display = 'flex';
}

async function doSignupModal() {
  const name     = document.getElementById('su-name').value.trim();
  const email    = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;
  const errEl    = document.getElementById('su-error');
  const btn      = document.getElementById('su-btn');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const data = await api('/api/v1/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    setToken(data.token);
    document.getElementById('signup-modal').style.display = 'none';
    await enterApp(data.user.role, data.user);
  } catch(e) {
    errEl.textContent = e.message.includes('409') ? 'An account with this email already exists.'
      : e.message.includes('400') ? 'Check your details — password needs 8+ chars with letters & numbers.'
      : 'Could not create account. Please try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Create Free Account →';
  }
}

function showPoliceSignupModal() {
  const am = document.getElementById('auth-modal');
  if (am) am.style.display = 'none';
  let pm = document.getElementById('police-signup-modal');
  if (!pm) {
    pm = document.createElement('div');
    pm.id = 'police-signup-modal';
    pm.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)';
    pm.innerHTML = `
      <div style="background:var(--surface,#1e293b);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 28px;width:100%;max-width:420px;position:relative;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <button onclick="document.getElementById('police-signup-modal').style.display='none'" style="position:absolute;top:14px;right:16px;background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;line-height:1">✕</button>
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;color:var(--text1,#f1f5f9)">Request Officer Access</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:20px">Submitted requests are reviewed by an admin. You'll be able to sign in once approved.</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Full Name</label>
            <input id="ps-name" type="text" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/></div>
          <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Official Email</label>
            <input id="ps-email" type="email" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/></div>
          <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Badge Number</label>
            <input id="ps-badge" type="text" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/></div>
          <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Station / Unit</label>
            <input id="ps-unit" type="text" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/></div>
          <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Password <span style="color:#64748b">(8+ chars, letters & numbers)</span></label>
            <input id="ps-password" type="password" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text1,#f1f5f9);font-size:14px;box-sizing:border-box;outline:none"/></div>
          <div id="ps-error" style="color:#f87171;font-size:12px;min-height:16px"></div>
          <div id="ps-success" style="color:#00b87a;font-size:12px;min-height:16px;display:none"></div>
          <button id="ps-btn" onclick="doPoliceSignup()"
            style="padding:12px;border-radius:10px;border:none;background:#00b87a;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font,inherit)">
            Submit Request →
          </button>
        </div>
      </div>`;
    document.body.appendChild(pm);
    pm.onclick = (e) => { if (e.target === pm) pm.style.display = 'none'; };
  }
  pm.style.display = 'flex';
}

async function doPoliceSignup() {
  const name     = document.getElementById('ps-name').value.trim();
  const email    = document.getElementById('ps-email').value.trim();
  const badge    = document.getElementById('ps-badge').value.trim();
  const unit     = document.getElementById('ps-unit').value.trim();
  const password = document.getElementById('ps-password').value;
  const errEl = document.getElementById('ps-error');
  const okEl  = document.getElementById('ps-success');
  const btn   = document.getElementById('ps-btn');
  errEl.textContent = ''; okEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const data = await api('/api/v1/auth/police-signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, badge_number: badge, assigned_unit: unit }),
    });
    okEl.textContent = data.message || 'Request submitted. Await admin approval.';
    okEl.style.display = 'block';
    btn.style.display = 'none';
  } catch(e) {
    errEl.textContent = e.message.includes('409') ? 'An account with this email already exists.'
      : e.message.includes('400') ? 'Check your details — all fields are required.'
      : 'Could not submit request. Please try again.';
    btn.disabled = false; btn.textContent = 'Submit Request →';
  }
}

function loginGuest() {
  _role = 'guest';
  _user = { name: 'Guest', role: 'guest', user_id: null };
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-header').style.display = 'flex';
  document.getElementById('app-nav').style.display = 'flex';
  document.getElementById('hdr-user-name').textContent = 'Guest';
  const rb = document.getElementById('hdr-role-badge');
  rb.textContent = 'GUEST'; rb.className = 'role-badge guest';
  document.getElementById('hdr-city').textContent = '10 Nov 2023 – 08 Apr 2024';
  document.getElementById('precinct-select').style.display = 'none';
  document.getElementById('export-btn-group').style.display = 'none';
  buildNav('guest');
  loadData('guest').then(() => showPage('guest-home'));
}

function logout() {
  clearToken();
  _role=null;_user=null;
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app-header').style.display='none';
  document.getElementById('app-nav').style.display='none';
  document.getElementById('content').innerHTML='';
  [leafMap,routeMap,dispatchMap,citizenMap,_policeMap,_opsMapRef,
   typeof _citizenHsMap!=='undefined'?_citizenHsMap:null,
   typeof _policeHotspotMap!=='undefined'?_policeHotspotMap:null,
   typeof _policePatrolMap!=='undefined'?_policePatrolMap:null]
    .forEach(m=>{try{if(m)m.remove()}catch(e){}});
  leafMap=routeMap=dispatchMap=citizenMap=_policeMap=_opsMapRef=null;
  if(typeof _citizenHsMap!=='undefined') _citizenHsMap=null;
  if(typeof _policeHotspotMap!=='undefined') _policeHotspotMap=null;
  if(typeof _policePatrolMap!=='undefined') _policePatrolMap=null;
  [typeof _epsChart!=='undefined'?_epsChart:null,
   typeof _violChart!=='undefined'?_violChart:null,
   typeof _windowChart!=='undefined'?_windowChart:null]
    .forEach(ch=>{try{if(ch)ch.destroy()}catch(e){}});
  if(typeof _epsChart!=='undefined') _epsChart=null;
  if(typeof _violChart!=='undefined') _violChart=null;
  if(typeof _windowChart!=='undefined') _windowChart=null;
}

function buildNav(role){
  const nav=document.getElementById('app-nav');
  const tabs={
    admin:[['admin-cmd','🛰 Command Center'],['admin-map','🗺 Hotspot Map'],['admin-eps','📊 EPS Rankings'],['admin-forecast','⚡ Risk Forecast'],['admin-routes','🚔 Officer Routing'],['admin-config','⚙️ Config & Export']],
    police:[['police-ops','🗺 Operations'],['police-complaints','📋 Complaints'],['police-hotspots','🔥 Hotspots'],['police-patrol','🚔 Patrol Route'],['police-analytics','📊 Analytics']],
    citizen:[['citizen-home','🏠 Home'],['citizen-map','🗺 Hotspot Map'],['citizen-alerts','⚡ Live Alerts'],['citizen-analysis','📊 Analysis'],['citizen-check','🔍 Safe to Park?'],['citizen-report','📸 Report Violation'],['citizen-track','🔍 Track Complaint'],['citizen-wallet','🪙 Civic Credits']],
    guest:[['guest-home','🏠 Home'],['guest-map','🗺 Hotspot Map'],['guest-alerts','⚡ Live Alerts'],['guest-report','📸 Report'],['guest-track','🔍 Track Complaint'],['guest-parking','🅿 Safe Parking']],
  };
  const navTabs = tabs[role] || tabs.guest;
  nav.innerHTML = navTabs.map(([id,label])=>`<button onclick="showPage('${id}')" data-page="${id}">${label}</button>`).join('');
  if(role==='guest'){
    nav.innerHTML += `<button onclick="showSignupPrompt()" style="margin-left:auto;color:var(--accent);font-weight:700">✨ Sign Up</button>`;
  }
}

function showSignupPrompt() {
  logout();
  switchAuthTab('signup');
}

let _currentPage = null;
function showPage(id){
  _currentPage = id;
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  const c=document.getElementById('content');
  c.style.overflow='auto'; c.style.height=''; c.style.background='';
  c.innerHTML='<div class="spinner"><div class="spin"></div><span>Loading…</span></div>';
  setTimeout(()=>renderPage(id),30);
}

async function loadData(role){
  try{
    // Public data available to all roles
    const[h,f]=await Promise.all([api('/api/v1/hotspots'),api('/api/v1/forecast')]);
    _hotspots=h.hotspots; _forecasts=f.forecasts;

    if(role==='admin'||role==='police'){
      [_summary]=await Promise.all([api('/api/v1/dashboard/summary')]);
      const a=await api('/api/v1/allocations');
      _allocations=a.allocations;
    }
    if(role==='police') _myRoute=await api('/api/v1/police/my-route?officer_id='+encodeURIComponent(_user?.user_id||''));
    if(role==='citizen'){
      _citizenProfile=await api('/api/v1/citizen/profile?user_id='+_user.user_id);
      const feed=await api('/api/v1/citizen/community-feed');
      _communityFeed=disambiguateFeedZones(feed.feed);
    }
    if(role==='admin') _adminConfig=await api('/api/v1/admin/config');
  }catch(e){toast('Data load error: '+e.message,true);}
}

function renderPage(id){
  const c=document.getElementById('content');
  const isPolice = ['police-ops','police-route','police-complaints','police-hotspots','police-patrol','police-analytics'].includes(id);
  // Only the map/ops pages are always dark; other police pages follow the user's theme
  const isAlwaysDark = ['police-ops','police-route'].includes(id);
  // Only Operations is a genuine fixed-height map+sidebar layout that manages
  // its own internal scrolling. The other police pages are normal flowing
  // content and need the outer container to scroll like every other page —
  // hiding overflow here clipped Analytics (and would clip a long Complaints
  // list) the moment content exceeded one viewport.
  const isFixedLayout = ['police-ops','police-route'].includes(id);
  c.style.overflow  = isFixedLayout ? 'hidden' : 'auto';
  c.style.height    = isFixedLayout ? '100%'   : '';
  c.style.background= isAlwaysDark ? '#080c14': '';
  const pages={
    'admin-cmd':renderAdminCmd,'admin-map':renderAdminMap,'admin-eps':renderAdminEPS,
    'admin-forecast':renderAdminForecast,'admin-routes':renderAdminRoutes,'admin-config':renderAdminConfig,
    'police-ops':renderPoliceOps,'police-complaints':renderPoliceComplaints,'police-hotspots':renderPoliceHotspots,
    'police-patrol':renderPolicePatrol,
    'police-analytics':renderPoliceAnalytics,
    'police-route':renderPoliceOps,
    'citizen-home':renderCitizenHome,'citizen-map':renderCitizenHotspotMap,'citizen-alerts':renderCitizenAlerts,
    'citizen-analysis':renderCitizenAnalysis,'citizen-check':renderCitizenCheck,'citizen-report':renderCitizenReport,
    'citizen-track':renderCitizenTrackComplaint,'citizen-wallet':renderCitizenWallet,
    'guest-home':renderGuestHome,'guest-map':renderGuestMap,'guest-alerts':renderGuestAlerts,
    'guest-report':renderGuestReport,
    'guest-track':renderGuestTrack,'guest-parking':renderGuestParking,
  };
  if(pages[id]) pages[id](c);
  else c.innerHTML='<div class="page active" style="color:var(--muted)">Page not found</div>';
}

// ── Precinct snapping ────────────────────────────────────────────────────────
const PRECINCT_COORDS={'Upparpet':[12.9767,77.5713,14],'Shivajinagar':[12.9850,77.5995,14],'Madiwala':[12.9220,77.6218,14],'Koramangala':[12.9352,77.6245,14],'Hebbal':[13.0350,77.5970,13],'Jayanagar':[12.9250,77.5938,14],'Basavanagudi':[12.9420,77.5750,14],'Whitefield':[12.9699,77.7499,13]};
function snapToPrecinct(name){
  if(!name) return;
  const coords=PRECINCT_COORDS[name]; if(!coords) return;
  [leafMap,_policeMap,dispatchMap].forEach(m=>{if(m)try{m.setView([coords[0],coords[1]],coords[2],{animate:true})}catch(e){}});
}

// ── Header junction search (Admin / Police) ──────────────────────────────────
// The precinct dropdown above only covers 8 fixed police-station names. This
// adds a free-text search over the FULL named-junction list (from
// /api/v1/junctions — same dataset-backed gazetteer used by the citizen
// safe-to-park / report-violation pages) so admin and police users can jump
// the active map straight to any of the ~80+ named junctions, not just the
// 8 station centres. Does not touch snapToPrecinct or the station dropdown.
let _hdrJunctionsLoaded = false;
async function initHeaderJunctionSearch(){
  const input = document.getElementById('hdr-junction-input');
  const results = document.getElementById('hdr-junction-results');
  if (!input || !results || _hdrJunctionsLoaded) return;
  _hdrJunctionsLoaded = true;
  let junctions = [];
  try {
    const data = await api('/api/v1/junctions');
    junctions = data.junctions || [];
  } catch(e) { junctions = []; }

  function render(list){
    if (!list.length) { results.style.display='none'; results.innerHTML=''; return; }
    results.innerHTML = list.slice(0,8).map(j =>
      `<div class="junction-result-item" data-lat="${j.latitude}" data-lon="${j.longitude}" data-name="${(j.display_name||j.junction_name).replace(/"/g,'&quot;')}">📍 ${j.display_name||j.junction_name}</div>`
    ).join('');
    results.style.display='block';
    results.querySelectorAll('.junction-result-item').forEach(el=>{
      el.onclick = () => {
        snapToJunction(parseFloat(el.dataset.lat), parseFloat(el.dataset.lon));
        input.value = el.dataset.name;
        results.style.display='none'; results.innerHTML='';
        toast('Map centred on ' + el.dataset.name);
      };
    });
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.style.display='none'; return; }
    render(junctions.filter(j => (j.junction_name||'').toLowerCase().includes(q)));
  });
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
  document.addEventListener('click', (e) => {
    if (e.target !== input && !results.contains(e.target)) results.style.display='none';
  });
}
function snapToJunction(lat, lon, zoom){
  if (!lat || !lon) return;
  const z = zoom || 16;
  [leafMap,_policeMap,dispatchMap].forEach(m=>{if(m)try{m.setView([lat,lon],z,{animate:true})}catch(e){}});
}

document.addEventListener('DOMContentLoaded', () => { initTheme(); tryRestoreSession(); loadLoginStats(); });

async function loadLoginStats(){
  try{
    const [h,f] = await Promise.all([api('/api/v1/hotspots?limit=1000'), api('/api/v1/forecast')]);
    const hotspots = h.hotspots || [];
    const totalViolations = hotspots.reduce((s,x)=>s+(x.total_violations||0),0);
    const top10Impact = hotspots.slice(0,10).reduce((s,x)=>s+(x.pct_of_citywide_impact||0),0);
    const valEl = document.querySelectorAll('.login-stat-val');
    if(valEl[0]) valEl[0].textContent = totalViolations.toLocaleString('en-IN');
    if(valEl[1]) valEl[1].textContent = hotspots.length.toLocaleString('en-IN');
    if(valEl[2]) valEl[2].textContent = top10Impact.toFixed(1)+'%';
  }catch(e){
    // Leave the placeholder dashes in place rather than showing stale fabricated numbers
    document.querySelectorAll('.login-stat-val').forEach(el=>el.textContent='—');
  }
}