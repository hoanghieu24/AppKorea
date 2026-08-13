import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';

export default function LearningHubPage({ user }) {
  const frameRef = useRef(null);
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [words, setWords] = useState([]);
  const [settings, setSettings] = useState(null);
  const [frameReady, setFrameReady] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([api('/classes'), api('/learning/settings')]).then(([classData, settingsData]) => {
      const items = classData.classes || [];
      setClasses(items);
      if (items[0]) setClassId(String(items[0].id));
      setSettings(settingsData.settings || null);
    }).catch((err) => setMessage(err.message));
  }, []);

  const loadWords = useCallback(async () => {
    if (!classId) { setWords([]); return; }
    try {
      const data = await api(`/classes/${classId}/vocabulary`);
      setWords(data.vocabulary || []);
      setMessage('');
    } catch (err) { setMessage(err.message); }
  }, [classId]);
  useEffect(() => { loadWords(); }, [loadWords]);

  const postToFrame = useCallback((payload) => {
    if (!frameReady || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage(payload, window.location.origin);
  }, [frameReady]);

  const syncToLearningEngine = useCallback(() => {
    postToFrame({
      type: 'CLASSROOM_VOCAB_SYNC', classId: classId || null,
      words: words.map((word) => ({
        id: Number(word.id), korean: word.korean, roman: word.romanization || '', meaning: word.meaningVi,
        pos: word.partOfSpeech || '', example: word.exampleKr || '', exampleViet: word.exampleVi || '',
        lesson: word.lessonTitle ? `Bài ${word.lessonId} · ${word.lessonTitle}` : `Bài ${word.lessonId}`,
      })),
    });
    if (settings) postToFrame({ type: 'CLASSROOM_SETTINGS_SYNC', settings });
  }, [classId, postToFrame, settings, words]);
  useEffect(() => { syncToLearningEngine(); }, [syncToLearningEngine]);

  useEffect(() => {
    const handleBridge = async (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data || {};
      if (data.type !== 'CLASSROOM_AI_REQUEST' || !data.requestId) return;
      try {
        const result = await api('/learning/ai', { method: 'POST', toast: false, body: JSON.stringify(data.payload || {}) });
        postToFrame({ type: 'CLASSROOM_AI_RESPONSE', requestId: data.requestId, ok: true, text: result.text || '' });
      } catch (error) {
        postToFrame({ type: 'CLASSROOM_AI_RESPONSE', requestId: data.requestId, ok: false, message: error.message || 'AI tạm thời không phản hồi.' });
      }
    };
    window.addEventListener('message', handleBridge);
    return () => window.removeEventListener('message', handleBridge);
  }, [postToFrame]);

  const refresh = async () => { await loadWords(); setTimeout(syncToLearningEngine, 0); };
  return <section className="legacy-learning-page">
    <div className="learning-toolbar">
      <div className="learning-title"><BookOpenCheck size={19} /><div><strong>Phòng tự học đầy đủ</strong><span>Đã tích hợp toàn bộ bộ tự học vào Classroom · AI dùng cấu hình hệ thống, không lưu API key trong trình duyệt</span></div></div>
      <div className="learning-sync">
        {classes.length ? <select aria-label="Chọn lớp để đồng bộ từ vựng" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <span>Chưa có lớp</span>}
        <b>{words.length} từ của lớp</b>
        <span className="learning-ai-safe" title="API AI do Admin quản lý ở backend"><ShieldCheck size={14} /> AI server</span>
        <button className="icon-button" onClick={refresh} title="Đồng bộ lại từ vựng"><RefreshCw size={17} /></button>
      </div>
    </div>
    {message && <div className="learning-message">{message}</div>}
    <iframe ref={frameRef} onLoad={() => setFrameReady(true)} className="legacy-learning-frame" src="/legacy/index.html" title="HanQuoc Learning - đầy đủ chế độ học" />
  </section>;
}
