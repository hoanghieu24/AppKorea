import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api` : '/api',
});

// Gắn token vào mọi request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

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

export function apiErrorMessage(err) {
  return err?.response?.data?.message || 'Đã có lỗi xảy ra, vui lòng thử lại.';
}

export default api;
