const SESSION_KEY = 'hanquoc_classroom_session';

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function appToast(message, type = 'success') {
  if (typeof window !== 'undefined' && message) window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }));
}

export async function api(path, options = {}) {
  const session = getSession();
  const { toast = true, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const response = await fetch(`/api${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(fetchOptions.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (toast && isMutation) appToast(data.message || `HTTP ${response.status}`, 'error');
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (toast && isMutation) appToast(data.message || 'Thao tác đã hoàn thành.', 'success');
  return data;
}

export const formatDate = (value) => {
  if (!value) return 'Không giới hạn';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
};

export const roleLabel = { ADMIN: 'Quản trị viên', TEACHER: 'Giáo viên', STUDENT: 'Học sinh' };
