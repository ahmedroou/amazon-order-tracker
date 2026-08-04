// API Service Layer for React Native App
let BASE_URL = 'https://84.8.102.52.sslip.io';

export function getBaseUrl() {
  return BASE_URL;
}

export function setBaseUrl(url) {
  if (url) {
    BASE_URL = url.replace(/\/$/, '');
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const ApiService = {
  getStats: () => request('/api/stats'),
  getOrders: (params = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.limit) query.append('limit', params.limit);
    if (params.offset) query.append('offset', params.offset);
    return request(`/api/orders?${query.toString()}`);
  },
  getOrderDetail: (id) => request(`/api/orders/${id}`),
  updateOrder: (id, payload) => request(`/api/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  deleteOrder: (id) => request(`/api/orders/${id}`, { method: 'DELETE' }),
  
  getAnalytics: (period = 'all', search = '') => {
    const query = new URLSearchParams({ period });
    if (search) query.append('search', search);
    return request(`/api/analytics?${query.toString()}`);
  },
  
  exportOrdersUrl: () => `${BASE_URL}/api/orders/export`,
  
  triggerSync: () => request('/api/sync', { method: 'POST' }),
  triggerAISync: () => request('/api/sync/ai', { method: 'POST' }),
  getSyncStatus: () => request('/api/sync/status'),
  
  getAccounts: () => request('/api/accounts'),
  deleteAccount: (id) => request(`/api/accounts/${id}`, { method: 'DELETE' }),
};
