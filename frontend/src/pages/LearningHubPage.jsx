import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    if (!classId) {
      setWords([]);
      return;
    }
    try {
      // Không truyền page/pageSize => backend trả toàn bộ học liệu của lớp.
      const data = await api(`/classes/${classId}/vocabulary`);
      setWords(data.vocabulary || []);
      setMessage('');
    } catch (err) {
      setMessage(err.message);
    }
  }, [classId]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const grammar = useMemo(() => {
    const map = new Map();
    words.forEach((word) => {
      const items = Array.isArray(word.grammar) ? word.grammar : [];
      items.forEach((title) => {
        const cleanTitle = String(title || '').trim();
        if (!cleanTitle) return;
        const key = `${word.lessonId}:${cleanTitle}`;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            title: cleanTitle,
            body: `Ngữ pháp trọng tâm của ${word.lessonTitle ? `Bài ${word.lessonId} · ${word.lessonTitle}` : `Bài ${word.lessonId}`}.`,
            lessonId: Number(word.lessonId),
            lessonTitle: word.lessonTitle || '',
          });
        }
      });
    });
    return [...map.values()];
  }, [words]);

  const postToFrame = useCallback((payload) => {
    if (!frameReady || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage(payload, window.location.origin);
  }, [frameReady]);

  const syncToLearningEngine = useCallback(() => {
    postToFrame({
      type: 'CLASSROOM_LEARNING_SYNC',
      classId: classId || null,
      words: words.map((word) => ({
        id: Number(word.id),
        korean: word.korean,
        roman: word.romanization || '',
        meaning: word.meaningVi,
        pos: word.partOfSpeech || '',
        example: word.exampleKr || '',
        exampleViet: word.exampleVi || '',
        lesson: word.lessonTitle ? `Bài ${word.lessonId} · ${word.lessonTitle}` : `Bài ${word.lessonId}`,
      })),
      grammar: grammar.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body || '',
        lesson: item.lessonTitle ? `Bài ${item.lessonId} · ${item.lessonTitle}` : `Bài ${item.lessonId}`,
        lessonId: Number(item.lessonId),
      })),
    });

    if (settings) {
      postToFrame({ type: 'CLASSROOM_SETTINGS_SYNC', settings });
    }
  }, [classId, grammar, postToFrame, settings, words]);

  useEffect(() => {
    syncToLearningEngine();
  }, [syncToLearningEngine]);

  useEffect(() => {
    const allowedBridgePaths = new Set(['/learning/ai', '/learning/state', '/learning/settings']);

    const handleBridge = async (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data || {};
      const replyToFrame = (payload) => event.source?.postMessage(payload, window.location.origin);

      // Iframe báo đã hydrate xong state server -> gửi lại học liệu lớp lần cuối,
      // tránh state cũ ghi đè từ vựng/ngữ pháp giáo viên vừa giao.
      if (data.type === 'CLASSROOM_LEARNING_READY') {
        setTimeout(syncToLearningEngine, 0);
        return;
      }

      if (data.type === 'CLASSROOM_API_REQUEST' && data.requestId) {
        const path = String(data.path || '');
        const method = String(data.method || 'GET').toUpperCase();

        if (!allowedBridgePaths.has(path) || !['GET', 'POST', 'PUT'].includes(method)) {
          replyToFrame({
            type: 'CLASSROOM_API_RESPONSE',
            requestId: data.requestId,
            ok: false,
            message: 'Yêu cầu từ Phòng tự học không được phép.',
          });
          return;
        }

        try {
          const options = { method, toast: false };
          if (data.body !== undefined && method !== 'GET') options.body = JSON.stringify(data.body);
          const result = await api(path, options);
          replyToFrame({
            type: 'CLASSROOM_API_RESPONSE',
            requestId: data.requestId,
            ok: true,
            data: result,
          });
        } catch (error) {
          replyToFrame({
            type: 'CLASSROOM_API_RESPONSE',
            requestId: data.requestId,
            ok: false,
            message: error.message || 'Không thể kết nối máy chủ Classroom.',
          });
        }
        return;
      }

      // Tương thích với bản legacy bridge cũ.
      if (data.type === 'CLASSROOM_AI_REQUEST' && data.requestId) {
        try {
          const result = await api('/learning/ai', {
            method: 'POST',
            toast: false,
            body: JSON.stringify(data.payload || {}),
          });
          replyToFrame({
            type: 'CLASSROOM_AI_RESPONSE',
            requestId: data.requestId,
            ok: true,
            text: result.text || '',
          });
        } catch (error) {
          replyToFrame({
            type: 'CLASSROOM_AI_RESPONSE',
            requestId: data.requestId,
            ok: false,
            message: error.message || 'AI tạm thời không phản hồi.',
          });
        }
      }
    };

    window.addEventListener('message', handleBridge);
    return () => window.removeEventListener('message', handleBridge);
  }, [syncToLearningEngine]);

  const refresh = async () => {
    await loadWords();
  };

  return (
    <section className="legacy-learning-page">
      <div className="learning-toolbar">
        <div className="learning-title">
          <BookOpenCheck size={19} />
          <div>
            <strong>Phòng tự học đầy đủ</strong>
            <span>Đã tích hợp bộ tự học mới vào Classroom · từ vựng & ngữ pháp được đồng bộ theo lớp · AI dùng cấu hình hệ thống</span>
          </div>
        </div>

        <div className="learning-sync">
          {classes.length ? (
            <select
              aria-label="Chọn lớp để đồng bộ học liệu"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          ) : <span>Chưa có lớp</span>}

          <b>{words.length} từ · {grammar.length} ngữ pháp</b>
          <span className="learning-ai-safe" title="API AI do Admin quản lý ở backend">
            <ShieldCheck size={14} /> AI server
          </span>
          <button className="icon-button" onClick={refresh} title="Đồng bộ lại từ vựng & ngữ pháp">
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      {message && <div className="learning-message">{message}</div>}

      <iframe
        ref={frameRef}
        onLoad={() => setFrameReady(true)}
        className="legacy-learning-frame"
        src="/legacy/index.html"
        title="HanQuoc Learning - đầy đủ chế độ học"
      />
    </section>
  );
}
