import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { wordsApi } from '../api/content';
import { progressApi } from '../api/progress';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestions(words, count = 10) {
  const sh = shuffle(words);
  const n = Math.min(sh.length, count);
  return sh.slice(0, n).map((w) => ({ word: w, type: Math.random() > 0.5 ? 'kr2vn' : 'vn2kr' }));
}

function buildChoices(question, pool) {
  const correctVal = question.type === 'kr2vn' ? question.word.meaning : question.word.korean;
  const others = pool.filter((w) => w.korean !== question.word.korean);
  const wrongPool = shuffle(others).slice(0, 3).map((w) => (question.type === 'kr2vn' ? w.meaning : w.korean));
  return shuffle([correctVal, ...wrongPool]);
}

const RESULT_TIERS = [
  { min: 90, emoji: '🏆', msg: 'Xuất sắc!' },
  { min: 70, emoji: '😎', msg: 'Tốt lắm!' },
  { min: 50, emoji: '😊', msg: 'Khá tốt!' },
  { min: 0, emoji: '😅', msg: 'Cần luyện thêm!' },
];

export default function QuizPage() {
  const qc = useQueryClient();
  const { data: words, isLoading } = useQuery({ queryKey: ['words'], queryFn: () => wordsApi.list() });
  const xpMutation = useMutation({ mutationFn: progressApi.grantXP, onSuccess: () => qc.invalidateQueries({ queryKey: ['progress', 'me'] }) });

  const [questions, setQuestions] = useState(null);
  const [current, setCurrent] = useState(0);
  const [choices, setChoices] = useState([]);
  const [answered, setAnswered] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const pool = useMemo(() => words || [], [words]);

  function start() {
    const qs = buildQuestions(pool);
    setQuestions(qs);
    setCurrent(0);
    setScore(0);
    setFinished(false);
    setAnswered(false);
    setChosen(null);
    setChoices(buildChoices(qs[0], pool));
  }

  function answer(value) {
    if (answered || !questions) return;
    const q = questions[current];
    const correct = q.type === 'kr2vn' ? q.word.meaning : q.word.korean;
    const ok = value === correct;
    setAnswered(true);
    setChosen(value);
    if (ok) {
      setScore((s) => s + 1);
      xpMutation.mutate(10);
    }
  }

  function next() {
    const nextIdx = current + 1;
    if (nextIdx >= questions.length) {
      setFinished(true);
      const pct = Math.round((score / questions.length) * 100);
      xpMutation.mutate(pct);
      return;
    }
    setCurrent(nextIdx);
    setChoices(buildChoices(questions[nextIdx], pool));
    setAnswered(false);
    setChosen(null);
  }

  if (isLoading) return <MainLayout title="❓ Trắc nghiệm"><Loader /></MainLayout>;

  if (pool.length < 4) {
    return (
      <MainLayout title="❓ Trắc nghiệm">
        <EmptyState icon="❓" title="Cần ít nhất 4 từ vựng để bắt đầu trắc nghiệm." />
      </MainLayout>
    );
  }

  if (!questions) {
    return (
      <MainLayout title="❓ Trắc nghiệm">
        <div className="quiz-container" style={{ textAlign: 'center', paddingTop: 40 }}>
          <p style={{ marginBottom: 20 }}>Sẵn sàng kiểm tra {Math.min(pool.length, 10)} từ vựng ngẫu nhiên?</p>
          <button className="btn btn-primary btn-lg" onClick={start}>🚀 Bắt đầu</button>
        </div>
      </MainLayout>
    );
  }

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    const tier = RESULT_TIERS.find((t) => pct >= t.min);
    return (
      <MainLayout title="❓ Trắc nghiệm">
        <div className="quiz-result">
          <div style={{ fontSize: '3rem' }}>{tier.emoji}</div>
          <h2>{tier.msg}</h2>
          <p style={{ fontSize: '1.3rem', fontWeight: 800 }}>{score} / {questions.length} ({pct}%)</p>
          <button className="btn btn-primary" onClick={start}>🔄 Làm lại</button>
        </div>
      </MainLayout>
    );
  }

  const q = questions[current];
  const correct = q.type === 'kr2vn' ? q.word.meaning : q.word.korean;

  return (
    <MainLayout title="❓ Trắc nghiệm">
      <div className="quiz-container">
        <div className="quiz-score-bar" style={{ marginBottom: 10 }}>
          <span>🏆 {score} / {current}</span>
        </div>
        <div className="progress-bar-wrapper">
          <div className="progress-bar-fill" style={{ width: `${(current / questions.length) * 100}%` }} />
        </div>
        <span className="quiz-type-badge">{q.type === 'kr2vn' ? '🇰🇷 → 🇻🇳 Chọn nghĩa tiếng Việt' : '🇻🇳 → 🇰🇷 Chọn từ tiếng Hàn'}</span>
        <div className="quiz-question" style={q.type === 'vn2kr' ? { fontFamily: "'Be Vietnam Pro',sans-serif" } : {}}>
          {q.type === 'kr2vn' ? q.word.korean : q.word.meaning}
        </div>
        <p className="quiz-hint">{q.type === 'kr2vn' ? q.word.roman : q.word.pos}</p>

        <div className="quiz-options">
          {choices.map((c) => {
            let cls = 'quiz-option';
            if (answered && c === correct) cls += ' correct';
            else if (answered && c === chosen) cls += ' wrong';
            return (
              <button key={c} className={cls} disabled={answered} onClick={() => answer(c)} style={q.type === 'vn2kr' ? { fontFamily: "'Noto Sans KR',sans-serif" } : {}}>
                {c}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`quiz-feedback ${chosen === correct ? 'feedback-correct' : 'feedback-wrong'}`} style={{ display: 'block' }}>
            {chosen === correct ? '🎉 Chính xác! +10 XP' : `❌ Sai rồi! Đáp án: ${correct}`}
          </div>
        )}

        {answered && (
          <button className="btn btn-primary quiz-next-btn" onClick={next}>
            {current + 1 >= questions.length ? 'Xem kết quả →' : 'Câu tiếp theo →'}
          </button>
        )}
      </div>
    </MainLayout>
  );
}
