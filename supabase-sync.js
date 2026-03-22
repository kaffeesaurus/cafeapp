const SUPABASE_URL = 'https://nnssdqtoemwdjaikusyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uc3NkcXRvZW13ZGphaWt1c3liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTU0MDQsImV4cCI6MjA4OTYzMTQwNH0.Oqq_NfJVYz1woaF0cgKi85H40KVWg6qkZGi2jFQG6Pc';

(function () {
  const SESSION_STORAGE_KEY = 'cloud_supabase_session_v1';
  const SYNC_ENABLED_KEY = 'cloud_sync_enabled_v1';

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

  function nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  function getStoreFromURL() {
    try {
      const params = new URLSearchParams(location.search);
      let s = params.get('store');
      if (!s && location.hash) {
        const m = location.hash.match(/store=([a-z0-9_-]+)/i) || location.hash.match(/^#([a-z0-9_-]+)/i);
        if (m) s = m[1];
      }
      s = s ? s.toLowerCase() : null;
      if (s && !/^[a-z0-9_-]+$/.test(s)) s = null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function getStoreId() {
    const urlStore = getStoreFromURL();
    if (urlStore) return urlStore;
    try {
      const stored = sessionStorage.getItem('current_store') || localStorage.getItem('current_store');
      return String(stored || 'koeln').toLowerCase();
    } catch (e) {
      return 'koeln';
    }
  }

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

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
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
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (e) {}
  }

  function refreshSessionSync(session) {
    try {
      if (!session || !session.refresh_token) return session;
      const exp = session.expires_at;
      if (typeof exp === 'number' && exp - nowSeconds() > 60) return session;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, false);
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ refresh_token: session.refresh_token }));
      if (xhr.status < 200 || xhr.status >= 300) return session;

      const data = JSON.parse(xhr.responseText || '{}');
      if (!data || !data.access_token) return session;
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
    } catch (e) {
      return session;
    }
  }

  function getAccessTokenSync() {
    const s = loadSession();
    if (!s || !s.access_token) return null;
    const next = refreshSessionSync(s);
    return next && next.access_token ? next.access_token : null;
  }

  function getStateFromCloudSync(storeId, accessToken) {
    const encoded = encodeURIComponent(storeId);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${SUPABASE_URL}/rest/v1/app_state?select=state&store_id=eq.${encoded}&limit=1`, false);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.send(null);
    if (xhr.status === 404) return null;
    if (xhr.status < 200 || xhr.status >= 300) {
      const msg = (xhr.responseText || '').trim();
      throw new Error(msg || `HTTP ${xhr.status}`);
    }
    const rows = JSON.parse(xhr.responseText || '[]');
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return row && row.state ? row.state : null;
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

  async function replaceAppStateRow(storeId, accessToken, state) {
    const encoded = encodeURIComponent(storeId);
    await fetch(`${SUPABASE_URL}/rest/v1/app_state?store_id=eq.${encoded}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });

    const row = { store_id: storeId, state: state, updated_at: new Date().toISOString() };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_state`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });

    if (res.ok) return true;

    const txt = await res.text().catch(() => '');
    if (String(txt || '').toLowerCase().includes('duplicate')) {
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/app_state?store_id=eq.${encoded}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(row)
      });
      if (!res2.ok) throw new Error((await res2.text().catch(() => '')) || `HTTP ${res2.status}`);
      return true;
    }

    throw new Error(txt || `HTTP ${res.status}`);
  }

  function isOnHubPage() {
    const p = (location.pathname.split('/').pop() || '').toLowerCase();
    return p === 'hub.html' || p === '';
  }

  function isSyncEnabled() {
    try {
      const v = localStorage.getItem(SYNC_ENABLED_KEY);
      if (v === null || v === undefined) return '1';
      return String(v) !== '0';
    } catch (e) {
      return true;
    }
  }

  function enableSyncPermanently() {
    try {
      localStorage.setItem(SYNC_ENABLED_KEY, '1');
    } catch (e) {}
  }

  function init() {
    if (!isSyncEnabled()) return;

    const storeId = getStoreId();
    const accessToken = getAccessTokenSync();
    if (!accessToken) {
      if (!isOnHubPage()) {
        try {
          alert('Bitte im Hub unter "Cloud-Speicher" anmelden.');
        } catch (e) {}
        location.replace(`hub.html?store=${encodeURIComponent(storeId)}`);
      }
      return;
    }

    const keySetArr = storeKeySetFor(storeId);
    const keySet = new Set(keySetArr);
    const virtual = new Map();

    const origSet = localStorage.setItem.bind(localStorage);
    const origGet = localStorage.getItem.bind(localStorage);
    const origRem = localStorage.removeItem.bind(localStorage);
    const origClear = localStorage.clear ? localStorage.clear.bind(localStorage) : null;
    const origKey = localStorage.key ? localStorage.key.bind(localStorage) : null;
    const origLengthDesc =
      (function () {
        try {
          return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(localStorage), 'length') || null;
        } catch (e) {
          return null;
        }
      })();

    let muted = false;

    let uploadTimer = null;
    let uploading = false;
    let pending = false;

    async function uploadNow() {
      if (uploading) {
        pending = true;
        return;
      }
      uploading = true;
      pending = false;
      try {
        const token = getAccessTokenSync();
        if (!token) return;
        const state = collectStoreState(storeId);
        await replaceAppStateRow(storeId, token, state);
      } catch (e) {
        try {
          console.error(e);
        } catch (e2) {}
      } finally {
        uploading = false;
        if (pending) scheduleUpload();
      }
    }

    function scheduleUpload() {
      if (uploadTimer) clearTimeout(uploadTimer);
      uploadTimer = setTimeout(() => {
        uploadTimer = null;
        uploadNow();
      }, 1200);
    }

    muted = true;
    try {
      const state = getStateFromCloudSync(storeId, accessToken);
      const keysObj = state && state.keys && typeof state.keys === 'object' ? state.keys : {};
      keySetArr.forEach(k => {
        if (Object.prototype.hasOwnProperty.call(keysObj, k)) {
          virtual.set(k, String(keysObj[k]));
        } else {
          virtual.delete(k);
        }
      });
    } catch (e) {
      try {
        console.error(e);
      } catch (e2) {}
    } finally {
      muted = false;
    }

    function combinedKeys() {
      const real = [];
      try {
        const realLen = origLengthDesc && typeof origLengthDesc.get === 'function' ? origLengthDesc.get.call(localStorage) : 0;
        for (let i = 0; i < realLen; i++) {
          if (!origKey) break;
          const k = origKey(i);
          if (k) real.push(k);
        }
      } catch (e) {}

      const virt = Array.from(virtual.keys());
      const set = new Set();
      const out = [];
      real.concat(virt).forEach(k => {
        const ks = String(k);
        if (set.has(ks)) return;
        set.add(ks);
        out.push(ks);
      });
      return out;
    }

    localStorage.getItem = function (k) {
      const key = String(k);
      if (keySet.has(key)) return virtual.has(key) ? virtual.get(key) : null;
      return origGet(key);
    };
    localStorage.setItem = function (k, v) {
      const key = String(k);
      if (keySet.has(key)) {
        virtual.set(key, String(v));
        if (!muted) scheduleUpload();
        return;
      }
      return origSet(key, v);
    };
    localStorage.removeItem = function (k) {
      const key = String(k);
      if (keySet.has(key)) {
        virtual.delete(key);
        if (!muted) scheduleUpload();
        return;
      }
      return origRem(key);
    };
    if (origClear) {
      localStorage.clear = function () {
        virtual.clear();
        const res = origClear();
        if (!muted) scheduleUpload();
        return res;
      };
    }
    if (origKey) {
      localStorage.key = function (i) {
        const all = combinedKeys();
        const idx = Number(i);
        if (!Number.isFinite(idx) || idx < 0) return null;
        return idx < all.length ? all[idx] : null;
      };
    }
    try {
      Object.defineProperty(localStorage, 'length', {
        configurable: true,
        enumerable: true,
        get: function () {
          return combinedKeys().length;
        }
      });
    } catch (e) {}

    enableSyncPermanently();
    window.__cloud_sync_store = storeId;
  }

  try {
    init();
  } catch (e) {
    try {
      console.error(e);
    } catch (e2) {}
  }
})();
