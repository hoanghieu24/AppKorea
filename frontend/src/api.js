const SESSION_KEY = 'hanquoc_classroom_session';
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let accessToken = '';
let refreshPromise = null;

function readStoredSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!parsed) return null;

    // Tự migrate session bản cũ: lấy JWT vào RAM một lần rồi xóa khỏi localStorage.
    if (parsed.token && !accessToken) accessToken = String(parsed.token);
    const clean = parsed.user ? { user: parsed.user } : null;
    if (clean) localStorage.setItem(SESSION_KEY, JSON.stringify(clean));
    else localStorage.removeItem(SESSION_KEY);
    return clean;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function getSession() {
  return readStoredSession();
}

export function saveSession(session) {
  if (session?.token) accessToken = String(session.token);
  const clean = session?.user ? { user: session.user } : null;
  if (clean) localStorage.setItem(SESSION_KEY, JSON.stringify(clean));
  else localStorage.removeItem(SESSION_KEY);
  return clean;
}

export function clearSession() {
  accessToken = '';
  localStorage.removeItem(SESSION_KEY);
}

export function appToast(message, type = 'success') {
  if (typeof window !== 'undefined' && message) window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }));
}

async function rawRequest(path, options = {}, token = accessToken) {
  const { toast: _toast, _retried: _ignored, ...fetchOptions } = options;
  return fetch(`${API_BASE}/api${path}`, {
    ...fetchOptions,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchOptions.headers || {}),
    },
  });
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const doRefresh = async () => {
      const response = await rawRequest('/auth/refresh', { method: 'POST', toast: false }, '');
      const data = await response.json().catch(() => ({}));
      return { response, data };
    };

    let { response, data } = await doRefresh();

    // Hai tab có thể cùng dùng refresh cookie cũ. Tab thắng sẽ rotate cookie; tab còn lại
    // thử lại một lần ngắn sau đó để nhận cookie mới thay vì tự đăng xuất người dùng.
    if (response.status === 401 && readStoredSession()?.user) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      ({ response, data } = await doRefresh());
    }

    if (!response.ok || !data.token || !data.user) {
      clearSession();
      throw new Error(data.message || 'Phiên đăng nhập đã hết hạn.');
    }
    accessToken = String(data.token);
    const session = saveSession(data);
    return { ...data, ...session };
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function bootstrapSession() {
  const stored = readStoredSession();
  if (!stored?.user) return null;

  // Nếu vừa nâng cấp từ bản cũ và vẫn còn access token trong RAM, dùng nó để cấp refresh cookie mới.
  if (accessToken) {
    try {
      const meResponse = await rawRequest('/auth/me', { method: 'GET', toast: false });
      const meData = await meResponse.json().catch(() => ({}));
      if (meResponse.ok && meData.user) {
        const sessionResponse = await rawRequest('/auth/session', { method: 'POST', toast: false });
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json().catch(() => ({}));
          if (sessionData.token) accessToken = String(sessionData.token);
        }
        return saveSession({ user: meData.user, token: accessToken });
      }
    } catch {
      // Chuyển qua refresh cookie bên dưới.
    }
  }

  try {
    const refreshed = await refreshAccessToken();
    return saveSession(refreshed);
  } catch {
    clearSession();
    return null;
  }
}

export async function logoutSession() {
  try {
    await rawRequest('/auth/logout', { method: 'POST', toast: false }, accessToken);
  } catch {
    // Logout phía client vẫn phải hoàn tất nếu mạng/server lỗi.
  } finally {
    clearSession();
  }
}

export async function api(path, options = {}) {
  const { toast = true, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  let response = await rawRequest(path, fetchOptions);
  const canRefresh = response.status === 401
    && !['/auth/login', '/auth/refresh', '/auth/logout'].includes(path)
    && !fetchOptions._retried;

  if (canRefresh) {
    try {
      await refreshAccessToken();
      response = await rawRequest(path, { ...fetchOptions, _retried: true });
    } catch {
      // Giữ response 401 ban đầu, đoạn dưới sẽ xử lý và xóa session.
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSession();
    if (toast && isMutation) appToast(data.message || `HTTP ${response.status}`, 'error');
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    error.requestId = data.requestId;
    throw error;
  }

  if (data?.token) accessToken = String(data.token);
  if (toast && isMutation) appToast(data.message || 'Thao tác đã hoàn thành.', 'success');
  return data;
}

export const formatDate = (value) => {
  if (!value) return 'Không giới hạn';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
};

export const roleLabel = { ADMIN: 'Quản trị viên', TEACHER: 'Giáo viên', STUDENT: 'Học sinh' };
