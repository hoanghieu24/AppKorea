import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '../layouts/MainLayout';
import { wordsApi, lessonsApi } from '../api/content';
import { progressApi } from '../api/progress';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { useToast } from '../components/Toast';

function speakKorean(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ko-KR';
  utter.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const XP_BY_RATING = { easy: 10, medium: 5, hard: 2 };

export default function FlashcardPage() {
  const showToast = useToast();
  const qc = useQueryClient();
  const [lessonFilter, setLessonFilter] = useState('all');
  const [deck, setDeck] = useState([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const { data: lessons } = useQuery({ queryKey: ['lessons'], queryFn: lessonsApi.list });
  const { data: words, isLoading } = useQuery({ queryKey: ['words'], queryFn: () => wordsApi.list() });

  const pool = useMemo(
    () => (words || []).filter((w) => lessonFilter === 'all' || w.lessonId === Number(lessonFilter)),
    [words, lessonFilter]
  );

  useEffect(() => {
    setDeck(shuffle(pool));
    setIndex(0);
    setFlipped(false);
  }, [pool.length, lessonFilter]);

  const progressMutation = useMutation({ mutationFn: ({ id, data }) => wordsApi.updateProgress(id, data) });
  const xpMutation = useMutation({
    mutationFn: progressApi.grantXP,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['progress', 'me'] }),
  });

  const word = deck[index];

  function flip() {
    setFlipped((f) => {
      if (!f && word) speakKorean(word.korean);
      return !f;
    });
  }

  function goNext() {
    setIndex((i) => (i + 1) % deck.length);
    setFlipped(false);
  }
  function goPrev() {
    setIndex((i) => (i - 1 + deck.length) % deck.length);
    setFlipped(false);
  }
  function reshuffle() {
    setDeck(shuffle(deck));
    setIndex(0);
    setFlipped(false);
    showToast('🔀 Đã trộn thẻ', 'info', 1200);
  }
  function rate(r) {
    if (word) {
      progressMutation.mutate({ id: word.id, data: { known: r === 'easy', incrementSeen: true } });
      xpMutation.mutate(XP_BY_RATING[r]);
      showToast(`+${XP_BY_RATING[r]} XP`, 'success', 1200);
    }
    goNext();
  }

  if (isLoading) return <MainLayout title="🃏 Flashcard"><Loader /></MainLayout>;

  if (!pool.length) {
    return (
      <MainLayout title="🃏 Flashcard">
        <EmptyState icon="🃏" title="Không có từ vựng nào để ôn trong bài học này." />
      </MainLayout>
    );
  }

  if (!deck.length) return <MainLayout title="🃏 Flashcard"><Loader label="Đang chuẩn bị bộ thẻ..." /></MainLayout>;

  return (
    <MainLayout title="🃏 Flashcard">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select className="lesson-select" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '9px 14px', borderRadius: 'var(--radius)' }} value={lessonFilter} onChange={(e) => setLessonFilter(e.target.value)}>
          <option value="all">Tất cả bài học</option>
          {lessons?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={reshuffle}>🔀 Trộn thẻ</button>
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <div className="progress-bar-wrapper">
          <div className="progress-bar-fill" style={{ width: `${((index + 1) / deck.length) * 100}%` }} />
        </div>
        <p className="stat-label" style={{ textAlign: 'center', marginBottom: 14 }}>{index + 1} / {deck.length}</p>

          <div className="flashcard-scene" onClick={flip}>
            <div className={`flashcard ${flipped ? 'flipped' : ''}`}>
              <div className="flashcard-front">
                <div style={{ fontFamily: "'Noto Sans KR',sans-serif", fontSize: '2.4rem', fontWeight: 900 }}>{word?.korean}</div>
                <span className="word-pos" style={{ marginTop: 10 }}>{word?.pos}</span>
                <p className="stat-label" style={{ marginTop: 10 }}>{word?.roman}</p>
                <p className="helper-text" style={{ marginTop: 18 }}>👆 Chạm để lật thẻ</p>
              </div>
              <div className="flashcard-back">
                <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{word?.meaning}</div>
                {word?.example && <p style={{ fontFamily: "'Noto Sans KR',sans-serif", marginTop: 12, textAlign: 'center' }}>{word.example}</p>}
                {word?.exampleViet && <p className="stat-label" style={{ marginTop: 4, textAlign: 'center' }}>{word.exampleViet}</p>}
                {word?.tip && <p className="helper-text" style={{ marginTop: 12, textAlign: 'center' }}>💡 {word.tip}</p>}
              </div>
            </div>
          </div>

          {flipped && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => rate('hard')}>😓 Khó (+2 XP)</button>
              <button className="btn btn-secondary" onClick={() => rate('medium')}>🙂 Tạm ổn (+5 XP)</button>
              <button className="btn btn-success" onClick={() => rate('easy')}>😎 Dễ (+10 XP)</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={goPrev}>← Trước</button>
            <button className="btn btn-ghost" onClick={goNext}>Sau →</button>
          </div>
        </div>
    </MainLayout>
  );
}
