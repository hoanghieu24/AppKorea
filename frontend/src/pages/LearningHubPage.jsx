import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';

const CLASSROOM_STUDY_AIDS = Object.freeze({
  위: { roman: 'wi', tip: '위 = trên: tưởng tượng chữ 위 đang nằm phía trên một chiếc bàn. Nhớ cụm 책상 위에 = ở trên bàn.', example: '책이 책상 위에 있어요.', exampleViet: 'Quyển sách ở trên bàn.' },
  아래: { roman: 'arae', tip: '아래 = dưới: hình dung mũi tên ↓ kéo chữ 아래 xuống dưới. 책상 아래에 = ở dưới bàn.', example: '가방이 의자 아래에 있어요.', exampleViet: 'Cái cặp ở dưới ghế.' },
  안: { roman: 'an', tip: '안 = trong: tưởng tượng đặt chữ 안 vào trong một chiếc hộp. 가방 안에 = ở trong cặp.', example: '책이 가방 안에 있어요.', exampleViet: 'Quyển sách ở trong cặp.' },
  밖: { roman: 'bak', tip: '밖 = ngoài: tưởng tượng bật chữ 밖 ra ngoài cánh cửa. 집 밖에 = ở ngoài nhà.', example: '사람이 집 밖에 있어요.', exampleViet: 'Có người ở ngoài nhà.' },
  옆: { roman: 'yeop', tip: '옆 = bên cạnh: hình dung hai đồ vật đứng sát cạnh nhau. 의자 옆에 = ở bên cạnh ghế.', example: '가방이 의자 옆에 있어요.', exampleViet: 'Cái cặp ở bên cạnh ghế.' },
  사이: { roman: 'sai', tip: '사이 = giữa: chữ 사이 chen vào giữa hai vật. A와 B 사이에 = ở giữa A và B.', example: '은행과 식당 사이에 카페가 있어요.', exampleViet: 'Quán cà phê ở giữa ngân hàng và nhà hàng.' },
  앞: { roman: 'ap', tip: '앞 = trước: liên tưởng “áp” sát về phía trước. 학교 앞에 = ở trước trường.', example: '학교 앞에서 만나요.', exampleViet: 'Chúng ta gặp nhau trước trường nhé.' },
  뒤: { roman: 'dwi', tip: '뒤 = sau: liên tưởng “đuôi” luôn nằm phía sau. 건물 뒤에 = ở sau tòa nhà.', example: '건물 뒤에 주차장이 있어요.', exampleViet: 'Bãi đỗ xe ở phía sau tòa nhà.' },
  왼쪽: { roman: 'oenjjok', tip: '왼쪽 = bên trái: 왼 là trái, 쪽 là phía. Tách từ ra là nhớ ngay “phía trái”.', example: '왼쪽으로 가세요.', exampleViet: 'Hãy đi về phía bên trái.' },
  오른쪽: { roman: 'oreunjjok', tip: '오른쪽 = bên phải: 오른 là phải, 쪽 là phía. Tách từ ra là “phía phải”.', example: '오른쪽으로 가세요.', exampleViet: 'Hãy đi về phía bên phải.' },
  양쪽: { roman: 'yangjjok', tip: '양쪽 = hai phía: 양 là cả hai, 쪽 là phía → cả hai phía.', example: '길 양쪽에 나무가 많아요.', exampleViet: 'Hai bên đường có nhiều cây.' },
  건너편: { roman: 'geonneopyeon', tip: '건너편 = phía đối diện: 건너 là băng qua, 편 là phía → phía bên kia đường.', example: '은행은 학교 건너편에 있어요.', exampleViet: 'Ngân hàng ở đối diện trường học.' },
  맞은편: { roman: 'majeunpyeon', tip: '맞은편 = đối diện: 맞다 gợi ý “đối mặt”, 편 là phía → phía đối mặt với mình.', example: '우체국 맞은편에 약국이 있어요.', exampleViet: 'Hiệu thuốc ở đối diện bưu điện.' },
  똑바로: { roman: 'ttokbaro', tip: '똑바로 = thẳng: tưởng tượng một đường thẳng tắp, không nghiêng và không rẽ.', example: '똑바로 가세요.', exampleViet: 'Hãy đi thẳng.' },
  쭉: { roman: 'jjuk', tip: '쭉 có âm kéo dài, hãy tưởng tượng đi thẳng một mạch thật dài: 쭉 가세요.', example: '이 길로 쭉 가세요.', exampleViet: 'Hãy đi thẳng theo con đường này.' },
  동: { roman: 'dong', tip: '동 = đông. Âm “dong” gần với “đông”, nên gần như đọc lên là nhớ nghĩa.', example: '해는 동쪽에서 떠요.', exampleViet: 'Mặt trời mọc ở phía đông.' },
  서: { roman: 'seo', tip: '서 = tây. Học theo cụm 동서남북 = đông – tây – nam – bắc để nhớ theo một chuỗi.', example: '서쪽으로 가세요.', exampleViet: 'Hãy đi về phía tây.' },
  남: { roman: 'nam', tip: '남 = nam. Chữ Hàn đọc gần hệt tiếng Việt “nam”.', example: '남쪽은 따뜻해요.', exampleViet: 'Phía nam ấm áp.' },
  북: { roman: 'buk', tip: '북 = bắc. Nhớ chung chuỗi 동서남북 = đông – tây – nam – bắc.', example: '북쪽은 추워요.', exampleViet: 'Phía bắc lạnh.' },
});

export function classroomStudyWord(word = {}) {
  const korean = String(word.korean || '').trim();
  const meaning = String(word.meaningVi || word.meaning || '').trim();
  const aids = CLASSROOM_STUDY_AIDS[korean] || {};
  const roman = String(word.romanization || word.roman || aids.roman || '').trim();
  const providedTip = String(word.memoryTip || word.tip || '').trim();
  const fallbackTip = roman
    ? `Đọc “${roman}” và gắn ngay với hình ảnh “${meaning}”. Nói “${korean} = ${meaning}” 3 lần rồi tự đặt một câu ngắn.`
    : `Hình dung một cảnh có “${meaning}”, sau đó dán nhãn ${korean} lên hình ảnh đó và đọc to 3 lần.`;

  return {
    korean,
    roman,
    meaning,
    pos: word.partOfSpeech || word.pos || '',
    tip: providedTip || aids.tip || fallbackTip,
    example: word.exampleKr || word.example || aids.example || '',
    exampleViet: word.exampleVi || word.exampleViet || aids.exampleViet || '',
  };
}

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
        ...classroomStudyWord(word),
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
    const allowedBridgePaths = new Set(['/learning/ai', '/learning/state', '/learning/settings', '/tts']);

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
