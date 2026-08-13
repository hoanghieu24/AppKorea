import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { wordsApi, lessonsApi } from '../api/content';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { apiErrorMessage } from '../api/client';

const POS_OPTIONS = ['명사', '동사', '형용사', '부사', '표현'];

export default function WordsPage() {
  const { user } = useAuthStore();
  const showToast = useToast();
  const qc = useQueryClient();
  const [lessonFilter, setLessonFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ korean: '', roman: '', meaning: '', pos: '명사', example: '', exampleViet: '', tip: '', lessonId: '' });

  const { data: lessons } = useQuery({ queryKey: ['lessons'], queryFn: lessonsApi.list });
  const { data: words, isLoading } = useQuery({ queryKey: ['words'], queryFn: () => wordsApi.list() });

  const createMutation = useMutation({
    mutationFn: wordsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['words'] });
      showToast('✅ Đã thêm từ mới', 'success');
      setForm({ korean: '', roman: '', meaning: '', pos: '명사', example: '', exampleViet: '', tip: '', lessonId: '' });
      setShowForm(false);
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: wordsApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['words'] }); showToast('🗑️ Đã xoá từ', 'info'); },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  const filtered = (words || []).filter((w) => lessonFilter === 'all' || w.lessonId === Number(lessonFilter));

  return (
    <MainLayout title="📖 Từ vựng">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select className="settings-select lesson-select" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '9px 14px', borderRadius: 'var(--radius)' }} value={lessonFilter} onChange={(e) => setLessonFilter(e.target.value)}>
          <option value="all">Tất cả bài học</option>
          {lessons?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span className="card-counter">{filtered.length} từ</span>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowForm((s) => !s)}>
          {showForm ? '✕ Đóng' : '➕ Thêm từ mới'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 22 }}>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ ...form, lessonId: form.lessonId || null }); }}>
            <div className="form-row">
              <div>
                <label className="field-label">Từ tiếng Hàn *</label>
                <input required className="settings-input" value={form.korean} onChange={(e) => setForm({ ...form, korean: e.target.value })} placeholder="안녕하세요" />
              </div>
              <div>
                <label className="field-label">Phiên âm</label>
                <input className="settings-input" value={form.roman} onChange={(e) => setForm({ ...form, roman: e.target.value })} placeholder="annyeonghaseyo" />
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div>
                <label className="field-label">Nghĩa tiếng Việt *</label>
                <input required className="settings-input" value={form.meaning} onChange={(e) => setForm({ ...form, meaning: e.target.value })} placeholder="xin chào" />
              </div>
              <div>
                <label className="field-label">Từ loại</label>
                <select className="settings-select" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} value={form.pos} onChange={(e) => setForm({ ...form, pos: e.target.value })}>
                  {POS_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div>
                <label className="field-label">Bài học</label>
                <select className="settings-select" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} value={form.lessonId} onChange={(e) => setForm({ ...form, lessonId: e.target.value })}>
                  <option value="">Không thuộc bài nào</option>
                  {lessons?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="field-label">Câu ví dụ (tiếng Hàn)</label>
              <input className="settings-input" value={form.example} onChange={(e) => setForm({ ...form, example: e.target.value })} placeholder="안녕하세요! 처음 뵙겠습니다." />
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="field-label">Dịch câu ví dụ</label>
              <input className="settings-input" value={form.exampleViet} onChange={(e) => setForm({ ...form, exampleViet: e.target.value })} placeholder="Xin chào! Rất vui được gặp." />
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Đang lưu...' : '💾 Lưu từ mới'}
            </button>
          </form>
        </div>
      )}

      {isLoading ? <Loader /> : !filtered.length ? (
        <EmptyState icon="📖" title="Chưa có từ vựng nào trong bài học này." />
      ) : (
        <div className="card-grid">
          {filtered.map((w) => (
            <div className="card" key={w.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontFamily: "'Noto Sans KR',sans-serif", fontSize: '1.3rem', fontWeight: 800 }}>{w.korean}</div>
                  <div className="stat-label">{w.roman}</div>
                </div>
                <span className="word-pos">{w.pos}</span>
              </div>
              <p style={{ margin: '10px 0 4px', fontWeight: 600 }}>{w.meaning}</p>
              {w.example && <p className="stat-label" style={{ fontFamily: "'Noto Sans KR',sans-serif" }}>{w.example}</p>}
              {w.exampleViet && <p className="stat-label">{w.exampleViet}</p>}
              {w.progress?.known && <span className="status-pill status-graded" style={{ marginTop: 8, width: 'fit-content' }}>✅ Đã thuộc</span>}
              {w.ownerId === user.id && (
                <button className="btn btn-ghost btn-xs" style={{ marginTop: 10, alignSelf: 'flex-start' }} onClick={() => deleteMutation.mutate(w.id)}>🗑️ Xoá</button>
              )}
            </div>
          ))}
        </div>
      )}
    </MainLayout>
  );
}
