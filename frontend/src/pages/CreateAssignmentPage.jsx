import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { classesApi } from '../api/classes';
import { lessonsApi } from '../api/content';
import { assignmentsApi } from '../api/assignments';
import { useToast } from '../components/Toast';
import { apiErrorMessage } from '../api/client';

const SOURCES = [
  { value: 'vocab', label: '📖 Từ vựng đã học' },
  { value: 'grammar', label: '📐 Cấu trúc ngữ pháp' },
  { value: 'topik', label: '📝 Kiểu đề TOPIK' },
  { value: 'manual', label: '✍️ Tự soạn câu hỏi' },
];
const DIFFICULTIES = [
  { value: 'easy', label: 'Dễ' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'hard', label: 'Khó' },
];

export default function CreateAssignmentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const preselectedClassId = location.state?.classId || '';

  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: classesApi.list });
  const { data: lessons } = useQuery({ queryKey: ['lessons'], queryFn: lessonsApi.list });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classId, setClassId] = useState(preselectedClassId);
  const [source, setSource] = useState('vocab');
  const [difficulty, setDifficulty] = useState('medium');
  const [count, setCount] = useState(6);
  const [lessonId, setLessonId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [manualQuestions, setManualQuestions] = useState([{ prompt: '', hint: '' }]);

  const useAI = source !== 'manual';

  const createMutation = useMutation({
    mutationFn: assignmentsApi.create,
    onSuccess: (res) => {
      showToast(`✅ Đã giao bài cho ${res.assignedCount} học sinh`, 'success');
      navigate(`/assignments/${res.assignment.id}`);
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  function updateQuestion(i, field, value) {
    setManualQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, [field]: value } : q)));
  }
  function addQuestion() {
    setManualQuestions((qs) => [...qs, { prompt: '', hint: '' }]);
  }
  function removeQuestion(i) {
    setManualQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!classId) return showToast('Vui lòng chọn lớp để giao bài.', 'error');

    const payload = {
      title: title || undefined,
      description,
      classId: Number(classId),
      source,
      difficulty,
      lessonId: lessonId || null,
      dueDate: dueDate || null,
      useAI,
    };
    if (useAI) {
      payload.count = count;
    } else {
      const qs = manualQuestions.filter((q) => q.prompt.trim()).map((q, i) => ({ id: i + 1, prompt: q.prompt, hint: q.hint }));
      if (!title) return showToast('Vui lòng nhập tiêu đề bài tập.', 'error');
      if (!qs.length) return showToast('Vui lòng nhập ít nhất 1 câu hỏi.', 'error');
      payload.questions = qs;
    }
    createMutation.mutate(payload);
  }

  return (
    <MainLayout title="➕ Giao bài tập mới">
      <form onSubmit={handleSubmit} style={{ maxWidth: 680 }}>
        <div className="card" style={{ marginBottom: 18 }}>
          <label className="field-label">Giao cho lớp *</label>
          <select required className="settings-select" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">-- Chọn lớp --</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.students?.length ?? 0} học sinh)</option>)}
          </select>

          <div className="form-row" style={{ marginTop: 14 }}>
            <div>
              <label className="field-label">Nguồn đề bài</label>
              <select className="settings-select" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            {useAI && (
              <div>
                <label className="field-label">Độ khó</label>
                <select className="settings-select" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {useAI && (
            <div className="form-row" style={{ marginTop: 14 }}>
              <div>
                <label className="field-label">Số câu hỏi (AI tự sinh)</label>
                <input type="number" min={3} max={20} className="settings-input" value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
              <div>
                <label className="field-label">Giới hạn theo bài học (tuỳ chọn)</label>
                <select className="settings-select" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
                  <option value="">Tất cả từ vựng</option>
                  {lessons?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label className="field-label">{useAI ? 'Tiêu đề (để trống để AI tự đặt tên)' : 'Tiêu đề bài tập *'}</label>
            <input className="settings-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: BTVN Bài 3 - Mua sắm" />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">Mô tả / ghi chú cho học sinh</label>
            <input className="settings-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="VD: Hoàn thành trước Chủ nhật nhé cả lớp!" />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">Hạn nộp (tuỳ chọn)</label>
            <input type="datetime-local" className="settings-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          {useAI && (
            <p className="helper-text" style={{ marginTop: 14 }}>
              🤖 AI (Gemini) sẽ tự soạn câu hỏi dựa trên nguồn & độ khó đã chọn khi bạn bấm "Giao bài tập".
            </p>
          )}
        </div>

        {!useAI && (
          <div className="card" style={{ marginBottom: 18 }}>
            <label className="field-label" style={{ marginBottom: 10 }}>Danh sách câu hỏi</label>
            {manualQuestions.map((q, i) => (
              <div className="question-card" key={i}>
                <div className="question-num">Câu {i + 1}</div>
                <input
                  className="settings-input" placeholder="Nội dung câu hỏi / yêu cầu..."
                  value={q.prompt} onChange={(e) => updateQuestion(i, 'prompt', e.target.value)} style={{ marginBottom: 8 }}
                />
                <input
                  className="settings-input" placeholder="Gợi ý (tuỳ chọn)"
                  value={q.hint} onChange={(e) => updateQuestion(i, 'hint', e.target.value)}
                />
                {manualQuestions.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 8 }} onClick={() => removeQuestion(i)}>🗑️ Xoá câu này</button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addQuestion}>➕ Thêm câu hỏi</button>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg" disabled={createMutation.isPending}>
          {createMutation.isPending ? (useAI ? '🤖 AI đang soạn đề...' : 'Đang giao bài...') : '📤 Giao bài tập'}
        </button>
      </form>
    </MainLayout>
  );
}
