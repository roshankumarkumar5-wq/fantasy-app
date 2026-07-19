// ============================================================
// Shared API client - handles auth token storage and requests
// ============================================================

// Change this to your deployed backend URL when hosting
const API_BASE = window.API_BASE_URL || 'http://localhost:4000/api';

const Auth = {
  getToken() {
    return localStorage.getItem('fa_token');
  },
  getUser() {
    const raw = localStorage.getItem('fa_user');
    return raw ? JSON.parse(raw) : null;
  },
  setSession(token, user) {
    localStorage.setItem('fa_token', token);
    localStorage.setItem('fa_user', JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem('fa_token');
    localStorage.removeItem('fa_user');
  },
  isLoggedIn() {
    return !!this.getToken();
  },
  isAdmin() {
    return this.getUser()?.role === 'admin';
  }
};

async function apiRequest(path, { method = 'GET', body = null, isFormData = false } = {}) {
  const headers = {};
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : null
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const Api = {
  signup: (payload) => apiRequest('/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload }),
  verifyEmail: (payload) => apiRequest('/auth/verify-email', { method: 'POST', body: payload }),
  resendCode: (payload) => apiRequest('/auth/resend-code', { method: 'POST', body: payload }),
  forgotPassword: (payload) => apiRequest('/auth/forgot-password', { method: 'POST', body: payload }),
  resetPassword: (payload) => apiRequest('/auth/reset-password', { method: 'POST', body: payload }),

  getMatches: () => apiRequest('/matches'),
  getMatch: (id) => apiRequest(`/matches/${id}`),

  submitTeam: (payload) => apiRequest('/fantasy-teams', { method: 'POST', body: payload }),
  getMyTeam: (matchId) => apiRequest(`/fantasy-teams/${matchId}`),
  getPublicLeaderboard: (matchId) => apiRequest(`/matches/${matchId}/leaderboard`),

  // Admin
  listRealTeams: () => apiRequest('/admin/teams'),
  createRealTeam: (payload) => apiRequest('/admin/teams', { method: 'POST', body: payload }),
  deleteRealTeam: (id) => apiRequest(`/admin/teams/${id}`, { method: 'DELETE' }),
  listPlayers: () => apiRequest('/admin/players'),
  createPlayer: (payload) => apiRequest('/admin/players', { method: 'POST', body: payload }),
  deletePlayer: (id) => apiRequest(`/admin/players/${id}`, { method: 'DELETE' }),
  uploadPlayersCsv: (formData) => apiRequest('/admin/players/upload-csv', { method: 'POST', body: formData, isFormData: true }),
  createMatch: (payload) => apiRequest('/admin/matches', { method: 'POST', body: payload }),
  setSpecialRules: (matchId, payload) => apiRequest(`/admin/matches/${matchId}/special-rules`, { method: 'PUT', body: payload }),
  lockMatch: (matchId) => apiRequest(`/admin/matches/${matchId}/lock`, { method: 'PUT' }),
  uploadScoresheet: (matchId, formData) => apiRequest(`/admin/matches/${matchId}/scoresheet`, { method: 'POST', body: formData, isFormData: true }),
  submitStats: (matchId, payload) => apiRequest(`/admin/matches/${matchId}/stats`, { method: 'POST', body: payload }),
  uploadStatsCsv: (matchId, formData) => apiRequest(`/admin/matches/${matchId}/stats/upload-csv`, { method: 'POST', body: formData, isFormData: true }),
  finalizeMatch: (matchId) => apiRequest(`/admin/matches/${matchId}/finalize`, { method: 'POST' }),
  getLeaderboard: (matchId) => apiRequest(`/admin/matches/${matchId}/leaderboard`),
  deleteMatch: (matchId) => apiRequest(`/admin/matches/${matchId}`, { method: 'DELETE' })
};

// Redirect to login if not authenticated - call at top of protected pages
function requireLogin() {
  if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

function requireAdminLogin() {
  if (!Auth.isLoggedIn() || !Auth.isAdmin()) {
    window.location.href = '../login.html';
  }
}

// ============================================================
// IST (Asia/Kolkata) date helpers - this app displays and
// collects all match timings in IST, regardless of the device's
// own timezone, since matches are India-based.
// ============================================================

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// Formats any stored UTC timestamp as an IST wall-clock string,
// no matter what timezone the viewer's device is set to.
function formatIST(dateStr) {
  return new Date(dateStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  }) + ' IST';
}

// Converts a <input type="datetime-local"> value (e.g. "2026-07-20T18:00"),
// which the admin enters intending it as IST wall-clock time, into the
// correct absolute UTC instant for storage - regardless of what timezone
// the admin's own browser/device happens to be set to.
function istInputToUtcIso(dateTimeLocalValue) {
  const [datePart, timePart] = dateTimeLocalValue.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const utcMillis = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS;
  return new Date(utcMillis).toISOString();
}
