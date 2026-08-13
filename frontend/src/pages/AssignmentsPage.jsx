import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { assignmentsApi } from '../api/assignments';
import { useAuthStore } from '../store/authStore';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';

const STATUS_LABEL = { pending: 'Chưa làm', submitted: 'Đã nộp', graded: 'Đã chấm' };

export default function AssignmentsPage() {
  const { user } = useAuthStore();
  const isTeacher = user.role === 'teacher';
  const { data: assignments, isLoading } = useQuery({ queryKey: ['assignments'], queryFn: assignmentsApi.list });

  return (
    <MainLayout title="📑 Bài tập">
      {isTeacher && (
        <div style={{ marginBottom: 20 }}>
          <Link to="/assignments/new" className="btn btn-primary">➕ Giao bài tập mới</Link>
        </div>
      )}

      {isLoading ? <Loader /> : !assignments?.length ? (
        <EmptyState
          icon="📑"
          title={isTeacher ? 'Bạn chưa giao bài tập nào.' : 'Bạn chưa được giao bài tập nào.'}
          action={!isTeacher && <Link to="/classes" className="btn btn-primary btn-sm">Tham gia lớp học</Link>}
        />
      ) : (
        <div className="card-grid">
          {assignments.map((a) => {
            const status = isTeacher ? null : (a.mySubmission?.status || 'pending');
            return (
              <Link to={`/assignments/${a.id}`} key={a.id} className="assignment-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="assignment-top">
                  <div className="assignment-title">{a.title}</div>
                  {isTeacher ? (
                    <span className="status-pill status-graded">✅ {a.stats.graded}/{a.stats.total}</span>
                  ) : (
                    <span className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</span>
                  )}
                </div>
                {a.description && <p className="stat-label">{a.description}</p>}
                <div className="assignment-meta">
                  {isTeacher ? <span>📤 {a.stats.submitted}/{a.stats.total} đã nộp</span> : <span>👩‍🏫 {a.teacher?.name}</span>}
                  {a.dueDate && <span>⏰ Hạn: {new Date(a.dueDate).toLocaleDateString('vi-VN')}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </MainLayout>
  );
}
