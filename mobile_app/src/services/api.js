const BASE_URL = 'https://84.8.102.52.sslip.io';

export async function fetchStats() {
  try {
    const res = await fetch(`${BASE_URL}/api/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('fetchStats error:', err);
    throw err;
  }
}

export async function fetchOrders(status = null, limit = 100, offset = 0) {
  try {
    let url = `${BASE_URL}/api/orders?limit=${limit}&offset=${offset}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('fetchOrders error:', err);
    throw err;
  }
}

export async function fetchSyncStatus() {
  try {
    const res = await fetch(`${BASE_URL}/api/sync/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('fetchSyncStatus error:', err);
    return { is_syncing: false, progress: 0, message: null };
  }
}

export async function triggerSync(aiMode = false) {
  try {
    const endpoint = aiMode ? '/api/sync/ai' : '/api/sync';
    const res = await fetch(`${BASE_URL}${endpoint}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('triggerSync error:', err);
    throw err;
  }
}

export function getExportUrl() {
  return `${BASE_URL}/api/orders/export`;
}

export async function sendChatMessage(message) {
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('sendChatMessage error:', err);
    throw err;
  }
}

export async function fetchAccounts() {
  try {
    const res = await fetch(`${BASE_URL}/api/accounts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('fetchAccounts error:', err);
    throw err;
  }
}

export async function deleteAccount(accountId) {
  try {
    const res = await fetch(`${BASE_URL}/api/accounts/${accountId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('deleteAccount error:', err);
    throw err;
  }
}

export async function syncAccountManual(accountId) {
  try {
    const res = await fetch(`${BASE_URL}/api/accounts/${accountId}/sync`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('syncAccountManual error:', err);
    throw err;
  }
}

export async function addAccount(email, displayName = '') {
  try {
    const res = await fetch(`${BASE_URL}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, display_name: displayName })
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('addAccount error:', err);
    throw err;
  }
}

export function getAddAccountUrl() {
  return `${BASE_URL}/auth/gmail`;
}

export default {
  fetchStats,
  fetchOrders,
  fetchSyncStatus,
  triggerSync,
  getExportUrl,
  sendChatMessage,
  fetchAccounts,
  deleteAccount,
  syncAccountManual,
  getAddAccountUrl,
};

