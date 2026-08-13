import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import WordsPage from './pages/WordsPage';
import FlashcardPage from './pages/FlashcardPage';
import QuizPage from './pages/QuizPage';
import ClassesPage from './pages/ClassesPage';
import ClassDetailPage from './pages/ClassDetailPage';
import AssignmentsPage from './pages/AssignmentsPage';
import CreateAssignmentPage from './pages/CreateAssignmentPage';
import AssignmentDetailPage from './pages/AssignmentDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
        <Route path="/words" element={<ProtectedRoute><WordsPage /></ProtectedRoute>} />
        <Route path="/flashcard" element={<ProtectedRoute><FlashcardPage /></ProtectedRoute>} />
        <Route path="/quiz" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} />
        <Route path="/classes" element={<ProtectedRoute><ClassesPage /></ProtectedRoute>} />
        <Route path="/classes/:id" element={<ProtectedRoute><ClassDetailPage /></ProtectedRoute>} />
        <Route path="/assignments" element={<ProtectedRoute><AssignmentsPage /></ProtectedRoute>} />
        <Route path="/assignments/new" element={<ProtectedRoute role="teacher"><CreateAssignmentPage /></ProtectedRoute>} />
        <Route path="/assignments/:id" element={<ProtectedRoute><AssignmentDetailPage /></ProtectedRoute>} />

        <Route path="*" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
