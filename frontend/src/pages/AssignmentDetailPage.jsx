import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { assignmentsApi, submissionsApi } from '../api/assignments';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import Loader from '../components/Loader';
import { apiErrorMessage } from '../api/client';

const RESULT_STATUS_LABEL = { correct: '✅ Đúng', imperfect: '🟡 Gần đúng', wrong: '❌ Sai' };

export default function AssignmentDetailPage() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const showToast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isTeacher = user.role === 'teacher';

  const { data, isLoading } = useQuery({ queryKey: ['assignments', id], queryFn: () => assignmentsApi.get(id) });

  if (isLoading || !data) return <MainLayout title="📑 Bài tập"><Loader /></MainLayout>;

  const { assignment } = data;

  return (
    <MainLayout title={assignment.title}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/assignments')} style={{ marginBottom: 16 }}>← Quay lại</button>
      {assignment.description && <p className="stat-label" style={{ marginBottom: 18 }}>{assignment.description}</p>}

      {isTeacher ? (
        <TeacherView assignment={assignment} submissions={data.submissions} qc={qc} showToast={showToast} />
      ) : (
        <StudentView assignmentId={id} assignment={assignment} mySubmission={data.mySubmission} qc={qc} showToast={showToast} />
      )}
    </MainLayout>
  );
}

/* ================= STUDENT VIEW ================= */
function StudentView({ assignmentId, assignment, mySubmission, qc, showToast }) {
  const [answers, setAnswers] = useState(() => {
    const init = {};
    (assignment.questions || []).forEach((q) => { init[q.id] = mySubmission?.answers?.[q.id] || ''; });
    return init;
  });

  const submitMutation = useMutation({
    mutationFn: () => assignmentsApi.submit(assignmentId, answers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments', assignmentId] });
      qc.invalidateQueries({ queryKey: ['progress', 'me'] });
      showToast('✅ Đã nộp bài! AI đang chấm điểm...', 'success');
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  const graded = mySubmission?.status === 'graded';
  const readOnly = mySubmission && mySubmission.status !== 'pending';

  return (
    <div style={{ maxWidth: 700 }}>
      {graded && mySubmission.aiResult && (
        <div className="grade-result-box ok">
          <div className="grade-score">{mySubmission.aiResult.grade || `${mySubmission.aiResult.scorePct}%`}</div>
          <p style={{ marginTop: 8 }}>{mySubmission.aiResult.feedback}</p>
          {mySubmission.teacherScore != null && (
            <p className="stat-label" style={{ marginTop: 8 }}>👩‍🏫 Giáo viên chấm: {mySubmission.teacherScore} — {mySubmission.teacherFeedback}</p>
          )}
        </div>
      )}
      {mySubmission?.status === 'submitted' && !mySubmission.aiResult && (
        <div className="grade-result-box" style={{ background: 'rgba(221,165,58,0.08)', border: '1px solid rgba(221,165,58,0.28)' }}>
          <p>⏳ Bài đã nộp, đang chờ chấm điểm (AI hoặc giáo viên).</p>
        </div>
      )}

      {(assignment.questions || []).map((q, i) => {
        const result = mySubmission?.aiResult?.results?.find((r) => r.questionNum === i + 1);
        return (
          <div className="question-card" key={q.id}>
            <div className="question-num">Câu {i + 1}</div>
            <div className="question-prompt">{q.prompt}</div>
            {q.hint && <div className="question-hint">💡 {q.hint}</div>}
            <input
              className="settings-input question-answer-input"
              value={answers[q.id] || ''}
              disabled={readOnly}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              placeholder="Nhập câu trả lời..."
            />
            {result && (
              <div style={{ marginTop: 10, fontSize: '0.88rem' }}>
                <span className={`result-status-${result.status}`}>{RESULT_STATUS_LABEL[result.status]}</span>
                {result.status !== 'correct' && <p className="stat-label" style={{ marginTop: 4 }}>Đáp án gợi ý: {result.correctAnswer}</p>}
                <p className="stat-label" style={{ marginTop: 4 }}>{result.explanation}</p>
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <button className="btn btn-primary btn-lg" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
          {submitMutation.isPending ? 'Đang nộp...' : '📤 Nộp bài'}
        </button>
      )}
    </div>
  );
}

/* ================= TEACHER VIEW ================= */
function TeacherView({ assignment, submissions, qc, showToast }) {
  const [openId, setOpenId] = useState(null);

  return (
    <div>
      <div className="section-title">📋 Câu hỏi ({assignment.questions?.length ?? 0})</div>
      {(assignment.questions || []).map((q, i) => (
        <div className="question-card" key={q.id}>
          <div className="question-num">Câu {i + 1}</div>
          <div className="question-prompt">{q.prompt}</div>
          {q.hint && <div className="question-hint">💡 {q.hint}</div>}
        </div>
      ))}

      <div className="section-title">🧑‍🎓 Bài nộp của học sinh ({submissions?.length ?? 0})</div>
      {submissions?.map((s) => (
        <SubmissionRow key={s.id} submission={s} assignment={assignment} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} qc={qc} showToast={showToast} />
      ))}
    </div>
  );
}

function SubmissionRow({ submission, assignment, open, onToggle, qc, showToast }) {
  const [teacherScore, setTeacherScore] = useState(submission.teacherScore ?? '');
  const [teacherFeedback, setTeacherFeedback] = useState(submission.teacherFeedback ?? '');

  const gradeMutation = useMutation({
    mutationFn: () => submissionsApi.grade(submission.id, { teacherScore: teacherScore || null, teacherFeedback }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments', String(assignment.id)] });
      showToast('✅ Đã lưu điểm', 'success');
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  const regradeMutation = useMutation({
    mutationFn: () => submissionsApi.regrade(submission.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments', String(assignment.id)] });
      showToast('🤖 AI đã chấm lại', 'success');
    },
    onError: (err) => showToast(apiErrorMessage(err), 'error'),
  });

  return (
    <div className="assignment-item" style={{ marginBottom: 12, cursor: 'pointer' }}>
      <div className="assignment-top" onClick={onToggle}>
        <div>
          <div className="assignment-title">{submission.student.name}</div>
          <div className="stat-label">{submission.student.email}</div>
        </div>
        <span className={`status-pill status-${submission.status}`}>
          {submission.status === 'graded' ? 'Đã chấm' : submission.status === 'submitted' ? 'Đã nộp' : 'Chưa làm'}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }} onClick={(e) => e.stopPropagation()}>
          {(assignment.questions || []).map((q, i) => (
            <div key={q.id} style={{ marginBottom: 10, fontSize: '0.9rem' }}>
              <strong>Câu {i + 1}:</strong> {q.prompt}
              <div className="stat-label">✏️ Trả lời: {submission.answers?.[q.id] || '(chưa làm)'}</div>
            </div>
          ))}

          {submission.aiResult && (
            <div className="grade-result-box ok" style={{ textAlign: 'left', margin: '12px 0' }}>
              <strong>🤖 AI chấm: {submission.aiResult.grade}</strong>
              <p style={{ marginTop: 6 }}>{submission.aiResult.feedback}</p>
            </div>
          )}

          <div className="form-row">
            <div>
              <label className="field-label">Điểm giáo viên (0-10)</label>
              <input type="number" min={0} max={10} step={0.5} className="settings-input" value={teacherScore} onChange={(e) => setTeacherScore(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="field-label">Nhận xét</label>
            <input className="settings-input" value={teacherFeedback} onChange={(e) => setTeacherFeedback(e.target.value)} placeholder="Nhận xét cho học sinh..." />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => gradeMutation.mutate()} disabled={gradeMutation.isPending}>💾 Lưu điểm</button>
            {submission.status !== 'pending' && (
              <button className="btn btn-ghost btn-sm" onClick={() => regradeMutation.mutate()} disabled={regradeMutation.isPending}>
                {regradeMutation.isPending ? '🤖 Đang chấm...' : '🤖 Chấm lại bằng AI'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
