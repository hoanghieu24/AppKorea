import api from './client';

export const progressApi = {
  me: () => api.get('/progress/me').then((r) => r.data.stats),
  checkin: () => api.post('/progress/checkin').then((r) => r.data.stats),
  grantXP: (amount) => api.post('/progress/xp', { amount }).then((r) => r.data.stats),
};
