import api from './client';

export const assignmentsApi = {
  list: () => api.get('/assignments').then((r) => r.data.assignments),
  get: (id) => api.get(`/assignments/${id}`).then((r) => r.data),
  create: (data) => api.post('/assignments', data).then((r) => r.data),
  remove: (id) => api.delete(`/assignments/${id}`).then((r) => r.data),
  submit: (id, answers) => api.post(`/assignments/${id}/submit`, { answers }).then((r) => r.data.submission),
};

export const submissionsApi = {
  regrade: (id) => api.post(`/submissions/${id}/regrade`).then((r) => r.data.submission),
  grade: (id, data) => api.put(`/submissions/${id}/grade`, data).then((r) => r.data.submission),
};
