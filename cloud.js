import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://nnssdqtoemwdjaikusyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uc3NkcXRvZW13ZGphaWt1c3liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTU0MDQsImV4cCI6MjA4OTYzMTQwNH0.Oqq_NfJVYz1woaF0cgKi85H40KVWg6qkZGi2jFQG6Pc';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getStoreId() {
  try {
    const s = sessionStorage.getItem('current_store') || localStorage.getItem('current_store');
    return String(window.__store_id || s || 'koeln').toLowerCase();
  } catch (e) {
    return String(window.__store_id || 'koeln').toLowerCase();
  }
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

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function uploadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  if (!hasLocalDataForStore(storeId)) {
    throw new Error(`Keine lokalen Daten für ${storeId} gefunden. Upload abgebrochen.`);
  }
  const state = collectStoreState(storeId);
  const row = { store_id: storeId, state: state, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('app_state').upsert(row, { onConflict: 'store_id' });
  if (error) throw error;
  return true;
}

async function downloadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const { data, error } = await supabase.from('app_state').select('state').eq('store_id', storeId).maybeSingle();
  if (error) throw error;
  if (data && data.state) applyStoreState(data.state);
  return !!(data && data.state);
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
  setText('cloudStatus', isLoggedIn ? `Angemeldet: ${session.user?.email || ''}` : 'Nicht angemeldet');
  setVisible('cloudLoginRow', !isLoggedIn);
  setVisible('cloudLoggedInRow', isLoggedIn);
  setVisible('cloudActionsRow', isLoggedIn);
}

function bindCloudUI() {
  const loginBtn = document.getElementById('cloudLoginBtn');
  const logoutBtn = document.getElementById('cloudLogoutBtn');
  const uploadStoreBtn = document.getElementById('cloudUploadStoreBtn');
  const downloadStoreBtn = document.getElementById('cloudDownloadStoreBtn');
  const uploadAllBtn = document.getElementById('cloudUploadAllBtn');
  const downloadAllBtn = document.getElementById('cloudDownloadAllBtn');
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
        await signIn(email, password);
        setOk('Angemeldet.');
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

  if (uploadStoreBtn) {
    uploadStoreBtn.addEventListener('click', async () => {
      setErr('');
      setOk('');
      try {
        const storeId = getStoreId();
        await uploadStore(storeId);
        setOk(`Hochgeladen: ${storeId}.`);
      } catch (e) {
        setErr(e && e.message ? e.message : 'Upload fehlgeschlagen.');
      }
    });
  }

  if (downloadStoreBtn) {
    downloadStoreBtn.addEventListener('click', async () => {
      setErr('');
      setOk('');
      try {
        const storeId = getStoreId();
        const found = await downloadStore(storeId);
        setOk(found ? `Geladen: ${storeId}.` : `Keine Cloud-Daten für ${storeId} gefunden.`);
      } catch (e) {
        setErr(e && e.message ? e.message : 'Download fehlgeschlagen.');
      }
    });
  }

  if (uploadAllBtn) {
    uploadAllBtn.addEventListener('click', async () => {
      setErr('');
      setOk('');
      try {
        await uploadAllStores();
        setOk('Hochgeladen: Köln und Bonn.');
      } catch (e) {
        setErr(e && e.message ? e.message : 'Upload fehlgeschlagen.');
      }
    });
  }

  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      setErr('');
      setOk('');
      try {
        await downloadAllStores();
        setOk('Geladen: Köln und Bonn.');
      } catch (e) {
        setErr(e && e.message ? e.message : 'Download fehlgeschlagen.');
      }
    });
  }

  supabase.auth.onAuthStateChange(() => {
    refreshCloudUI();
  });
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
