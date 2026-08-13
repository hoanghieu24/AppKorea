import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Clock3, FilePlus2, Plus, School, Send, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

const freshQuestion = () => ({ type: 'MULTIPLE_CHOICE', prompt: '', optionsText: '', correctAnswer: '', explanation: '', topic: 'Từ vựng', points: 1 });

export default function AssignmentsPage({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClassId = user.role === 'TEACHER' ? searchParams.get('classId') || '' : '';
  const [assignments, setAssignments] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [studentFilter, setStudentFilter] = useState('PENDING');
  const [classes, setClasses] = useState([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ classId: '', type: 'HOMEWORK', title: '', instructions: '', dueAt: '', timeLimitMinutes: '', questions: [freshQuestion()], publishNow: true });

  const load = async () => {
    setListLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '8' });
    if (selectedClassId) params.set('classId', selectedClassId);
    if (user.role === 'STUDENT') params.set('view', studentFilter);
    const assignmentPath = `/assignments?${params.toString()}`;
    const [assignmentData, classData] = await Promise.all([api(assignmentPath), api('/classes')]);
    setAssignments(assignmentData.assignments); setPagination(assignmentData.pagination); setClasses(classData.classes);
    setForm((old) => ({ ...old, classId: selectedClassId || old.classId || String(classData.classes[0]?.id || '') }));
    setListLoading(false);
  };
  useEffect(() => { load().catch((err) => { setMessage(err.message); setListLoading(false); }); }, [selectedClassId, page, studentFilter]);

  const updateQuestion = (index, patch) => setForm((old) => ({ ...old, questions: old.questions.map((question, i) => i === index ? { ...question, ...patch } : question) }));
  const removeQuestion = (index) => setForm((old) => ({ ...old, questions: old.questions.filter((_, i) => i !== index) }));

  const createAssignment = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      const payload = {
        classId: Number(form.classId), type: form.type, title: form.title, instructions: form.instructions,
        dueAt: form.dueAt || null, timeLimitMinutes: form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
        questions: form.questions.map((q) => ({
          type: q.type, prompt: q.prompt, correctAnswer: q.correctAnswer, explanation: q.explanation, topic: q.topic,
          points: Number(q.points), options: q.type === 'MULTIPLE_CHOICE' ? q.optionsText.split('\n').map((x) => x.trim()).filter(Boolean) : [],
        })),
      };
      const created = await api('/assignments', { method: 'POST', body: JSON.stringify(payload) });
      if (form.publishNow) await api(`/assignments/${created.id}/publish`, { method: 'POST' });
      setMessage(form.publishNow ? 'Đã tạo và giao bài cho toàn bộ học sinh trong lớp.' : created.message);
      setCreating(false); setForm({ classId: form.classId, type: 'HOMEWORK', title: '', instructions: '', dueAt: '', timeLimitMinutes: '', questions: [freshQuestion()], publishNow: true });
      await load();
    } catch (err) { setMessage(err.message); }
  };

  const publish = async (id) => {
    try { const data = await api(`/assignments/${id}/publish`, { method: 'POST' }); setMessage(data.message); await load(); }
    catch (err) { setMessage(err.message); }
  };

  if (user.role === 'STUDENT') return <StudentAssignments assignments={assignments} message={message} filter={studentFilter} setFilter={(value) => { setStudentFilter(value); setPage(1); }} pagination={pagination} page={page} setPage={setPage} loading={listLoading} />;

  const selectedClass = classes.find((item) => String(item.id) === selectedClassId);

  return <>
    <PageHeader eyebrow="GIÁO VIÊN" title="Bài tập & bài kiểm tra" subtitle={selectedClass ? `Đang xem riêng lớp ${selectedClass.name}. Bài của lớp khác không hiển thị trong danh sách này.` : 'Đang xem tất cả lớp. Mỗi bài vẫn chỉ thuộc đúng một lớp.'} action={<button className="btn primary" onClick={() => { setCreating((v) => !v); if (selectedClassId) setForm((old) => ({ ...old, classId: selectedClassId })); }}><FilePlus2 size={18} /> Tạo bài mới</button>} />
    {message && <div className="notice">{message}</div>}
    <div className="assignment-class-filter"><div><School size={17} /><span><strong>Lọc theo lớp</strong><small>Tách lộ trình và bài tập của từng lớp</small></span></div><select value={selectedClassId} onChange={(e) => { const value = e.target.value; setPage(1); setSearchParams(value ? { classId: value } : {}); }}><option value="">Tất cả lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></div>
    {creating && <form className="panel assignment-builder" onSubmit={createAssignment}>
      <div className="panel-title"><div><span>BÀI MỚI</span><h3>Soạn nội dung</h3></div><button type="button" className="btn ghost" onClick={() => setCreating(false)}>Đóng</button></div>
      <div className="form-grid three">
        <label>Lớp<select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required><option value="">Chọn lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Loại<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="HOMEWORK">Bài tập về nhà</option><option value="TEST">Bài kiểm tra</option></select></label>
        <label>Hạn nộp<input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
        <label className="span-2">Tiêu đề<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ôn tập Bài 5" required /></label>
        <label>Thời gian (phút)<input type="number" min="1" max="360" value={form.timeLimitMinutes} onChange={(e) => setForm({ ...form, timeLimitMinutes: e.target.value })} placeholder="Tùy chọn" /></label>
        <label className="span-3">Hướng dẫn<textarea rows="2" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Làm cẩn thận, kiểm tra lại trước khi nộp..." /></label>
      </div>
      <div className="question-builder-head"><div><strong>Câu hỏi</strong><span>{form.questions.length} câu</span></div><button type="button" className="btn secondary small" onClick={() => setForm({ ...form, questions: [...form.questions, freshQuestion()] })}><Plus size={16} /> Thêm câu</button></div>
      <div className="question-builder-list">
        {form.questions.map((question, index) => <div className="question-edit" key={index}>
          <div className="question-number">{index + 1}</div>
          <div className="question-edit-main">
            <div className="question-meta-row">
              <select value={question.type} onChange={(e) => updateQuestion(index, { type: e.target.value })}><option value="MULTIPLE_CHOICE">Trắc nghiệm</option><option value="SHORT_TEXT">Điền / trả lời ngắn</option><option value="ESSAY">Tự luận · AI chấm</option></select>
              <input value={question.topic} onChange={(e) => updateQuestion(index, { topic: e.target.value })} placeholder="Chủ đề: Ngữ pháp bài 5" />
              <label className="points-input"><input type="number" min="0.25" step="0.25" value={question.points} onChange={(e) => updateQuestion(index, { points: e.target.value })} /> điểm</label>
              {form.questions.length > 1 && <button type="button" className="icon-button danger" onClick={() => removeQuestion(index)}><Trash2 size={17} /></button>}
            </div>
            <textarea rows="2" value={question.prompt} onChange={(e) => updateQuestion(index, { prompt: e.target.value })} placeholder="Nội dung câu hỏi" required />
            {question.type === 'MULTIPLE_CHOICE' && <textarea rows="3" value={question.optionsText} onChange={(e) => updateQuestion(index, { optionsText: e.target.value })} placeholder={'Các lựa chọn, mỗi dòng 1 đáp án\n학교\n병원\n은행'} required />}
            <div className="answer-row"><input value={question.correctAnswer} onChange={(e) => updateQuestion(index, { correctAnswer: e.target.value })} placeholder={question.type === 'ESSAY' ? 'Đáp án tham khảo cho AI (khuyên có)' : 'Đáp án đúng · có thể dùng A||B để chấp nhận nhiều đáp án'} required={question.type !== 'ESSAY'} /><input value={question.explanation} onChange={(e) => updateQuestion(index, { explanation: e.target.value })} placeholder="Giải thích khi sai (tùy chọn)" /></div>
          </div>
        </div>)}
      </div>
      <div className="builder-actions"><label className="check-label"><input type="checkbox" checked={form.publishNow} onChange={(e) => setForm({ ...form, publishNow: e.target.checked })} /> Giao ngay cho toàn bộ học sinh</label><button className="btn primary"><Send size={17} /> {form.publishNow ? 'Tạo & giao bài' : 'Lưu bản nháp'}</button></div>
    </form>}
    <section className="panel"><div className="panel-title"><div><span>DANH SÁCH</span><h3>{selectedClass ? `Bài của lớp ${selectedClass.name}` : 'Bài của tất cả lớp'}</h3></div>{selectedClass && <span className="class-context-badge"><School size={14} /> {selectedClass.code}</span>}</div>
      {listLoading ? <Empty>Đang tải trang bài tập...</Empty> : assignments.length ? <div className="assignment-cards">{assignments.map((item) => <article className="assignment-card" key={item.id}>
        <div className={`assignment-type ${item.type.toLowerCase()}`}>{item.type === 'TEST' ? <ClipboardCheck /> : <ClipboardList />}</div>
        <div className="assignment-main"><div className="assignment-title-row"><strong>{item.title}</strong><span className={`status ${item.status.toLowerCase()}`}>{item.status === 'DRAFT' ? 'Bản nháp' : item.status === 'PUBLISHED' ? 'Đang mở' : 'Đã đóng'}</span></div><p className="assignment-class-name"><School size={14} /> Lớp: <strong>{item.className}</strong></p><div className="assignment-meta"><span><Clock3 size={15} /> {formatDate(item.due_at)}</span><span><CheckCircle2 size={15} /> {item.submittedCount || 0}/{item.studentCount || 0} đã nộp</span></div></div>
        <div className="assignment-actions">{item.status === 'DRAFT' && <button className="btn secondary small" onClick={() => publish(item.id)}><Send size={15} /> Giao bài</button>}<Link className="btn ghost small" to={`/assignments/${item.id}`}>Chi tiết</Link></div>
      </article>)}</div> : <Empty>Chưa có bài nào. Tạo bài đầu tiên nhé.</Empty>}
      <Pagination pagination={pagination} loading={listLoading} onPageChange={setPage} label="bài" />
    </section>
  </>;
}

function StudentAssignments({ assignments, message, filter, setFilter, pagination, setPage, loading }) {
  return <>
    <PageHeader eyebrow="HỌC SINH" title="Bài của tôi" subtitle="Bài mới từ giáo viên sẽ tự xuất hiện ở đây." />
    {message && <div className="notice">{message}</div>}
    <div className="segmented"><button className={filter === 'PENDING' ? 'active' : ''} onClick={() => setFilter('PENDING')}>Cần làm</button><button className={filter === 'DONE' ? 'active' : ''} onClick={() => setFilter('DONE')}>Đã nộp</button><button className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>Tất cả</button></div>
    <section className="panel">
      {loading ? <Empty>Đang tải trang bài tập...</Empty> : assignments.length ? <div className="student-assignment-grid">{assignments.map((item) => <Link className="student-assignment-card" to={`/assignments/${item.id}`} key={item.id}><div className="student-assignment-top"><span className={`type-pill ${item.type.toLowerCase()}`}>{item.type === 'TEST' ? 'Bài kiểm tra' : 'Bài tập'}</span>{item.submissionId ? <span className="score-pill">{Math.round(item.percentage)} điểm</span> : <ChevronDown size={18} />}</div><h3>{item.title}</h3><p>{item.className}</p><div className="student-assignment-bottom"><span><Clock3 size={15} /> {formatDate(item.due_at)}</span><strong>{item.submissionId ? 'Xem kết quả' : 'Làm bài →'}</strong></div></Link>)}</div> : <Empty>{filter === 'PENDING' ? 'Không còn bài đang chờ.' : 'Chưa có bài phù hợp.'}</Empty>}
      <Pagination pagination={pagination} loading={loading} onPageChange={setPage} label="bài" />
    </section>
  </>;
}
