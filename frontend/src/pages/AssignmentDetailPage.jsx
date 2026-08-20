import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, CheckCircle2, CircleAlert, Clock3, ChevronLeft, ChevronRight, Headphones, LoaderCircle, Maximize2, MessageSquare, Music2, Send, Sparkles, UserCheck, Users, X, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlob, formatDate } from '../api.js';
import { Empty, Pagination } from '../components/Shell.jsx';

const SHARED_CONTEXT_START = '[[APPKOREA_SHARED_CONTEXT]]';
const SHARED_CONTEXT_END = '[[/APPKOREA_SHARED_CONTEXT]]';

function splitQuestionPrompt(value = '') {
  const raw = String(value || '');
  const start = raw.indexOf(SHARED_CONTEXT_START);
  const end = raw.indexOf(SHARED_CONTEXT_END);
  if (start !== 0 || end < 0) return { sharedContext: '', prompt: raw.trim() };
  const sharedContext = raw.slice(SHARED_CONTEXT_START.length, end).trim();
  const prompt = raw.slice(end + SHARED_CONTEXT_END.length).trim();
  return { sharedContext, prompt };
}

function FormattedQuestionText({ text }) {
  const value = String(text || '');
  const lines = value.split(/\r?\n/);
  return <>{lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return <span key={`line-${lineIndex}`}>
      {parts.map((part, index) => /^\*\*[^*]+\*\*$/.test(part)
        ? <strong key={`${lineIndex}-${index}-${part}`}>{part.slice(2, -2)}</strong>
        : <span key={`${lineIndex}-${index}-${part}`}>{part}</span>)}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </span>;
  })}</>;
}

function SharedContext({ text }) {
  if (!text) return null;
  return <div className="shared-question-context"><div className="shared-question-context-head">ĐỀ CHUNG</div><p><FormattedQuestionText text={text} /></p></div>;
}

function formatScoreValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return String(Math.round(numeric * 100) / 100);
}

function studentScoreText(student = {}) {
  return `${formatScoreValue(student.score)}/${formatScoreValue(student.maxScore)} điểm · ${Math.round(Number(student.percentage) || 0)}%`;
}

function formatAudioSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AssignmentAudioPlayer({ assignmentId, audio }) {
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setLoading(true);
    setError('');
    setSource('');
    apiBlob(`/assignments/${assignmentId}/audio`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Chưa tải được file nghe.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assignmentId, audio?.updatedAt]);

  return <section className="assignment-listening-player">
    <div className="assignment-listening-title">
      <span><Headphones size={21} /></span>
      <div><small>PHẦN NGHE</small><strong>Nghe audio rồi trả lời câu hỏi</strong></div>
      <em>{formatAudioSize(audio.sizeBytes)}</em>
    </div>
    <div className="assignment-listening-body">
      <div className="assignment-listening-file"><Music2 size={17} /><span>{audio.fileName}</span></div>
      {loading ? <div className="assignment-audio-loading"><LoaderCircle className="spin" size={17} /> Đang tải file nghe...</div> : null}
      {error ? <div className="assignment-audio-error"><CircleAlert size={17} /> {error}</div> : null}
      {source ? <audio controls preload="metadata" src={source}>Trình duyệt không phát được file nghe này.</audio> : null}
    </div>
  </section>;
}


export default function AssignmentDetailPage({ user }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [answers, setAnswers] = useState({});
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState(0);
  const [checkingElapsed, setCheckingElapsed] = useState(0);
  const [reportPage, setReportPage] = useState(1);
  const [reportLoading, setReportLoading] = useState(false);

  const load = async () => {
    try {
      const result = await api(`/assignments/${id}`);
      setData(result);
      if (user.role === 'STUDENT' && !result?.submission) {
        if (result?.latestAttempt) {
          setAnswers(result.latestAttempt.answers || {});
          setPreview({ ...result.latestAttempt, reused: true });
        } else {
          setAnswers({});
          setPreview(null);
        }
      } else if (user.role === 'STUDENT') {
        setAnswers({});
        setPreview(null);
      }
    } catch (err) { setMessage(err.message); }
  };
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!checking) return undefined;
    const startedAt = Date.now();
    setCheckingElapsed(0);
    setCheckingProgress((current) => Math.max(4, current));
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setCheckingElapsed(Math.floor(elapsed));
      // Progress cảm nhận: tiến nhanh lúc đầu, chậm dần và dừng ở 92% cho tới khi server trả kết quả thật.
      setCheckingProgress((current) => Math.max(current, Math.min(92, Math.round(8 + 84 * (1 - Math.exp(-elapsed / 6.5))))));
    }, 250);
    return () => window.clearInterval(timer);
  }, [checking]);

  useEffect(() => {
    if (!data?.assignment || data?.assignment?.type === undefined) return;
    if (user.role !== 'TEACHER') return;
    setReportLoading(true);
    api(`/assignments/${id}/report?page=${reportPage}&pageSize=8`)
      .then(setReport).catch(() => {}).finally(() => setReportLoading(false));
  }, [id, user.role, reportPage, data?.assignment?.id]);

  const setAnswer = (qId, val) => {
    setAnswers((prev) => ({ ...prev, [String(qId)]: val }));
    // Nếu học sinh sửa đáp án sau khi đã check AI thì lần check cũ không còn
    // đại diện cho bài hiện tại nữa. Bắt buộc check lại trước khi nộp.
    setPreview(null);
  };

  const checkWithAi = async () => {
    setMessage('');
    setCheckingProgress(4);
    setCheckingElapsed(0);
    setChecking(true);
    try {
      const result = await api(`/assignments/${id}/attempt`, { method: 'POST', toast: false, body: JSON.stringify({ answers }) });
      setCheckingProgress(100);
      setPreview(result);
      setMessage(result.reused ? result.message : '');
      // Cho người học kịp thấy trạng thái “Hoàn tất” thay vì panel biến mất đột ngột.
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    } catch (err) { setMessage(err.message); }
    finally { setChecking(false); }
  };

  const publish = async () => {
    try { await api(`/assignments/${id}/publish`, { method: 'POST' }); await load(); } catch (err) { setMessage(err.message); }
  };

  const submit = async (e) => {
    e?.preventDefault(); setSubmitting(true);
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
    {data.audio ? <AssignmentAudioPlayer assignmentId={Number(id)} audio={data.audio} /> : null}
    {message && <div className="notice">{message}</div>}
    {assignment.instructions && <div className="instruction-box"><strong>Hướng dẫn</strong><p>{assignment.instructions}</p></div>}
    {user.role === 'STUDENT' ? <StudentWork assignment={assignment} questions={questions} submission={submission} answers={answers} setAnswer={setAnswer} preview={preview} checkWithAi={checkWithAi} checking={checking} checkingProgress={checkingProgress} checkingElapsed={checkingElapsed} submit={submit} submitting={submitting} aiEnabled={data.aiEnabled} /> : <TeacherView assignment={assignment} questions={questions} report={report} setReport={setReport} reportLoading={reportLoading} setReportPage={setReportPage} publish={publish} assignmentId={Number(id)} />}
  </>;
}

function StudentWork({ assignment, questions, submission, answers, setAnswer, preview, checkWithAi, checking, checkingProgress, checkingElapsed, submit, submitting, aiEnabled }) {
  const answerMap = useMemo(() => new Map((submission?.answers || []).map((answer) => [Number(answer.questionId), answer])), [submission]);
  if (submission) {
    return <div className="two-col result-layout">
      <section className="panel result-summary"><div className="score-ring" style={{ '--score': `${submission.percentage}%` }}><div><strong>{Math.round(submission.percentage)}</strong><span>/ 100</span></div></div><h2>Đã chấm xong</h2><p>{submission.ai_summary}</p><div className="score-line"><span>Điểm</span><strong>{submission.score}/{submission.max_score}</strong></div>{submission.teacher_feedback && <div className="student-teacher-feedback"><div><MessageSquare size={17} /><strong>Nhận xét của giáo viên</strong></div><p>{submission.teacher_feedback}</p>{submission.teacher_reviewed_at && <small>Cập nhật {formatDate(submission.teacher_reviewed_at)}</small>}</div>}</section>
      <section className="question-list result-questions">{questions.map((question, index) => {
        const result = answerMap.get(Number(question.id));
        const parts = splitQuestionPrompt(question.prompt);
        const partial = !result?.isCorrect && Number(result?.pointsAwarded || 0) > 0;
        return <article className={`question-card ${result?.isCorrect ? 'correct' : partial ? 'partial' : 'wrong'}`} key={question.id}><SharedContext text={parts.sharedContext} /><div className="q-head"><span>Câu {index + 1} · {question.points} điểm</span>{result?.isCorrect ? <CheckCircle2 /> : partial ? <CircleAlert /> : <XCircle />}</div><h3><FormattedQuestionText text={parts.prompt} /></h3><div className="answer-review"><span>Bạn trả lời</span><strong>{result?.answerText || '—'}</strong></div><div className="answer-review correct-answer"><span>Đáp án tham khảo</span><strong>{question.correctAnswer || 'Tự luận'}</strong></div><p className="feedback">{result?.gradedByAi && <Bot size={16} />} {result?.feedback}</p></article>;
      })}</section>
    </div>;
  }
  return <form onSubmit={submit} className="student-work">
    <div className="work-info"><Sparkles size={18} /><span>{assignment.type === 'HOMEWORK' ? (aiEnabled ? 'Làm xong → Check bằng AI → sửa nếu cần → khi ổn mới nộp chính thức cho giáo viên.' : 'AI tạm thời chưa sẵn sàng; hệ thống vẫn kiểm tra bài bằng cơ chế dự phòng rồi mới cho nộp.') : 'Bài kiểm tra chỉ nộp chính thức một lần; không có bước xem trước đáp án.'}</span></div>
    <div className="question-list">{questions.map((question, index) => { const parts = splitQuestionPrompt(question.prompt); return <article className="question-card" key={question.id}><SharedContext text={parts.sharedContext} /><div className="q-head"><span>Câu {index + 1}</span><b>{question.points} điểm · {question.topic}</b></div><h3><FormattedQuestionText text={parts.prompt} /></h3>
      {question.type === 'MULTIPLE_CHOICE' ? <div className="option-list">{question.options.map((option) => <label key={option} className={answers[String(question.id)] === option ? 'selected' : ''}><input type="radio" name={`q-${question.id}`} value={option} checked={answers[String(question.id)] === option} disabled={checking || submitting} onChange={(e) => setAnswer(question.id, e.target.value)} /><span>{option}</span></label>)}</div> : question.type === 'SHORT_TEXT' ? <input className="student-answer-input" value={answers[String(question.id)] || ''} disabled={checking || submitting} onChange={(e) => setAnswer(question.id, e.target.value)} placeholder="Nhập câu trả lời..." /> : <textarea className="student-answer-input" rows="4" value={answers[String(question.id)] || ''} disabled={checking || submitting} onChange={(e) => setAnswer(question.id, e.target.value)} placeholder="Viết câu trả lời của bạn..." />}
    </article>; })}</div>
    {assignment.type === 'HOMEWORK' && checking && <AiCheckingStatus progress={checkingProgress} elapsed={checkingElapsed} />}
    {assignment.type === 'HOMEWORK' && preview && <section className="ai-preview panel"><div className="ai-preview-head"><div><Bot /><span><strong>AI check lần {preview.attemptNo}</strong><small>Kết quả được khóa theo từng đáp án; câu không đổi sẽ không bị chấm lại.</small></span></div><b>{Math.round(preview.percentage)}%</b></div><p>{preview.summary}</p><div className="preview-results">{preview.results?.map((result, index) => {
      const partial = !result.isCorrect && Number(result.awarded || 0) > 0;
      return <div className={`preview-result ${result.isCorrect ? 'correct' : partial ? 'partial' : 'wrong'}`} key={result.questionId}><span>{result.isCorrect ? <CheckCircle2 size={17} /> : partial ? <CircleAlert size={17} /> : <XCircle size={17} />} Câu {index + 1}</span><strong>{result.awarded}/{result.points} điểm</strong><p>{result.feedback || (result.isCorrect ? 'Đúng.' : 'Cần xem lại.')}</p>{!result.isCorrect && result.referenceAnswer && <small>Đáp án tham khảo: {result.referenceAnswer}</small>}</div>;
    })}</div></section>}
    <div className="submit-bar"><div><strong>{assignment.type === 'HOMEWORK' ? (preview ? 'Ổn rồi thì nộp cho giáo viên' : 'Bước 1: Check bằng AI') : 'Kiểm tra kỹ trước khi nộp'}</strong><span>{assignment.type === 'HOMEWORK' ? (preview ? `Đang dùng kết quả lần ${preview.attemptNo}. Muốn check lại phải sửa đáp án; chỉ câu đã sửa được chấm lại.` : 'Có thể sửa và check nhiều lần; đáp án không đổi luôn giữ nguyên kết quả.') : 'Bài kiểm tra chỉ nộp chính thức một lần.'}</span></div><div className="submit-actions">{assignment.type === 'HOMEWORK' && <button type="button" className="btn secondary" onClick={checkWithAi} disabled={checking || submitting || Boolean(preview)}><Bot size={17} /> {checking ? 'AI đang check...' : preview ? 'Sửa đáp án để check lại' : 'Check bằng AI'}</button>}<button className="btn primary" disabled={submitting || checking || (assignment.type === 'HOMEWORK' && !preview)}><Send size={17} /> {submitting ? 'Đang nộp...' : 'Nộp cho giáo viên'}</button></div></div>
  </form>;
}

function AiCheckingStatus({ progress, elapsed }) {
  const percent = Math.max(4, Math.min(100, Number(progress) || 4));
  let title = 'Đang chuẩn bị bài làm...';
  let detail = 'Hệ thống đang tiếp nhận câu trả lời của bạn.';
  let activeStep = 0;

  if (percent >= 18) {
    title = 'AI đang chấm bài của bạn';
    detail = 'AI đang đọc câu trả lời và đánh giá nội dung từng câu.';
    activeStep = 1;
  }
  if (percent >= 62) {
    title = 'Đang đối chiếu đáp án & lỗi tiếng Hàn';
    detail = 'AI đang kiểm tra chính tả, trợ từ, đuôi câu và đáp án tham khảo.';
    activeStep = 2;
  }
  if (percent >= 84) {
    title = 'Đang tổng hợp nhận xét';
    detail = 'Sắp xong rồi — hệ thống đang gom điểm và phản hồi cho từng câu.';
    activeStep = 3;
  }
  if (percent >= 100) {
    title = 'Chấm xong rồi!';
    detail = 'Đang mở kết quả cho bạn...';
    activeStep = 4;
  }

  const steps = ['Chuẩn bị', 'Đang chấm', 'Đối chiếu', 'Nhận xét'];
  return <aside className="ai-checking-float" role="status" aria-live="polite" aria-busy="true">
    <div className="ai-checking-top">
      <div className="ai-checking-orb"><Bot size={22} /></div>
      <div><strong>{title}</strong><span>{detail}</span></div>
      <b>{percent}%</b>
    </div>
    <div className="ai-checking-track"><i style={{ width: `${percent}%` }} /></div>
    <div className="ai-checking-steps">{steps.map((step, index) => <span className={index <= activeStep ? 'active' : ''} key={step}><i />{step}</span>)}</div>
    <div className="ai-checking-foot"><span className="ai-live-dot" /> AI đang làm việc thật · đừng đóng tab <b>{elapsed}s</b></div>
  </aside>;
}

function TeacherFeedbackEditor({ assignmentId, student, onSaved }) {
  const [value, setValue] = useState(student.teacherFeedback || '');
  const [savedValue, setSavedValue] = useState(student.teacherFeedback || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValue(student.teacherFeedback || '');
    setSavedValue(student.teacherFeedback || '');
  }, [student.submissionId, student.teacherFeedback]);

  const save = async () => {
    if (!student.submissionId || saving || value.trim() === savedValue.trim()) return;
    setError('');
    setSaving(true);
    try {
      const result = await api(`/assignments/${assignmentId}/submissions/${student.submissionId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ teacherFeedback: value }),
      });
      setValue(result.teacherFeedback || '');
      setSavedValue(result.teacherFeedback || '');
      onSaved(student.submissionId, result);
    } catch (saveError) {
      setError(saveError.message || 'Chưa lưu được đánh giá.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="teacher-feedback-editor">
    <div className="teacher-feedback-editor-head"><span><MessageSquare size={15} /><strong>Đánh giá của giáo viên</strong></span>{student.teacherReviewedAt && <small>{formatDate(student.teacherReviewedAt)}</small>}</div>
    <small className="teacher-feedback-send-note">Khi lưu, nhận xét sẽ được gửi vào thông báo của học sinh và hiển thị trong kết quả bài làm.</small>
    <textarea rows="3" maxLength="2000" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ghi nhận xét, điều học sinh làm tốt và phần cần cải thiện..." />
    {error && <small className="teacher-feedback-error">{error}</small>}
    <div className="teacher-feedback-editor-actions"><span>{value.length}/2000 ký tự</span><button type="button" className="btn secondary small" onClick={save} disabled={saving || value.trim() === savedValue.trim()}>{saving ? 'Đang gửi...' : savedValue.trim() && !value.trim() ? 'Xóa đánh giá' : 'Lưu & gửi cho học sinh'}</button></div>
  </div>;
}

function TeacherView({ assignment, questions, report, setReport, reportLoading, setReportPage, publish, assignmentId }) {
  const submitted = report?.submittedCount ?? report?.students?.filter((s) => s.submitted).length ?? 0;
  const total = report?.total ?? report?.students?.length ?? 0;
  const [contentCollapsed, setContentCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiHistory, setAiHistory] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const aiBottomRef = useRef(null);

  const updateSavedReview = (submissionId, result) => {
    setReport((current) => current ? {
      ...current,
      students: current.students.map((student) => Number(student.submissionId) === Number(submissionId)
        ? { ...student, teacherFeedback: result.teacherFeedback, teacherReviewedAt: result.teacherReviewedAt }
        : student),
    } : current);
  };

  const sendAiQuestion = async () => {
    const q = aiQuestion.trim();
    if (!q || aiLoading) return;
    setAiHistory((h) => [...h, { role: 'user', text: q }]);
    setAiQuestion('');
    setAiLoading(true);
    try {
      const { answer } = await api('/teacher/ai-ask', {
        method: 'POST',
        toast: false,
        body: JSON.stringify({ question: q, assignmentId }),
      });
      setAiHistory((h) => [...h, { role: 'ai', text: answer }]);
    } catch (err) {
      setAiHistory((h) => [...h, { role: 'ai', text: `❌ ${err.message}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    aiBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiHistory, aiLoading]);

  const quickQuestions = [
    'Học sinh nào có điểm thấp nhất?',
    'Câu nào học sinh hay làm sai nhất?',
    'Tôi cần ôn lại kiến thức gì cho lớp?',
    'Nhận xét tổng quát về bài làm của lớp?',
  ];

  return <div className="teacher-detail">
    {assignment.status === 'DRAFT' && <div className="draft-callout"><div><Send /><span><strong>Bài đang là bản nháp</strong><small>Học sinh chưa nhìn thấy bài này.</small></span></div><button className="btn primary" onClick={publish}>Giao cho cả lớp</button></div>}
    <div className="stats-inline"><div><Users /><span><strong>{total}</strong> học sinh</span></div><div><UserCheck /><span><strong>{submitted}</strong> đã nộp</span></div><div><Clock3 /><span><strong>{Math.max(0, total - submitted)}</strong> chưa nộp</span></div></div>

    <div className={`two-col teacher-detail-grid${contentCollapsed ? ' content-hidden' : ''}`}>
      {/* Cột Nội dung */}
      <section className={`panel teacher-content-panel${contentCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-title">
          <div><span>NỘI DUNG</span><h3>{questions.length} câu hỏi</h3></div>
          <button
            className="icon-button collapse-btn"
            title={contentCollapsed ? 'Mở rộng nội dung' : 'Thu gọn nội dung'}
            onClick={() => setContentCollapsed((v) => !v)}
          >
            {contentCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        {!contentCollapsed && (
          <div className="teacher-questions">
            {questions.map((q, index) => {
              const parts = splitQuestionPrompt(q.prompt);
              return <div key={q.id}>
                <SharedContext text={parts.sharedContext} />
                <span>Câu {index + 1} · {q.topic}</span>
                <strong><FormattedQuestionText text={parts.prompt} /></strong>
                <small>Đáp án: {q.correctAnswer || 'AI đánh giá theo đáp án tham khảo'} · {q.points} điểm</small>
              </div>;
            })}
          </div>
        )}
        {contentCollapsed && (
          <div className="collapsed-hint" onClick={() => setContentCollapsed(false)}>
            <Maximize2 size={16} />
            <span>{questions.length} câu</span>
          </div>
        )}
      </section>

      {/* Cột Theo dõi */}
      <section className="panel">
        <div className="panel-title">
          <div><span>THEO DÕI</span><h3>Kết quả học sinh</h3></div>
          <button
            className={`icon-button ai-ask-toggle-btn${aiOpen ? ' active' : ''}`}
            title="Hỏi AI về học sinh"
            onClick={() => setAiOpen((v) => !v)}
          >
            <MessageSquare size={18} />
          </button>
        </div>

        {/* AI Ask Panel */}
        {aiOpen && (
          <div className="teacher-ai-ask-panel">
            <div className="teacher-ai-ask-header">
              <Bot size={16} />
              <strong>Hỏi AI về học sinh &amp; bài tập này</strong>
              <button className="icon-button" onClick={() => setAiOpen(false)}><X size={16} /></button>
            </div>
            {aiHistory.length === 0 && (
              <div className="teacher-ai-quick-qs">
                {quickQuestions.map((q) => (
                  <button key={q} className="teacher-ai-quick-q" onClick={() => { setAiQuestion(q); }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="teacher-ai-messages">
              {aiHistory.map((msg, i) => (
                <div key={i} className={`teacher-ai-msg ${msg.role}`}>
                  {msg.role === 'ai' && <Bot size={15} />}
                  <p>{msg.text}</p>
                </div>
              ))}
              {aiLoading && (
                <div className="teacher-ai-msg ai">
                  <Bot size={15} />
                  <p className="ai-typing">AI đang phân tích...</p>
                </div>
              )}
              <div ref={aiBottomRef} />
            </div>
            <div className="teacher-ai-input-row">
              <input
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendAiQuestion()}
                placeholder="Ví dụ: Học sinh nào yếu nhất? Câu nào cần ôn lại?"
              />
              <button className="btn primary small" onClick={sendAiQuestion} disabled={aiLoading || !aiQuestion.trim()}>
                <Send size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Student list */}
        {reportLoading ? <Empty>Đang tải trang học sinh...</Empty> : report?.students?.length ? (
          <div className="report-list">
            {report.students.map((student) => (
              <div className="report-row report-row-attempts" key={student.id}>
                <div className="avatar small">{student.fullName.slice(0, 1)}</div>
                <div className="grow">
                  <strong>{student.fullName}</strong>
                  <span>{student.submitted ? `Đã nộp · ${studentScoreText(student)}` : student.attemptCount ? 'Đang làm bài' : 'Chưa nộp bài'}</span>
                  {student.attemptCount > 0 && <small className="student-check-count">{student.fullName} đã Check AI {student.attemptCount} lần</small>}
                  {student.submitted && <div className="student-total-score"><div><span>TỔNG ĐIỂM HỌC SINH</span><strong>{formatScoreValue(student.score)}<small>/{formatScoreValue(student.maxScore)} điểm</small></strong></div><b>{Math.round(Number(student.percentage) || 0)}%</b></div>}
                  {(student.summary || student.latestAttempt?.summary) && <div className="student-ai-overview"><Bot size={15} /><div><strong>Đánh giá chung của AI</strong><p>{student.summary || student.latestAttempt?.summary}</p></div></div>}
                  {student.weakTopics?.length ? <small>Cần ôn: {student.weakTopics.map((t) => `${t.topic} (${t.mastery}%)`).join(', ')}</small> : null}
                  {student.latestAttempt?.results?.length ? (
                    <details className="latest-attempt-detail" open={student.submitted}>
                      <summary>
                        <span>{student.submitted ? 'Chi tiết bài nộp cuối cùng' : 'Chi tiết lần Check AI gần nhất'}</span>
                        <b>{student.submitted ? studentScoreText(student) : `${formatScoreValue(student.latestAttempt.score)}/${formatScoreValue(student.latestAttempt.maxScore)} điểm · ${Math.round(student.latestAttempt.percentage)}%`}</b>
                      </summary>
                      <article>
                        <small>{student.latestAttempt.createdAt ? new Date(student.latestAttempt.createdAt).toLocaleString('vi-VN') : ''}</small>
                        <div className="latest-attempt-results">
                          {student.latestAttempt.results.map((result, index) => {
                            const question = questions.find((item) => Number(item.id) === Number(result.questionId));
                            return (
                              <div className={`latest-attempt-question ${result.isCorrect ? 'correct' : 'wrong'}`} key={result.questionId ?? index}>
                                <div className="latest-attempt-question-head">
                                  <strong>Câu {index + 1}</strong>
                                  <span>{result.awarded}/{result.points} điểm</span>
                                </div>
                                {question?.prompt && (() => { const parts = splitQuestionPrompt(question.prompt); return <><SharedContext text={parts.sharedContext} /><p className="latest-question-prompt"><FormattedQuestionText text={parts.prompt} /></p></>; })()}
                                <div className="latest-answer-box">
                                  <p><b>Bài làm:</b> {result.answer || '—'}</p>
                                  <p><b>AI nhận xét:</b> {result.feedback || (result.isCorrect ? 'Đúng.' : 'Cần xem lại.')}</p>
                                  {!result.isCorrect && result.referenceAnswer && <p><b>Đáp án tham khảo:</b> {result.referenceAnswer}</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    </details>
                  ) : null}
                  {student.submitted && <TeacherFeedbackEditor assignmentId={assignmentId} student={student} onSaved={updateSavedReview} />}
                </div>
                <span className={`submit-state ${student.submitted ? 'done' : ''}`}>{student.submitted ? 'Đã nộp' : 'Chưa nộp'}</span>
              </div>
            ))}
          </div>
        ) : <Empty>Lớp chưa có học sinh.</Empty>}
        <Pagination pagination={report?.pagination} loading={reportLoading} onPageChange={setReportPage} label="học sinh" />
      </section>
    </div>
  </div>;
}

export { formatScoreValue, studentScoreText };
