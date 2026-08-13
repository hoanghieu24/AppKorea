import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import { useAuthStore } from '../store/authStore';
import { progressApi } from '../api/progress';
import { classesApi } from '../api/classes';
import { assignmentsApi } from '../api/assignments';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';

export default function HomePage() {
  const { user } = useAuthStore();
  const { data: stats } = useQuery({ queryKey: ['progress', 'me'], queryFn: progressApi.me });
  const { data: classes, isLoading: loadingClasses } = useQuery({ queryKey: ['classes'], queryFn: classesApi.list });
  const { data: assignments, isLoading: loadingAssignments } = useQuery({ queryKey: ['assignments'], queryFn: assignmentsApi.list });

  const isTeacher = user?.role === 'teacher';

  return (
    <MainLayout title={`Xin chào, ${user?.name} 👋`}>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">⭐</div>
          <div className="stat-value">{stats?.xp ?? 0}</div>
          <div className="stat-label">Điểm kinh nghiệm</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔥</div>
          <div className="stat-value">{stats?.streak ?? 0}</div>
          <div className="stat-label">Ngày liên tiếp</div>
        </div>
        {isTeacher ? (
          <>
            <div className="stat-card">
              <div className="stat-icon">🏫</div>
              <div className="stat-value">{classes?.length ?? 0}</div>
              <div className="stat-label">Lớp đang dạy</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">📑</div>
              <div className="stat-value">{assignments?.length ?? 0}</div>
              <div className="stat-label">Bài đã giao</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-icon">✅</div>
              <div className="stat-value">{stats?.totalCorrect ?? 0}</div>
              <div className="stat-label">Câu trả lời đúng</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">📑</div>
              <div className="stat-value">{assignments?.filter((a) => a.mySubmission?.status !== 'graded').length ?? 0}</div>
              <div className="stat-label">Bài chưa hoàn thành</div>
            </div>
          </>
        )}
      </div>

      {isTeacher ? (
        <>
          <div className="section-title">
            🏫 Lớp của bạn
            <Link to="/classes" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>+ Tạo lớp</Link>
          </div>
          {loadingClasses ? <Loader /> : !classes?.length ? (
            <EmptyState icon="🏫" title="Bạn chưa có lớp nào." action={<Link to="/classes" className="btn btn-primary btn-sm">Tạo lớp đầu tiên</Link>} />
          ) : (
            <div className="card-grid">
              {classes.slice(0, 3).map((c) => (
                <Link to={`/classes/${c.id}`} key={c.id} className="card class-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="class-card-name">{c.name}</div>
                  <div className="stat-label">{c.students?.length ?? 0} học sinh</div>
                  <div className="join-code-pill">🔑 {c.joinCode}</div>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="section-title">📑 Bài tập gần đây</div>
          {loadingAssignments ? <Loader /> : !assignments?.length ? (
            <EmptyState icon="📑" title="Bạn chưa được giao bài tập nào." action={<Link to="/classes" className="btn btn-primary btn-sm">Tham gia lớp học</Link>} />
          ) : (
            <div className="card-grid">
              {assignments.slice(0, 4).map((a) => (
                <Link to={`/assignments/${a.id}`} key={a.id} className="assignment-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="assignment-top">
                    <div className="assignment-title">{a.title}</div>
                    <span className={`status-pill status-${a.mySubmission?.status || 'pending'}`}>
                      {a.mySubmission?.status === 'graded' ? 'Đã chấm' : a.mySubmission?.status === 'submitted' ? 'Đã nộp' : 'Chưa làm'}
                    </span>
                  </div>
                  <div className="assignment-meta">👩‍🏫 {a.teacher?.name}</div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <div className="section-title">🚀 Học ngay</div>
      <div className="card-grid">
        <Link to="/words" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📖</div>
          <strong>Từ vựng</strong>
          <p className="stat-label" style={{ marginTop: 4 }}>Xem & thêm từ mới</p>
        </Link>
        <Link to="/flashcard" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>🃏</div>
          <strong>Flashcard</strong>
          <p className="stat-label" style={{ marginTop: 4 }}>Lật thẻ ôn từ vựng</p>
        </Link>
        <Link to="/quiz" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>❓</div>
          <strong>Trắc nghiệm</strong>
          <p className="stat-label" style={{ marginTop: 4 }}>Kiểm tra nhanh</p>
        </Link>
      </div>
    </MainLayout>
  );
}
