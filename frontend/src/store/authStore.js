import { create } from 'zustand';

const STORAGE_KEY = 'hq_auth';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

const persisted = loadPersisted();

export const useAuthStore = create((set) => ({
  token: persisted.token,
  user: persisted.user,

  login: (token, user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  },

  updateUser: (user) => {
    set((state) => {
      const next = { token: state.token, user };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { user };
    });
  },
}));
