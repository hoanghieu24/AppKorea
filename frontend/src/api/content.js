import api from './client';

export const lessonsApi = {
  list: () => api.get('/lessons').then((r) => r.data.lessons),
  create: (data) => api.post('/lessons', data).then((r) => r.data.lesson),
  remove: (id) => api.delete(`/lessons/${id}`).then((r) => r.data),
};

export const wordsApi = {
  list: (lessonId) => api.get('/words', { params: lessonId ? { lessonId } : {} }).then((r) => r.data.words),
  create: (data) => api.post('/words', data).then((r) => r.data.word),
  remove: (id) => api.delete(`/words/${id}`).then((r) => r.data),
  updateProgress: (id, data) => api.put(`/words/${id}/progress`, data).then((r) => r.data.progress),
};

export const grammarApi = {
  list: () => api.get('/grammar').then((r) => r.data.grammar),
  create: (data) => api.post('/grammar', data).then((r) => r.data.grammar),
  remove: (id) => api.delete(`/grammar/${id}`).then((r) => r.data),
};
