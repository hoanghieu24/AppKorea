import api from './client';

export const classesApi = {
  list: () => api.get('/classes').then((r) => r.data.classes),
  get: (id) => api.get(`/classes/${id}`).then((r) => r.data.class),
  create: (data) => api.post('/classes', data).then((r) => r.data.class),
  join: (joinCode) => api.post('/classes/join', { joinCode }).then((r) => r.data),
  removeStudent: (classId, studentId) =>
    api.delete(`/classes/${classId}/students/${studentId}`).then((r) => r.data),
};
