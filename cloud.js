(function () {
const SUPABASE_CFG={
  koeln:{url:'https://nnssdqtoemwdjaikusyb.supabase.co',anon:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uc3NkcXRvZW13ZGphaWt1c3liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTU0MDQsImV4cCI6MjA4OTYzMTQwNH0.Oqq_NfJVYz1woaF0cgKi85H40KVWg6qkZGi2jFQG6Pc'},
  bonn:{url:'https://fxbwosgfgwvhpcsyjgvr.supabase.co',anon:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4Yndvc2dmZ3d2aHBjc3lqZ3ZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTA0NDUsImV4cCI6MjA5MDQ4NjQ0NX0.QjaNB-YxkjbTl8cUt7O0tNsX-o_uv979ONtdeYgOy6I'}
};
const __cur=(function(){try{return String(getStoreId()||'koeln').toLowerCase();}catch(e){return'koeln';}})();
const SUPABASE_URL=(SUPABASE_CFG[__cur]||SUPABASE_CFG.koeln).url;
const SUPABASE_ANON_KEY=(SUPABASE_CFG[__cur]||SUPABASE_CFG.koeln).anon;

function getStoreId() {
  try {
    const s = sessionStorage.getItem('current_store') || localStorage.getItem('current_store');
    return String(window.__store_id || s || 'koeln').toLowerCase();
  } catch (e) {
    return String(window.__store_id || 'koeln').toLowerCase();
  }
}

const SESSION_STORAGE_KEY = 'cloud_supabase_session_v1';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function loadSession() {
  try {
    let raw = null;
    try {
      raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch (e) {}
    if (!raw) raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch (e) {
    return null;
  }
}

function saveSession(session) {
  try {
    if (!session) {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch (e) {}
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    const raw = JSON.stringify(session);
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, raw);
    } catch (e) {}
    localStorage.setItem(SESSION_STORAGE_KEY, raw);
  } catch (e) {}
}

function getSessionUserEmail(session) {
  if (!session) return '';
  if (session.user && session.user.email) return String(session.user.email);
  if (session.user && session.user.user_metadata && session.user.user_metadata.email) return String(session.user.user_metadata.email);
  return '';
}

async function supabaseAuthRequest(pathWithQuery, bodyObj) {
  const res = await fetch(`${SUPABASE_URL}${pathWithQuery}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyObj || {})
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && (data.error_description || data.msg || data.message || data.error) ? (data.error_description || data.msg || data.message || data.error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function refreshIfNeeded(session) {
  if (!session) return null;
  const exp = session.expires_at;
  if (!exp || typeof exp !== 'number') return session;
  if (exp - nowSeconds() > 60) return session;
  if (!session.refresh_token) return session;

  const data = await supabaseAuthRequest('/auth/v1/token?grant_type=refresh_token', {
    refresh_token: session.refresh_token
  });
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    expires_at: nowSeconds() + (data.expires_in || 0),
    user: data.user || session.user
  };
  saveSession(next);
  return next;
}

async function getSession() {
  const session = loadSession();
  if (!session) return null;
  return await refreshIfNeeded(session);
}

async function signIn(email, password) {
  const data = await supabaseAuthRequest('/auth/v1/token?grant_type=password', { email, password });
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    expires_at: nowSeconds() + (data.expires_in || 0),
    user: data.user
  };
  saveSession(session);
  return session;
}

async function signOut() {
  saveSession(null);
}

async function restRequest(method, pathWithQuery, accessToken, bodyObj) {
  const headers = {
    apikey: SUPABASE_ANON_KEY
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    headers.Prefer = 'return=minimal';
  }

  const res = await fetch(`${SUPABASE_URL}${pathWithQuery}`, {
    method,
    headers,
    body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data && (data.message || data.error || data.hint) ? (data.message || data.error || data.hint) : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (method === 'GET') {
    return await res.json().catch(() => null);
  }
  return null;
}

async function replaceAppStateRow(storeId, state) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');

  const encodedStoreId = encodeURIComponent(storeId);
  await restRequest('DELETE', `/rest/v1/app_state?store_id=eq.${encodedStoreId}`, session.access_token);

  const row = { store_id: storeId, state: state, updated_at: new Date().toISOString() };
  try {
    await restRequest('POST', '/rest/v1/app_state', session.access_token, row);
  } catch (e) {
    if (String(e && e.message || '').toLowerCase().includes('duplicate')) {
      await restRequest('PATCH', `/rest/v1/app_state?store_id=eq.${encodedStoreId}`, session.access_token, row);
      return true;
    }
    throw e;
  }
  return true;
}

const SHARED_KEYS = [
  'departments',
  'workEntries',
  'dailyCalculations',
  'tipData',
  'tipPaymentPeriods',
  'kitchenProcedureSettings',
  'spuelerProcedureSettings',
  'baristaProcedureSettings',
  'tipProcedurePeriods',
  'punctuality_enabled',
  'punctualityPeriods',
  'tipProcedureSettings',
  'accessControlSettings',
  'lockedTips'
];

const KOELN_PREFIX_KEYS = [
  'koeln_employees',
  'koeln_notes',
  'koeln_personalTipsTimeout',
  'koeln_lastWorkDate'
];

function storeKeySetFor(storeId) {
  const keys = [];
  if (storeId === 'koeln') {
    SHARED_KEYS.forEach(k => keys.push(k));
    KOELN_PREFIX_KEYS.forEach(k => keys.push(k));
    keys.push('koeln_gate_hash');
  } else {
    SHARED_KEYS.forEach(k => keys.push(`${storeId}_${k}`));
    KOELN_PREFIX_KEYS.forEach(k => keys.push(k.replace(/^koeln_/, `${storeId}_`)));
    keys.push(`${storeId}_gate_hash`);
  }
  return keys;
}

function collectStoreState(storeId) {
  const keys = storeKeySetFor(storeId);
  const values = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null && v !== undefined) values[k] = v;
    } catch (e) {}
  });
  return { version: 1, storeId, keys: values, exportedAt: new Date().toISOString() };
}

function hasLocalDataForStore(storeId) {
  const keys = storeKeySetFor(storeId);
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null && v !== undefined) return true;
    } catch (e) {}
  }
  return false;
}

function applyStoreState(state) {
  if (!state || !state.keys || typeof state.keys !== 'object') return;
  Object.entries(state.keys).forEach(([k, v]) => {
    try {
      if (v === null || v === undefined) {
        localStorage.removeItem(k);
      } else {
        localStorage.setItem(k, String(v));
      }
    } catch (e) {}
  });
}

async function uploadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  if (!hasLocalDataForStore(storeId)) {
    throw new Error(`Keine lokalen Daten für ${storeId} gefunden. Upload abgebrochen.`);
  }
  const state = collectStoreState(storeId);
  await replaceAppStateRow(storeId, state);
  return true;
}

async function downloadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const rows = await restRequest('GET', `/rest/v1/app_state?select=state&store_id=eq.${encodeURIComponent(storeId)}&limit=1`, session.access_token);
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (row && row.state) applyStoreState(row.state);
  return !!(row && row.state);
}

async function uploadAllStores() {
  const results = [];
  if (hasLocalDataForStore('koeln')) {
    await uploadStore('koeln');
    results.push('Köln');
  }
  if (hasLocalDataForStore('bonn')) {
    await uploadStore('bonn');
    results.push('Bonn');
  }
  if (results.length === 0) {
    throw new Error('Keine lokalen Daten gefunden. Upload abgebrochen.');
  }
}

async function downloadAllStores() {
  await downloadStore('koeln');
  await downloadStore('bonn');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

async function refreshCloudUI() {
  let session = null;
  try {
    session = await getSession();
  } catch (e) {}
  const isLoggedIn = !!session;
  const host=(function(){try{return new URL(SUPABASE_URL).host;}catch(e){return SUPABASE_URL;}})();
  setText('cloudStatus', isLoggedIn ? `Angemeldet: ${getSessionUserEmail(session)} (Projekt: ${host})` : `Nicht angemeldet (Projekt: ${host})`);
  setVisible('cloudLoginRow', !isLoggedIn);
  setVisible('cloudLoggedInRow', isLoggedIn);
  setVisible('cloudActionsRow', false);
}

function bindCloudUI() {
  const loginBtn = document.getElementById('cloudLoginBtn');
  const logoutBtn = document.getElementById('cloudLogoutBtn');
  const errEl = document.getElementById('cloudError');
  const okEl = document.getElementById('cloudOk');

  function setErr(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.style.display = msg ? 'block' : 'none';
  }
  function setOk(msg) {
    if (!okEl) return;
    okEl.textContent = msg || '';
    okEl.style.display = msg ? 'block' : 'none';
  }

  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      setErr('');
      setOk('');
      const email = (document.getElementById('cloudEmail')?.value || '').trim();
      const password = (document.getElementById('cloudPassword')?.value || '').trim();
      if (!email || !password) {
        setErr('Bitte E-Mail und Passwort eingeben.');
        return;
      }
      try {
        const storeId = getStoreId();
        console.log('Hub login target', { storeId, url: SUPABASE_URL });
        await signIn(email, password);
        await downloadStore(storeId);
        const host=(function(){try{return new URL(SUPABASE_URL).host;}catch(e){return SUPABASE_URL;}})();
        setOk(`Angemeldet. Cloud-Daten geladen: ${storeId}. Projekt: ${host}`);
        await refreshCloudUI();
      } catch (e) {
        setErr(e && e.message ? e.message : 'Anmeldung fehlgeschlagen.');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      setErr('');
      setOk('');
      try {
        await signOut();
        setOk('Abgemeldet.');
        await refreshCloudUI();
      } catch (e) {
        setErr(e && e.message ? e.message : 'Abmeldung fehlgeschlagen.');
      }
    });
  }
}

window.cloud = {
  signIn,
  signOut,
  getSession,
  uploadStore,
  downloadStore,
  uploadAllStores,
  downloadAllStores
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('cloudStatus')) return;
  bindCloudUI();
  await refreshCloudUI();
});
})();
