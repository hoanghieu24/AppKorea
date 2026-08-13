import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { classesApi } from '../api/classes';
import { assignmentsApi } from '../api/assignments';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import { apiErrorMessage } from '../api/client';

export default function ClassDetailPage() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const showToast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: cls, isLoading } = useQuery({ queryKey: ['classes', id], queryFn: () => classesApi.get(id) });
  const { data: assignments } = useQuery({ queryKey: ['assignments'], queryFn: assignmentsApi.list });

  const removeMutation = useMutation({
    mutationFn: (studentId) => classesApi.removeStudent(id, studentId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes', id] }); showToast('Đã xoá học sinh khỏi lớp', 'info'); },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  if (isLoading || !cls) return <MainLayout title="🏫 Lớp học"><Loader /></MainLayout>;

  const isOwner = user.role === 'teacher' && cls.teacherId === user.id;
  const classAssignments = (assignments || []).filter((a) => a.classId === Number(id));

  return (
    <MainLayout title={cls.name}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/classes')} style={{ marginBottom: 16 }}>← Quay lại</button>

      {cls.description && <p className="stat-label" style={{ marginBottom: 16 }}>{cls.description}</p>}

      {isOwner && (
        <div className="card" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="field-label">Mã tham gia lớp</div>
            <div className="join-code-pill" style={{ fontSize: '1.1rem' }}>🔑 {cls.joinCode}</div>
          </div>
          <Link to="/assignments/new" state={{ classId: cls.id }} className="btn btn-primary">➕ Giao bài tập mới</Link>
        </div>
      )}

      <div className="section-title">👥 Danh sách học sinh ({cls.students?.length ?? 0})</div>
      {!cls.students?.length ? (
        <EmptyState icon="👥" title="Chưa có học sinh nào trong lớp." />
      ) : (
        <div className="card">
          {cls.students.map((s) => (
            <div className="roster-row" key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <div className="stat-label">{s.email}</div>
              </div>
              {isOwner && (
                <button className="btn btn-ghost btn-xs" onClick={() => removeMutation.mutate(s.id)}>Xoá</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="section-title">📑 Bài tập của lớp</div>
      {!classAssignments.length ? (
        <EmptyState icon="📑" title="Lớp chưa có bài tập nào." />
      ) : (
        <div className="card-grid">
          {classAssignments.map((a) => (
            <Link to={`/assignments/${a.id}`} key={a.id} className="assignment-item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="assignment-title">{a.title}</div>
              {a.stats && <div className="assignment-meta">✅ {a.stats.graded}/{a.stats.total} đã chấm</div>}
            </Link>
          ))}
        </div>
      )}
    </MainLayout>
  );
}
