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
      if (user.role === 'STUDENT') {
        const initialAnswers = {};
        // Ưu tiên đáp án từ lần check AI mới nhất (latestAttempt), rồi mới đến submission
        if (result?.latestAttempt?.answers) {
          Object.assign(initialAnswers, result.latestAttempt.answers);
        } else if (result?.submission?.answers) {
          for (const ans of result.submission.answers) {
            initialAnswers[String(ans.questionId)] = ans.answerText || '';
          }
        }
        setAnswers(initialAnswers);
        if (result?.latestAttempt) {
          setPreview({ ...result.latestAttempt });
        } else {
          setPreview(null);
        }
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
  };

  const checkWithAi = async () => {
    setMessage('');
    setCheckingProgress(4);
    setCheckingElapsed(0);
    setChecking(true);
    try {
      const result = await api(`/assignments/${id}/attempt`, { method: 'POST', toast: false, body: JSON.stringify({ answers }) });
      setCheckingProgress(100);
      // Cập nhật preview với kết quả mới NGAY LẬP TỨC mà không gọi load()
      // để tránh bị overwrite answers đang sửa
      setPreview(result);
      setMessage(result.message || '');
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      // Sau khi cập nhật xong preview, cũng cập nhật data.latestAttempt trong nền
      setData((prev) => prev ? {
        ...prev,
        latestAttempt: { ...result, answers: { ...answers } },
      } : prev);
    } catch (err) { setMessage(err.message); }
    finally { setChecking(false); }
  };

  const publish = async () => {
    try { await api(`/assignments/${id}/publish`, { method: 'POST' }); await load(); } catch (err) { setMessage(err.message); }
  };

  const submit = async (e) => {
    e?.preventDefault(); setSubmitting(true);
    try {
      const result = await api(`/assignments/${id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) });
      setMessage(`Đã nộp bài chính thức cho giáo viên: ${Math.round(result.percentage)}%. ${result.summary}`);
      setPreview(result);
      await load();
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
  const isHomework = assignment.type === 'HOMEWORK';
  const hasSubmitted = Boolean(submission);

  // Nếu đã nộp bài: lấy kết quả chi tiết từ preview (latest attempt) hoặc từ submission_answers ban đầu
  const resultAnswerMap = useMemo(() => {
    if (!hasSubmitted) return new Map();
    if (preview?.results?.length) {
      return new Map(preview.results.map((r) => [Number(r.questionId), {
        questionId: Number(r.questionId),
        answerText: r.answer,
        isCorrect: Boolean(r.isCorrect),
        awarded: Number(r.awarded || 0),
        points: Number(r.points || 1),
        feedback: r.feedback,
        referenceAnswer: r.referenceAnswer,
      }]));
    }
    if (submission?.answers?.length) {
      return new Map(submission.answers.map((a) => [Number(a.questionId), {
        questionId: Number(a.questionId),
        answerText: a.answerText,
        isCorrect: Boolean(a.isCorrect),
        awarded: Number(a.pointsAwarded || 0),
        points: 1,
        feedback: a.feedback,
      }]));
    }
    return new Map();
  }, [hasSubmitted, preview, submission]);

  // Kiểm tra học sinh đã hoàn thành 100% full điểm chưa
  const currentPercentage = Math.max(Number(submission?.percentage || 0), Number(preview?.percentage || 0));
  const isFullScore = currentPercentage >= 100 || (preview?.results?.length > 0 && preview.results.every((r) => r.isCorrect));

  // GIAO DIỆN HỌC SINH ĐÃ NỘP BÀI
  if (hasSubmitted) {
    return <div className="student-submitted-workspace">
      <div className="two-col result-layout">
        {/* Panel tổng quan bên trái */}
        <section className="panel result-summary">
          <div className="score-ring" style={{ '--score': `${Math.round(currentPercentage)}%` }}>
            <div><strong>{Math.round(currentPercentage)}</strong><span>/ 100</span></div>
          </div>
          <h2>{isFullScore ? 'Đã hoàn thành xuất sắc!' : 'Đã nộp bài cho giáo viên'}</h2>
          
          <div className="student-status-badge-wrap">
            {isFullScore ? (
              <div className="student-status-tag completed">
                <Sparkles size={16} /> <strong>ĐÃ HOÀN THÀNH (100%)</strong>
              </div>
            ) : (
              <div className="student-status-tag incomplete">
                <CircleAlert size={16} /> <strong>ĐÃ NỘP NHƯNG CHƯA SỬA HẾT BÀI</strong>
              </div>
            )}
          </div>

          <p>{preview?.summary || submission?.ai_summary || 'Bài nộp đầu tiên đã được ghi nhận vào sổ điểm của giáo viên.'}</p>
          
          <div className="score-line">
            <span>Điểm bài nộp ban đầu</span>
            <strong>{formatScoreValue(submission.score)}/{formatScoreValue(submission.max_score)} ({Math.round(submission.percentage)}%)</strong>
          </div>

          {preview && preview.attemptNo > 1 && (
            <div className="score-line update">
              <span>Điểm sau khi sửa (Check {preview.attemptNo})</span>
              <strong>{formatScoreValue(preview.score)}/{formatScoreValue(preview.max_score)} ({Math.round(preview.percentage)}%)</strong>
            </div>
          )}

          {submission.teacher_feedback && (
            <div className="student-teacher-feedback">
              <div><MessageSquare size={17} /><strong>Nhận xét của giáo viên</strong></div>
              <p>{submission.teacher_feedback}</p>
              {submission.teacher_reviewed_at && <small>Cập nhật {formatDate(submission.teacher_reviewed_at)}</small>}
            </div>
          )}
        </section>

        {/* Danh sách câu hỏi + Chức năng Sửa bài & Check AI bên phải */}
        <section className="question-list result-questions">
          {isHomework && (
            <div className="homework-ai-check-notice">
              <Bot size={20} />
              <div>
                <strong>Tính năng AI Check &amp; Hướng dẫn sửa bài đã mở</strong>
                <p>{isFullScore ? 'Bạn đã làm đúng toàn bộ câu hỏi. Có thể xem lại kiến thức hoặc luyện tập thêm.' : 'Hãy chọn lại hoặc sửa đáp án các câu sai bên dưới, sau đó bấm nút Check AI để được AI chấm và giải thích lại.'}</p>
              </div>
            </div>
          )}

          {questions.map((question, index) => {
            const result = resultAnswerMap.get(Number(question.id));
            const parts = splitQuestionPrompt(question.prompt);
            const isCorrect = result?.isCorrect;
            const currentAns = answers[String(question.id)] ?? result?.answerText ?? '';

            return (
              <article className={`question-card ${isCorrect ? 'correct' : 'wrong'}`} key={question.id}>
                <SharedContext text={parts.sharedContext} />
                <div className="q-head">
                  <span>Câu {index + 1} · {question.points} điểm</span>
                  {isCorrect ? <span className="status-label-correct"><CheckCircle2 size={16} /> Đúng</span> : <span className="status-label-wrong"><XCircle size={16} /> Sai</span>}
                </div>
                <h3><FormattedQuestionText text={parts.prompt} /></h3>

                {/* Nếu là bài tập về nhà: cho phép sửa đáp án trực tiếp để check AI */}
                {isHomework ? (
                  <div className="question-correction-box">
                    <label className="correction-label"><strong>Đáp án của bạn:</strong></label>
                    {question.type === 'MULTIPLE_CHOICE' ? (
                      <div className="option-list">
                        {question.options.map((option) => (
                          <label key={option} className={currentAns === option ? 'selected' : ''}>
                            <input
                              type="radio"
                              name={`q-corr-${question.id}`}
                              value={option}
                              checked={currentAns === option}
                              disabled={checking}
                              onChange={(e) => setAnswer(question.id, e.target.value)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : question.type === 'SHORT_TEXT' ? (
                      <input
                        className="student-answer-input"
                        value={currentAns}
                        disabled={checking}
                        onChange={(e) => setAnswer(question.id, e.target.value)}
                        placeholder="Sửa lại câu trả lời..."
                      />
                    ) : (
                      <textarea
                        className="student-answer-input"
                        rows="3"
                        value={currentAns}
                        disabled={checking}
                        onChange={(e) => setAnswer(question.id, e.target.value)}
                        placeholder="Sửa lại câu trả lời..."
                      />
                    )}
                  </div>
                ) : (
                  <div className="answer-review">
                    <span>Bạn trả lời</span>
                    <strong>{result?.answerText || '—'}</strong>
                  </div>
                )}

                {/* Nhận xét AI và đáp án tham khảo */}
                {result?.feedback && (
                  <p className="feedback">
                    <Bot size={16} /> <span>{result.feedback}</span>
                  </p>
                )}
                {!isCorrect && question.correctAnswer && (
                  <div className="answer-review correct-answer">
                    <span>Đáp án tham khảo</span>
                    <strong>{question.correctAnswer}</strong>
                  </div>
                )}
              </article>
            );
          })}

          {/* AI Checking Animation Banner */}
          {isHomework && checking && <AiCheckingStatus progress={checkingProgress} elapsed={checkingElapsed} />}

          {/* Nút Check AI sau khi nộp bài */}
          {isHomework && (
            <div className="submit-bar student-post-submit-bar">
              <div>
                <strong>Sửa bài &amp; Check bằng AI</strong>
                <span>Sửa lại câu sai rồi bấm Check AI để AI chấm lại và giải thích chi tiết.</span>
              </div>
              <div className="submit-actions">
                <button type="button" className="btn primary" onClick={checkWithAi} disabled={checking}>
                  <Bot size={18} /> {checking ? 'AI đang chấm lại...' : 'AI Check lại bài làm'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>;
  }

  // GIAO DIỆN HỌC SINH ĐANG LÀM BÀI (CHƯA NỘP)
  // Nút Check AI BỊ ẨN hoàn toàn theo yêu cầu người dùng
  return <form onSubmit={submit} className="student-work">
    <div className="work-info">
      <Sparkles size={18} />
      <span>{isHomework ? 'Làm bài cẩn thận và bấm Nộp cho giáo viên. Bài nộp đầu tiên này sẽ là điểm số chính thức. Sau khi nộp, bạn sẽ được mở tính năng AI Check để nhận hướng dẫn sửa các câu sai.' : 'Bài kiểm tra chỉ nộp chính thức một lần.'}</span>
    </div>

    <div className="question-list">
      {questions.map((question, index) => {
        const parts = splitQuestionPrompt(question.prompt);
        return (
          <article className="question-card" key={question.id}>
            <SharedContext text={parts.sharedContext} />
            <div className="q-head">
              <span>Câu {index + 1}</span>
              <b>{question.points} điểm · {question.topic}</b>
            </div>
            <h3><FormattedQuestionText text={parts.prompt} /></h3>
            {question.type === 'MULTIPLE_CHOICE' ? (
              <div className="option-list">
                {question.options.map((option) => (
                  <label key={option} className={answers[String(question.id)] === option ? 'selected' : ''}>
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      value={option}
                      checked={answers[String(question.id)] === option}
                      disabled={submitting}
                      onChange={(e) => setAnswer(question.id, e.target.value)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            ) : question.type === 'SHORT_TEXT' ? (
              <input
                className="student-answer-input"
                value={answers[String(question.id)] || ''}
                disabled={submitting}
                onChange={(e) => setAnswer(question.id, e.target.value)}
                placeholder="Nhập câu trả lời..."
              />
            ) : (
              <textarea
                className="student-answer-input"
                rows="4"
                value={answers[String(question.id)] || ''}
                disabled={submitting}
                onChange={(e) => setAnswer(question.id, e.target.value)}
                placeholder="Viết câu trả lời của bạn..."
              />
            )}
          </article>
        );
      })}
    </div>

    <div className="submit-bar">
      <div>
        <strong>Kiểm tra kỹ trước khi nộp bài</strong>
        <span>Bài nộp này sẽ được gửi trực tiếp cho giáo viên làm điểm chính thức.</span>
      </div>
      <div className="submit-actions">
        {/* Nút Check AI BỊ ẨN hoàn toàn khi đang làm bài. Chỉ có nút nộp bài cho giáo viên. */}
        <button className="btn primary" disabled={submitting}>
          <Send size={17} /> {submitting ? 'Đang nộp bài...' : 'Nộp bài cho giáo viên'}
        </button>
      </div>
    </div>
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
            {report.students.map((student) => {
              const hasSubmitted = Boolean(student.submitted);
              const isCompleted = student.status === 'COMPLETED' || Number(student.percentage) >= 100;
              const results = student.answers || [];
              const correctCount = results.filter((r) => r.isCorrect).length;
              const wrongCount = results.length - correctCount;

              return (
                <div className="report-row report-row-attempts" key={student.id}>
                  <div className="avatar small">{student.fullName.slice(0, 1)}</div>
                  <div className="grow">
                    <div className="student-name-status-row">
                      <strong>{student.fullName}</strong>
                      {hasSubmitted ? (
                        isCompleted ? (
                          <span className="submit-state done">Đã hoàn thành</span>
                        ) : (
                          <span className="submit-state incomplete">Đã nộp nhưng chưa sửa hết bài</span>
                        )
                      ) : (
                        <span className="submit-state not-submitted">Chưa nộp bài</span>
                      )}
                    </div>

                    <span>
                      {hasSubmitted
                        ? `Điểm bài nộp: ${studentScoreText(student)}`
                        : 'Chưa nộp bài'}
                    </span>

                    {hasSubmitted && results.length > 0 && (
                      <div className="student-question-score-pills">
                        <span className="pill-correct"><CheckCircle2 size={13} /> Đúng {correctCount}/{results.length} câu</span>
                        {wrongCount > 0 && <span className="pill-wrong"><XCircle size={13} /> Sai {wrongCount} câu</span>}
                      </div>
                    )}

                    {hasSubmitted && <div className="student-total-score"><div><span>ĐIỂM NỘP CHÍNH THỨC</span><strong>{formatScoreValue(student.score)}<small>/{formatScoreValue(student.maxScore)} điểm</small></strong></div><b>{Math.round(Number(student.percentage) || 0)}%</b></div>}
                    {student.summary && <div className="student-ai-overview"><Bot size={15} /><div><strong>Đánh giá chung của AI</strong><p>{student.summary}</p></div></div>}
                    {student.weakTopics?.length ? <small>Cần ôn: {student.weakTopics.map((t) => `${t.topic} (${t.mastery}%)`).join(', ')}</small> : null}

                    {results.length > 0 ? (
                      <details className="latest-attempt-detail" open={hasSubmitted}>
                        <summary>
                          <span>Xem chi tiết câu đúng &amp; câu sai của học sinh</span>
                          <b>{correctCount}/{results.length} câu đúng · {studentScoreText(student)}</b>
                        </summary>
                        <article>
                          {student.submittedAt && <small>Nộp lúc: {new Date(student.submittedAt).toLocaleString('vi-VN')}</small>}
                          <div className="latest-attempt-results">
                            {results.map((result, index) => {
                              const question = questions.find((item) => Number(item.id) === Number(result.questionId));
                              return (
                                <div className={`latest-attempt-question ${result.isCorrect ? 'correct' : 'wrong'}`} key={result.questionId ?? index}>
                                  <div className="latest-attempt-question-head">
                                    <strong>Câu {index + 1} {result.isCorrect ? '· Đúng' : '· Sai'}</strong>
                                    <span>{result.awarded}/{result.points} điểm</span>
                                  </div>
                                  {question?.prompt && (() => { const parts = splitQuestionPrompt(question.prompt); return <><SharedContext text={parts.sharedContext} /><p className="latest-question-prompt"><FormattedQuestionText text={parts.prompt} /></p></>; })()}
                                  <div className="latest-answer-box">
                                    <p><b>Bài làm:</b> {result.answer || '—'}</p>
                                    <p><b>AI nhận xét:</b> {result.feedback || (result.isCorrect ? 'Đúng.' : 'Cần xem lại.')}</p>
                                    {!result.isCorrect && (result.referenceAnswer || question?.correctAnswer) && (
                                      <p><b>Đáp án tham khảo:</b> {result.referenceAnswer || question?.correctAnswer}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      </details>
                    ) : null}
                    {hasSubmitted && <TeacherFeedbackEditor assignmentId={assignmentId} student={student} onSaved={updateSavedReview} />}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty>Lớp chưa có học sinh.</Empty>}
        <Pagination pagination={report?.pagination} loading={reportLoading} onPageChange={setReportPage} label="học sinh" />
      </section>
    </div>
  </div>;
}

export { formatScoreValue, studentScoreText };
