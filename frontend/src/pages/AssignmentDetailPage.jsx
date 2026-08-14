import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, CheckCircle2, CircleAlert, Clock3, Send, Sparkles, UserCheck, Users, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, Pagination } from '../components/Shell.jsx';

export default function AssignmentDetailPage({ user }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [answers, setAnswers] = useState({});
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reportPage, setReportPage] = useState(1);
  const [reportLoading, setReportLoading] = useState(false);

  const load = async () => {
    const detail = await api(`/assignments/${id}`); setData(detail);
    if (user.role === 'STUDENT' && !detail.submission && detail.latestAttempt) {
      setPreview(detail.latestAttempt); setAnswers(detail.latestAttempt.answers || {});
    }
  };
  useEffect(() => { load().catch((err) => setMessage(err.message)); }, [id]);
  const loadReport = async () => {
    if (user.role !== 'TEACHER') return;
    setReportLoading(true);
    try { setReport(await api(`/assignments/${id}/report?page=${reportPage}&pageSize=8`)); }
    catch (err) { setMessage(err.message); }
    finally { setReportLoading(false); }
  };
  useEffect(() => { loadReport(); }, [id, reportPage, user.role]);

  const publish = async () => {
    try { const result = await api(`/assignments/${id}/publish`, { method: 'POST' }); setMessage(result.message); await load(); await loadReport(); }
    catch (err) { setMessage(err.message); }
  };
  const setAnswer = (questionId, value) => { setAnswers((old) => ({ ...old, [String(questionId)]: value })); setPreview(null); };
  const checkWithAi = async () => {
    setChecking(true); setMessage('');
    try {
      const result = await api(`/assignments/${id}/check`, { method: 'POST', body: JSON.stringify({ answers }) });
      setPreview(result); setMessage(`AI đã check lần ${result.attemptNo}: ${Math.round(result.percentage)}%.`);
    } catch (err) { setMessage(err.message); }
    finally { setChecking(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setSubmitting(true); setMessage('');
    try {
      const body = data.assignment.type === 'HOMEWORK' ? { attemptId: preview?.attemptId } : { answers };
      const result = await api(`/assignments/${id}/submit`, { method: 'POST', body: JSON.stringify(body) });
      setMessage(`Đã nộp chính thức: ${Math.round(result.percentage)}%. ${result.summary}`); setPreview(null); await load();
    } catch (err) { setMessage(err.message); }
    finally { setSubmitting(false); }
  };

  if (!data || !data.assignment) {
    return (
      <div className="panel">
        <div className="empty-state">
          <CircleAlert size={32} />
          <p>{message || 'Không tìm thấy bài tập này hoặc bài tập không thuộc lớp của bạn.'}</p>
          <Link className="btn primary small" to="/assignments" style={{ marginTop: 12 }}>
            Quay lại danh sách bài tập
          </Link>
        </div>
      </div>
    );
  }
  const { assignment, questions, submission } = data;

  return <>
    <div className="detail-back"><Link to="/assignments"><ArrowLeft size={17} /> Quay lại danh sách</Link></div>
    <section className="assignment-detail-head">
      <div><span className={`type-pill ${assignment.type.toLowerCase()}`}>{assignment.type === 'TEST' ? 'BÀI KIỂM TRA' : 'BÀI TẬP VỀ NHÀ'}</span><h1>{assignment.title}</h1><p>{assignment.className} · {assignment.teacherName}</p></div>
      <div className="detail-meta"><div><Clock3 size={18} /><span>Hạn nộp<strong>{formatDate(assignment.due_at)}</strong></span></div>{assignment.time_limit_minutes && <div><CircleAlert size={18} /><span>Thời gian<strong>{assignment.time_limit_minutes} phút</strong></span></div>}</div>
    </section>
    {message && <div className="notice">{message}</div>}
    {assignment.instructions && <div className="instruction-box"><strong>Hướng dẫn</strong><p>{assignment.instructions}</p></div>}
    {user.role === 'STUDENT' ? <StudentWork assignment={assignment} questions={questions} submission={submission} answers={answers} setAnswer={setAnswer} preview={preview} checkWithAi={checkWithAi} checking={checking} submit={submit} submitting={submitting} aiEnabled={data.aiEnabled} /> : <TeacherView assignment={assignment} questions={questions} report={report} reportLoading={reportLoading} setReportPage={setReportPage} publish={publish} />}
  </>;
}

function StudentWork({ assignment, questions, submission, answers, setAnswer, preview, checkWithAi, checking, submit, submitting, aiEnabled }) {
  const answerMap = useMemo(() => new Map((submission?.answers || []).map((answer) => [Number(answer.questionId), answer])), [submission]);
  if (submission) {
    return <div className="two-col result-layout">
      <section className="panel result-summary"><div className="score-ring" style={{ '--score': `${submission.percentage}%` }}><div><strong>{Math.round(submission.percentage)}</strong><span>/ 100</span></div></div><h2>Đã chấm xong</h2><p>{submission.ai_summary}</p><div className="score-line"><span>Điểm</span><strong>{submission.score}/{submission.max_score}</strong></div></section>
      <section className="question-list result-questions">{questions.map((question, index) => {
        const result = answerMap.get(Number(question.id));
        return <article className={`question-card ${result?.isCorrect ? 'correct' : 'wrong'}`} key={question.id}><div className="q-head"><span>Câu {index + 1} · {question.points} điểm</span>{result?.isCorrect ? <CheckCircle2 /> : <XCircle />}</div><h3>{question.prompt}</h3><div className="answer-review"><span>Bạn trả lời</span><strong>{result?.answerText || '—'}</strong></div><div className="answer-review correct-answer"><span>Đáp án tham khảo</span><strong>{question.correctAnswer || 'Tự luận'}</strong></div><p className="feedback">{result?.gradedByAi && <Bot size={16} />} {result?.feedback}</p></article>;
      })}</section>
    </div>;
  }
  return <form onSubmit={submit} className="student-work">
    <div className="work-info"><Sparkles size={18} /><span>{assignment.type === 'HOMEWORK' ? (aiEnabled ? 'Làm xong → Check bằng AI → sửa nếu cần → khi ổn mới nộp chính thức cho giáo viên.' : 'Admin chưa cấu hình AI; hệ thống vẫn check bằng cơ chế dự phòng rồi mới cho nộp.') : 'Bài kiểm tra chỉ nộp chính thức một lần; không có bước xem trước đáp án.'}</span></div>
    <div className="question-list">{questions.map((question, index) => <article className="question-card" key={question.id}><div className="q-head"><span>Câu {index + 1}</span><b>{question.points} điểm · {question.topic}</b></div><h3>{question.prompt}</h3>
      {question.type === 'MULTIPLE_CHOICE' ? <div className="option-list">{question.options.map((option) => <label key={option} className={answers[String(question.id)] === option ? 'selected' : ''}><input type="radio" name={`q-${question.id}`} value={option} checked={answers[String(question.id)] === option} onChange={(e) => setAnswer(question.id, e.target.value)} /><span>{option}</span></label>)}</div> : question.type === 'SHORT_TEXT' ? <input className="student-answer-input" value={answers[String(question.id)] || ''} onChange={(e) => setAnswer(question.id, e.target.value)} placeholder="Nhập câu trả lời..." /> : <textarea className="student-answer-input" rows="4" value={answers[String(question.id)] || ''} onChange={(e) => setAnswer(question.id, e.target.value)} placeholder="Viết câu trả lời của bạn..." />}
    </article>)}</div>
    {assignment.type === 'HOMEWORK' && preview && <section className="ai-preview panel"><div className="ai-preview-head"><div><Bot /><span><strong>AI check lần {preview.attemptNo}</strong><small>Đây chưa phải bài nộp chính thức.</small></span></div><b>{Math.round(preview.percentage)}%</b></div><p>{preview.summary}</p><div className="preview-results">{preview.results?.map((result, index) => <div className={result.isCorrect ? 'preview-result correct' : 'preview-result wrong'} key={result.questionId}><span>{result.isCorrect ? <CheckCircle2 size={17} /> : <XCircle size={17} />} Câu {index + 1}</span><strong>{result.awarded}/{result.points} điểm</strong><p>{result.feedback || (result.isCorrect ? 'Đúng.' : 'Cần xem lại.')}</p>{!result.isCorrect && result.referenceAnswer && <small>Đáp án tham khảo: {result.referenceAnswer}</small>}</div>)}</div></section>}
    <div className="submit-bar"><div><strong>{assignment.type === 'HOMEWORK' ? (preview ? 'Ổn rồi thì nộp cho giáo viên' : 'Bước 1: Check bằng AI') : 'Kiểm tra kỹ trước khi nộp'}</strong><span>{assignment.type === 'HOMEWORK' ? (preview ? `Đã check ${preview.attemptNo} lần. Sửa đáp án sẽ cần check lại.` : 'Có thể check lại nhiều lần trước khi nộp chính thức.') : 'Bài kiểm tra chỉ nộp chính thức một lần.'}</span></div><div className="submit-actions">{assignment.type === 'HOMEWORK' && <button type="button" className="btn secondary" onClick={checkWithAi} disabled={checking || submitting}><Bot size={17} /> {checking ? 'AI đang check...' : preview ? 'Check lại bằng AI' : 'Check bằng AI'}</button>}<button className="btn primary" disabled={submitting || checking || (assignment.type === 'HOMEWORK' && !preview)}><Send size={17} /> {submitting ? 'Đang nộp...' : 'Nộp cho giáo viên'}</button></div></div>
  </form>;
}

function TeacherView({ assignment, questions, report, reportLoading, setReportPage, publish }) {
  const submitted = report?.submittedCount ?? report?.students?.filter((student) => student.submitted).length ?? 0;
  const total = report?.total ?? report?.students?.length ?? 0;
  return <div className="teacher-detail">
    {assignment.status === 'DRAFT' && <div className="draft-callout"><div><Send /><span><strong>Bài đang là bản nháp</strong><small>Học sinh chưa nhìn thấy bài này.</small></span></div><button className="btn primary" onClick={publish}>Giao cho cả lớp</button></div>}
    <div className="stats-inline"><div><Users /><span><strong>{total}</strong> học sinh</span></div><div><UserCheck /><span><strong>{submitted}</strong> đã nộp</span></div><div><Clock3 /><span><strong>{Math.max(0, total - submitted)}</strong> chưa nộp</span></div></div>
    <div className="two-col teacher-detail-grid">
      <section className="panel"><div className="panel-title"><div><span>NỘI DUNG</span><h3>{questions.length} câu hỏi</h3></div></div><div className="teacher-questions">{questions.map((q, index) => <div key={q.id}><span>Câu {index + 1} · {q.topic}</span><strong>{q.prompt}</strong><small>Đáp án: {q.correctAnswer || 'AI đánh giá theo đáp án tham khảo'} · {q.points} điểm</small></div>)}</div></section>
      <section className="panel"><div className="panel-title"><div><span>THEO DÕI</span><h3>Kết quả & lịch sử AI</h3></div></div>{reportLoading ? <Empty>Đang tải trang học sinh...</Empty> : report?.students?.length ? <div className="report-list">{report.students.map((student) => <div className="report-row report-row-attempts" key={student.id}><div className="avatar small">{student.fullName.slice(0, 1)}</div><div className="grow"><strong>{student.fullName}</strong><span>{student.submitted ? `Đã nộp · ${Math.round(student.percentage)}%` : student.attemptCount ? `Đang làm · đã check AI ${student.attemptCount} lần` : 'Chưa làm bài'}</span>{student.summary && <small className="student-ai-summary">AI: {student.summary}</small>}{student.weakTopics?.length ? <small>Cần ôn: {student.weakTopics.map((topic) => `${topic.topic} (${topic.mastery}%)`).join(', ')}</small> : null}{student.attemptCount > 0 && <details className="attempt-history"><summary>Xem {student.attemptCount} lần check AI</summary><div>{student.attempts.map((attempt) => <article key={attempt.id}><div><strong>Lần {attempt.attemptNo} · {Math.round(attempt.percentage)}%</strong>{attempt.submitted && <b>ĐÃ NỘP</b>}</div><span>{new Date(attempt.createdAt).toLocaleString('vi-VN')}</span><p>{attempt.summary}</p>{attempt.results?.length ? <ul className="attempt-feedback">{attempt.results.map((result, index) => <li key={result.questionId}><strong>Câu {index + 1}: {result.awarded}/{result.points} điểm</strong><div className="attempt-ans-box"><div className="student-ans-text"><b>Bài làm:</b> <span>{result.answer || '—'}</span></div><div className="ai-fb-text"><b>AI nhận xét:</b> <span>{result.feedback || (result.isCorrect ? 'Đúng.' : 'Cần xem lại.')}</span></div></div></li>)}</ul> : null}</article>)}</div></details>}</div><span className={`submit-state ${student.submitted ? 'done' : ''}`}>{student.submitted ? 'Đã nộp' : 'Chưa nộp'}</span></div>)}</div> : <Empty>Lớp chưa có học sinh.</Empty>}<Pagination pagination={report?.pagination} loading={reportLoading} onPageChange={setReportPage} label="học sinh" /></section>
    </div>
  </div>;
}
