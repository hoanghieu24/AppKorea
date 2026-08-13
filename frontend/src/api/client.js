import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: '/api',
});

// Gắn token vào mọi request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Nếu token hết hạn/không hợp lệ -> đăng xuất tự động
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

// Helper lấy message lỗi tiếng Việt từ backend
export function apiErrorMessage(err) {
  return err?.response?.data?.message || 'Đã có lỗi xảy ra, vui lòng thử lại.';
}

export default api;
