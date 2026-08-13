import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, clearSession, getSession } from './api.js';
import Shell from './components/Shell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AssignmentsPage from './pages/AssignmentsPage.jsx';
import AssignmentDetailPage from './pages/AssignmentDetailPage.jsx';
import VocabularyPage from './pages/VocabularyPage.jsx';
import LearningHubPage from './pages/LearningHubPage.jsx';
import AdminSettingsPage from './pages/AdminSettingsPage.jsx';
import AdminManagementPage from './pages/AdminManagementPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import TeacherStudentsPage from './pages/TeacherStudentsPage.jsx';

export default function App() {
  const [session, setSession] = useState(() => getSession());
  const [checking, setChecking] = useState(Boolean(session?.token));
  const location = useLocation();

  useEffect(() => {
    if (!session?.token) { setChecking(false); return; }
    api('/auth/me')
      .then(({ user }) => setSession((current) => ({ ...current, user })))
      .catch(() => { clearSession(); setSession(null); })
      .finally(() => setChecking(false));
  }, [session?.token]);

  if (checking) return <div className="app-loader"><div className="loader-logo">한</div><p>Đang mở lớp học...</p></div>;
  if (!session?.user) return <Routes><Route path="/login" element={<LoginPage onLogin={setSession} />} /><Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} /></Routes>;

  const user = session.user;
  return (
    <Shell user={user} onLogout={() => setSession(null)}>
      <Routes>
        <Route path="/" element={<DashboardPage user={user} />} />
        <Route path="/assignments" element={user.role === 'ADMIN' ? <Navigate to="/" replace /> : <AssignmentsPage user={user} />} />
        <Route path="/assignments/:id" element={user.role === 'ADMIN' ? <Navigate to="/" replace /> : <AssignmentDetailPage user={user} />} />
        <Route path="/vocabulary" element={user.role === 'ADMIN' ? <Navigate to="/" replace /> : <VocabularyPage user={user} />} />
        <Route path="/learning" element={user.role === 'ADMIN' ? <Navigate to="/" replace /> : <LearningHubPage user={user} />} />
        <Route path="/settings" element={user.role === 'ADMIN' ? <AdminSettingsPage /> : <Navigate to="/" replace />} />
        <Route path="/admin/classes" element={user.role === 'ADMIN' ? <AdminManagementPage mode="classes" currentUser={user} /> : <Navigate to="/" replace />} />
        <Route path="/admin/students" element={user.role === 'ADMIN' ? <AdminManagementPage mode="students" currentUser={user} /> : <Navigate to="/" replace />} />
        <Route path="/admin/teachers" element={user.role === 'ADMIN' ? <AdminManagementPage mode="teachers" currentUser={user} /> : <Navigate to="/" replace />} />
        <Route path="/admin/users" element={user.role === 'ADMIN' ? <AdminManagementPage mode="users" currentUser={user} /> : <Navigate to="/" replace />} />
        <Route path="/teacher/students" element={user.role === 'TEACHER' ? <TeacherStudentsPage user={user} /> : <Navigate to="/" replace />} />
        <Route path="/notifications" element={<NotificationsPage user={user} />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
