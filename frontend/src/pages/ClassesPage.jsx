import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { classesApi } from '../api/classes';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { apiErrorMessage } from '../api/client';

export default function ClassesPage() {
  const { user } = useAuthStore();
  const showToast = useToast();
  const qc = useQueryClient();
  const isTeacher = user.role === 'teacher';

  const { data: classes, isLoading } = useQuery({ queryKey: ['classes'], queryFn: classesApi.list });

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const createMutation = useMutation({
    mutationFn: classesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] });
      showToast('✅ Đã tạo lớp học', 'success');
      setName(''); setDesc(''); setShowCreate(false);
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  const joinMutation = useMutation({
    mutationFn: classesApi.join,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['classes'] });
      showToast(`✅ ${res.message}`, 'success');
      setJoinCode('');
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  return (
    <MainLayout title="🏫 Lớp học">
      {isTeacher ? (
        <div className="card" style={{ marginBottom: 24 }}>
          {!showCreate ? (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>➕ Tạo lớp mới</button>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ name, description: desc }); }}>
              <div className="form-row">
                <div>
                  <label className="field-label">Tên lớp *</label>
                  <input required className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Lớp Hàn Cơ Bản A1" />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="field-label">Mô tả (tuỳ chọn)</label>
                <input className="settings-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Lớp học buổi tối thứ 3-5" />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Đang tạo...' : '💾 Tạo lớp'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Huỷ</button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 24 }}>
          <label className="field-label">Tham gia lớp bằng mã</label>
          <form onSubmit={(e) => { e.preventDefault(); joinMutation.mutate(joinCode); }} className="api-key-row" style={{ display: 'flex', gap: 10 }}>
            <input
              className="settings-input" value={joinCode} placeholder="VD: DEMO01"
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase', letterSpacing: 1 }}
            />
            <button className="btn btn-primary" disabled={joinMutation.isPending || !joinCode}>
              {joinMutation.isPending ? 'Đang vào...' : '🚪 Tham gia'}
            </button>
          </form>
        </div>
      )}

      {isLoading ? <Loader /> : !classes?.length ? (
        <EmptyState icon="🏫" title={isTeacher ? 'Bạn chưa tạo lớp nào.' : 'Bạn chưa tham gia lớp nào.'} />
      ) : (
        <div className="card-grid">
          {classes.map((c) => (
            <Link to={`/classes/${c.id}`} key={c.id} className="card class-card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="class-card-top">
                <div className="class-card-name">{c.name}</div>
              </div>
              {c.description && <p className="stat-label">{c.description}</p>}
              {isTeacher ? (
                <>
                  <div className="stat-label">👥 {c.students?.length ?? 0} học sinh</div>
                  <div className="join-code-pill">🔑 {c.joinCode}</div>
                </>
              ) : (
                <div className="stat-label">👩‍🏫 GV: {c.teacher?.name}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </MainLayout>
  );
}
