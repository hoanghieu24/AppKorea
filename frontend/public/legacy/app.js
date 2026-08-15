/* =============================================
   HanQuoc Learn AI - Main App + Gemini AI
   ============================================= */
'use strict';

function classroomSession() {
  try { return JSON.parse(localStorage.getItem('hanquoc_classroom_session') || 'null'); }
  catch { return null; }
}

function classroomScopedStorageKey(baseKey) {
  const userId = classroomSession()?.user?.id;
  return userId ? `${baseKey}_user_${userId}` : baseKey;
}

const CLASSROOM_BRIDGE = (() => {
  let seq = 0;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type !== 'CLASSROOM_API_RESPONSE' || !data.requestId) return;

    const req = pending.get(data.requestId);
    if (!req) return;

    pending.delete(data.requestId);
    clearTimeout(req.timer);
    if (data.ok) req.resolve(data.data ?? {});
    else req.reject(new Error(data.message || 'Không thể kết nối API Classroom.'));
  });

  function request(path, { method = 'GET', body, timeout = 60000 } = {}) {
    if (window.parent === window) return Promise.reject(new Error('CLASSROOM_BRIDGE_UNAVAILABLE'));

    return new Promise((resolve, reject) => {
      const requestId = `classroom_${Date.now()}_${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Classroom API phản hồi quá lâu.'));
      }, timeout);

      pending.set(requestId, { resolve, reject, timer });
      window.parent.postMessage({
        type: 'CLASSROOM_API_REQUEST',
        requestId,
        path,
        method,
        body,
      }, window.location.origin);
    });
  }

  return { request };
})();

function classroomApi(path, options = {}) {
  return CLASSROOM_BRIDGE.request(path, options);
}

function learningStateStorageKey() {
  return classroomScopedStorageKey('hq_state');
}

// ============ GEMINI API ============
// AI/user text trong legacy có nhiều màn hình render bằng innerHTML. Trung hòa dấu < > ngay
// tại boundary AI để model/prompt injection không thể biến thành tag/script trong DOM.
function neutralizeMarkup(value) {
  return String(value ?? '').replace(/</g, '＜').replace(/>/g, '＞');
}

const GEMINI = {
  // API key/model chỉ tồn tại ở backend. Legacy self-study không bao giờ lưu hoặc nhận secret.
  getKey: () => (classroomSession()?.user ? 'CLASSROOM_BACKEND' : ''),
  getModel: () => 'SERVER_MANAGED',

  async call(prompt, systemPrompt = '', opts = {}) {
    if (!classroomSession()?.user) {
      throw new Error('AI chỉ hoạt động khi mở Phòng tự học từ HanQuoc Classroom. API do Admin quản lý.');
    }
    const { jsonMode = false, ...generationOpts } = opts;
    const data = await classroomApi('/learning/ai', {
      method: 'POST',
      body: {
        prompt,
        systemPrompt,
        temperature: generationOpts.temperature ?? 0.7,
        maxOutputTokens: generationOpts.maxOutputTokens ?? 1024,
        jsonMode,
      },
    });
    return neutralizeMarkup(String(data.text || '')).trim();
  },

  async callChat(history, systemPrompt = '') {
    if (!classroomSession()?.user) {
      throw new Error('AI chỉ hoạt động khi mở Phòng tự học từ HanQuoc Classroom. API do Admin quản lý.');
    }
    const data = await classroomApi('/learning/ai', {
      method: 'POST',
      body: {
        history: Array.isArray(history) ? history.slice(-20) : history,
        systemPrompt,
        temperature: 0.85,
        maxOutputTokens: 1200,
      },
    });
    return neutralizeMarkup(String(data.text || '')).trim();
  },

  async generateVocab(word) {
    const prompt = `Bạn là chuyên gia tiếng Hàn. Hãy tạo thông tin học tập cho từ tiếng Hàn: "${word}"
Trả lời CHÍNH XÁC theo định dạng JSON sau (không thêm bất kỳ text nào khác):
{
  "roman": "phiên âm romanization",
  "meaning": "nghĩa tiếng Việt ngắn gọn",
  "pos": "từ loại bằng tiếng Hàn (명사/동사/형용사/부사/표현)",
  "tip": "mẹo nhớ từ thú vị cho người Việt, so sánh âm hoặc nghĩa",
  "example": "câu ví dụ tiếng Hàn đơn giản dùng từ này",
  "exampleViet": "bản dịch tiếng Việt của câu ví dụ"
}`;
    const raw = await GEMINI.call(prompt, '', { temperature: 0.4 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    return JSON.parse(match[0]);
  },

  async generateGrammar(title) {
    const prompt = `Bạn là giáo viên tiếng Hàn dạy người Việt. Hãy giải thích cấu trúc ngữ pháp: "${title}"
Viết bằng tiếng Việt, bao gồm:
- Cấu trúc: [công thức]
- Nghĩa/chức năng
- 3 ví dụ có dịch tiếng Việt
- Mẹo ghi nhớ
Giới hạn 200 từ.`;
    return GEMINI.call(prompt, '', { temperature: 0.5 });
  },

  async explainWord(word, meaning, example) {
    const prompt = `Từ tiếng Hàn: "${word}" (${meaning})
Hãy giải thích ngắn gọn (100-150 từ tiếng Việt):
1. Gốc từ / Hanja (nếu có)
2. Cách dùng thực tế
3. Từ liên quan
4. Lỗi hay gặp`;
    return GEMINI.call(prompt, '', { temperature: 0.5 });
  },
};

// ============ VOICE / TTS (High Quality Audio Engine) ============
// ============ VOICE / TTS (High Quality Audio Engine - Google Voice) ============
const TTS = {
  voices: [],
  selectedVoice: null,
  rate: 0.92,
  pitch: 1.0,
  useOnlineAudio: true,
  currentAudio: null,

  init() {
    const load = () => {
      TTS.voices = window.speechSynthesis?.getVoices() || [];
      TTS.findBestKoreanVoice();
      TTS.populateVoiceSelect();
    };
    if (window.speechSynthesis && speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = load;
    }
    load();

    const savedRate = localStorage.getItem('hq_tts_rate');
    const savedPitch = localStorage.getItem('hq_tts_pitch');
    const savedVoice = localStorage.getItem('hq_tts_voice');
    const savedMode = localStorage.getItem('hq_tts_mode');

    if (savedRate) TTS.rate = parseFloat(savedRate);
    if (savedPitch) TTS.pitch = parseFloat(savedPitch);
    if (savedVoice) TTS.savedVoiceName = savedVoice;
    if (savedMode !== null) {
      TTS.useOnlineAudio = savedMode === 'online';
    } else {
      TTS.useOnlineAudio = true; // Default to Google Voice Online
    }
  },

  findBestKoreanVoice() {
    const kr = TTS.voices.filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('ko'));
    const savedName = TTS.savedVoiceName || localStorage.getItem('hq_tts_voice');
    if (savedName) {
      const found = kr.find(v => v.name === savedName);
      if (found) { TTS.selectedVoice = found; return; }
    }
    TTS.selectedVoice =
      kr.find(v => v.name.includes('Google') || v.name.includes('한국')) ||
      kr.find(v => v.name.includes('Natural') || v.name.includes('Neural')) ||
      kr.find(v => v.name.includes('Sun-Hi') || v.name.includes('InJoon') || v.name.includes('Heami')) ||
      kr.find(v => v.name.includes('Microsoft')) ||
      kr[0] || null;
  },

  populateVoiceSelect() {
    const sel = document.getElementById('voiceSelect');
    if (!sel) return;
    const kr = TTS.voices.filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('ko'));

    let html = `<option value="ONLINE_HD" ${TTS.useOnlineAudio ? 'selected' : ''}>🌟 Giọng Google Tiếng Hàn Chuẩn (Dễ nghe, tự nhiên)</option>`;
    if (kr.length > 0) {
      html += kr.map(v =>
        `<option value="${escStr(v.name)}" ${(!TTS.useOnlineAudio && TTS.selectedVoice?.name === v.name) ? 'selected' : ''}>${v.name} (${v.lang})</option>`
      ).join('');
    }
    sel.innerHTML = html;

    sel.onchange = () => {
      if (sel.value === 'ONLINE_HD') {
        TTS.useOnlineAudio = true;
        localStorage.setItem('hq_tts_mode', 'online');
      } else {
        TTS.useOnlineAudio = false;
        localStorage.setItem('hq_tts_mode', 'local');
        TTS.selectedVoice = TTS.voices.find(v => v.name === sel.value) || null;
        localStorage.setItem('hq_tts_voice', sel.value);
      }
    };
  },

  speak(text, lang = 'ko-KR', onEnd = null) {
    if (!text || !text.trim()) { if (onEnd) onEnd(); return; }
    const cleanText = text.trim();

    if (TTS.currentAudio) {
      try {
        TTS.currentAudio.pause();
        TTS.currentAudio.currentTime = 0;
      } catch(e) {}
      TTS.currentAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    if (TTS.useOnlineAudio) {
      TTS.speakOnlineHD(cleanText, lang, onEnd);
    } else {
      TTS.speakWebSpeech(cleanText, lang, onEnd);
    }
  },

  speakOnlineHD(text, lang = 'ko-KR', onEnd = null) {
    const langCode = (lang || 'ko-KR').split('-')[0];
    const encoded = encodeURIComponent(text);

    // List of TTS audio sources to try in sequence (Google Translate Direct first)
    const sources = [
      `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encoded}`,
      `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${langCode}&q=${encoded}`
    ];

    let currentSourceIndex = 0;

    const tryPlayNext = () => {
      if (currentSourceIndex >= sources.length) {
        TTS.speakWebSpeech(text, lang, onEnd);
        return;
      }

      const url = sources[currentSourceIndex++];
      const audio = new Audio(url);
    audio.playbackRate = 0.85;
      audio.playbackRate = TTS.rate || 0.85;
      TTS.currentAudio = audio;

      audio.onended = () => {
        TTS.currentAudio = null;
        if (onEnd) onEnd();
      };

      audio.onerror = () => {
        tryPlayNext();
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          tryPlayNext();
        });
      }
    };

    tryPlayNext();
  },

  speakWebSpeech(text, lang = 'ko-KR', onEnd = null) {
    if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = TTS.rate || 0.85; // Tốc độ vừa vặn, dễ nghe, không bị dính chữ
    u.pitch = TTS.pitch || 1.05; // Cao độ trong trẻo, tự nhiên
    if (lang.startsWith('vi')) {
      const viVoices = (TTS.voices || []).filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('vi'));
      if (viVoices.length > 0) u.voice = viVoices[0];
    } else {
      if (!TTS.selectedVoice) TTS.findBestKoreanVoice();
      if (TTS.selectedVoice) u.voice = TTS.selectedVoice;
    }
    if (onEnd) u.onend = onEnd;

    setTimeout(() => {
      if (speechSynthesis.paused) speechSynthesis.resume();
    }, 40);

    window.speechSynthesis.speak(u);
  },

  test() {
    TTS.speak('안녕하세요! 한국어 발음이 맑고 듣기 편한가요?');
  }
};

function speakBilingual(koreanText, vietnameseText, callback = null) {
  if (!koreanText) return;
  TTS.speak(koreanText, 'ko-KR', () => {
    if (vietnameseText && vietnameseText.trim()) {
      setTimeout(() => {
        TTS.speak(vietnameseText, 'vi-VN', callback);
      }, 300);
    } else {
      if (callback) callback();
    }
  });
}

// ============ AI PERSONALITIES ============
const PERSONALITIES = {
  hana: {
    name: 'Hana', avatar: '👩‍🏫', emoji: '👩‍🏫',
    subtitle: 'Gia sư AI tiếng Hàn - Ân cần & Kiên nhẫn',
    systemPrompt: `Bạn là Hana, gia sư tiếng Hàn AI thân thiện, ân cần và kiên nhẫn. 
Bạn giúp người Việt Nam học tiếng Hàn. Hãy:
- Dùng cả tiếng Hàn và tiếng Việt (tùy theo chế độ người dùng chọn)
- Giải thích ngữ pháp đơn giản, dễ hiểu
- Khen ngợi khi người dùng làm đúng (예! 잘했어요! / Xuất sắc!)
- Sửa lỗi nhẹ nhàng với ví dụ
- Dùng emoji phù hợp để chat vui hơn
- Tập trung vào từ vựng người dùng đã học
- Luôn khuyến khích và tích cực`,
  },
  minho: {
    name: 'Minho', avatar: '👨‍💼', emoji: '👨‍💼',
    subtitle: 'Gia sư AI - Chuyên nghiệp & Nghiêm túc',
    systemPrompt: `Bạn là Minho, gia sư tiếng Hàn chuyên nghiệp. 
Bạn dạy tiếng Hàn theo phong cách học thuật, nghiêm túc.
- Giải thích chi tiết về ngữ pháp và cấu trúc câu
- Sửa lỗi ngay và chính xác
- Cung cấp ví dụ phong phú từ cuộc sống thực
- Đề xuất bài tập luyện tập
- Trả lời bằng cả tiếng Hàn lẫn tiếng Việt`,
  },
  yuri: {
    name: 'Yuri', avatar: '👧', emoji: '👧',
    subtitle: 'AI bạn học - Vui vẻ như bạn bè',
    systemPrompt: `Bạn là Yuri, người bạn Hàn Quốc vui vẻ và thân thiện!
Bạn chat như bạn bè, không quá formal.
- Dùng ngôn ngữ thân thiện, tự nhiên  
- Chia sẻ văn hóa Hàn Quốc thú vị (K-pop, K-drama, đồ ăn...)
- Học tiếng Hàn qua chủ đề vui
- Dùng nhiều emoji 😊🎉💕
- Thỉnh thoảng dùng slang tiếng Hàn cool
- Khuyến khích bằng năng lượng tích cực!`,
  },
};

// ============ STATE ============
let state = {
  words: [],
  grammar: [],
  lessons: ['Bài 1', 'Bài 2', 'Bài 3', 'Bài 4', 'Bài 5'],
  activeLesson: 'all',
  stats: {
    totalAnswered: 0, totalCorrect: 0, quizzesCompleted: 0,
    streak: 0, lastDate: null, xp: 0, ratings: {}, aiMessages: 0,
    wordSeenCount: {}, // SRS: how many times each word was seen
    examHistory: [],
  },
  currentMode: 'home',
  personality: 'hana',
  chatMode: 'mix', // kr / vn / mix
  chatHistory: [],  // Gemini multi-turn history
  tutorHistory: [],
  chatRecognition: null,
  isChatRecording: false,
  learn: { index: 0, known: {} },
  batchLearn: { size: 20, index: 0, mastered: {} }, // Học theo lộ trình: mastered[korean]=true khi đã qua bài kiểm tra của bộ
  flash: { index: 0, shuffled: [] },
  quiz: { questions: [], current: 0, score: 0, total: 0, answered: false },
  fill: { current: null, index: 0, shuffled: [], score: 0, total: 0 },
  listen: { current: null, score: 0, total: 0 },
  listenDial: { dialogue: null, questions: [], answers: {}, submitted: false, playCount: 0 },
  write: { current: null, index: 0, shuffled: [], score: 0, total: 0 },
  speak: { index: 0 },
  review: { queue: [], index: 0, hard: 0, medium: 0, easy: 0 },
  recognition: null,
  isRecording: false,
  grammarPractice: { selectedIndex: 0, exercises: [], answers: {}, submitted: false, difficulty: 'easy' },
  exam: { type: '', questions: [], current: 0, answers: {}, startTime: 0, timerInterval: null },
  dict: { history: [], savedWords: [] },
  pdfList: [],
  homework: { history: [], current: null }
};

// ============ VOCAB DATABASE ============
const VOCAB_DB = {
  '사람':{ roman:'saram', meaning:'người, con người', pos:'명사', tip:'Sa-ram: "Sa ra" - người bạn luôn nhớ mãi', example:'이 사람은 친구예요.', exampleViet:'Người này là bạn của tôi.' },
  '학생':{ roman:'haksaeng', meaning:'học sinh, sinh viên', pos:'명사', tip:'Hak-saeng: "học sinh" âm gần giống tiếng Việt! Hak=học', example:'저는 학생이에요.', exampleViet:'Tôi là học sinh.' },
  '의사':{ roman:'uisa', meaning:'bác sĩ', pos:'명사', tip:'Ui-sa: "ý sĩ" = bác sĩ có ý định chữa bệnh', example:'의사는 병원에 있어요.', exampleViet:'Bác sĩ ở bệnh viện.' },
  '회사원':{ roman:'hoesawon', meaning:'nhân viên công ty', pos:'명사', tip:'Hoesa=công ty, won=người → nhân viên', example:'오빠는 회사원이에요.', exampleViet:'Anh ấy là nhân viên.' },
  '행복':{ roman:'haengbok', meaning:'hạnh phúc', pos:'명사', tip:'Haeng-bok gần âm "hạnh phúc" tiếng Việt!', example:'저는 행복해요.', exampleViet:'Tôi hạnh phúc.' },
  '사랑':{ roman:'sarang', meaning:'tình yêu', pos:'명사', tip:'Sarang haeyo! = I love you - từ K-drama nổi tiếng', example:'사랑해요!', exampleViet:'Tôi yêu bạn!' },
  '친구':{ roman:'chingu', meaning:'bạn bè', pos:'명사', tip:'Chin-gu: "chính goo" = người bạn thật sự', example:'친구가 많아요.', exampleViet:'Tôi có nhiều bạn.' },
  '가족':{ roman:'gajok', meaning:'gia đình', pos:'명사', tip:'Ga-jok: "gia tộc" âm Hán Việt gần giống!', example:'가족이 좋아요.', exampleViet:'Tôi yêu gia đình.' },
  '음식':{ roman:'eumsik', meaning:'thức ăn', pos:'명사', tip:'Eum-sik: "ăm sích" = thứ để ăn → thức ăn', example:'음식이 맛있어요.', exampleViet:'Đồ ăn ngon quá.' },
  '물':{ roman:'mul', meaning:'nước', pos:'명사', tip:'Mul: ngắn gọn. MUL = nước (H2O)', example:'물을 마셔요.', exampleViet:'Tôi uống nước.' },
  '밥':{ roman:'bap', meaning:'cơm', pos:'명사', tip:'Bap: 밥 먹었어요? = Ăn cơm chưa? = xin chào!', example:'밥을 먹어요.', exampleViet:'Tôi ăn cơm.' },
  '집':{ roman:'jip', meaning:'nhà', pos:'명사', tip:'Jip: JIP = nhà. 집에 가요 = về nhà', example:'집에 있어요.', exampleViet:'Tôi ở nhà.' },
  '학교':{ roman:'hakkyo', meaning:'trường học', pos:'명사', tip:'Hak=học, kyo=trường → trường học!', example:'학교에 가요.', exampleViet:'Tôi đi học.' },
  '선생님':{ roman:'seonsaengnim', meaning:'giáo viên', pos:'명사', tip:'Nim = kính ngữ. Giống sensei Nhật!', example:'선생님 감사해요.', exampleViet:'Cảm ơn thầy/cô.' },
  '행복':{ roman:'haengbok', meaning:'hạnh phúc', pos:'명사', tip:'Haeng-bok ≈ "hạnh phúc" âm rất gần!', example:'저는 행복해요.', exampleViet:'Tôi hạnh phúc.' },
  '감사합니다':{ roman:'gamsahamnida', meaning:'cảm ơn (lịch sự)', pos:'표현', tip:'Gam-sa ≈ "cảm tạ" Hán Việt!', example:'도와주셔서 감사합니다.', exampleViet:'Cảm ơn đã giúp đỡ.' },
  '안녕하세요':{ roman:'annyeonghaseyo', meaning:'xin chào (lịch sự)', pos:'표현', tip:'An-nyeong = bình an. Chào bình an!', example:'안녕하세요! 처음 뵙겠습니다.', exampleViet:'Xin chào! Rất vui được gặp.' },
  '네':{ roman:'ne', meaning:'vâng, dạ', pos:'표현', tip:'Ne ngắn gọn = yes! Giống "nê" tiếng Việt', example:'네, 맞아요.', exampleViet:'Vâng, đúng rồi.' },
  '아니요':{ roman:'aniyo', meaning:'không', pos:'표현', tip:'A-ni-yo = không. Đơn giản!', example:'아니요, 괜찮아요.', exampleViet:'Không, không sao ạ.' },
  '맛있다':{ roman:'masitda', meaning:'ngon', pos:'형용사', tip:'Ma-SIT-da: ngồi xuống (sit) vì ăn quá ngon!', example:'김치가 맛있어요!', exampleViet:'Kim chi ngon quá!' },
  '좋다':{ roman:'jota', meaning:'tốt, thích', pos:'형용사', tip:'Jo-ta! = Tốt! Dùng để khen', example:'날씨가 좋아요.', exampleViet:'Thời tiết đẹp.' },
  '예쁘다':{ roman:'yeppeuda', meaning:'đẹp', pos:'형용사', tip:'Yep-peu-da: K-pop girls thường được khen vậy!', example:'꽃이 예뻐요.', exampleViet:'Hoa đẹp quá.' },
  '가다':{ roman:'gada', meaning:'đi', pos:'동사', tip:'Ga-da: ga tàu → đi đến ga → đi!', example:'어디 가요?', exampleViet:'Bạn đi đâu vậy?' },
  '오다':{ roman:'oda', meaning:'đến, tới', pos:'동사', tip:'O-da: "ôi đến rồi!" → đến', example:'언제 와요?', exampleViet:'Khi nào bạn đến?' },
  '먹다':{ roman:'meokda', meaning:'ăn', pos:'동사', tip:'Meok-da: đừng để mốc → ăn ngay!', example:'뭐 먹어요?', exampleViet:'Bạn ăn gì?' },
  '마시다':{ roman:'masida', meaning:'uống', pos:'동사', tip:'Ma-si-da: "mình si" uống gì đó → uống', example:'커피 마셔요.', exampleViet:'Tôi uống cà phê.' },
  '공부하다':{ roman:'gongbuhada', meaning:'học bài', pos:'동사', tip:'Gongbu (工夫) = công phu học tập!', example:'매일 공부해요.', exampleViet:'Tôi học mỗi ngày.' },
  '머리':{ roman:'meori', meaning:'đầu, tóc', pos:'명사', tip:'Meo-ri: "mỡ" trên đầu → tóc', example:'머리가 아파요.', exampleViet:'Tôi đau đầu.' },
  '눈':{ roman:'nun', meaning:'mắt / tuyết', pos:'명사', tip:'Nun: mắt trắng như tuyết! Đa nghĩa', example:'눈이 예뻐요.', exampleViet:'Mắt đẹp.' },
  '손':{ roman:'son', meaning:'tay', pos:'명사', tip:'Son: "son" môi → dùng tay tô son', example:'손이 예뻐요.', exampleViet:'Tay đẹp.' },
  '한국':{ roman:'hanguk', meaning:'Hàn Quốc', pos:'명사', tip:'Han=dân tộc Hàn, guk=quốc → Hàn Quốc!', example:'한국이 좋아요.', exampleViet:'Tôi thích Hàn Quốc.' },
  '베트남':{ roman:'betenam', meaning:'Việt Nam', pos:'명사', tip:'Be-te-nam: "Vietnam" đọc kiểu Hàn!', example:'베트남 음식이 맛있어요.', exampleViet:'Đồ ăn Việt Nam ngon.' },
  '김치':{ roman:'gimchi', meaning:'kim chi', pos:'명사', tip:'Kim chi! Nổi tiếng thế giới!', example:'김치가 맛있어요.', exampleViet:'Kim chi ngon.' },
  '불고기':{ roman:'bulgogi', meaning:'thịt nướng Hàn', pos:'명사', tip:'Bul=lửa, gogi=thịt → thịt nướng lửa!', example:'불고기 주세요.', exampleViet:'Cho tôi bulgogi.' },
  '돈':{ roman:'don', meaning:'tiền', pos:'명사', tip:'Don ≈ "đồng" tiền Việt Nam!', example:'돈이 없어요.', exampleViet:'Tôi hết tiền rồi.' },
  '시간':{ roman:'sigan', meaning:'thời gian', pos:'명사', tip:'Si-gan ≈ "thì giờ" Hán Việt', example:'시간이 없어요.', exampleViet:'Tôi không có thời gian.' },
  '오늘':{ roman:'oneul', meaning:'hôm nay', pos:'부사', tip:'O-neul: "ô hôm nay"', example:'오늘 날씨가 좋아요.', exampleViet:'Hôm nay đẹp trời.' },
  '내일':{ roman:'naeil', meaning:'ngày mai', pos:'부사', tip:'Na-eil: "mail" tới ngày mai mới đến', example:'내일 봐요!', exampleViet:'Hẹn gặp ngày mai!' },
  '지금':{ roman:'jigeum', meaning:'bây giờ', pos:'부사', tip:'Ji-geum: "gold" = bây giờ quý như vàng!', example:'지금 어디예요?', exampleViet:'Bạn đang ở đâu vậy?' },
  '있다':{ roman:'itda', meaning:'có, tồn tại', pos:'동사', tip:'It-da: "it đó" = có đó!', example:'시간이 있어요?', exampleViet:'Bạn có thời gian không?' },
  '없다':{ roman:'eopda', meaning:'không có', pos:'동사', tip:'Eop-da: ôm không có = rỗng tay', example:'돈이 없어요.', exampleViet:'Tôi không có tiền.' },
  '많다':{ roman:'manta', meaning:'nhiều', pos:'형용사', tip:'Man-ta: manta cá đuối to = nhiều vây!', example:'친구가 많아요.', exampleViet:'Tôi có nhiều bạn.' },
  '피곤하다':{ roman:'pigonhada', meaning:'mệt mỏi', pos:'형용사', tip:'Pi-gon: "phi công" mệt sau chuyến bay!', example:'너무 피곤해요.', exampleViet:'Tôi mệt quá.' },
  '슬프다':{ roman:'seulpeuda', meaning:'buồn', pos:'형용사', tip:'Seul-peu-da ≈ "sầu" tiếng Việt', example:'왜 슬퍼요?', exampleViet:'Tại sao bạn buồn?' },
  '행복하다':{ roman:'haengbokhada', meaning:'hạnh phúc', pos:'형용사', tip:'Haengbok=hạnh phúc + hada=là/làm', example:'지금 행복해요.', exampleViet:'Bây giờ tôi hạnh phúc.' },
  '사과':{ roman:'sagwa', meaning:'táo / xin lỗi', pos:'명사', tip:'Sa-gwa đa nghĩa: quả táo và xin lỗi!', example:'사과가 맛있어요.', exampleViet:'Táo ngon.' },
  '고양이':{ roman:'goyangi', meaning:'mèo', pos:'명사', tip:'Go-yang-i = mèo cute!', example:'고양이가 귀여워요.', exampleViet:'Mèo thật dễ thương.' },
  '강아지':{ roman:'gangaji', meaning:'cún con', pos:'명사', tip:'Gang-a-ji = puppy Hàn Quốc', example:'강아지가 귀여워요.', exampleViet:'Cún dễ thương!' },
  '날씨':{ roman:'nalsi', meaning:'thời tiết', pos:'명사', tip:'Nal-si: ngày-thời = thời tiết ngày hôm nay', example:'오늘 날씨가 좋아요.', exampleViet:'Hôm nay thời tiết đẹp.' },
  '사랑하다':{ roman:'saranghada', meaning:'yêu', pos:'동사', tip:'Sarang=tình yêu + hada=làm → yêu!', example:'사랑해요!', exampleViet:'Tôi yêu bạn!' },
};
const SAMPLES = {
  basic: ['사람','학생','의사','회사원','친구','가족','집','학교','선생님','한국'],
  body: ['머리','눈','코','입','손','발','귀','어깨','다리','배'],
  food: ['밥','음식','물','김치','불고기','사과','고기','채소','과일','커피'],
  emotion: ['행복','사랑','슬프다','피곤하다','좋다','많다','있다','없다','맛있다','예쁘다'],
};
const BODY_EXTRA = {
  '코':{ roman:'ko', meaning:'mũi', pos:'명사', tip:'Ko ngắn gọn = mũi. Nose!', example:'코가 높아요.', exampleViet:'Mũi cao.' },
  '입':{ roman:'ip', meaning:'miệng', pos:'명사', tip:'Ip: "lip" bỏ L = môi → miệng', example:'입이 작아요.', exampleViet:'Miệng nhỏ.' },
  '발':{ roman:'bal', meaning:'chân', pos:'명사', tip:'Bal: ball đá bằng chân!', example:'발이 아파요.', exampleViet:'Chân đau.' },
  '귀':{ roman:'gwi', meaning:'tai', pos:'명사', tip:'Gwi = tai nghe!', example:'귀가 작아요.', exampleViet:'Tai nhỏ.' },
  '어깨':{ roman:'eokkae', meaning:'vai', pos:'명사', tip:'Eo-kkae: vai gánh nặng', example:'어깨가 아파요.', exampleViet:'Vai đau.' },
  '다리':{ roman:'dari', meaning:'chân, cầu', pos:'명사', tip:'Da-ri: đa nghĩa chân và cầu!', example:'다리가 예뻐요.', exampleViet:'Chân đẹp.' },
  '배':{ roman:'bae', meaning:'bụng / thuyền / quả lê', pos:'명사', tip:'Bae đa nghĩa 3 cách: bụng, thuyền, lê!', example:'배가 고파요.', exampleViet:'Tôi đói bụng.' },
  '고기':{ roman:'gogi', meaning:'thịt', pos:'명사', tip:'Go-gi: K-BBQ gogi = thịt!', example:'고기가 맛있어요.', exampleViet:'Thịt ngon.' },
  '채소':{ roman:'chaeso', meaning:'rau củ', pos:'명사', tip:'Chae-so: rau sạch', example:'채소를 먹어요.', exampleViet:'Tôi ăn rau.' },
  '과일':{ roman:'gwail', meaning:'trái cây', pos:'명사', tip:'Gwa-il: "quả ít" calo', example:'과일이 좋아요.', exampleViet:'Tôi thích trái cây.' },
  '커피':{ roman:'keopi', meaning:'cà phê', pos:'명사', tip:'Keo-pi: "coffee" đọc tiếng Hàn!', example:'커피를 마셔요.', exampleViet:'Tôi uống cà phê.' },
};
Object.assign(VOCAB_DB, BODY_EXTRA);

// ============ UTILS ============
function showToast(msg, type='info', dur=2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'toast', dur);
}
function addXP(n) {
  state.stats.xp += n;
  document.getElementById('xpCount').textContent = state.stats.xp + ' XP';
  saveState();
}
const DEFAULT_GRAMMAR = [
  { title: '-입니다 / -입니까?', body: 'Đuôi câu khẳng định / nghi vấn lịch sự trang trọng (Là... / Là... phải không?)', lesson: 'Bài 1' },
  { title: '-은 / -는', body: 'Tiểu từ chủ đề, đứng sau danh từ để nhấn mạnh chủ đề của câu', lesson: 'Bài 1' },
  { title: '-이 / -가', body: 'Tiểu từ chủ ngữ, đứng sau danh từ làm chủ ngữ trong câu', lesson: 'Bài 1' },
  { title: '-을 / -를', body: 'Tiểu từ tân ngữ, đứng sau danh từ chịu sự tác động của động từ', lesson: 'Bài 2' },
  { title: '-아/어/여요', body: 'Đuôi câu thân mật lịch sự dùng phổ biến trong giao tiếp hằng ngày', lesson: 'Bài 2' },
  { title: '-에 / -에서', body: 'Tiểu từ chỉ thời gian, địa điểm (ở, tại, đến)', lesson: 'Bài 2' },
  { title: '-고 싶다', body: 'Cấu trúc biểu thị mong muốn "Muốn làm gì đó"', lesson: 'Bài 3' },
  { title: '-(으)ㄹ 거예요', body: 'Thì tương lai "Sẽ làm gì đó / Sẽ diễn ra"', lesson: 'Bài 3' },
  { title: '-지 않다 / 안 -', body: 'Phủ định "Không làm gì / Không như thế nào"', lesson: 'Bài 3' },
  { title: '-아/어/여야 하다', body: 'Cấu trúc bắt buộc "Phải làm gì đó"', lesson: 'Bài 4' },
  { title: '-(으)ㄹ 수 있다/없다', body: 'Cấu trúc khả năng "Có thể / Không thể làm gì"', lesson: 'Bài 4' },
  { title: '-(으)면서', body: 'Cấu trúc thực hiện song song 2 hành động "Vừa... vừa..."', lesson: 'Bài 5' },
];

const DEFAULT_WORDS = Object.entries(VOCAB_DB).map(([k, v]) => ({
  korean: k,
  roman: v.roman || k,
  meaning: v.meaning,
  pos: v.pos || '명사',
  tip: v.tip || '',
  example: v.example || `${k}입니다.`,
  exampleViet: v.exampleViet || `Là ${v.meaning}.`,
  lesson: 'Bài 1'
}));

let classroomStateSyncTimer = null;
let lastClassroomLearningSync = null;

function buildPersistedLearningState() {
  return {
    words: state.words,
    grammar: state.grammar,
    stats: state.stats,
    personality: state.personality,
    dict: state.dict,
    lessons: state.lessons,
    activeLesson: state.activeLesson,
    batchLearn: { size: state.batchLearn.size, mastered: state.batchLearn.mastered },
  };
}

function syncClassroomLearningState(snapshot) {
  if (!classroomSession()?.user) return;
  clearTimeout(classroomStateSyncTimer);
  classroomStateSyncTimer = setTimeout(() => {
    classroomApi('/learning/state', {
      method: 'PUT',
      body: { state: snapshot },
      timeout: 30000,
    }).catch(() => {});
  }, 700);
}

function saveState() {
  const snapshot = buildPersistedLearningState();
  try {
    localStorage.setItem(learningStateStorageKey(), JSON.stringify(snapshot));
  } catch(e){}
  syncClassroomLearningState(snapshot);
}

function loadState() {
  try {
    const d = JSON.parse(localStorage.getItem(learningStateStorageKey()) || '{}');
    if (d.words && d.words.length > 0) state.words = d.words;
    else state.words = [...DEFAULT_WORDS];

    if (d.grammar && d.grammar.length > 0) state.grammar = d.grammar;
    else state.grammar = [...DEFAULT_GRAMMAR];

    if (d.stats) state.stats = { ...state.stats, ...d.stats };
    if (d.personality) state.personality = d.personality;
    if (d.dict) state.dict = { ...state.dict, ...d.dict };
    if (d.lessons && d.lessons.length > 0) state.lessons = d.lessons;
    if (d.activeLesson) state.activeLesson = d.activeLesson;
    if (d.batchLearn) state.batchLearn = { ...state.batchLearn, ...d.batchLearn };

    if (!state.words || state.words.length === 0) state.words = [...DEFAULT_WORDS];
    if (!state.grammar || state.grammar.length === 0) state.grammar = [...DEFAULT_GRAMMAR];

    if (!state.stats.wordSeenCount) state.stats.wordSeenCount = {};
    if (!state.stats.examHistory) state.stats.examHistory = [];
    if (!state.dict.savedWords) state.dict.savedWords = [];
    if (!state.dict.history) state.dict.history = [];
    if (!state.batchLearn) state.batchLearn = { size: 20, index: 0, mastered: {} };
    if (!state.batchLearn.mastered) state.batchLearn.mastered = {};
    if (!state.batchLearn.size) state.batchLearn.size = 20;
  } catch(e){
    state.words = [...DEFAULT_WORDS];
    state.grammar = [...DEFAULT_GRAMMAR];
  }
}

async function hydrateClassroomSystemSettings() {
  if (!classroomSession()?.user) return;
  try {
    const { settings } = await classroomApi('/learning/settings', { timeout: 30000 });
    if (!settings) return;

    TTS.rate = Number(settings.speechRate) || 0.8;
    TTS.pitch = Number(settings.speechPitch) || 1;
    TTS.useOnlineAudio = settings.voiceMode !== 'local';
    TTS.savedVoiceName = settings.voiceName || '';
    localStorage.setItem('hq_tts_rate', String(TTS.rate));
    localStorage.setItem('hq_tts_pitch', String(TTS.pitch));
    localStorage.setItem('hq_tts_mode', TTS.useOnlineAudio ? 'online' : 'local');
    if (settings.voiceName) localStorage.setItem('hq_tts_voice', settings.voiceName);
    else localStorage.removeItem('hq_tts_voice');
    TTS.findBestKoreanVoice();
    TTS.populateVoiceSelect();

    if (PERSONALITIES[settings.personality]) selectPersonality(settings.personality, false);
    document.body.classList.toggle('light-mode', settings.theme !== 'dark');
    document.body.classList.toggle('dark-mode', settings.theme === 'dark');
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.textContent = settings.theme === 'dark' ? '🌙' : '☀️';
    updateApiIndicator(Boolean(settings.aiConfigured));
    const aiBadge = document.getElementById('aiPowerBadge');
    if (aiBadge) aiBadge.style.display = settings.aiConfigured ? 'flex' : 'none';
  } catch(e) {}
}

async function hydrateClassroomLearningState() {
  if (!classroomSession()?.user) return;
  try {
    const data = await classroomApi('/learning/state', { timeout: 30000 });
    if (data.state) {
      localStorage.setItem(learningStateStorageKey(), JSON.stringify(data.state));
      loadState();
      renderWordChips();
      renderGrammarChips();
      renderLessonSelectors();
      const xp = document.getElementById('xpCount');
      const streak = document.getElementById('streakCount');
      if (xp) xp.textContent = state.stats.xp + ' XP';
      if (streak) streak.textContent = state.stats.streak;
    }
  } catch(e) {}

  await hydrateClassroomSystemSettings();

  // Nếu parent đã gửi dữ liệu lớp trong lúc state server đang hydrate, áp lại lần cuối
  // để state cũ không ghi đè từ vựng/ngữ pháp giáo viên vừa giao.
  if (lastClassroomLearningSync) applyClassroomLearningSync(lastClassroomLearningSync, { quiet: true });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'CLASSROOM_LEARNING_READY' }, window.location.origin);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function getRandom(arr, n, exclude=[]) {
  return shuffle(arr.filter(x => !exclude.includes(x))).slice(0, n);
}
function getSmartWrongChoices(targetWord, pool, count = 3) {
  if (!targetWord) return getRandom(state.words, count, []);
  const allPool = (pool && pool.length > 1) ? pool : state.words;
  const candidates = allPool.filter(w => w.korean !== targetWord.korean && w.meaning !== targetWord.meaning);

  // 1. Prefer words from the same lesson
  let poolSameLesson = candidates.filter(w => w.lesson && targetWord.lesson && w.lesson === targetWord.lesson);

  // 2. Prefer words from the same POS (part of speech)
  let poolSamePos = candidates.filter(w => w.pos && targetWord.pos && w.pos === targetWord.pos);

  // Choose best list that has enough candidates
  let preferred = poolSameLesson.length >= count ? poolSameLesson : (poolSamePos.length >= count ? poolSamePos : candidates);

  const selected = [];
  const shuffled = shuffle(preferred);

  for (const w of shuffled) {
    if (selected.length >= count) break;
    if (!selected.some(x => x.korean === w.korean || x.meaning === w.meaning)) {
      selected.push(w);
    }
  }

  // If still not enough choices, fill up from remaining candidates across state.words
  if (selected.length < count) {
    const backupCandidates = candidates.concat(state.words.filter(w => w.korean !== targetWord.korean && w.meaning !== targetWord.meaning));
    for (const w of shuffle(backupCandidates)) {
      if (selected.length >= count) break;
      if (!selected.some(x => x.korean === w.korean || x.meaning === w.meaning)) {
        selected.push(w);
      }
    }
  }

  return selected;
}
function escStr(s) { return (s||'').replace(/'/g,"\\'").replace(/"/g,'\\"'); }

// ============ LESSON MANAGEMENT HELPERS ============
function getActiveWords() {
  const activeL = state.activeLesson || 'all';
  if (activeL === 'all') return state.words;
  return state.words.filter(w => (w.lesson || 'Bài 1') === activeL);
}

function getActiveGrammar() {
  const activeL = state.activeLesson || 'all';
  if (activeL === 'all') return state.grammar;
  return state.grammar.filter(g => (g.lesson || 'Bài 1') === activeL);
}

function renderLessonSelectors() {
  const lessons = state.lessons || ['Bài 1', 'Bài 2', 'Bài 3', 'Bài 4', 'Bài 5'];
  const activeL = state.activeLesson || 'all';

  // 1. Topbar Global Filter
  const globalSel = document.getElementById('globalLessonSelect');
  if (globalSel) {
    globalSel.innerHTML = `
      <option value="all" ${activeL === 'all' ? 'selected' : ''}>🌐 Tất cả bài học</option>
      ${lessons.map(l => `<option value="${escStr(l)}" ${activeL === l ? 'selected' : ''}>📌 ${l}</option>`).join('')}
    `;
  }

  // 2. Word & Grammar Lesson Assign Selectors (Home)
  ['wordLessonSelect', 'grammarLessonSelect'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = lessons.map(l => `<option value="${escStr(l)}">${l}</option>`).join('');
  });

  // 3. Lesson Modal List
  const manageList = document.getElementById('lessonManageList');
  if (manageList) {
    const lessonMeta = paginateList('lessonManage', lessons, renderLessonSelectors, 10);
    manageList.innerHTML = lessonMeta.pageItems.map(l => {
      const wordCount = state.words.filter(w => (w.lesson || 'Bài 1') === l).length;
      const grammarCount = state.grammar.filter(g => (g.lesson || 'Bài 1') === l).length;
      return `
        <div class="lesson-manage-item">
          <div class="lesson-manage-info">
            <span class="lesson-name">📌 ${l}</span>
            <span class="lesson-count">${wordCount} từ · ${grammarCount} ngữ pháp</span>
          </div>
          <button class="btn btn-ghost btn-xs" onclick="deleteLesson('${escStr(l)}')" title="Xóa bài học này">🗑 Xóa</button>
        </div>
      `;
    }).join('');
    mountListPagination(manageList, 'lessonManage', lessonMeta, 'bài học');
  }
}

function handleGlobalLessonChange(val) {
  state.activeLesson = val;
  saveState();
  showToast(val === 'all' ? '🌐 Học tất cả các bài' : `📌 Đang lọc học: ${val}`, 'info');
  setMode(state.currentMode || 'home');
}

function openLessonModal() {
  renderLessonSelectors();
  document.getElementById('lessonOverlay').classList.add('open');
}

function closeLessonModal() {
  document.getElementById('lessonOverlay').classList.remove('open');
}

function addNewLesson() {
  const input = document.getElementById('newLessonInput');
  const name = input ? input.value.trim() : '';
  if (!name) { showToast('⚠️ Nhập tên bài học!', 'error'); return; }
  if (state.lessons.includes(name)) { showToast('⚠️ Bài học này đã tồn tại!', 'info'); return; }
  state.lessons.push(name);
  saveState();
  renderLessonSelectors();
  if (input) input.value = '';
  showToast(`✅ Đã tạo ${name}!`, 'success');
}

function deleteLesson(name) {
  if (state.lessons.length <= 1) { showToast('⚠️ Cần giữ lại ít nhất 1 bài học!', 'error'); return; }
  if (confirm(`Xóa bài học "${name}"? Các từ vựng thuộc bài này sẽ được chuyển về "Bài 1".`)) {
    state.lessons = state.lessons.filter(l => l !== name);
    state.words.forEach(w => { if ((w.lesson || 'Bài 1') === name) w.lesson = 'Bài 1'; });
    state.grammar.forEach(g => { if ((g.lesson || 'Bài 1') === name) g.lesson = 'Bài 1'; });
    if (state.activeLesson === name) state.activeLesson = 'all';
    saveState();
    renderLessonSelectors();
    showToast(`Đã xóa bài "${name}"`, 'info');
  }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function updateStreak() {
  const today = new Date().toDateString();
  if (state.stats.lastDate === today) return;
  const yesterday = new Date(Date.now()-86400000).toDateString();
  state.stats.streak = state.stats.lastDate === yesterday ? state.stats.streak+1 : 1;
  state.stats.lastDate = today;
  document.getElementById('streakCount').textContent = state.stats.streak;
  saveState();
}
function generateWordData(korean) {
  return VOCAB_DB[korean]
    ? { korean, ...VOCAB_DB[korean] }
    : { korean, roman: korean, meaning:`[${korean}] - cần AI tạo`, pos:'명사', tip:'AI do Admin quản lý trên hệ thống.', example:`${korean}이에요.`, exampleViet:`Đây là ${korean}.` };
}

// ============ AI STATUS (server-managed) ============
function updateApiIndicator(ok) {
  const dot = document.getElementById('apiDot');
  const label = document.getElementById('apiLabel');
  if (!dot || !label) return;
  if (ok) {
    dot.classList.add('active');
    dot.classList.remove('error');
    label.textContent = 'AI ✓';
    label.style.color = 'var(--teal)';
  } else {
    dot.classList.remove('active');
    dot.classList.add('error');
    label.textContent = 'AI ✗';
    label.style.color = 'var(--red)';
  }
}

// ============ SETTINGS MODAL ============
function openSettings() {
  const modal = document.getElementById('settingsOverlay');
  modal.classList.add('open');

  // Gemini API key và model do Admin quản lý ở backend; modal này không hiển thị secret.
  // Rate/Pitch sliders
  const rateSlider = document.getElementById('speechRate');
  const pitchSlider = document.getElementById('speechPitch');
  rateSlider.value = TTS.rate;
  pitchSlider.value = TTS.pitch;
  document.getElementById('rateVal').textContent = TTS.rate;
  document.getElementById('pitchVal').textContent = TTS.pitch;
  rateSlider.addEventListener('input', () => {
    TTS.rate = parseFloat(rateSlider.value);
    document.getElementById('rateVal').textContent = TTS.rate;
    localStorage.setItem('hq_tts_rate', TTS.rate);
  });
  pitchSlider.addEventListener('input', () => {
    TTS.pitch = parseFloat(pitchSlider.value);
    document.getElementById('pitchVal').textContent = TTS.pitch;
    localStorage.setItem('hq_tts_pitch', TTS.pitch);
  });
  // Personality
  selectPersonality(state.personality, false);
}
function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
}
function selectPersonality(name, save=true) {
  state.personality = name;
  document.querySelectorAll('.personality-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('p-'+name);
  if (btn) btn.classList.add('active');
  if (save) {
    saveState();
    const p = PERSONALITIES[name];
    document.getElementById('tutorAvatar').textContent = p.avatar;
    document.getElementById('tutorName').textContent = `${p.name} - AI Gia sư tiếng Hàn`;
    document.getElementById('tutorSubtitle').textContent = p.subtitle;
    document.querySelectorAll('.chat-avatar').forEach((av,i) => {
      if (!av.closest('.user-message')) av.textContent = p.avatar;
    });
    showToast(`Đã chọn ${p.name} làm gia sư!`, 'info');
  }
}
function testVoice() { TTS.test(); }

// ============ MODE SWITCHING ============
function setMode(mode) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`page-${mode}`);
  const nav = document.getElementById(`nav-${mode}`);
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');
  state.currentMode = mode;
  closeSidebar();
  updateRobotTipForMode(mode);
  switch(mode) {
    case 'learn': initLearn(); break;
    case 'batch': initBatchLearn(); break;
    case 'flashcard': initFlash(); break;
    case 'quiz': startQuiz(); break;
    case 'fill': initFill(); break;
    case 'listening': initListen(); break;
    case 'listenDial': initListenDial(); break;
    case 'writing': initWrite(); break;
    case 'speaking': initSpeak(); break;
    case 'matchGame': initMatchGame(); break;
    case 'numbers': initNumbersPage(); break;
    case 'aichat': initAIChat(); break;
    case 'aitutor': initAITutor(); break;
    case 'review': startReview(); break;
    case 'dialogue': generateDialogue(); break;
    case 'grammar': initGrammarDictionary(); break;
    case 'grammarPractice': initGrammarPractice(); break;
    case 'stats': renderStats(); break;
    case 'exam': initExam(); break;
    case 'dictionary': initDictionary(); break;
    case 'translate': initTranslate(); break;
    case 'pdfStudy': initPdfStudy(); break;
    case 'homework': initHomework(); break;
    case 'sentencePractice': initSentencePractice(); break;
    case 'notebook': initNotebook(); break;
    case 'grammarGame': initGrammarGame(); break;
    case 'irregulars': initIrregularsPage(); break;
  }
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

// ============ ADD WORDS ============
async function processWords(rawWords) {
  const loadBar = document.getElementById('loadingBar');
  const prog = document.getElementById('loadingProgress');
  const text = document.getElementById('loadingText');
  loadBar.style.display = 'block';
  const useAI = document.getElementById('aiGenToggle')?.checked && GEMINI.getKey();
  const targetLesson = document.getElementById('wordLessonSelect')?.value || 'Bài 1';
  const newWords = [];
  let updatedCount = 0;

  for (let i=0; i<rawWords.length; i++) {
    const w = neutralizeMarkup(rawWords[i].trim());
    if (!w) continue;

    const existing = state.words.find(x => x.korean === w);
    if (existing) {
      existing.lesson = targetLesson;
      updatedCount++;
      continue;
    }

    const pct = Math.round(((i+1)/rawWords.length)*100);
    prog.style.width = pct + '%';

    let data;
    if (VOCAB_DB[w]) {
      text.textContent = `📚 Tìm thấy: ${w} (${pct}%)`;
      data = generateWordData(w);
    } else if (useAI) {
      text.textContent = `🤖 AI đang tạo: ${w} (${pct}%)`;
      try {
        const aiData = await GEMINI.generateVocab(w);
        data = { korean: w, ...aiData };
      } catch(e) {
        data = generateWordData(w);
        data.tip = '⚠️ AI hệ thống tạm chưa phản hồi. Bạn có thể nhập thủ công hoặc thử lại sau.';
      }
    } else {
      text.textContent = `📝 Thêm: ${w} (${pct}%)`;
      data = generateWordData(w);
    }
    data.lesson = targetLesson;
    newWords.push(data);
    await delay(useAI && !VOCAB_DB[w] ? 500 : 20);
  }
  state.words.push(...newWords);
  loadBar.style.display = 'none';
  renderLessonSelectors();
  return newWords.length + updatedCount;
}

function needsAIRegen(w) {
  return !!(w && typeof w.meaning === 'string' && (
    w.meaning.includes('cần AI tạo') || 
    w.meaning.includes('chưa có nghĩa') ||
    (typeof w.tip === 'string' && w.tip.includes('thất bại'))
  ));
}

async function regenerateAIWords() {
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!','error'); return; }
  const targets = state.words.map((w,i)=>({w,i})).filter(x=>needsAIRegen(x.w));
  if (targets.length===0) return;

  const btn = document.getElementById('regenAiBtn');
  if (btn) btn.disabled = true;
  let done=0, failed=0;
  for (const {w,i} of targets) {
    if (btn) btn.textContent = `🔄 Đang tạo... (${done+failed+1}/${targets.length})`;
    try {
      const aiData = await GEMINI.generateVocab(w.korean);
      state.words[i] = { ...state.words[i], ...aiData };
      done++;
    } catch(e) {
      failed++;
    }
    saveState();
    await delay(500);
  }
  if (btn) btn.disabled = false;
  renderWordChips();
  if (failed===0) showToast(`✅ Đã tạo lại ${done} từ bằng AI!`,'success');
  else showToast(`⚠️ Đã tạo lại ${done} từ, còn ${failed} từ bị lỗi (thử lại sau).`,'error');
}

const WORD_PAGE_SIZE_KEY = 'hq_word_page_size';
const WORD_PAGE_SIZES = [15, 30, 60, 120];
const savedWordPageSize = parseInt(localStorage.getItem(WORD_PAGE_SIZE_KEY), 10);
let wordPagination = {
  page: 1,
  pageSize: WORD_PAGE_SIZES.includes(savedWordPageSize) ? savedWordPageSize : 30
};


// ============ SHARED LIST PAGINATION ============
const LIST_PAGE_SIZES = [10, 20, 30, 60];
const listPaginationState = {};
const listPaginationRenderers = {};

function getListPaginationState(key, defaultSize = 20) {
  if (!listPaginationState[key]) {
    const saved = parseInt(localStorage.getItem(`hq_list_page_size_${key}`), 10);
    listPaginationState[key] = {
      page: 1,
      pageSize: LIST_PAGE_SIZES.includes(saved) ? saved : defaultSize
    };
  }
  return listPaginationState[key];
}

function paginateList(key, items, renderer, defaultSize = 20) {
  listPaginationRenderers[key] = renderer;
  const pg = getListPaginationState(key, defaultSize);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pg.pageSize));
  pg.page = Math.min(Math.max(1, pg.page), totalPages);
  const start = (pg.page - 1) * pg.pageSize;
  const end = Math.min(start + pg.pageSize, totalItems);
  return { pageItems: items.slice(start, end), totalItems, totalPages, start, end, pg };
}

function mountListPagination(container, key, meta, label = 'mục') {
  if (!container || !container.parentElement) return;
  const pagerId = `listPagination_${key}`;
  let pager = document.getElementById(pagerId);
  if (!pager) {
    pager = document.createElement('nav');
    pager.id = pagerId;
    pager.className = 'pagination list-pagination';
    pager.setAttribute('aria-label', `Phân trang ${label}`);
    container.insertAdjacentElement('afterend', pager);
  }
  const { totalItems, totalPages, start, end, pg } = meta;
  if (totalItems === 0 || totalPages <= 1) {
    pager.innerHTML = '';
    pager.style.display = 'none';
    return;
  }
  const pageItems = getPaginationItems(pg.page, totalPages);
  pager.style.display = 'flex';
  pager.innerHTML = `
    <span class="pagination-range">${start + 1}–${end} / ${totalItems} ${label}</span>
    <select class="pagination-size-select" onchange="changeListPageSize('${key}', this.value)" title="Số mục mỗi trang">
      ${LIST_PAGE_SIZES.map(size => `<option value="${size}" ${size === pg.pageSize ? 'selected' : ''}>${size}/trang</option>`).join('')}
    </select>
    <button class="pagination-btn pagination-nav" onclick="changeListPage('${key}', ${pg.page - 1})" ${pg.page === 1 ? 'disabled' : ''}>‹ <span>Trước</span></button>
    <div class="pagination-pages">
      ${pageItems.map(item => typeof item === 'number'
        ? `<button class="pagination-btn ${item === pg.page ? 'active' : ''}" onclick="changeListPage('${key}', ${item})">${item}</button>`
        : `<span class="pagination-ellipsis">…</span>`).join('')}
    </div>
    <button class="pagination-btn pagination-nav" onclick="changeListPage('${key}', ${pg.page + 1})" ${pg.page === totalPages ? 'disabled' : ''}><span>Sau</span> ›</button>
    <span class="pagination-summary">Trang ${pg.page}/${totalPages}</span>`;
}

function changeListPage(key, page) {
  const pg = getListPaginationState(key);
  pg.page = Math.max(1, Number(page) || 1);
  const render = listPaginationRenderers[key];
  if (render) render();
  const pager = document.getElementById(`listPagination_${key}`);
  const target = pager?.previousElementSibling;
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changeListPageSize(key, value) {
  const size = parseInt(value, 10);
  if (!LIST_PAGE_SIZES.includes(size)) return;
  const pg = getListPaginationState(key);
  pg.pageSize = size;
  pg.page = 1;
  localStorage.setItem(`hq_list_page_size_${key}`, String(size));
  const render = listPaginationRenderers[key];
  if (render) render();
}

function resetListPagination(key) {
  getListPaginationState(key).page = 1;
}

function changeWordPage(page) {
  const nextPage = Number(page);
  if (!Number.isFinite(nextPage) || nextPage < 1) return;
  wordPagination.page = Math.floor(nextPage);
  renderWordChips();
  document.getElementById('wordListCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changeWordPageSize(value) {
  const size = parseInt(value, 10);
  if (!WORD_PAGE_SIZES.includes(size)) return;
  wordPagination.pageSize = size;
  wordPagination.page = 1;
  localStorage.setItem(WORD_PAGE_SIZE_KEY, String(size));
  renderWordChips();
}

function renderWordPagination(totalItems) {
  const pager = document.getElementById('wordPagination');
  if (!pager) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / wordPagination.pageSize));
  wordPagination.page = Math.min(Math.max(1, wordPagination.page), totalPages);

  if (totalItems === 0 || totalPages <= 1) {
    pager.innerHTML = '';
    pager.style.display = 'none';
    return;
  }

  const pageItems = getPaginationItems(wordPagination.page, totalPages);
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="pagination-btn pagination-nav" onclick="changeWordPage(${wordPagination.page - 1})" ${wordPagination.page === 1 ? 'disabled' : ''} aria-label="Trang trước">‹ <span>Trước</span></button>
    <div class="pagination-pages">
      ${pageItems.map(item => typeof item === 'number'
        ? `<button class="pagination-btn ${item === wordPagination.page ? 'active' : ''}" onclick="changeWordPage(${item})" ${item === wordPagination.page ? 'aria-current="page"' : ''}>${item}</button>`
        : `<span class="pagination-ellipsis" aria-hidden="true">…</span>`
      ).join('')}
    </div>
    <button class="pagination-btn pagination-nav" onclick="changeWordPage(${wordPagination.page + 1})" ${wordPagination.page === totalPages ? 'disabled' : ''} aria-label="Trang sau"><span>Sau</span> ›</button>
    <span class="pagination-summary">Trang ${wordPagination.page}/${totalPages}</span>
  `;
}

function renderWordChips() {
  const chips = document.getElementById('wordChips');
  const card = document.getElementById('wordListCard');
  const count = document.getElementById('wordCount');
  const range = document.getElementById('wordPageRange');
  const pageSizeSelect = document.getElementById('wordPageSize');
  if (!chips || !card || !count) return;

  chips.innerHTML = '';
  const totalItems = state.words.length;
  count.textContent = totalItems;

  if (totalItems === 0) {
    card.style.display = 'none';
    if (range) range.textContent = 'Đang xem 0 từ';
    renderWordPagination(0);
    return;
  }

  card.style.display = 'block';
  const totalPages = Math.max(1, Math.ceil(totalItems / wordPagination.pageSize));
  wordPagination.page = Math.min(Math.max(1, wordPagination.page), totalPages);

  const startIndex = (wordPagination.page - 1) * wordPagination.pageSize;
  const endIndex = Math.min(startIndex + wordPagination.pageSize, totalItems);
  const pageWords = state.words.slice(startIndex, endIndex);

  if (pageSizeSelect && Number(pageSizeSelect.value) !== wordPagination.pageSize) {
    pageSizeSelect.value = String(wordPagination.pageSize);
  }
  if (range) range.textContent = `Đang xem ${startIndex + 1}–${endIndex} / ${totalItems} từ`;

  pageWords.forEach((w, pageIndex) => {
    const originalIndex = startIndex + pageIndex;
    const chip = document.createElement('div');
    const isPending = needsAIRegen(w);
    chip.className = `word-chip ${isPending ? 'word-chip-pending' : ''}`;
    chip.innerHTML = `${w.korean} ${isPending ? '⚠️' : ''} <button class="word-chip-del" onclick="removeWord(${originalIndex})">×</button>`;
    chips.appendChild(chip);
  });

  renderWordPagination(totalItems);

  const regenBtn = document.getElementById('regenAiBtn');
  if (regenBtn) {
    const pending = state.words.filter(needsAIRegen).length;
    regenBtn.style.display = pending > 0 ? 'inline-flex' : 'none';
    if (pending > 0) regenBtn.textContent = `🔄 Tạo lại bằng AI (${pending})`;
  }
}
function removeWord(i) { state.words.splice(i,1); renderWordChips(); saveState(); showToast('Đã xóa từ','info'); }
function renderGrammarChips() {
  const chips = document.getElementById('grammarChips');
  const card = document.getElementById('grammarListCard');
  const count = document.getElementById('grammarCount');
  if (!chips || !card || !count) return;
  count.textContent = state.grammar.length;
  if (state.grammar.length === 0) {
    chips.innerHTML = '';
    card.style.display = 'none';
    mountListPagination(chips, 'grammarChips', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('grammarChips') }, 'ngữ pháp');
    return;
  }
  card.style.display = 'block';
  const entries = state.grammar.map((g, i) => ({ g, i }));
  const meta = paginateList('grammarChips', entries, renderGrammarChips, 20);
  chips.innerHTML = meta.pageItems.map(({g, i}) => `
    <div class="grammar-chip">📐 ${g.title} <button class="word-chip-del" onclick="removeGrammar(${i})">×</button></div>
  `).join('');
  mountListPagination(chips, 'grammarChips', meta, 'ngữ pháp');
}

function removeGrammar(i) { state.grammar.splice(i,1); renderGrammarChips(); renderGrammar(); saveState(); }
function loadSample(type) {
  document.getElementById('wordInput').value = (SAMPLES[type]||[]).join('\n');
  showToast(`Đã tải từ mẫu "${type}"`, 'info');
}

// ============ LEARN ============
function initLearn() {
  const empty = document.getElementById('learnEmpty');
  const cont = document.getElementById('learnCardContainer');
  const words = getActiveWords();
  if (words.length===0) { empty.style.display='flex'; cont.style.display='none'; return; }
  empty.style.display='none'; cont.style.display='flex';
  if (state.learn.index>=words.length) state.learn.index=0;
  renderLearnCard();
}
function renderLearnCard() {
  const words = getActiveWords();
  const w = words[state.learn.index];
  if (!w) return;
  // Track SRS seen count
  trackWordSeen(w.korean);
  document.getElementById('lcPos').textContent = (w.pos||'명사') + ` (${w.lesson || 'Bài 1'})`;
  document.getElementById('lcWord').textContent = w.korean;
  document.getElementById('lcRoman').textContent = w.roman||'';
  document.getElementById('lcMeaning').textContent = w.meaning||'';
  document.getElementById('lcExample').textContent = w.example||'';
  document.getElementById('lcExampleViet').textContent = w.exampleViet||'';
  document.getElementById('lcTip').textContent = w.tip||'';
  document.getElementById('aiExplainBox').style.display = 'none';
  const total = words.length, idx = state.learn.index;
  document.getElementById('learnCounter').textContent = `${idx+1} / ${total}`;
  document.getElementById('learnProgress').style.width = `${((idx+1)/total)*100}%`;
  // Show SRS rating badge if rated
  const rating = state.stats.ratings[w.korean];
  const seen = state.stats.wordSeenCount[w.korean] || 0;
  const posBadge = document.getElementById('lcPos');
  if (rating === 'hard') posBadge.style.background = 'rgba(248,113,113,0.2)';
  else if (rating === 'easy') posBadge.style.background = 'rgba(74,222,128,0.15)';
  else posBadge.style.background = '';
  const card = document.getElementById('learnCard');
  card.style.animation='none'; card.offsetHeight; card.style.animation='cardIn 0.35s cubic-bezier(0.34,1.56,0.64,1)';
}
function nextLearnCard() { state.learn.index=(state.learn.index+1)%state.words.length; renderLearnCard(); }
function prevLearnCard() { state.learn.index=(state.learn.index-1+state.words.length)%state.words.length; renderLearnCard(); }
function speakWord(ctx) {
  let w;
  if (ctx==='learn') w = state.words[state.learn.index];
  else if (ctx==='flash') w = state.flash.shuffled[state.flash.index];
  else if (ctx==='speak') w = state.words[state.speak.index%state.words.length];
  if (w) TTS.speak(w.korean);
}
function speakExample() {
  const w = state.words[state.learn.index];
  if (w?.example) TTS.speak(w.example);
}
async function aiExplainWord() {
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!','error'); return; }
  const w = state.words[state.learn.index];
  if (!w) return;
  const box = document.getElementById('aiExplainBox');
  const content = document.getElementById('aiExplainContent');
  box.style.display = 'block';
  content.textContent = '🤖 Đang hỏi Gemini...';
  try {
    const result = await GEMINI.explainWord(w.korean, w.meaning, w.example);
    content.textContent = result;
  } catch(e) {
    content.textContent = '❌ Lỗi: ' + e.message;
  }
}
function markKnown(known) {
  const w = state.words[state.learn.index];
  if (known) { state.learn.known[w.korean]=true; addXP(5); showToast('✅ Tuyệt! +5 XP','success',1500); }
  nextLearnCard(); updateStreak(); saveState();
}

// ============ BATCH LEARNING (HỌC THEO LỘ TRÌNH) ============
// Chia từ vựng đang học thành từng bộ 10-20 từ. Học xong bấm "Kiểm tra",
// phải đúng hết cả bộ mới được đánh dấu thuộc & mở khóa bộ tiếp theo.
// Tiến độ (từ nào đã thuộc) được lưu qua saveState() nên không bị mất khi tải lại trang.
let batchViewIndex = null; // bộ đang xem (null = tự theo bộ hiện tại đang mở khóa gần nhất)
let batchTest = null;      // phiên kiểm tra đang chạy (null = đang ở chế độ học/xem thẻ)
let batchSentencePractice = null; // phiên luyện đặt/dịch câu theo bộ
let batch10xPractice = null; // phiên luyện chép 10 lần theo bộ

function getBatches(words, size) {
  const out = [];
  const n = size > 0 ? size : 20;
  for (let i = 0; i < words.length; i += n) out.push(words.slice(i, i + n));
  return out;
}
function isBatchComplete(batch) {
  return batch.length > 0 && batch.every(w => state.batchLearn.mastered[w.korean]);
}
function getBatchMasteredCount(batch) {
  return batch.filter(w => state.batchLearn.mastered[w.korean]).length;
}
function getCurrentBatchIndex(batches) {
  for (let i = 0; i < batches.length; i++) if (!isBatchComplete(batches[i])) return i;
  return Math.max(0, batches.length - 1);
}
function setBatchSize(size) {
  state.batchLearn.size = size;
  state.batchLearn.index = 0;
  batchViewIndex = null; batchTest = null; batchSentencePractice = null; batch10xPractice = null;
  saveState();
  renderBatchPage();
  showToast(`📦 Mỗi bộ giờ có ${size} từ`, 'info', 1800);
}
function initBatchLearn() {
  batchTest = null; batchSentencePractice = null; batch10xPractice = null;
  renderBatchPage();
}
function viewBatch(i) {
  batchViewIndex = i;
  batchTest = null; batchSentencePractice = null; batch10xPractice = null;
  state.batchLearn.index = 0;
  renderBatchPage();
}
function renderBatchPage() {
  const words = getActiveWords();
  const emptyEl = document.getElementById('batchEmpty');
  const mainEl = document.getElementById('batchMain');
  if (!words.length) { emptyEl.style.display='flex'; mainEl.style.display='none'; return; }
  emptyEl.style.display='none'; mainEl.style.display='block';

  const size = state.batchLearn.size || 20;
  const batches = getBatches(words, size);
  const curIdx = getCurrentBatchIndex(batches);
  const viewIdx = (batchViewIndex!==null && batchViewIndex>=0 && batchViewIndex<batches.length) ? batchViewIndex : curIdx;

  const sizeSel = document.getElementById('batchSizeSelect');
  if (sizeSel) sizeSel.value = String(size);

  const batchOverviewEl = document.getElementById('batchOverview');
  const batchEntries = batches.map((b, i) => ({ b, i }));
  const batchMeta = paginateList('batchOverview', batchEntries, renderBatchPage, 20);
  batchOverviewEl.innerHTML = batchMeta.pageItems.map(({b,i}) => {
    const done = isBatchComplete(b);
    const locked = i > curIdx;
    const active = i === viewIdx;
    const icon = done ? '✅' : locked ? '🔒' : '🎯';
    return `<button class="batch-chip ${done?'batch-done':''} ${locked?'batch-locked':''} ${active?'batch-active':''}"
      onclick="viewBatch(${i})" ${locked?'disabled':''}>
      <span class="batch-chip-icon">${icon}</span>
      <span class="batch-chip-title">Bộ ${i+1}</span>
      <span class="batch-chip-count">${getBatchMasteredCount(b)}/${b.length}</span>
    </button>`;
  }).join('');
  mountListPagination(batchOverviewEl, 'batchOverview', batchMeta, 'bộ');

  renderBatchBody(batches, viewIdx, curIdx);
}
function renderBatchBody(batches, viewIdx, curIdx) {
  const body = document.getElementById('batchBody');
  const batch = batches[viewIdx];
  if (!batch) { body.innerHTML=''; return; }

  if (viewIdx > curIdx) {
    body.innerHTML = `<div class="batch-locked-msg">
      <div class="empty-icon">🔒</div>
      <p>Hoàn thành Bộ ${curIdx+1} với 100% chính xác để mở khóa Bộ ${viewIdx+1} nhé!</p>
      <button class="btn btn-primary" onclick="viewBatch(${curIdx})">📖 Về Bộ ${curIdx+1}</button>
    </div>`;
    return;
  }

  if (batch10xPractice && batch10xPractice.batchIndex === viewIdx) {
    renderBatch10xPracticeUI();
    return;
  }

  if (batchSentencePractice && batchSentencePractice.batchIndex === viewIdx) {
    renderBatchSentencePracticeUI();
    return;
  }

  if (batchTest && batchTest.batchIndex === viewIdx) {
    if (batchTest.queue.length === 0) renderBatchTestResult();
    else renderBatchTestUI();
    return;
  }

  if (state.batchLearn.index >= batch.length || state.batchLearn.index < 0) state.batchLearn.index = 0;
  const w = batch[state.batchLearn.index];
  const done = isBatchComplete(batch);
  const masteredCount = getBatchMasteredCount(batch);
  const isLast = viewIdx === batches.length - 1;

  body.innerHTML = `
    <div class="batch-status-row">
      <span>📦 Bộ ${viewIdx+1} · ${batch.length} từ${done?' · <span style="color:var(--green)">✅ Đã hoàn thành</span>':''}</span>
      <span>${masteredCount}/${batch.length} đã thuộc</span>
    </div>
    <div class="progress-bar-wrapper"><div class="progress-bar-fill" style="width:${(masteredCount/batch.length)*100}%"></div></div>
    <div class="learn-card-container">
      <div class="learn-card" id="batchCard">
        <div class="learn-card-top">
          <span class="word-pos">${w.pos||'명사'}${state.batchLearn.mastered[w.korean]?' · ✅':''}</span>
          <div class="learn-top-right"><button class="audio-btn" onclick="TTS.speak('${escStr(w.korean)}')" title="Nghe phát âm">🔊</button></div>
        </div>
        <div class="korean-word">${w.korean}</div>
        <div class="romanization">${w.roman||''}</div>
        <div class="meaning">${w.meaning||''}</div>
        <div class="divider"></div>
        <div class="example-block">
          <div class="example-label">Ví dụ <button class="mini-audio-btn" onclick="TTS.speak('${escStr(w.example||w.korean)}')">🔊</button></div>
          <div class="example-korean">${w.example||''}</div>
          <div class="example-viet">${w.exampleViet||''}</div>
        </div>
        <div class="tip-block"><div class="tip-icon">💡</div><div class="tip-text">${w.tip||''}</div></div>
      </div>
    </div>
    <div class="learn-controls" style="justify-content:center;margin:14px 0">
      <button class="btn btn-ghost btn-sm" onclick="batchStudyNav(-1)">← Trước</button>
      <span class="card-counter">${state.batchLearn.index+1} / ${batch.length}</span>
      <button class="btn btn-ghost btn-sm" onclick="batchStudyNav(1)">Tiếp →</button>
    </div>
    <div class="batch-actions" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <button class="btn btn-accent btn-lg" onclick="startBatch10xPractice(${viewIdx})">✏️ Luyện chép 10 lần & Kiểm tra Bộ ${viewIdx+1}</button>
      <button class="btn btn-primary btn-lg" onclick="startBatchTest(${viewIdx})">🎯 Trắc nghiệm Bộ ${viewIdx+1}</button>
      <button class="btn btn-ai btn-lg" onclick="startBatchSentencePractice(${viewIdx})">✍️ Luyện viết câu Bộ ${viewIdx+1}</button>
      ${done && !isLast ? `<button class="btn btn-accent btn-lg" onclick="viewBatch(${viewIdx+1})">➡️ Sang Bộ ${viewIdx+2}</button>` : ''}
    </div>
    ${done && isLast ? `<div class="batch-all-done">🏆 Bạn đã hoàn thành tất cả các bộ từ hiện có! Thêm từ mới ở Trang chủ để tiếp tục lộ trình nhé.</div>` : ''}
  `;
}

// ============ BATCH 10X PRACTICE (LUYỆN CHÉP 10 LẦN THEO BỘ) ============
function startBatch10xPractice(batchIdx, targetCount = 10) {
  const words = getActiveWords();
  const batches = getBatches(words, state.batchLearn.size || 20);
  const batch = batches[batchIdx];
  if (!batch || !batch.length) return;

  batchViewIndex = batchIdx;
  batchTest = null;
  batchSentencePractice = null;

  batch10xPractice = {
    batchIndex: batchIdx,
    batchWords: batch,
    wordIndex: 0,
    targetCount: targetCount,
    currentCount: 0,
    completedWords: new Set(),
    autoStartTest: true,
  };

  renderBatchPage();
}

function set10xTargetCount(count) {
  if (!batch10xPractice) return;
  batch10xPractice.targetCount = parseInt(count) || 10;
  if (batch10xPractice.currentCount > batch10xPractice.targetCount) {
    batch10xPractice.currentCount = batch10xPractice.targetCount;
  }
  renderBatchPage();
}

function renderBatch10xPracticeUI() {
  const sp = batch10xPractice;
  const body = document.getElementById('batchBody');
  if (!sp || !sp.batchWords || !sp.batchWords.length) {
    body.innerHTML = '';
    return;
  }

  const w = sp.batchWords[sp.wordIndex];
  if (!w) {
    finishBatch10xPractice();
    return;
  }

  const totalWords = sp.batchWords.length;
  const wordNum = sp.wordIndex + 1;
  const currentCount = sp.currentCount;
  const targetCount = sp.targetCount || 10;

  let pillsHtml = '';
  for (let i = 1; i <= targetCount; i++) {
    const isDone = i <= currentCount;
    const isActive = i === currentCount + 1;
    pillsHtml += `<span class="rep-pill ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}">${isDone ? '✓' : i}</span>`;
  }

  const safeKorean = escStr(w.korean);
  const safeMeaning = escStr(w.meaning || '');
  const safeExample = escStr(w.example || w.korean);

  body.innerHTML = `
    <div class="batch-status-row">
      <span>✏️ Luyện chép 10 lần · Bộ ${sp.batchIndex + 1}</span>
      <span>Từ ${wordNum}/${totalWords}: <strong>${w.korean}</strong></span>
    </div>
    <div class="progress-bar-wrapper">
      <div class="progress-bar-fill" style="width:${(sp.wordIndex / totalWords) * 100}%"></div>
    </div>

    <div class="batch-10x-card">
      <div class="batch-10x-header">
        <div class="batch-10x-settings">
          <label for="targetCountSelect">🎯 Mục tiêu luyện chép:</label>
          <select id="targetCountSelect" class="settings-select-sm" onchange="set10xTargetCount(this.value)">
            <option value="5" ${targetCount === 5 ? 'selected' : ''}>5 lần / từ</option>
            <option value="10" ${targetCount === 10 ? 'selected' : ''}>10 lần / từ (Khuyên dùng)</option>
            <option value="15" ${targetCount === 15 ? 'selected' : ''}>15 lần / từ</option>
            <option value="20" ${targetCount === 20 ? 'selected' : ''}>20 lần / từ</option>
          </select>
          <label class="toggle-label" style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;margin-left:10px">
            <input type="checkbox" id="bilingualTtsToggle" ${state.bilingualTts !== false ? 'checked' : ''} onchange="state.bilingualTts = this.checked; saveState();" /> 🔊 Đọc Hàn + Việt
          </label>
        </div>
        <div class="batch-10x-counter-badge">
          Lần <span class="counter-num">${currentCount}</span> / ${targetCount}
        </div>
      </div>

      <div class="batch-10x-word-box">
        <div class="batch-10x-pos-row">
          <span class="word-pos">${w.pos || '명사'}</span>
          <button class="audio-btn" onclick="speakBilingual('${safeKorean}', '${safeMeaning}')" title="Nghe đọc tiếng Hàn & tiếng Việt">🔊 Nghe Hàn + Việt</button>
        </div>
        <div class="korean-word font-kr" style="font-size:2.4rem;color:var(--accent-light);margin:6px 0">${w.korean}</div>
        <div class="romanization" style="font-size:1.05rem;color:var(--text-secondary)">[ ${w.roman || w.korean} ]</div>
        <div class="meaning" style="font-size:1.15rem;font-weight:700;color:var(--text-primary);margin-top:6px">🇻🇳 ${w.meaning || ''}</div>

        ${w.example ? `
          <div class="example-block" style="margin-top:12px;text-align:left">
            <div class="example-label">Ví dụ <button class="mini-audio-btn" onclick="TTS.speak('${safeExample}')">🔊</button></div>
            <div class="example-korean font-kr">${w.example}</div>
            ${w.exampleViet ? `<div class="example-viet">${w.exampleViet}</div>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="rep-pills-wrap">
        <div class="rep-pills-label">Số lần đã gõ đúng từ <strong>"${w.korean}"</strong>:</div>
        <div class="rep-pills-row" id="repPillsRow">${pillsHtml}</div>
      </div>

      <div class="batch-10x-input-wrap">
        <input type="text" id="batch10xInput" class="batch-10x-input font-kr"
          placeholder="Gõ lại từ tiếng Hàn: ${w.korean}"
          autocomplete="off"
          autofocus
          onkeydown="if(event.key==='Enter') handleBatch10xSubmit()" />
        <button class="btn btn-primary btn-md" onclick="handleBatch10xSubmit()">✅ Xác nhận (Enter)</button>
      </div>
      <div class="batch-10x-input-tip">💡 Bật bàn phím tiếng Hàn (Win + Space) để gõ chính xác</div>
      <div id="batch10xFeedback" class="batch-10x-feedback" style="display:none"></div>
    </div>

    <div class="batch-10x-actions">
      <button class="btn btn-ghost btn-sm" onclick="navBatch10xWord(-1)" ${sp.wordIndex === 0 ? 'disabled' : ''}>← Từ trước</button>
      <span class="card-counter">${wordNum} / ${totalWords}</span>
      <button class="btn btn-ghost btn-sm" onclick="navBatch10xWord(1)" ${sp.wordIndex === totalWords - 1 ? 'disabled' : ''}>Từ tiếp →</button>
    </div>

    <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="startBatchTest(${sp.batchIndex})">🎯 Qua thẳng Kiểm tra Bộ ${sp.batchIndex + 1}</button>
      <button class="btn btn-ghost" onclick="stopBatchTest()">🔙 Thoát luyện chép</button>
    </div>
  `;

  setTimeout(() => {
    const inputEl = document.getElementById('batch10xInput');
    if (inputEl) inputEl.focus();
  }, 50);
}

function handleBatch10xSubmit() {
  const sp = batch10xPractice;
  if (!sp) return;
  const inputEl = document.getElementById('batch10xInput');
  const fbEl = document.getElementById('batch10xFeedback');
  if (!inputEl) return;

  const w = sp.batchWords[sp.wordIndex];
  if (!w) return;

  const typedVal = inputEl.value.trim();
  const targetVal = w.korean.trim();

  if (!typedVal) {
    if (fbEl) {
      fbEl.style.display = 'block';
      fbEl.className = 'batch-10x-feedback fb-warn';
      fbEl.innerHTML = '⚠️ Vui lòng nhập từ tiếng Hàn vào ô trên!';
    }
    return;
  }

  if (typedVal === targetVal) {
    sp.currentCount++;
    addXP(1);
    if (state.bilingualTts !== false) {
      speakBilingual(w.korean, w.meaning);
    } else {
      TTS.speak(w.korean, 'ko-KR');
    }

    inputEl.value = '';

    if (fbEl) {
      fbEl.style.display = 'block';
      fbEl.className = 'batch-10x-feedback fb-success';
      fbEl.innerHTML = `🎉 Chính xác! (+1 XP) — Đã thuộc <strong>${sp.currentCount}/${sp.targetCount}</strong> lần`;
    }

    if (sp.currentCount >= sp.targetCount) {
      sp.completedWords.add(w.korean);
      if (sp.wordIndex < sp.batchWords.length - 1) {
        showToast(`🎉 Tuyệt vời! Đã hoàn thành ${sp.targetCount} lần từ "${w.korean}". Sang từ tiếp theo!`, 'success', 2000);
        sp.wordIndex++;
        sp.currentCount = 0;
      } else {
        finishBatch10xPractice();
        return;
      }
    }

    renderBatchPage();
  } else {
    inputEl.classList.add('shake-error');
    setTimeout(() => inputEl.classList.remove('shake-error'), 500);
    inputEl.select();

    if (fbEl) {
      fbEl.style.display = 'block';
      fbEl.className = 'batch-10x-feedback fb-error';
      fbEl.innerHTML = `❌ Chưa đúng! Bạn nhập "<strong>${escapePracticeHtml(typedVal)}</strong>", đáp án đúng là "<strong>${escapePracticeHtml(targetVal)}</strong>". Thử lại nhé!`;
    }
  }
}

function navBatch10xWord(delta) {
  const sp = batch10xPractice;
  if (!sp) return;
  const newIdx = sp.wordIndex + delta;
  if (newIdx >= 0 && newIdx < sp.batchWords.length) {
    sp.wordIndex = newIdx;
    sp.currentCount = 0;
    renderBatchPage();
  }
}

function finishBatch10xPractice() {
  const sp = batch10xPractice;
  if (!sp) return;
  const bIdx = sp.batchIndex;
  const tCount = sp.targetCount;
  batch10xPractice = null;
  showToast(`🏆 Xuất sắc! Bạn đã hoàn thành luyện chép ${tCount} lần tất cả từ trong Bộ ${bIdx + 1}! Chuyển sang bài kiểm tra ngay.`, 'success', 3500);
  startBatchTest(bIdx);
}

function startQuick10xWord(koreanWord) {
  const words = getActiveWords();
  const size = state.batchLearn.size || 20;
  const batches = getBatches(words, size);
  let foundBatchIdx = 0;
  for (let i = 0; i < batches.length; i++) {
    if (batches[i].some(w => w.korean === koreanWord)) {
      foundBatchIdx = i;
      break;
    }
  }

  setMode('batch');
  startBatch10xPractice(foundBatchIdx, 10);

  if (batch10xPractice) {
    const wIdx = batch10xPractice.batchWords.findIndex(w => w.korean === koreanWord);
    if (wIdx >= 0) batch10xPractice.wordIndex = wIdx;
    renderBatchPage();
  }
}
function batchStudyNav(delta) {
  const words = getActiveWords();
  const batches = getBatches(words, state.batchLearn.size||20);
  const viewIdx = batchViewIndex!==null ? batchViewIndex : getCurrentBatchIndex(batches);
  const batch = batches[viewIdx];
  if (!batch || !batch.length) return;
  state.batchLearn.index = (state.batchLearn.index + delta + batch.length) % batch.length;
  renderBatchPage();
}
function startBatchTest(batchIdx) {
  if (state.words.length < 4) { showToast('⚠️ Cần ít nhất 4 từ vựng trong sổ để tạo câu hỏi trắc nghiệm!','error'); return; }
  const words = getActiveWords();
  const batches = getBatches(words, state.batchLearn.size||20);
  const batch = batches[batchIdx];
  if (!batch || !batch.length) return;
  batchViewIndex = batchIdx;
  batchSentencePractice = null;
  batchTest = {
    batchIndex: batchIdx,
    batchWords: batch,
    queue: shuffle(batch).map(w => ({ word: w, type: Math.random()>0.5?'kr2vn':'vn2kr' })),
    totalWords: batch.length,
    completedWords: new Set(),
    mistakes: {},
    answered: false,
  };
  renderBatchPage();
}
function renderBatchTestUI() {
  const t = batchTest;
  const body = document.getElementById('batchBody');
  const q = t.queue[0];
  const doneCount = t.completedWords.size;
  body.innerHTML = `
    <div class="batch-status-row"><span>🧪 Kiểm tra Bộ ${t.batchIndex+1}</span><span>${doneCount}/${t.totalWords} từ đã qua</span></div>
    <div class="progress-bar-wrapper"><div class="progress-bar-fill" style="width:${(doneCount/t.totalWords)*100}%"></div></div>
    <div class="quiz-container">
      <div class="quiz-type-badge">${q.type==='kr2vn' ? '🇰🇷 → 🇻🇳 Chọn nghĩa tiếng Việt' : '🇻🇳 → 🇰🇷 Chọn từ tiếng Hàn'}</div>
      <div class="quiz-question" style="${q.type==='vn2kr'?'':"font-family:'Noto Sans KR',sans-serif"}">${q.type==='kr2vn'?q.word.korean:q.word.meaning}</div>
      <div class="quiz-hint">${q.type==='kr2vn'?(q.word.roman||''):(q.word.pos||'')}</div>
      <div class="quiz-options" id="batchQuizOptions"></div>
      <div class="quiz-feedback" id="batchQuizFeedback" style="display:none"></div>
      <button class="btn btn-primary quiz-next-btn" id="batchQuizNextBtn" style="display:none" onclick="nextBatchTestQuestion()">Tiếp theo →</button>
    </div>
    <div style="text-align:center;margin-top:14px">
      <button class="btn btn-ghost btn-sm" onclick="stopBatchTest()">🔙 Dừng, học lại đã</button>
    </div>
  `;
  const optsWrap = document.getElementById('batchQuizOptions');
  const pool = (t.batchWords && t.batchWords.length >= 4) ? t.batchWords : getActiveWords();
  const wrongList = getSmartWrongChoices(q.word, pool, 3);
  if (q.type === 'kr2vn') {
    const wrong = wrongList.map(w=>w.meaning);
    const choices = shuffle([q.word.meaning, ...wrong]);
    optsWrap.innerHTML = choices.map(c=>`<button class="quiz-option" onclick="answerBatchTest(this,'${escStr(c)}','${escStr(q.word.meaning)}')">${c}</button>`).join('');
  } else {
    const wrong = wrongList.map(w=>w.korean);
    const choices = shuffle([q.word.korean, ...wrong]);
    optsWrap.innerHTML = choices.map(c=>`<button class="quiz-option" style="font-family:'Noto Sans KR',sans-serif" onclick="answerBatchTest(this,'${escStr(c)}','${escStr(q.word.korean)}')">${c}</button>`).join('');
  }
}
function answerBatchTest(btn, chosen, correct) {
  const t = batchTest;
  if (!t || t.answered) return;
  t.answered = true;
  document.querySelectorAll('#batchQuizOptions .quiz-option').forEach(o => {
    o.disabled = true;
    if (o.textContent.trim() === correct) o.classList.add('correct');
  });
  const q = t.queue[0];
  const ok = chosen === correct;
  const fb = document.getElementById('batchQuizFeedback');
  state.stats.totalAnswered++;
  if (ok) {
    btn.classList.add('correct');
    t.completedWords.add(q.word.korean);
    t.queue.shift();
    state.stats.totalCorrect++;
    addXP(6);
    fb.innerHTML = '<div class="batch-fb-correct">🎉 Chính xác! <span style="color:var(--gold)">+6 XP</span></div>';
    fb.className = 'quiz-feedback feedback-correct';
  } else {
    btn.classList.add('wrong');
    t.mistakes[q.word.korean] = (t.mistakes[q.word.korean]||0) + 1;
    state.stats.ratings[q.word.korean] = 'hard';
    t.queue.shift();
    t.queue.push({ word: q.word, type: q.type==='kr2vn'?'vn2kr':'kr2vn' });
    const w = q.word;
    const safeKr = escStr(w.korean);
    fb.innerHTML = `
      <div class="batch-fb-wrong-header">❌ Chưa đúng — Từ này sẽ quay lại để ôn thêm!</div>
      <div class="batch-explain-card">
        <div class="batch-explain-top">
          <div class="batch-explain-kr">${w.korean}</div>
          <button class="mini-audio-btn" onclick="TTS.speak('${safeKr}')" title="Nghe phát âm">🔊</button>
        </div>
        <div class="batch-explain-roman">[ ${w.roman || w.korean} ]</div>
        <div class="batch-explain-meaning">🇻🇳 <strong>Nghĩa đúng:</strong> ${w.meaning || ''}</div>
        ${w.example ? `
          <div class="batch-explain-example">
            📌 <span class="font-kr">${w.example}</span>
            ${w.exampleViet ? `<div class="batch-explain-vi">${w.exampleViet}</div>` : ''}
          </div>` : ''}
        ${w.tip ? `<div class="batch-explain-tip">💡 <em>${w.tip}</em></div>` : ''}
        <div style="margin-top:8px;text-align:center">
          <button class="btn btn-ghost btn-sm" style="color:var(--accent-light);border:1px solid var(--accent-glow)" onclick="startQuick10xWord('${safeKr}')">✏️ Luyện chép 10 lần từ "${w.korean}" ngay</button>
        </div>
      </div>
    `;
    fb.className = 'quiz-feedback feedback-wrong';
  }
  fb.style.display = 'block';
  document.getElementById('batchQuizNextBtn').style.display = 'block';
  saveState();
}
function nextBatchTestQuestion() {
  const t = batchTest;
  if (!t) return;
  t.answered = false;
  if (t.queue.length === 0) {
    const words = getActiveWords();
    const batches = getBatches(words, state.batchLearn.size||20);
    const batch = batches[t.batchIndex] || [];
    batch.forEach(w => state.batchLearn.mastered[w.korean] = true);
    state.stats.quizzesCompleted++;
    addXP(25);
    saveState();
    renderBatchPage();
  } else {
    renderBatchTestUI();
  }
}
function renderBatchTestResult() {
  const t = batchTest;
  const body = document.getElementById('batchBody');
  if (!t) return;
  const mistakeWords = Object.keys(t.mistakes);
  const totalMistakes = Object.values(t.mistakes).reduce((a,b)=>a+b,0);
  const perfect = totalMistakes === 0;
  body.innerHTML = `
    <div class="quiz-result" style="display:flex">
      <div class="result-emoji">${perfect?'🏆':'🎉'}</div>
      <div class="result-text">${perfect ? 'Hoàn hảo! Không sai từ nào!' : 'Đã hoàn thành Bộ '+(t.batchIndex+1)+'!'}</div>
      <div class="result-score">${t.totalWords}/${t.totalWords} từ đã thuộc${totalMistakes>0?` (ôn lại ${mistakeWords.length} từ, nhầm ${totalMistakes} lần)`:''}</div>
      ${mistakeWords.length>0 ? `<div class="batch-review-chips">${mistakeWords.map(k=>`<span class="diff-chip">${k}</span>`).join('')}</div>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:14px">
        <button class="btn btn-ai btn-lg" onclick="startBatchSentencePractice(${t.batchIndex})">✍️ Luyện viết câu Bộ này</button>
        <button class="btn btn-primary btn-lg" onclick="afterBatchTestContinue()">➡️ Tiếp tục sang Bộ tiếp theo</button>
      </div>
    </div>
  `;
  showToast(`🎉 Đã hoàn thành Bộ ${t.batchIndex+1}!`, 'success', 3000);
}
function afterBatchTestContinue() {
  const words = getActiveWords();
  const batches = getBatches(words, state.batchLearn.size||20);
  const finishedIdx = batchTest ? batchTest.batchIndex : (batchViewIndex||0);
  batchTest = null;
  batchSentencePractice = null;
  batchViewIndex = (finishedIdx < batches.length - 1) ? finishedIdx + 1 : finishedIdx;
  state.batchLearn.index = 0;
  renderBatchPage();
}
function stopBatchTest() {
  batchTest = null;
  batchSentencePractice = null;
  renderBatchPage();
}

// ============ BATCH SENTENCE PRACTICE (LUYỆN VIẾT CÂU THEO BỘ) ============
function startBatchSentencePractice(batchIdx) {
  const words = getActiveWords();
  const batches = getBatches(words, state.batchLearn.size||20);
  const batch = batches[batchIdx];
  if (!batch || !batch.length) return;

  batchViewIndex = batchIdx;
  batchTest = null;

  const activeG = getActiveGrammar();
  const grammars = activeG && activeG.length > 0 ? activeG : (state.grammar && state.grammar.length > 0 ? state.grammar : DEFAULT_GRAMMAR);

  batchSentencePractice = {
    batchIndex: batchIdx,
    batchWords: batch,
    grammars: grammars,
    currentQuestion: null,
    answered: false,
    loading: true,
    total: 0,
    correct: 0,
  };

  renderBatchPage();
  generateBatchSentenceQuestion();
}

async function generateBatchSentenceQuestion() {
  const sp = batchSentencePractice;
  if (!sp) return;
  if (!sp.recentQuestions) sp.recentQuestions = [];

  sp.loading = true;
  sp.answered = false;
  sp.currentQuestion = null;
  renderBatchPage();

  const words = sp.batchWords;
  const grammars = sp.grammars;
  const direction = Math.random() > 0.5 ? 'vn2kr' : 'kr2vn';

  if (GEMINI.getKey()) {
    try {
      const vocabListStr = words.map(w => `${w.korean} (${w.meaning})`).join(', ');
      const grammarListStr = grammars.slice(0, 10).map(g => g.title).join(', ');
      const avoidStr = sp.recentQuestions.length > 0
        ? `\nCÁC CÂU ĐÃ TẠO TRƯỚC ĐÂY (TUYỆT ĐỐI KHÔNG ĐƯỢC LẶP LẠI VÀ KHÔNG TẠO CÂU TƯƠNG TỰ): \n${sp.recentQuestions.slice(-10).map(q => `- ${q}`).join('\n')}\n`
        : '';

      const prompt = `Bạn là giáo viên tiếng Hàn dạy trình độ SƠ CẤP.

DANH SÁCH TỪ VỰNG TRONG BỘ HỌC NÀY (BẮT BUỘC DÙNG TỪ TRONG NÀY):
${vocabListStr}

CẤU TRÚC NGỮ PHÁP (Áp dụng 1 cấu trúc trong đây):
${grammarListStr}
${avoidStr}
QUY TẮC NGHIÊM NGẶT (PHẢI THỰC HIỆN ĐÚNG 100%):
1. LOGIC THỰC TẾ 100%: Nội dung câu phải hợp lý với thực tế đời sống. CẤM tạo câu phi logic (Ví dụ CẤM: "tôi 23 tuổi em tôi 24 tuổi" - phi lý vì em không thể nhiều tuổi hơn anh/chị; CẤM: con mèo lái xe, đồ vật biết nói, cá sấu bay...). Số tuổi, thời gian, tên mối quan hệ phải logic chuẩn xác.
2. DỊCH SÁT NGHĨA & CHUẨN XÁC 100%: Câu tiếng Việt và câu tiếng Hàn phải dịch tương đương nghĩa tuyệt đối, chuẩn ngữ pháp Sơ cấp, không diễn đạt ngớ ngẩn.
3. BÁM SÁT TỪ VỰNG BỘ: Sử dụng đúng từ vựng trong danh sách trên.
4. Chiều dịch: ${direction === 'vn2kr' ? 'Câu hỏi Tiếng Việt -> Đáp án Tiếng Hàn' : 'Câu hỏi Tiếng Hàn -> Đáp án Tiếng Việt'}.

Trả về JSON (không có text nào khác):
{
  "direction": "${direction}",
  "questionText": "câu ${direction==='vn2kr'?'tiếng Việt chuẩn logic':'tiếng Hàn chuẩn logic'}",
  "answerText": "đáp án ${direction==='vn2kr'?'tiếng Hàn':'tiếng Việt'} dịch sát nghĩa 100%",
  "batchVocabUsed": ["từ_Hàn_dùng_trong_bộ"],
  "grammarUsed": "cấu trúc ngữ pháp",
  "hint": "gợi ý ngắn",
  "explanation": "giải thích ngắn nghĩa và ngữ pháp bằng tiếng Việt"
}`;

      const raw = await GEMINI.call(prompt, '', { temperature: 0.3, maxOutputTokens: 500 });
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);

        // Validate: the Korean answer must contain at least one batch vocab word
        const answerKr = (direction === 'vn2kr' ? parsed.answerText : parsed.questionText) || '';
        const batchKoreanWords = words.map(w => w.korean);
        const containsBatchVocab = batchKoreanWords.some(kw => answerKr.includes(kw));

        if (containsBatchVocab && parsed.questionText && parsed.answerText) {
          sp.currentQuestion = {
            direction: parsed.direction || direction,
            questionText: parsed.questionText,
            answerText: parsed.answerText,
            batchVocabUsed: Array.isArray(parsed.batchVocabUsed) ? parsed.batchVocabUsed : [],
            grammarUsed: parsed.grammarUsed || '',
            hint: parsed.hint || '',
            explanation: parsed.explanation || ''
          };
          sp.recentQuestions.push(parsed.questionText);
          if (sp.recentQuestions.length > 20) sp.recentQuestions.shift();
        } else {
          console.warn('AI generated off-topic sentence (no batch vocab found), falling back to local example.');
        }
      }
    } catch(e) {
      console.warn('AI batch sentence gen error, falling back to local:', e);
    }
  }

  // Fallback: always use a word from the batch with its example sentence
  if (!sp.currentQuestion) {
    const unusedWords = words.filter(w =>
      !sp.recentQuestions.includes(w.korean) &&
      !sp.recentQuestions.includes(w.exampleViet) &&
      (w.example || w.exampleViet) // only pick words that have example sentences
    );
    const candidateWords = unusedWords.length > 0 ? unusedWords : words.filter(w => w.example || w.exampleViet);
    const pool = candidateWords.length > 0 ? candidateWords : words;
    const w = pool[Math.floor(Math.random() * pool.length)];
    const g = grammars[Math.floor(Math.random() * grammars.length)] || { title: 'Cấu trúc câu cơ bản' };
    const isVn = direction === 'vn2kr';

    const qText = isVn ? (w.exampleViet || `Hãy đặt câu với từ "${w.meaning}"`) : (w.example || w.korean);
    const aText = isVn ? (w.example || w.korean) : (w.exampleViet || w.meaning);

    sp.currentQuestion = {
      direction: direction,
      questionText: qText,
      answerText: aText,
      batchVocabUsed: [w.korean],
      grammarUsed: g.title,
      hint: `Từ vựng bộ: ${w.korean} (${w.meaning}) | Ngữ pháp: ${g.title}`,
      explanation: `Dùng từ vựng "${w.korean}" (${w.meaning}) và ngữ pháp ${g.title}`
    };
    sp.recentQuestions.push(qText);
    if (sp.recentQuestions.length > 20) sp.recentQuestions.shift();
  }

  sp.loading = false;
  renderBatchPage();
}

function renderBatchSentencePracticeUI() {
  const sp = batchSentencePractice;
  const body = document.getElementById('batchBody');
  if (!sp || !body) return;

  if (sp.loading) {
    body.innerHTML = `
      <div class="batch-status-row">
        <span>✍️ Luyện viết câu Bộ ${sp.batchIndex+1} (Vận dụng Từ vựng Bộ & Ngữ pháp)</span>
        <button class="btn btn-ghost btn-xs" onclick="stopBatchSentencePractice()">🔙 Dừng lại</button>
      </div>
      <div class="sp-loading" style="padding: 40px 0; text-align:center;">
        <div class="sp-loading-spinner"></div>
        <p style="margin-top:12px;color:var(--text-secondary)">🤖 AI đang tổng hợp từ vựng Bộ ${sp.batchIndex+1} & Ngữ pháp đã học để tạo câu bài tập...</p>
      </div>
    `;
    return;
  }

  const q = sp.currentQuestion;
  const isVn2Kr = q.direction === 'vn2kr';

  body.innerHTML = `
    <div class="batch-status-row">
      <span>✍️ Luyện viết câu Bộ ${sp.batchIndex+1} · Dùng từ vựng & Ngữ pháp đã học</span>
      <span>Đã luyện: ${sp.total} câu</span>
    </div>

    <!-- Vocab & Grammar Summary Chips for this Batch -->
    <div style="background:var(--hover-bg);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:16px;">
      <div style="font-size:0.78rem;font-weight:700;color:var(--accent);margin-bottom:6px">📦 Từ vựng trong Bộ ${sp.batchIndex+1}:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        ${sp.batchWords.map(w => `<span class="diff-chip" style="font-size:0.75rem;background:rgba(99,102,241,0.1);color:var(--accent);border:1px solid rgba(99,102,241,0.2)">${w.korean} (${w.meaning})</span>`).join('')}
      </div>
      <div style="font-size:0.78rem;font-weight:700;color:var(--gold);margin-bottom:6px">📐 Ngữ pháp áp dụng:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${sp.grammars.slice(0,6).map(g => `<span class="diff-chip" style="font-size:0.75rem;background:rgba(245,158,11,0.1);color:var(--gold);border:1px solid rgba(245,158,11,0.2)">${g.title}</span>`).join('')}
      </div>
    </div>

    <!-- Exercise Card -->
    <div class="sp-exercise-card" style="margin:0 auto;max-width:100%">
      <div class="sp-dir-badge">${isVn2Kr ? '🇻🇳 → 🇰🇷 Dịch sang Tiếng Hàn' : '🇰🇷 → 🇻🇳 Dịch sang Tiếng Việt'}</div>
      
      <div class="sp-question-label">${isVn2Kr ? 'Dịch câu sau sang tiếng Hàn:' : 'Dịch câu sau sang tiếng Việt:'}</div>
      <div class="sp-question-sentence">${q.questionText}</div>
      ${q.hint ? `<div class="sp-question-hint">💡 ${q.hint}</div>` : ''}

      <div class="sp-vocab-hints">
        ${q.batchVocabUsed.map(v => `<span class="sp-hint-chip">📦 Từ vựng tested: <strong class="sp-hint-kr">${v}</strong></span>`).join('')}
        ${q.grammarUsed ? `<span class="sp-hint-chip" style="border-color:rgba(245,158,11,0.3)">📐 Ngữ pháp tested: <strong style="color:var(--gold)">${q.grammarUsed}</strong></span>` : ''}
      </div>

      <div class="sp-input-wrap">
        <textarea id="batchSpAnswerInput" class="sp-answer-textarea" placeholder="${isVn2Kr ? 'Nhập câu dịch tiếng Hàn của bạn...' : 'Nhập câu dịch tiếng Việt của bạn...'}" rows="3" ${sp.answered ? 'disabled' : ''} onkeydown="if(event.key==='Enter'&&event.ctrlKey)checkBatchSentenceAnswer()">${sp.lastUserAnswer && sp.answered ? escStr(sp.lastUserAnswer) : ''}</textarea>
        <div class="sp-input-tips">💡 Nhấn <kbd>Ctrl+Enter</kbd> để AI chấm bài</div>
      </div>

      ${!sp.answered ? `
        <div class="sp-answer-actions" id="batchSpActions">
          <button class="btn btn-primary" onclick="checkBatchSentenceAnswer()" id="batchSpCheckBtn">✅ AI Chấm bài</button>
          <button class="btn btn-ghost" onclick="showBatchSentenceAnswer()">👁 Xem đáp án</button>
          <button class="btn btn-ghost" onclick="TTS.speak('${escStr(isVn2Kr ? q.answerText : q.questionText)}')">🔊 Nghe phát âm</button>
        </div>
      ` : ''}

      <div class="sp-feedback" id="batchSpFeedback" style="display:${sp.answered ? 'block' : 'none'}"></div>

      ${sp.answered ? `
        <div class="sp-next-actions" style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-primary btn-lg" onclick="generateBatchSentenceQuestion()">✨ Câu tiếp theo</button>
          <button class="btn btn-secondary btn-lg" onclick="retryBatchSentenceQuestion()">🔄 Làm lại câu này</button>
          <button class="btn btn-ghost" onclick="stopBatchSentencePractice()">🔙 Về lại Bộ ${sp.batchIndex+1}</button>
        </div>
      ` : ''}
    </div>

    <div style="text-align:center;margin-top:16px">
      <button class="btn btn-ghost btn-sm" onclick="stopBatchSentencePractice()">🔙 Dừng luyện câu, về Bộ ${sp.batchIndex+1}</button>
    </div>
  `;

  if (!sp.answered) {
    const inp = document.getElementById('batchSpAnswerInput');
    if (inp) setTimeout(() => inp.focus(), 100);
  }
}

function normalizePracticeText(value) {
  return String(value || '').toLowerCase().replace(/[.,!?~"'“”‘’]/g, '').replace(/\s+/g, ' ').trim();
}

function hasHangul(value) {
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(String(value || ''));
}

function isAnswerLanguageValid(direction, answer) {
  const text = String(answer || '').trim();
  if (!text) return false;

  if (direction === 'vn2kr') {
    // Việt -> Hàn: câu trả lời bắt buộc phải có Hangul.
    return hasHangul(text);
  }

  // Hàn -> Việt: không chấp nhận câu chỉ/toàn tiếng Hàn.
  const chars = [...text].filter(ch => /[A-Za-zÀ-ỹ가-힣]/.test(ch));
  if (!chars.length) return false;
  const hangulCount = chars.filter(ch => /[가-힣]/.test(ch)).length;
  return hangulCount / chars.length < 0.45;
}

function escapePracticeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function checkBatchSentenceAnswer() {
  const sp = batchSentencePractice;
  if (!sp || sp.answered) return;

  const inp = document.getElementById('batchSpAnswerInput');
  const userAns = (inp ? inp.value : '').trim();
  if (!userAns) {
    showToast('⚠️ Vui lòng nhập câu dịch của bạn!', 'warning');
    return;
  }

  const q = sp.currentQuestion;
  const languageOk = isAnswerLanguageValid(q.direction, userAns);
  const copiedQuestion = normalizePracticeText(userAns) === normalizePracticeText(q.questionText)
    && normalizePracticeText(q.questionText) !== normalizePracticeText(q.answerText);

  sp.answered = true;
  sp.lastUserAnswer = userAns;
  sp.total++;

  const checkBtn = document.getElementById('batchSpCheckBtn');
  if (checkBtn) {
    checkBtn.disabled = true;
    checkBtn.textContent = '⏳ AI đang chấm...';
  }

  let gradeResult = null;

  // Chặn lỗi như ảnh: đề yêu cầu Việt -> Hàn nhưng học viên nhập lại câu tiếng Việt
  // mà AI vẫn cho 100/100.
  if (!languageOk || copiedQuestion) {
    const target = q.direction === 'vn2kr' ? 'tiếng Hàn' : 'tiếng Việt';
    gradeResult = {
      score: 0,
      verdict: 'wrong',
      note: copiedQuestion
        ? `Bạn đang nhập lại nguyên câu đề bài. Hãy dịch sang ${target}.`
        : `Câu trả lời chưa đúng ngôn ngữ yêu cầu. Hãy trả lời bằng ${target}.`,
      corrected: q.answerText,
      explanation: q.explanation || `Chiều dịch của câu này là ${q.direction === 'vn2kr' ? 'Việt → Hàn' : 'Hàn → Việt'}.`,
    };
  }

  if (!gradeResult && GEMINI.getKey()) {
    try {
      const targetLanguage = q.direction === 'vn2kr' ? 'TIẾNG HÀN' : 'TIẾNG VIỆT';
      const prompt = `Bạn là giáo viên tiếng Hàn đang chấm bài dịch cho học viên Việt Nam.

CHIỀU DỊCH BẮT BUỘC: ${q.direction === 'vn2kr' ? 'Tiếng Việt -> Tiếng Hàn' : 'Tiếng Hàn -> Tiếng Việt'}
NGÔN NGỮ CÂU TRẢ LỜI BẮT BUỘC: ${targetLanguage}

Bộ từ vựng tested: ${q.batchVocabUsed.join(', ')}
Ngữ pháp tested: ${q.grammarUsed}
Câu gốc: "${q.questionText}"
Đáp án tham khảo: "${q.answerText}"
Bài của học viên: "${userAns}"

QUY TẮC CHẤM:
1. Nếu học viên trả lời sai ngôn ngữ yêu cầu hoặc chỉ chép lại câu gốc: score = 0.
2. Chấm theo NGHĨA + NGỮ PHÁP, không bắt buộc giống từng chữ với đáp án tham khảo.
3. Câu tự nhiên, đúng nghĩa và đúng ngữ pháp có thể đạt 100 dù cách diễn đạt khác.
4. Nếu sai tiểu từ/chia động từ nhưng vẫn hiểu được: trừ điểm tương ứng, không cho 100.
5. "corrected" phải là câu sửa hoàn chỉnh bằng ${targetLanguage}.

Trả về duy nhất JSON:
{
  "score": <số nguyên 0-100>,
  "verdict": "<correct|partial|wrong>",
  "note": "nhận xét ngắn bằng tiếng Việt",
  "corrected": "câu sửa chuẩn",
  "explanation": "giải thích lỗi/điểm đúng, từ vựng và ngữ pháp bằng tiếng Việt"
}`;

      const raw = await GEMINI.call(prompt, '', { temperature: 0.2, maxOutputTokens: 700, jsonMode: true });
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) gradeResult = JSON.parse(match[0]);
    } catch(e) {
      console.warn('AI grading failed, using fallback check:', e);
    }
  }

  if (!gradeResult) {
    const ok = normalizePracticeText(userAns) === normalizePracticeText(q.answerText);
    gradeResult = {
      score: ok ? 100 : 40,
      verdict: ok ? 'correct' : 'wrong',
      note: ok ? 'Chính xác!' : 'Chưa chính xác lắm, xem đáp án bên dưới nhé.',
      corrected: q.answerText,
      explanation: q.explanation || `Áp dụng từ vựng: ${q.batchVocabUsed.join(', ')} & Ngữ pháp: ${q.grammarUsed}`,
    };
  }

  let score = Math.max(0, Math.min(100, Math.round(Number(gradeResult.score) || 0)));

  // Hậu kiểm: kể cả model có hallucinate 100 điểm thì sai ngôn ngữ vẫn không được qua.
  if (!languageOk || copiedQuestion) score = 0;
  gradeResult.score = score;
  gradeResult.corrected = gradeResult.corrected || q.answerText;

  if (score >= 70) sp.correct++;
  addXP(score >= 70 ? 8 : 2);

  renderBatchPage();

  const fb = document.getElementById('batchSpFeedback');
  if (fb) {
    fb.style.display = 'block';
    const isOk = score >= 70;
    fb.className = `sp-feedback ${isOk ? 'sp-ok' : 'sp-wrong'}`;
    fb.innerHTML = `
      <div class="sp-fb-header">${score >= 90 ? '🎉 Xuất sắc!' : isOk ? '👍 Khá tốt!' : '❌ Chưa chính xác'} — Điểm: <span style="color:${isOk ? 'var(--green)' : '#ef4444'}">${score}/100</span></div>
      ${gradeResult.note ? `<div class="sp-fb-explanation">📝 ${escapePracticeHtml(gradeResult.note)}</div>` : ''}
      <div style="margin-top:10px;display:grid;gap:8px">
        <div class="sp-user-answer-box" style="padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;">
          <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:2px">✏️ Câu bạn đã nhập:</div>
          <div class="sp-user-answer" style="font-weight:700;color:var(--text-primary);font-family:'Noto Sans KR',sans-serif">${escapePracticeHtml(userAns)}</div>
        </div>
        <div style="padding:10px 14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:10px;">
          <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:2px">✅ Đáp án chuẩn:</div>
          <div style="font-weight:700;color:var(--green);font-family:'Noto Sans KR',sans-serif">${escapePracticeHtml(gradeResult.corrected || q.answerText)}</div>
        </div>
      </div>
      ${gradeResult.explanation ? `<div class="sp-fb-grammar-notes"><strong>📐 Giải thích cách dùng từ vựng Bộ & Ngữ pháp:</strong><br>${escapePracticeHtml(gradeResult.explanation)}</div>` : ''}
    `;
  }
}

function retryBatchSentenceQuestion() {
  const sp = batchSentencePractice;
  if (!sp) return;
  sp.answered = false;
  renderBatchPage();
  const inp = document.getElementById('batchSpAnswerInput');
  if (inp) {
    inp.disabled = false;
    if (sp.lastUserAnswer) inp.value = sp.lastUserAnswer;
    setTimeout(() => {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 100);
  }
}

function showBatchSentenceAnswer() {
  const sp = batchSentencePractice;
  if (!sp || sp.answered) return;
  sp.answered = true;
  sp.total++;
  renderBatchPage();

  const q = sp.currentQuestion;
  const fb = document.getElementById('batchSpFeedback');
  if (fb) {
    fb.style.display = 'block';
    fb.className = 'sp-feedback sp-reveal';
    fb.innerHTML = `
      <div class="sp-fb-header">👁 Đáp án chuẩn</div>
      <div class="sp-fb-answer">${q.answerText}</div>
      ${q.explanation ? `<div class="sp-fb-grammar-notes"><strong>📐 Giải thích:</strong><br>${q.explanation}</div>` : ''}
    `;
  }
}

function stopBatchSentencePractice() {
  batchSentencePractice = null;
  renderBatchPage();
}

// ============ FLASHCARD ============
function initFlash() {
  const empty = document.getElementById('flashEmpty');
  const scene = document.getElementById('flashScene');
  const words = getActiveWords();
  if (words.length===0) { empty.style.display='flex'; scene.style.display='none'; return; }
  empty.style.display='none'; scene.style.display='flex';
  state.flash.shuffled = [...words];
  if (state.flash.index>=state.flash.shuffled.length) state.flash.index=0;
  renderFlashCard();
}
function renderFlashCard() {
  const w = state.flash.shuffled[state.flash.index];
  if (!w) return;
  document.getElementById('flashcard').classList.remove('flipped');
  document.getElementById('flashRateBtns').style.display='none';
  document.getElementById('flashKorean').textContent=w.korean;
  document.getElementById('flashSub').textContent=w.pos||'명사';
  document.getElementById('flashRoman').textContent=w.roman||'';
  document.getElementById('flashMeaning').textContent=w.meaning||'';
  document.getElementById('flashExample').textContent=w.example||'';
  document.getElementById('flashTip').textContent='💡 '+(w.tip||'');
  const total=state.flash.shuffled.length;
  document.getElementById('flashCounter').textContent=`${state.flash.index+1} / ${total}`;
  document.getElementById('flashProgress').style.width=`${((state.flash.index+1)/total)*100}%`;
}
function flipCard() {
  const card = document.getElementById('flashcard');
  const isFlipped = card.classList.toggle('flipped');
  document.getElementById('flashRateBtns').style.display = isFlipped?'flex':'none';
  if (isFlipped) { const w=state.flash.shuffled[state.flash.index]; if(w) TTS.speak(w.korean); }
}
function prevFlash() { state.flash.index=(state.flash.index-1+state.flash.shuffled.length)%state.flash.shuffled.length; renderFlashCard(); }
function nextFlash() { state.flash.index=(state.flash.index+1)%state.flash.shuffled.length; renderFlashCard(); }
function shuffleFlash() { state.flash.shuffled=shuffle(state.flash.shuffled); state.flash.index=0; renderFlashCard(); showToast('🔀 Đã trộn thẻ','info',1500); }
function rateFlash(r) {
  const w=state.flash.shuffled[state.flash.index];
  if(w) { state.stats.ratings[w.korean]=r; addXP(r==='easy'?10:r==='medium'?5:2); }
  nextFlash(); saveState();
}

// ============ QUIZ ============
function startQuiz() {
  const empty=document.getElementById('quizEmpty');
  const cont=document.getElementById('quizContainer');
  const result=document.getElementById('quizResult');
  const words = getActiveWords();
  if (words.length<4) { empty.style.display='flex'; cont.style.display='none'; result.style.display='none'; return; }
  empty.style.display='none'; result.style.display='none'; cont.style.display='block';
  const sh=shuffle(words), count=Math.min(sh.length,10);
  state.quiz.questions=sh.slice(0,count).map(w=>({ word:w, type:Math.random()>0.5?'kr2vn':'vn2kr' }));
  state.quiz.current=0; state.quiz.score=0; state.quiz.total=count; state.quiz.answered=false;
  renderQuiz();
}
function renderQuiz() {
  const q=state.quiz.questions[state.quiz.current];
  if (!q) return;
  document.getElementById('quizFeedback').style.display='none';
  document.getElementById('quizNextBtn').style.display='none';
  document.getElementById('quizScore').textContent=`🏆 ${state.quiz.score} / ${state.quiz.current}`;
  document.getElementById('quizProgress').style.width=`${(state.quiz.current/state.quiz.total)*100}%`;
  state.quiz.answered=false;
  const pool = getActiveWords();
  const wrongList = getSmartWrongChoices(q.word, pool, 3);
  if (q.type==='kr2vn') {
    document.getElementById('quizTypeBadge').textContent='🇰🇷 → 🇻🇳 Chọn nghĩa tiếng Việt';
    document.getElementById('quizQuestion').textContent=q.word.korean;
    document.getElementById('quizHint').textContent=q.word.roman||'';
    const wrong = wrongList.map(w=>w.meaning);
    const choices = shuffle([q.word.meaning, ...wrong]);
    document.getElementById('quizOptions').innerHTML=choices.map(c=>`<button class="quiz-option" onclick="answerQuiz(this,'${escStr(c)}','${escStr(q.word.meaning)}')">${c}</button>`).join('');
  } else {
    document.getElementById('quizTypeBadge').textContent='🇻🇳 → 🇰🇷 Chọn từ tiếng Hàn';
    document.getElementById('quizQuestion').textContent=q.word.meaning;
    document.getElementById('quizHint').textContent=q.word.pos||'';
    const wrong = wrongList.map(w=>w.korean);
    const choices = shuffle([q.word.korean, ...wrong]);
    document.getElementById('quizOptions').innerHTML=choices.map(c=>`<button class="quiz-option" onclick="answerQuiz(this,'${escStr(c)}','${escStr(q.word.korean)}')" style="font-family:'Noto Sans KR',sans-serif">${c}</button>`).join('');
  }
}
function answerQuiz(btn, chosen, correct) {
  if (state.quiz.answered) return;
  state.quiz.answered=true;
  document.querySelectorAll('.quiz-option').forEach(o => {
    o.disabled=true;
    if (o.textContent.trim()===correct) o.classList.add('correct');
  });
  const ok = chosen===correct;
  if (ok) { btn.classList.add('correct'); state.quiz.score++; state.stats.totalCorrect++; addXP(10); showQuizFeedback(true,'🎉 Chính xác! +10 XP'); }
  else { btn.classList.add('wrong'); state.stats.ratings[state.quiz.questions[state.quiz.current]?.word?.korean]='hard'; showQuizFeedback(false,`❌ Sai rồi! Đáp án: ${correct}`); }
  state.stats.totalAnswered++;
  document.getElementById('quizNextBtn').style.display='block';
  saveState();
}
function showQuizFeedback(ok,msg) {
  const fb=document.getElementById('quizFeedback');
  fb.textContent=msg; fb.className=`quiz-feedback ${ok?'feedback-correct':'feedback-wrong'}`; fb.style.display='block';
}
function nextQuiz() { state.quiz.current++; if (state.quiz.current>=state.quiz.total) finishQuiz(); else renderQuiz(); }
function finishQuiz() {
  state.stats.quizzesCompleted++; saveState();
  document.getElementById('quizContainer').style.display='none';
  const result=document.getElementById('quizResult'); result.style.display='flex';
  const pct=Math.round((state.quiz.score/state.quiz.total)*100);
  const [emoji,msg]=pct>=90?['🏆','Xuất sắc!']:pct>=70?['😎','Tốt lắm!']:pct>=50?['😊','Khá tốt!']:['😅','Cần luyện thêm!'];
  document.getElementById('resultEmoji').textContent=emoji;
  document.getElementById('resultText').textContent=msg;
  document.getElementById('resultScore').textContent=`${state.quiz.score} / ${state.quiz.total} (${pct}%)`;
  addXP(pct);
}

// ============ FILL ============
function initFill() {
  const empty=document.getElementById('fillEmpty'), cont=document.getElementById('fillContainer');
  if (state.words.length===0) { empty.style.display='flex'; cont.style.display='none'; return; }
  empty.style.display='none'; cont.style.display='block';
  state.fill.index=0; state.fill.shuffled=shuffle([...state.words]); state.fill.score=0; state.fill.total=0;
  loadFillQuestion();
}
function loadFillQuestion() {
  if (state.fill.index>=state.fill.shuffled.length) { state.fill.index=0; state.fill.shuffled=shuffle([...state.words]); }
  const w=state.fill.shuffled[state.fill.index]; state.fill.current=w;
  const sentence=w.example||`${w.korean}이에요.`;
  const html=sentence.replace(w.korean,`<span class="fill-blank-ui">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`);
  document.getElementById('fillSentence').innerHTML=html;
  document.getElementById('fillViet').textContent=w.exampleViet||'';
  document.getElementById('fillInput').value='';
  document.getElementById('fillFeedback').style.display='none';
  document.getElementById('fillProgress').style.width=`${((state.fill.index+1)/state.fill.shuffled.length)*100}%`;
  document.getElementById('fillInput').focus();
}
function checkFill() {
  const w=state.fill.current; if (!w) return;
  const val=document.getElementById('fillInput').value.trim();
  const fb=document.getElementById('fillFeedback'); fb.style.display='block';
  state.fill.total++; state.stats.totalAnswered++;
  if (val===w.korean) {
    fb.className='fill-feedback feedback-correct'; fb.textContent=`✅ Chính xác! "${w.korean}" - ${w.meaning}`;
    state.fill.score++; state.stats.totalCorrect++; addXP(8); TTS.speak(w.korean);
    state.fill.index++; setTimeout(loadFillQuestion,1400);
  } else {
    fb.className='fill-feedback feedback-wrong'; fb.textContent=`❌ Chưa đúng! Gợi ý: ${w.roman}`;
  }
  document.getElementById('fillScore').textContent=`✅ ${state.fill.score} / ${state.fill.total}`;
  saveState();
}
function showFillHint() { const w=state.fill.current; if(w) showToast(`💡 Gợi ý: ${w.korean[0]}... (${w.roman})`,'info',3000); }
function nextFill() { state.fill.index++; loadFillQuestion(); }

// ============ LISTENING ============
function initListen() {
  const empty=document.getElementById('listenEmpty'), cont=document.getElementById('listenContainer');
  if (state.words.length<4) { empty.style.display='flex'; cont.style.display='none'; return; }
  empty.style.display='none'; cont.style.display='block';
  state.listen.score=0; state.listen.total=0; loadListenQuestion();
}
function loadListenQuestion() {
  const w=state.words[Math.floor(Math.random()*state.words.length)]; state.listen.current=w;
  document.getElementById('listenFeedback').style.display='none';
  document.getElementById('listenScore').textContent=`🎯 ${state.listen.score} / ${state.listen.total}`;
  const wrong=getRandom(state.words,3,[w]);
  const choices=shuffle([w,...wrong]);
  document.getElementById('listenOptions').innerHTML=choices.map(c=>
    `<button class="listen-option" data-korean="${escStr(c.korean)}" onclick="answerListen(this,'${escStr(c.korean)}','${escStr(w.korean)}')">
      <div style="font-family:'Noto Sans KR',sans-serif;font-size:1.2rem;font-weight:800">${c.korean}</div>
      <div style="font-size:0.78rem;color:var(--text-secondary)">${c.meaning}</div>
    </button>`
  ).join('');
}
function playListenAudio() {
  const w=state.listen.current; if (!w) return;
  TTS.speak(w.korean);
  const bars=document.querySelectorAll('.wave-bar');
  bars.forEach(b=>b.classList.add('playing'));
  setTimeout(()=>bars.forEach(b=>b.classList.remove('playing')),2000);
}
function answerListen(btn, chosen, correct) {
  document.querySelectorAll('.listen-option').forEach(o=>o.disabled=true);
  state.listen.total++; state.stats.totalAnswered++;
  const fb=document.getElementById('listenFeedback'); fb.style.display='block';
  if (chosen===correct) {
    btn.classList.add('correct'); state.listen.score++; state.stats.totalCorrect++; addXP(8);
    fb.className='listen-feedback feedback-correct'; fb.textContent='✅ Đúng rồi! +8 XP';
    setTimeout(loadListenQuestion,1500);
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.listen-option').forEach(o=>{ if(o.dataset.korean===correct) o.classList.add('correct'); });
    fb.className='listen-feedback feedback-wrong'; fb.textContent=`❌ Sai! Đáp án: ${correct}`;
    setTimeout(loadListenQuestion,2500);
  }
  document.getElementById('listenScore').textContent=`🎯 ${state.listen.score} / ${state.listen.total}`;
  document.getElementById('listenProgress').style.width=`${(state.listen.score/Math.max(state.listen.total,1))*100}%`;
  saveState();
}

// ============ LISTEN DIALOGUE (Nghe hội thoại điền thông tin) ============
function initListenDial() {
  const cont = document.getElementById('listenDialContainer');
  const empty = document.getElementById('listenDialEmpty');
  const words = getActiveWords();
  if (words.length < 3) {
    if(empty) empty.style.display='flex';
    if(cont) cont.style.display='none';
    return;
  }
  if(empty) empty.style.display='none';
  if(cont) cont.style.display='block';
  // Reset state
  state.listenDial = { dialogue: null, questions: [], answers: {}, submitted: false, playCount: 0 };
  renderListenDialSetup();
}

let ldDifficulty = 'easy';
function setLdDifficulty(level, btn) {
  ldDifficulty = level;
  document.querySelectorAll('#listenDialContainer .gp-diff-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const infoEl = document.getElementById('ldDiffGuide');
  if (infoEl) {
    if (level === 'easy') {
      infoEl.innerHTML = '🟢 <strong>Dễ</strong>: Chỉ dùng từ vựng bạn đã & đang học. Tuyệt đối KHÔNG có từ mới lạ!';
    } else if (level === 'medium') {
      infoEl.innerHTML = '🟡 <strong>Thường</strong>: Dùng từ đã học + 2-3 từ mới phù hợp chủ đề (có dịch nghĩa từ mới).';
    } else {
      infoEl.innerHTML = '🔴 <strong>Khó</strong>: Nhiều từ mới phong phú, câu thoại tự nhiên sát đề thi nghe TOPIK thật!';
    }
  }
}

function renderListenDialSetup() {
  const cont = document.getElementById('listenDialContainer');
  if (!cont) return;
  cont.innerHTML = `
    <div class="ldial-setup">
      <div class="ldial-header">
        <div class="ldial-icon">🎧</div>
        <h3>Nghe hội thoại điền thông tin</h3>
        <p>AI sẽ tạo một đoạn hội thoại tiếng Hàn. Bạn nghe rồi điền thông tin còn thiếu.</p>
      </div>
      <div class="ldial-topics">
        <div class="ldial-topic-label">🎯 Chọn chủ đề hội thoại:</div>
        <div class="ldial-topic-chips">
          <button class="ldial-topic-chip active" id="ldtopic-restaurant" onclick="selectDialTopic(this,'Nhà hàng - Gọi món')">&#x1F374; Nhà hàng</button>
          <button class="ldial-topic-chip" id="ldtopic-shopping" onclick="selectDialTopic(this,'Mua sắm - Hỏi giá')">&#x1F6CD; Mua sắm</button>
          <button class="ldial-topic-chip" id="ldtopic-transport" onclick="selectDialTopic(this,'Hỏi đường - Phương tiện')">&#x1F686; Di chuyển</button>
          <button class="ldial-topic-chip" id="ldtopic-school" onclick="selectDialTopic(this,'Trường học - Bạn bè')">&#x1F393; Trường học</button>
          <button class="ldial-topic-chip" id="ldtopic-work" onclick="selectDialTopic(this,'Công việc - Văn phòng')">&#x1F4BC; Công việc</button>
          <button class="ldial-topic-chip" id="ldtopic-health" onclick="selectDialTopic(this,'Sức khỏe - Bệnh viện')">&#x1FA7A; Sức khỏe</button>
        </div>
      </div>
      <div class="ldial-level-row" style="margin-top:10px">
        <span class="ldial-topic-label">📊 Mức độ:</span>
        <div class="gp-diff-selector">
          <button class="gp-diff-btn ${ldDifficulty==='easy'?'active':''}" id="lddiff-easy" onclick="setLdDifficulty('easy',this)">🟢 Dễ</button>
          <button class="gp-diff-btn ${ldDifficulty==='medium'?'active':''}" id="lddiff-medium" onclick="setLdDifficulty('medium',this)">🟡 Thường</button>
          <button class="gp-diff-btn ${ldDifficulty==='hard'?'active':''}" id="lddiff-hard" onclick="setLdDifficulty('hard',this)">🔴 Khó</button>
        </div>
      </div>
      <div id="ldDiffGuide" class="ldial-diff-info">
        ${ldDifficulty==='easy'?'🟢 <strong>Dễ</strong>: Chỉ dùng từ vựng bạn đã & đang học. Tuyệt đối KHÔNG có từ mới lạ!':ldDifficulty==='medium'?'🟡 <strong>Thường</strong>: Dùng từ đã học + 2-3 từ mới phù hợp chủ đề (có dịch nghĩa từ mới).':'🔴 <strong>Khó</strong>: Nhiều từ mới phong phú, câu thoại tự nhiên sát đề thi nghe TOPIK thật!'}
      </div>
      <button class="btn btn-ai btn-lg" style="margin-top:14px" onclick="generateListenDial()" ${!GEMINI.getKey() ? 'disabled title="AI chưa được Admin cấu hình!"' : ''}>
        🤖 Tạo hội thoại AI
      </button>
      ${!GEMINI.getKey() ? '<p style="color:var(--orange);font-size:.82rem;margin-top:8px">⚠️ AI chưa được Admin cấu hình. <span>Liên hệ Admin.</span></p>' : ''}
    </div>
  `;
  if (!window._ldialTopic) window._ldialTopic = 'Nhà hàng - Gọi món';
}

function selectDialTopic(btn, topic) {
  document.querySelectorAll('.ldial-topic-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  window._ldialTopic = topic;
}

async function generateListenDial() {
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }
  const cont = document.getElementById('listenDialContainer');
  const diff = ldDifficulty || 'easy';
  const topic = window._ldialTopic || 'Nhà hàng';
  const words = getActiveWords();
  const vocabHint = words.slice(0,25).map(w=>w.korean).join(', ');

  const diffPrompts = {
    easy: `QUAN TRỌNG - MỨC DỄ: CHỈ ĐƯỢC DÙNG CÁC TỪ VỰNG TIẾNG HÀN ĐÃ HỌC SAU ĐÂY: ${vocabHint || 'tiếng Hàn cơ bản'}. TUYỆT ĐỐI KHÔNG DÙNG BẤT KỲ TỪ MỚI NÀO KHÁC NGHĨA NGOÀI DANH SÁCH NÀY. Đặt câu ngắn gọn, quen thuộc, dễ nghe. Mảng "newWords" trả về mảng rỗng [].`,
    medium: `MỨC THƯỜNG: Dùng từ vựng đã học làm nòng cốt (${vocabHint || 'tiếng Hàn cơ bản'}), nhưng có thể bổ sung 2-3 từ mới phù hợp chủ đề ${topic}. Đưa từ mới kèm dịch nghĩa vào mảng "newWords".`,
    hard: `MỨC KHÓ (sát đề TOPIK): Tự do dùng từ phong phú phù hợp chủ đề ${topic}, câu thoại tự nhiên và tốc độ/cấu trúc phức tạp hơn. Đưa từ mới kèm dịch nghĩa vào mảng "newWords".`
  };

  cont.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang tạo hội thoại (${topic})...</span></div>`;

  const prompt = `Bạn là giáo viên tiếng Hàn chuẩn bị đề nghe TOPIK cho người Việt.
Tạo 1 đoạn hội thoại tiếng Hàn chủ đề: "${topic}".

${diffPrompts[diff]}

Yêu cầu:
- Hội thoại 6-10 dòng giữa người A và B
- Tạo 4 câu hỏi điền thông tin (ai, cái gì, ở đâu, bao nhiêu, khi nào)

Trả lời EXACT JSON:
{
  "topic": "${topic}",
  "context": "ngữ cảnh ngắn bằng tiếng Việt (1 câu)",
  "dialogue": [
    {"speaker": "A", "text": "câu tiếng Hàn"},
    {"speaker": "B", "text": "câu tiếng Hàn"}
  ],
  "newWords": [
    {"korean": "한국어", "meaning": "nghĩa tiếng Việt"}
  ],
  "questions": [
    {"q": "câu hỏi bằng tiếng Việt", "answer": "đáp án ngắn", "hint": "gợi ý"}
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.65, maxOutputTokens: 2000 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON error');
    const data = JSON.parse(match[0]);
    state.listenDial.dialogue = data;
    state.listenDial.questions = data.questions || [];
    state.listenDial.answers = {};
    state.listenDial.submitted = false;
    state.listenDial.playCount = 0;
    renderListenDialScene();
    showToast('✅ Hội thoại đã tạo! Nhấn ▶ để nghe.', 'success');
  } catch(e) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo hội thoại: ${escapePracticeHtml(e.message)}.<br><button class="btn btn-ai btn-sm" onclick="generateListenDial()">Thử lại</button></p></div>`;
    showToast('⚠️ Lỗi. Thử lại!', 'error');
  }
}

function renderListenDialScene() {
  const cont = document.getElementById('listenDialContainer');
  const d = state.listenDial.dialogue;
  if (!cont || !d) return;

  // Build new-word glossary from data.newWords array (Easy mode hides new words)
  const newWords = (ldDifficulty === 'easy') ? [] : (d.newWords || []);

  const dialogueHtml = (d.dialogue || []).map((line, i) => `
    <div class="ldial-line ${line.speaker==='A'?'ldial-a':'ldial-b'}">
      <div class="ldial-speaker">${line.speaker}</div>
      <div class="ldial-bubble">
        <span class="ldial-text" style="font-family:'Noto Sans KR',sans-serif">${line.text}</span>
        <button class="mini-audio-btn" onclick="TTS.speak(${JSON.stringify(line.text)})">&#x1F50A;</button>
      </div>
    </div>
  `).join('');

  const questionsHtml = state.listenDial.submitted
    ? renderListenDialResult()
    : state.listenDial.questions.map((q, i) => `
        <div class="ldial-q-item" id="ldqitem${i}">
          <div class="ldial-q-num">❓ Câu ${i+1}</div>
          <div class="ldial-q-text">${q.q}</div>
          ${(ldDifficulty !== 'easy' && q.hint) ? `<div class="ldial-q-hint">💡 Gợi ý: ${q.hint}</div>` : ''}
          <input type="text" class="ldial-q-input" id="ldqinput${i}" placeholder="Điền câu trả lời..." onkeydown="if(event.key==='Enter')checkListenDialAnswers()" />
        </div>
      `).join('');

  const newWordNote = newWords.length > 0
    ? `<div class="ldial-new-words-note">
        <div>⚠️ <strong>${newWords.length} từ mới xuất hiện trong hội thoại:</strong></div>
        <div class="ldial-new-word-list">
          ${newWords.map(w=>`<div class="ldial-new-word-item">
            <span class="ldial-new-word" style="font-family:'Noto Sans KR',sans-serif">${w.korean}</span>
            <span class="ldial-new-word-arrow">→</span>
            <span class="ldial-new-word-meaning">${w.meaning}</span>
            <button class="mini-audio-btn" onclick="TTS.speak('${escStr(w.korean)}')">&#x1F50A;</button>
          </div>`).join('')}
        </div>
      </div>`
    : '';

  cont.innerHTML = `
    <div class="ldial-scene">
      <div class="ldial-context-bar">
        <span class="ldial-ctx-icon">🎧</span>
        <span class="ldial-ctx-text">${d.context}</span>
        <span class="ldial-ctx-topic">${d.topic}</span>
      </div>
      ${newWordNote}
      <div class="ldial-play-controls">
        <button class="ldial-play-btn" id="ldialPlayBtn" onclick="playFullDialogue()">▶ Nghe toàn bộ hội thoại</button>
        <span class="ldial-play-count" id="ldialPlayCount">(Đã nghe: ${state.listenDial.playCount} lần)</span>
      </div>
      <div class="ldial-dialogue-box">${dialogueHtml}</div>
      <div class="ldial-questions">
        <div class="ldial-q-header">📝 Điền thông tin:</div>
        ${questionsHtml}
      </div>
      ${!state.listenDial.submitted ? `
        <div class="ldial-actions">
          <button class="btn btn-primary" onclick="checkListenDialAnswers()">✅ Kiểm tra</button>
          <button class="btn btn-ghost btn-sm" onclick="generateListenDial()">🔄 Hội thoại mới</button>
        </div>
      ` : `
        <div class="ldial-actions">
          <button class="btn btn-ai" onclick="generateListenDial()">🤖 Hội thoại mới</button>
          <button class="btn btn-ghost" onclick="setMode('listenDial')">🔄 Làm lại</button>
        </div>
      `}
    </div>
  `;
}

async function playFullDialogue() {
  const d = state.listenDial.dialogue;
  if (!d?.dialogue) return;
  const btn = document.getElementById('ldialPlayBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏸️ Đang phát...'; }
  for (const line of d.dialogue) {
    const clean = line.text.replace(/\*/g, '');
    await new Promise(resolve => TTS.speak(clean, 'ko-KR', resolve));
    await delay(300);
  }
  state.listenDial.playCount++;
  const countEl = document.getElementById('ldialPlayCount');
  if (countEl) countEl.textContent = `(Đã nghe: ${state.listenDial.playCount} lần)`;
  if (btn) { btn.disabled = false; btn.textContent = '▶ Nghe lại toàn bộ'; }
}

function checkListenDialAnswers() {
  const qs = state.listenDial.questions;
  if (!qs.length) return;
  qs.forEach((q, i) => {
    const inp = document.getElementById(`ldqinput${i}`);
    state.listenDial.answers[i] = inp ? inp.value.trim() : '';
  });
  state.listenDial.submitted = true;
  const score = qs.filter((q, i) => {
    const ans = (state.listenDial.answers[i] || '').toLowerCase().trim();
    const correct = q.answer.toLowerCase().trim();
    return ans === correct || correct.includes(ans) || ans.includes(correct);
  }).length;
  addXP(score * 12);
  saveState();
  renderListenDialScene();
  const pct = Math.round(score/qs.length*100);
  showToast(pct>=75 ? `🏆 Xuất sắc! ${score}/${qs.length} đúng! +${score*12} XP` : `💪 ${score}/${qs.length} đúng. Cố lên!`, pct>=75?'success':'info', 3000);
}

function renderListenDialResult() {
  const qs = state.listenDial.questions;
  return qs.map((q, i) => {
    const ans = state.listenDial.answers[i] || '';
    const correct = q.answer.toLowerCase().trim();
    const userAns = ans.toLowerCase().trim();
    const isOk = userAns === correct || correct.includes(userAns) || userAns.includes(correct);
    return `
      <div class="ldial-q-item ${isOk ? 'ldial-q-ok' : 'ldial-q-err'}">
        <div class="ldial-q-num">${isOk ? '✅' : '❌'} Câu ${i+1}</div>
        <div class="ldial-q-text">${q.q}</div>
        <div class="ldial-q-answer">💬 Bạn trả lời: <strong>${ans || '(bỏ trống)'}</strong></div>
        ${!isOk ? `<div class="ldial-q-correct">✅ Đáp án đúng: <strong>${q.answer}</strong></div>` : ''}
      </div>
    `;
  }).join('');
}

// ============ WRITING ============
function initWrite() {
  const empty=document.getElementById('writeEmpty'), cont=document.getElementById('writeContainer');
  if (state.words.length===0) { empty.style.display='flex'; cont.style.display='none'; return; }
  empty.style.display='none'; cont.style.display='block';
  state.write.shuffled=shuffle([...state.words]); state.write.index=0; state.write.score=0; state.write.total=0;
  loadWriteQuestion();
}
function loadWriteQuestion() {
  if (state.write.index>=state.write.shuffled.length) { state.write.index=0; state.write.shuffled=shuffle([...state.words]); }
  const w=state.write.shuffled[state.write.index]; state.write.current=w;
  document.getElementById('writeMeaning').textContent=w.meaning;
  document.getElementById('writePos').textContent=`${w.pos||''} · ${w.roman||''}`;
  document.getElementById('writeInput').value='';
  document.getElementById('writeFeedback').style.display='none';
  document.getElementById('writeProgress').style.width=`${((state.write.index+1)/state.write.shuffled.length)*100}%`;
  document.getElementById('writeScore').textContent=`📝 ${state.write.score} / ${state.write.total}`;
  document.getElementById('writeInput').focus();
}
function checkWrite() {
  const w=state.write.current; if (!w) return;
  const val=document.getElementById('writeInput').value.trim();
  const fb=document.getElementById('writeFeedback'); fb.style.display='block';
  state.write.total++; state.stats.totalAnswered++;
  if (val===w.korean) {
    fb.className='write-feedback feedback-correct'; fb.innerHTML=`✅ Chính xác! <strong>${w.korean}</strong> = ${w.meaning} (+10 XP)`;
    state.write.score++; state.stats.totalCorrect++; addXP(10); TTS.speak(w.korean);
    state.write.index++; setTimeout(loadWriteQuestion,1600);
  } else {
    fb.className='write-feedback feedback-wrong'; fb.innerHTML=`❌ Chưa đúng! Đáp án: <strong>${w.korean}</strong> | Phiên âm: ${w.roman}`;
  }
  document.getElementById('writeScore').textContent=`📝 ${state.write.score} / ${state.write.total}`;
  saveState();
}
function showWriteHint() { const w=state.write.current; if(w) { document.getElementById('writeInput').value=w.korean[0]; showToast(`💡 Chữ đầu: ${w.korean[0]}`,'info'); } }
function nextWrite() { state.write.index++; loadWriteQuestion(); }

// ============ SPEAKING ============
function initSpeak() {
  const empty=document.getElementById('speakEmpty'), cont=document.getElementById('speakContainer');
  if (state.words.length===0) { empty.style.display='flex'; cont.style.display='none'; return; }
  empty.style.display='none'; cont.style.display='block'; state.speak.index=0; renderSpeakCard();
}
function renderSpeakCard() {
  const w=state.words[state.speak.index%state.words.length];
  document.getElementById('speakKorean').textContent=w.korean;
  document.getElementById('speakRoman').textContent=w.roman||'';
  document.getElementById('speakMeaning').textContent=w.meaning;
  document.getElementById('speakResult').style.display='none';
}
function toggleRecord() { state.isRecording?stopRecording():startRecording(); }
function startRecording() {
  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
    showToast('⚠️ Cần Chrome để dùng tính năng nói!','error',3000); return;
  }
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  state.recognition=new SR(); state.recognition.lang='ko-KR'; state.recognition.interimResults=false;
  state.recognition.onresult=e=>{ const said=e.results[0][0].transcript.trim(); showSpeakResult(said); };
  state.recognition.onerror=()=>{ showToast('❌ Không nhận được giọng nói!','error'); stopRecording(); };
  state.recognition.onend=()=>stopRecording();
  state.recognition.start(); state.isRecording=true;
  document.getElementById('recordBtn').textContent='⏹ Dừng lại';
  document.getElementById('recordBtn').classList.add('record-active');
}
function stopRecording() {
  if (state.recognition) { try{state.recognition.stop();}catch(e){} }
  state.isRecording=false;
  document.getElementById('recordBtn').textContent='🎤 Bắt đầu nói';
  document.getElementById('recordBtn').classList.remove('record-active');
}
function showSpeakResult(said) {
  const w=state.words[state.speak.index%state.words.length];
  document.getElementById('speakResultText').textContent=said;
  const norm=s=>s.toLowerCase().replace(/\s/g,'');
  const correct=norm(w.korean), attempt=norm(said);
  let score=attempt===correct?100:attempt.includes(correct)||correct.includes(attempt)?70:
    Math.round(([...correct].filter((c,i)=>attempt[i]===c).length/correct.length)*100);
  const [scoreText,color]=score>=85?['🎉 Xuất sắc! '+score+'%','var(--green)']:score>=60?['👍 Khá tốt! '+score+'%','var(--orange)']:['🔁 Thử lại! '+score+'%','var(--red)'];
  if (score>=85) addXP(15); else if (score>=60) addXP(8);
  document.getElementById('speakScoreDisplay').textContent=scoreText;
  document.getElementById('speakScoreDisplay').style.color=color;
  document.getElementById('speakResult').style.display='block';
}
function nextSpeak() { state.speak.index++; if(state.isRecording) stopRecording(); renderSpeakCard(); }

// ============ AI CHAT ============
const AI_SUGGESTIONS = [
  '안녕하세요! 제 이름은 뭐예요?', '오늘 날씨가 어때요?',
  '한국어 공부가 어려워요?', '제가 배운 단어를 연습해요!',
  'K-드라마 좋아해요?', '한국 음식 뭐가 맛있어요?',
  'Giải thích 이에요/예요 cho tôi', 'Tôi muốn luyện hội thoại',
];

function initAIChat() {
  const hasKey = !!GEMINI.getKey();
  const notice = document.getElementById('noApiNotice');
  notice.classList.toggle('show', !hasKey);

  // Update tutor info
  const p = PERSONALITIES[state.personality];
  document.getElementById('tutorAvatar').textContent = p.avatar;
  document.getElementById('tutorName').textContent = `${p.name} - AI Gia sư`;
  document.getElementById('tutorSubtitle').textContent = p.subtitle;

  // Suggestions
  const chips = document.getElementById('suggestionChips');
  const vocabSuggestions = state.words.slice(0,3).map(w => `Dùng từ "${w.korean}" trong câu`);
  const all = [...vocabSuggestions, ...AI_SUGGESTIONS].slice(0,6);
  chips.innerHTML = all.map(s =>
    `<button class="suggestion-chip" onclick="sendSuggestion('${escStr(s)}')">${s}</button>`
  ).join('');

  // Keyboard
  const input = document.getElementById('chatInput');
  input.onkeydown = e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } };
}

function sendSuggestion(text) {
  document.getElementById('chatInput').value = text;
  sendChatMessage();
}

function setChatMode(mode) {
  state.chatMode = mode;
  document.querySelectorAll('.chat-mode-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('mode'+mode.charAt(0).toUpperCase()+mode.slice(1)).classList.add('active');
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!','error'); return; }
  input.value = '';

  // Add user message
  appendChatMessage('user', text, '👤');
  const typingId = appendTypingIndicator();

  // Build system prompt
  const p = PERSONALITIES[state.personality];
  const vocabContext = state.words.length>0
    ? `\n\nTừ vựng người dùng đang học: ${state.words.slice(0,20).map(w=>`${w.korean}(${w.meaning})`).join(', ')}`
    : '';
  const modeInstr = state.chatMode==='kr' ? '\nHãy ưu tiên trả lời bằng tiếng Hàn, kèm dịch ngắn.'
    : state.chatMode==='vn' ? '\nHãy trả lời bằng tiếng Việt, dùng tiếng Hàn khi cần thiết.'
    : '\nHãy mix tiếng Hàn và tiếng Việt tự nhiên.';
  const systemPrompt = p.systemPrompt + vocabContext + modeInstr;

  // Add to history
  state.chatHistory.push({ role:'user', parts:[{text}] });
  if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

  try {
    const reply = await GEMINI.callChat(state.chatHistory, systemPrompt);
    removeTypingIndicator(typingId);
    state.chatHistory.push({ role:'model', parts:[{text:reply}] });
    const msgEl = appendChatMessage('ai', reply, p.avatar);
    // Add TTS button
    const audioBtn = msgEl.querySelector('.message-audio-btn');
    if (audioBtn) audioBtn.onclick = () => TTS.speak(reply.replace(/[가-힣]+/g, m => m));
    state.stats.aiMessages++;
    addXP(2);
    saveState();
  } catch(e) {
    removeTypingIndicator(typingId);
    appendChatMessage('ai', `❌ Lỗi: ${e.message}. AI hệ thống tạm chưa sẵn sàng.`, p.avatar);
  }
}

function appendChatMessage(type, text, avatar) {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-message ${type}-message fade-in`;

  // Escape trước khi highlight để user/AI không chèn HTML/script vào iframe cùng origin.
  const safeText = escapePracticeHtml(text);
  const formatted = safeText.replace(/([가-힣]+)/g, `<span class="korean-highlight">$1</span>`);
  const safeAvatar = escapePracticeHtml(avatar);

  div.innerHTML = `
    <div class="chat-avatar">${safeAvatar}</div>
    <div class="message-bubble">
      <div class="message-text">${formatted}</div>
      <div class="message-time" style="display:flex;gap:6px;align-items:center">
        ${type==='ai' ? `<button class="message-audio-btn" title="Nghe">🔊</button>` : ''}
        ${new Date().toLocaleTimeString('vi',{hour:'2-digit',minute:'2-digit'})}
      </div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function appendTypingIndicator() {
  const msgs = document.getElementById('chatMessages');
  const id = 'typing-' + Date.now();
  const p = PERSONALITIES[state.personality];
  const div = document.createElement('div');
  div.id = id;
  div.className = 'typing-indicator fade-in';
  div.innerHTML = `
    <div class="chat-avatar">${p.avatar}</div>
    <div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}
function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}
function clearChat() {
  state.chatHistory = [];
  const msgs = document.getElementById('chatMessages');
  const p = PERSONALITIES[state.personality];
  msgs.innerHTML = `
    <div class="chat-message ai-message">
      <div class="chat-avatar">${p.avatar}</div>
      <div class="message-bubble">
        <div class="message-text">안녕하세요! 다시 시작해요! 😊<br><em>Chào mừng trở lại! Hãy bắt đầu lại nhé!</em></div>
        <div class="message-time">${p.name}</div>
      </div>
    </div>
  `;
}

// Chat voice recording
function toggleChatRecord() {
  state.isChatRecording ? stopChatRecord() : startChatRecord();
}
function startChatRecord() {
  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
    showToast('⚠️ Cần Chrome!','error'); return;
  }
  const lang = state.chatMode==='kr' ? 'ko-KR' : 'vi-VN';
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  state.chatRecognition = new SR();
  state.chatRecognition.lang = lang;
  state.chatRecognition.onresult = e => {
    document.getElementById('chatInput').value = e.results[0][0].transcript;
    stopChatRecord();
    sendChatMessage();
  };
  state.chatRecognition.onerror = () => stopChatRecord();
  state.chatRecognition.onend = () => stopChatRecord();
  state.chatRecognition.start();
  state.isChatRecording = true;
  document.getElementById('chatVoiceBtn').classList.add('recording');
}
function stopChatRecord() {
  if (state.chatRecognition) { try{state.chatRecognition.stop();}catch(e){} }
  state.isChatRecording = false;
  document.getElementById('chatVoiceBtn').classList.remove('recording');
}

// ============ AI TUTOR ============
function initAITutor() {
  const hasKey = !!GEMINI.getKey();
  document.getElementById('noApiNoticeTutor').classList.toggle('show', !hasKey);
  document.getElementById('tutorInput').onkeydown = e => {
    if (e.key==='Enter') sendTutorMessage();
  };
}

async function askTutor(question) {
  document.getElementById('tutorInput').value = question;
  sendTutorMessage();
}

async function askTutorAboutWords() {
  if (state.words.length===0) { showToast('Thêm từ vựng trước!','error'); return; }
  const wordList = state.words.slice(0,10).map(w=>`${w.korean}(${w.meaning})`).join(', ');
  askTutor(`Giải thích chi tiết và tạo bài tập cho các từ sau: ${wordList}`);
}

async function sendTutorMessage() {
  const input = document.getElementById('tutorInput');
  const text = input.value.trim();
  if (!text) return;
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!','error'); return; }
  input.value = '';

  appendTutorMsg('user', text);
  const typingId = appendTutorTyping();

  const vocabCtx = state.words.length>0
    ? `Từ vựng người dùng đang học: ${state.words.map(w=>`${w.korean}(${w.meaning})`).join(', ')}\n\n`
    : '';
  const systemPrompt = `Bạn là gia sư tiếng Hàn chuyên nghiệp cho người Việt. ${vocabCtx}
Hãy giải thích rõ ràng, có ví dụ cụ thể, dùng cả tiếng Hàn lẫn tiếng Việt.
Dùng formatting (bullet points, số thứ tự) cho dễ đọc.`;

  state.tutorHistory.push({ role:'user', parts:[{text}] });
  if (state.tutorHistory.length>10) state.tutorHistory = state.tutorHistory.slice(-10);

  try {
    const reply = await GEMINI.callChat(state.tutorHistory, systemPrompt);
    removeTypingFromTutor(typingId);
    state.tutorHistory.push({ role:'model', parts:[{text:reply}] });
    appendTutorMsg('ai', reply);
    state.stats.aiMessages++;
    addXP(2);
    saveState();
  } catch(e) {
    removeTypingFromTutor(typingId);
    appendTutorMsg('ai', `❌ Lỗi: ${e.message}`);
  }
}

function appendTutorMsg(type, text) {
  const chat = document.getElementById('tutorChat');
  const div = document.createElement('div');
  const p = PERSONALITIES[state.personality];
  div.className = `chat-message ${type}-message fade-in`;
  const formatted = escapePracticeHtml(text).replace(/([가-힣]+)/g, `<span class="korean-highlight">$1</span>`).replace(/\n/g,'<br>');
  div.innerHTML = `
    <div class="chat-avatar">${escapePracticeHtml(type==='ai'?p.avatar:'👤')}</div>
    <div class="message-bubble">
      <div class="message-text">${formatted}</div>
      <div class="message-time">${type==='ai'?p.name:'Bạn'}</div>
    </div>
  `;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}
function appendTutorTyping() {
  const chat = document.getElementById('tutorChat');
  const id = 'ttyp-'+Date.now();
  const p = PERSONALITIES[state.personality];
  const div = document.createElement('div');
  div.id=id; div.className='typing-indicator fade-in';
  div.innerHTML = `<div class="chat-avatar">${p.avatar}</div><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  chat.appendChild(div); chat.scrollTop=chat.scrollHeight;
  return id;
}
function removeTypingFromTutor(id) { document.getElementById(id)?.remove(); }

// ============ REVIEW ============
function startReview() {
  const empty=document.getElementById('reviewEmpty'), cont=document.getElementById('reviewContainer');
  if (state.words.length===0) { empty.style.display='flex'; cont.style.display='none'; return; }
  empty.style.display='none'; cont.style.display='block';
  // Smart SRS: use weighted shuffle so hard/new words appear more
  const smartQueue = smartSRSShuffle(state.words).slice(0, 20);
  // Fallback: ensure at least 1 of each word if list is short
  const uniqueMap = new Map();
  smartQueue.forEach(w => { if (!uniqueMap.has(w.korean)) uniqueMap.set(w.korean, w); });
  state.words.filter(w => !uniqueMap.has(w.korean)).forEach(w => uniqueMap.set(w.korean, w));
  state.review.queue = smartQueue.length > 0 ? smartQueue : [...state.words];
  state.review.index=0; state.review.hard=0; state.review.medium=0; state.review.easy=0;
  renderReviewCard();
}
function renderReviewCard() {
  if (state.review.index>=state.review.queue.length) {
    document.getElementById('reviewEmpty').style.display='flex';
    document.getElementById('reviewContainer').style.display='none'; return;
  }
  const w=state.review.queue[state.review.index];
  document.getElementById('reviewKorean').textContent=w.korean;
  document.getElementById('reviewRoman').textContent=w.roman||'';
  document.getElementById('reviewMeaning').textContent=w.meaning;
  document.getElementById('reviewExample').textContent=w.example||'';
  document.getElementById('reviewBack').style.display='none';
  document.getElementById('reviewFront').style.display='flex';
  updateReviewMini();
}
function revealReview() {
  document.getElementById('reviewFront').style.display='none';
  document.getElementById('reviewBack').style.display='flex';
  const w=state.review.queue[state.review.index]; if(w) TTS.speak(w.korean);
}
function rateReview(r) {
  const w=state.review.queue[state.review.index];
  if(w) state.stats.ratings[w.korean]=r;
  if(r==='hard') state.review.hard++; else if(r==='medium') state.review.medium++; else { state.review.easy++; addXP(5); }
  state.review.index++; updateReviewMini(); renderReviewCard(); saveState();
}
function updateReviewMini() {
  document.getElementById('rsHard').textContent=`😰 ${state.review.hard}`;
  document.getElementById('rsMedium').textContent=`🤔 ${state.review.medium}`;
  document.getElementById('rsEasy').textContent=`😎 ${state.review.easy}`;
}

// ============ DIALOGUE ============
const DIALOGUE_TEMPLATES = [
  (w1,w2) => ({ scene:'🏫 Ở trường học', lines:[
    {s:'A',k:`안녕하세요! 저는 ${w1.pos==='명사'?w1.korean+'이에요':'학생이에요'}.`,v:`Xin chào! Tôi là... (${w1.meaning})`},
    {s:'B',k:`아, 그래요? 저도 반가워요! ${w2.korean}이 좋아요?`,v:`Ồ vậy ạ? Vui được gặp! Bạn có thích ${w2.meaning} không?`},
    {s:'A',k:`네! ${w2.korean}이 아주 좋아요!`,v:`Vâng! Tôi rất thích ${w2.meaning}!`},
    {s:'B',k:`정말요? 같이 공부해요!`,v:`Thật sao? Cùng học nhé!`},
  ]}),
  (w1,w2) => ({ scene:'🍜 Ở nhà hàng', lines:[
    {s:'A',k:`안녕하세요! ${w1.korean} 있어요?`,v:`Xin chào! Có ${w1.meaning} không?`},
    {s:'B',k:`네, 있어요. ${w2.korean}도 있어요!`,v:`Có ạ. Cũng có ${w2.meaning} nữa!`},
    {s:'A',k:`${w1.korean}하고 ${w2.korean} 주세요.`,v:`Cho tôi ${w1.meaning} và ${w2.meaning} nhé.`},
    {s:'B',k:`알겠어요! 잠깐만요. 맛있게 드세요!`,v:`Được rồi! Chờ chút. Chúc ngon miệng!`},
  ]}),
  (w1,w2) => ({ scene:'📱 Nhắn tin với bạn', lines:[
    {s:'A',k:`야! 오늘 ${w1.korean} 어때?`,v:`Này! Hôm nay ${w1.meaning} thế nào?`},
    {s:'B',k:`${w1.korean}이 너무 좋아! ${w2.korean}도 봤어?`,v:`${w1.meaning} tuyệt lắm! Thấy ${w2.meaning} chưa?`},
    {s:'A',k:`아직! ${w2.korean}이 뭐야?`,v:`Chưa! ${w2.meaning} là gì vậy?`},
    {s:'B',k:`같이 가자! 재미있을 거야!`,v:`Cùng đi thôi! Sẽ vui lắm!`},
  ]}),
];
function generateDialogue() {
  const cont = document.getElementById('dialogueContainer');
  if (state.words.length<2) { cont.innerHTML=`<div class="empty-state"><div class="empty-icon">💬</div><p>Cần ít nhất 2 từ!</p></div>`; return; }
  const sh=shuffle([...state.words]);
  const w1=sh[0], w2=sh[1];
  const tpl=DIALOGUE_TEMPLATES[Math.floor(Math.random()*DIALOGUE_TEMPLATES.length)](w1,w2);
  cont.innerHTML = `
    <div class="dialogue-scene">
      <div class="dialogue-title">📍 ${tpl.scene}</div>
      ${tpl.lines.map(l=>`
        <div class="dialogue-line ${l.s==='A'?'left':'right'}">
          <div class="dialogue-avatar ${l.s==='A'?'avatar-a':'avatar-b'}">${l.s==='A'?'👩':'👨'}</div>
          <div class="dialogue-bubble">
            <div class="bubble-korean">${l.k}</div>
            <div class="bubble-viet">${l.v}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="dialogue-vocab-used">
      <strong>📚 Từ vựng dùng trong hội thoại:</strong>
      <span class="vocab-tag">${w1.korean}</span> <span class="vocab-tag">${w2.korean}</span>
    </div>`;
}

// ============ GRAMMAR ============
async function addGrammar(title, body) {
  const targetLesson = document.getElementById('grammarLessonSelect')?.value || 'Bài 1';
  if (!body && GEMINI.getKey()) {
    showToast('🤖 AI đang tạo nội dung ngữ pháp...', 'info', 4000);
    try {
      body = await GEMINI.generateGrammar(title);
    } catch(e) {
      body = `Công thức: ${title}\n\nNhập thêm chi tiết tại đây.`;
    }
  } else if (!body) {
    body = `Công thức: ${title}\n\nAI hệ thống tạm chưa sẵn sàng; bạn có thể nhập nội dung thủ công.`;
  }
  state.grammar.push({ title, body, lesson: targetLesson });
  renderLessonSelectors();
}
// ============ GRAMMAR DICTIONARY (TỪ ĐIỂN NGỮ PHÁP HÀN - VIỆT) ============
let gdictViewMode = 'cols1';
let gdictQuizState = null;

function renderGrammar() {
  initGrammarDictionary();
}

function initGrammarDictionary() {
  const input = document.getElementById('gdictInput');
  if (input) {
    input.onkeydown = e => { if (e.key === 'Enter') gdictSearch(); };
  }
  populateGdictLessonFilter();
  setGdictViewMode(gdictViewMode);
  switchGdictTab('allgrammar');
  renderGdictSavedList();
}

function setGdictViewMode(mode) {
  gdictViewMode = mode;
  ['cols1', 'cols2', 'cols3'].forEach(m => {
    const btn = document.getElementById(`gview-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  renderFullGrammarDictionaryList();
}

function switchGdictTab(tab) {
  const tabs = ['allgrammar', 'result', 'saved', 'quiz'];
  tabs.forEach(t => {
    const btn = document.getElementById(`gtab-${t}`);
    const content = document.getElementById(`gdictTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (content) content.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'allgrammar') {
    populateGdictLessonFilter();
    renderFullGrammarDictionaryList();
  }
  if (tab === 'saved') renderGdictSavedList();
  if (tab === 'quiz') {
    if (!gdictQuizState) generateGdictQuickQuiz();
  }
}

function getAllGrammarList() {
  const list = state.grammar && state.grammar.length > 0 ? state.grammar : DEFAULT_GRAMMAR;
  return list.map(g => {
    const title = g.title || '';
    let autoType = 'Cấu trúc';
    if (title.includes('은') || title.includes('이') || title.includes('을') || title.includes('에') || title.includes('가') || title.includes('는') || title.includes('를') || title.includes('에서')) {
      autoType = 'tiểu từ';
    } else if (title.includes('않다') || title.includes('안')) {
      autoType = 'phủ định';
    } else if (title.includes('입니다') || title.includes('요') || title.includes('예요') || title.includes('거예요')) {
      autoType = 'đuôi câu';
    }
    return {
      title: title,
      body: g.body || '',
      lesson: g.lesson || 'Bài 1',
      type: g.type || autoType,
      example: g.example || '',
      exampleViet: g.exampleViet || '',
      isSaved: (state.dict && state.dict.savedGrammar) ? state.dict.savedGrammar.includes(title) : false
    };
  });
}

function populateGdictLessonFilter() {
  const sel = document.getElementById('gdictLessonFilter');
  if (!sel) return;
  const lessons = getUniqueLessons();
  const cur = sel.value || 'all';
  sel.innerHTML = `<option value="all">Tất cả bài học</option>` + lessons.map(l => `<option value="${escStr(l)}" ${l===cur?'selected':''}>${l}</option>`).join('');
}

function handleGdictFilterChange() {
  resetListPagination('gdictAll');
  const allTab = document.getElementById('gtab-allgrammar');
  if (allTab && allTab.classList.contains('active')) {
    renderFullGrammarDictionaryList();
  }
}

function renderFullGrammarDictionaryList() {
  const container = document.getElementById('gdictAllgrammarList');
  const countBadge = document.getElementById('gdictCountBadge');
  if (!container) return;

  container.className = `dict-list-container view-${gdictViewMode}`;

  const allGrammar = getAllGrammarList();
  const searchInput = (document.getElementById('gdictInput')?.value || '').trim().toLowerCase();
  const lessonFilter = document.getElementById('gdictLessonFilter')?.value || 'all';
  const typeFilter = document.getElementById('gdictTypeFilter')?.value || 'all';
  const sourceFilter = document.getElementById('gdictSourceFilter')?.value || 'all';
  const sortFilter = document.getElementById('gdictSortFilter')?.value || 'title-asc';

  let filtered = allGrammar.filter(g => {
    if (searchInput) {
      const mTitle = g.title.toLowerCase().includes(searchInput);
      const mBody = (g.body || '').toLowerCase().includes(searchInput);
      if (!mTitle && !mBody) return false;
    }
    if (lessonFilter !== 'all' && (g.lesson || 'Bài 1') !== lessonFilter) return false;
    if (typeFilter !== 'all' && (g.type || '').toLowerCase() !== typeFilter.toLowerCase()) return false;
    if (sourceFilter === 'saved' && !g.isSaved) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortFilter === 'title-asc') return a.title.localeCompare(b.title, 'ko');
    if (sortFilter === 'lesson-asc') return (a.lesson || '').localeCompare(b.lesson || '');
    return 0;
  });

  if (countBadge) {
    countBadge.textContent = `Hiển thị: ${filtered.length} / ${allGrammar.length} ngữ pháp`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔍</div><p>Không tìm thấy cấu trúc ngữ pháp nào khớp với bộ lọc.</p></div>`;
    mountListPagination(container, 'gdictAll', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('gdictAll') }, 'ngữ pháp');
    return;
  }

  const gMeta = paginateList('gdictAll', filtered, renderFullGrammarDictionaryList, 15);
  container.innerHTML = gMeta.pageItems.map(g => {
    const safeTitle = escStr(g.title);
    const isSaved = g.isSaved;

    if (gdictViewMode === 'cols3') {
      return `
        <div class="dict-word-card cols5-card">
          <div class="dw-top">
            <span class="dw-korean font-kr" style="font-size:1.15rem; color:var(--accent-light); font-weight:800;">${g.title}</span>
            <button class="mini-audio-btn" onclick="TTS.speak('${safeTitle}')" title="Nghe phát âm">🔊</button>
          </div>
          <div class="dw-meaning" style="font-size:0.85rem">${g.body}</div>
          <div class="dw-footer-compact" style="margin-top:8px">
            <span class="dict-pos-badge" style="font-size:0.7rem">${g.lesson || 'Bài 1'}</span>
            <div style="display:flex; gap:4px">
              <button class="mini-audio-btn" onclick="gdictAiSearchForTitle('${safeTitle}')" title="AI Phân tích sâu">🔍</button>
              <button class="mini-audio-btn" onclick="startSingleGrammarQuiz('${safeTitle}')" title="Làm bài tập ngay">🏋️</button>
              <button class="mini-audio-btn" onclick="toggleSaveGrammar('${safeTitle}')" style="${isSaved?'color:var(--gold)':''}" title="${isSaved?'Bỏ lưu':'Lưu ngữ pháp'}">${isSaved?'★':'⭐'}</button>
            </div>
          </div>
        </div>
      `;
    }

    if (gdictViewMode === 'cols2') {
      return `
        <div class="dict-word-card cols3-card">
          <div class="dw-top">
            <div class="dw-main">
              <span class="dw-korean font-kr" style="font-size:1.3rem; color:var(--accent-light); font-weight:800;">${g.title}</span>
              <span class="dict-pos-badge">${g.type || 'Cấu trúc'}</span>
            </div>
            <button class="mini-audio-btn" onclick="TTS.speak('${safeTitle}')" title="Nghe đọc">🔊</button>
          </div>
          <div class="dw-meaning" style="margin-top:6px">📌 <strong>Cách dùng:</strong> ${g.body}</div>
          <div class="dw-footer-row" style="margin-top:12px">
            <span class="dw-lesson-tag">${g.lesson || 'Bài 1'}</span>
            <div class="dw-actions">
              <button class="btn btn-ghost btn-sm" onclick="gdictAiSearchForTitle('${safeTitle}')">🔍 Tra AI</button>
              <button class="btn btn-primary btn-sm" onclick="startSingleGrammarQuiz('${safeTitle}')">🏋️ Ôn luyện</button>
              <button class="btn btn-ghost btn-sm" onclick="toggleSaveGrammar('${safeTitle}')" style="${isSaved?'color:var(--gold)':''}">${isSaved?'★':'⭐'}</button>
            </div>
          </div>
        </div>
      `;
    }

    // Default: cols1 (Full Detail Dictionary Card)
    return `
      <div class="dict-word-card cols1-card">
        <div class="dw-top">
          <div class="dw-main">
            <span class="dw-korean font-kr" style="font-size:1.4rem; color:var(--accent-light); font-weight:900;">📐 ${g.title}</span>
            <span class="dict-pos-badge">${g.type || 'Ngữ pháp'}</span>
          </div>
          <span class="dw-lesson-tag">${g.lesson || 'Bài 1'}</span>
        </div>
        <div class="dw-meaning" style="font-size:1rem; line-height:1.6;">💡 <strong>Ý nghĩa & Quy tắc:</strong> ${g.body}</div>
        ${g.example ? `
          <div class="dw-example font-kr" style="margin-top:8px">
            📌 <strong>Ví dụ mẫu:</strong> ${g.example}
            ${g.exampleViet ? `<div class="dw-example-vi">🇻🇳 ${g.exampleViet}</div>` : ''}
          </div>
        ` : ''}
        <div class="dw-actions" style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="mini-audio-btn" onclick="TTS.speak('${safeTitle}')">🔊 Nghe đọc tên ngữ pháp</button>
          <button class="btn btn-ai btn-sm" onclick="gdictAiSearchForTitle('${safeTitle}')">🤖 AI Giải thích chi tiết</button>
          <button class="btn btn-accent btn-sm" onclick="startSingleGrammarQuiz('${safeTitle}')">🏋️ Làm Bài Tập Cấu Trúc Này</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleSaveGrammar('${safeTitle}')" style="${isSaved?'color:var(--gold)':''}">${isSaved?'★ Đã lưu':'⭐ Lưu vào Từ điển'}</button>
        </div>
      </div>
    `;
  }).join('');
  mountListPagination(container, 'gdictAll', gMeta, 'ngữ pháp');
}

function renderGdictSavedList() {
  const container = document.getElementById('gdictSavedList');
  if (!container) return;
  const savedTitles = (state.dict && state.dict.savedGrammar) ? state.dict.savedGrammar : [];
  if (!savedTitles.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><p>Chưa có ngữ pháp nào được lưu. Hãy nhấn ⭐ bên cạnh cấu trúc ngữ pháp để lưu lại!</p></div>`;
    return;
  }
  const allG = getAllGrammarList();
  const savedG = allG.filter(g => savedTitles.includes(g.title));
  container.innerHTML = savedG.map(g => `
    <div class="dict-word-card cols1-card" style="margin-bottom:12px">
      <div class="dw-top">
        <span class="dw-korean font-kr" style="font-size:1.3rem; color:var(--accent-light); font-weight:800;">📐 ${g.title}</span>
        <span class="dw-lesson-tag">${g.lesson || 'Bài 1'}</span>
      </div>
      <div class="dw-meaning">💡 <strong>Ý nghĩa:</strong> ${g.body}</div>
      <div class="dw-actions" style="margin-top:10px">
        <button class="btn btn-ai btn-sm" onclick="gdictAiSearchForTitle('${escStr(g.title)}')">🤖 Phân tích AI</button>
        <button class="btn btn-primary btn-sm" onclick="startSingleGrammarQuiz('${escStr(g.title)}')">🏋️ Làm bài tập</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleSaveGrammar('${escStr(g.title)}')" style="color:var(--gold)">★ Bỏ lưu</button>
      </div>
    </div>
  `).join('');
}

function toggleSaveGrammar(title) {
  if (!state.dict) state.dict = { savedWords: [], savedGrammar: [] };
  if (!state.dict.savedGrammar) state.dict.savedGrammar = [];
  const idx = state.dict.savedGrammar.indexOf(title);
  if (idx >= 0) {
    state.dict.savedGrammar.splice(idx, 1);
    showToast(`⭐ Đã bỏ lưu cấu trúc "${title}"`, 'info');
  } else {
    state.dict.savedGrammar.push(title);
    showToast(`⭐ Đã lưu cấu trúc "${title}" vào Từ điển Ngữ pháp!`, 'success');
  }
  saveState();
  renderFullGrammarDictionaryList();
  if (document.getElementById('gtab-saved')?.classList.contains('active')) {
    renderGdictSavedList();
  }
}

async function gdictSearch() {
  const input = document.getElementById('gdictInput');
  const q = input ? input.value.trim() : '';
  if (!q) return;
  gdictAiSearchForTitle(q);
}

async function gdictAiSearchForTitle(title) {
  switchGdictTab('result');
  const res = document.getElementById('gdictResult');
  if (!res) return;
  res.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 Gemini AI đang phân tích chi tiết cấu trúc ngữ pháp "${title}"...</span></div>`;

  if (!GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình!', 'error');
    return;
  }

  const prompt = `Phân tích sâu ngữ pháp tiếng Hàn: "${title}".
  Cung cấp:
  1. Ý nghĩa cốt lõi & Ngữ cảnh sử dụng.
  2. Công thức chia động từ/tính từ/danh từ chi tiết (có ví dụ biến đổi).
  3. 3 Câu ví dụ mẫu thực tế (Tiếng Hàn + Phiên âm + Tiếng Việt).
  4. Lưu ý hoặc Phân biệt với các cấu trúc tương tự (nếu có).

  Trả về định dạng HTML đẹp mắt (dùng <h3>, <ul>, <li>, <strong>, <span>):`;

  try {
    const html = await GEMINI.call(prompt, '', { temperature: 0.5 });
    res.innerHTML = `
      <div class="card" style="padding:24px; max-width:800px; margin:0 auto; line-height:1.7;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
          <h3 style="margin:0; font-size:1.4rem; color:var(--accent-light);" class="font-kr">📐 Phân tích: ${title}</h3>
          <button class="btn btn-accent btn-sm" onclick="startSingleGrammarQuiz('${escStr(title)}')">🏋️ Làm bài tập ngay</button>
        </div>
        <div>${html}</div>
      </div>
    `;
  } catch(e) {
    res.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi phân tích AI: ${escapePracticeHtml(e.message)}</p></div>`;
  }
}

async function startSingleGrammarQuiz(grammarTitle) {
  switchGdictTab('quiz');
  const quizArea = document.getElementById('gdictQuizArea');
  if (!quizArea) return;
  quizArea.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang tạo bài tập thực hành cho cấu trúc "${grammarTitle}"...</span></div>`;

  if (!GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình!', 'error');
    return;
  }

  const prompt = `Bạn là giáo viên tiếng Hàn. Hãy tạo đúng 4 câu hỏi bài tập thực hành làm trực tiếp (Trắc nghiệm hoặc điền đáp án) cho cấu trúc ngữ pháp "${grammarTitle}".
  Trả về EXACT JSON:
  {
    "title": "Bài tập ôn luyện ngữ pháp: ${grammarTitle}",
    "questions": [
      {
        "id": 1,
        "question": "Nội dung câu hỏi...",
        "options": ["đáp án 1", "đáp án 2", "đáp án 3", "đáp án 4"],
        "answer": "đáp án 1",
        "explain": "Giải thích chi tiết tại sao chọn đáp án này"
      }
    ]
  }`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.5 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const data = JSON.parse(match[0]);
    gdictQuizState = {
      title: data.title,
      questions: data.questions || [],
      userAnswers: {},
      submitted: false,
    };
    renderGdictQuizUI();
  } catch(e) {
    quizArea.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo bài tập: ${escapePracticeHtml(e.message)}</p></div>`;
  }
}

async function generateGdictQuickQuiz() {
  const activeG = getActiveGrammar();
  const sampleGrammars = activeG.slice(0, 8).map(g => g.title).join(', ');
  switchGdictTab('quiz');
  const quizArea = document.getElementById('gdictQuizArea');
  if (!quizArea) return;
  quizArea.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang khởi tạo 5 câu bài tập tổng hợp ngữ pháp...</span></div>`;

  if (!GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình!', 'error');
    return;
  }

  const prompt = `Tạo đúng 5 câu hỏi bài tập trắc nghiệm ngữ pháp tiếng Hàn dựa trên các cấu trúc: ${sampleGrammars}.
  Trả về EXACT JSON:
  {
    "title": "Bộ Bài Tập Ôn Luyện Ngữ Pháp Tổng Hợp",
    "questions": [
      {
        "id": 1,
        "question": "Câu hỏi trắc nghiệm tiếng Hàn...",
        "options": ["A", "B", "C", "D"],
        "answer": "A",
        "explain": "Giải thích đáp án..."
      }
    ]
  }`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.6 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const data = JSON.parse(match[0]);
    gdictQuizState = {
      title: data.title,
      questions: data.questions || [],
      userAnswers: {},
      submitted: false,
    };
    renderGdictQuizUI();
  } catch(e) {
    quizArea.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo bài tập: ${escapePracticeHtml(e.message)}</p></div>`;
  }
}

function renderGdictQuizUI() {
  const qArea = document.getElementById('gdictQuizArea');
  const st = gdictQuizState;
  if (!qArea || !st || !st.questions.length) return;

  const submitted = st.submitted;

  const qsHtml = st.questions.map((q, idx) => {
    const userChoice = st.userAnswers[idx];
    const isCorrect = userChoice === q.answer;

    return `
      <div class="card" style="background:var(--bg-input); border:1px solid var(--border); padding:16px; margin-bottom:14px; border-radius:var(--radius);">
        <div style="font-weight:800; font-size:1rem; color:var(--text-primary); margin-bottom:10px;">
          Câu ${idx + 1}: ${q.question}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${q.options.map(opt => {
            const selected = userChoice === opt;
            let optClass = 'quiz-option';
            if (submitted) {
              if (opt === q.answer) optClass += ' correct';
              else if (selected) optClass += ' wrong';
            } else if (selected) {
              optClass += ' selected';
            }
            return `
              <button class="${optClass}" style="text-align:left; font-family:'Noto Sans KR',sans-serif;" ${submitted ? 'disabled' : ''} onclick="selectGdictQuizOption(${idx}, '${escStr(opt)}')">
                ${opt}
              </button>
            `;
          }).join('')}
        </div>
        ${submitted ? `
          <div class="quiz-feedback ${isCorrect ? 'feedback-correct' : 'feedback-wrong'}" style="display:block; margin-top:10px; padding:10px; border-radius:8px;">
            <div style="font-weight:800;">${isCorrect ? '🎉 Chính xác!' : '❌ Chưa chính xác!'}</div>
            <div style="font-size:0.85rem; margin-top:4px;">💡 <strong>Giải thích:</strong> ${q.explain}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  qArea.innerHTML = `
    <h4 style="margin:0 0 14px; font-size:1.1rem; color:var(--text-primary); font-weight:800;">${st.title}</h4>
    <div>${qsHtml}</div>
    <div style="margin-top:16px; text-align:center;">
      ${!submitted ? `
        <button class="btn btn-primary btn-lg" onclick="submitGdictQuiz()">✅ Nộp Bài & Chấm Điểm</button>
      ` : `
        <button class="btn btn-secondary btn-lg" onclick="generateGdictQuickQuiz()">🔄 Làm Bài Tập Mới</button>
      `}
    </div>
  `;
}

function selectGdictQuizOption(qIdx, choice) {
  if (!gdictQuizState || gdictQuizState.submitted) return;
  gdictQuizState.userAnswers[qIdx] = choice;
  renderGdictQuizUI();
}

function submitGdictQuiz() {
  if (!gdictQuizState || gdictQuizState.submitted) return;
  gdictQuizState.submitted = true;

  let correctCount = 0;
  gdictQuizState.questions.forEach((q, idx) => {
    if (gdictQuizState.userAnswers[idx] === q.answer) correctCount++;
  });

  const xpEarned = correctCount * 5;
  addXP(xpEarned);
  saveState();
  renderGdictQuizUI();
  showToast(`🏆 Hoàn thành! Đúng ${correctCount}/${gdictQuizState.questions.length} câu (+${xpEarned} XP)`, 'success', 3500);
}

// ============ STATS ============

// ============ STATS ============
function renderStats() {
  const total=state.words.length, known=Object.keys(state.learn.known).length;
  const diff=Object.values(state.stats.ratings).filter(r=>r==='hard').length;
  const acc=state.stats.totalAnswered>0?Math.round((state.stats.totalCorrect/state.stats.totalAnswered)*100):0;
  document.getElementById('statTotalWords').textContent=total;
  document.getElementById('statKnown').textContent=known;
  document.getElementById('statAccuracy').textContent=acc+'%';
  document.getElementById('statQuizzes').textContent=state.stats.quizzesCompleted;
  document.getElementById('statStreak').textContent=state.stats.streak;
  document.getElementById('statDifficult').textContent=diff;
  document.getElementById('statXP').textContent=state.stats.xp;
  document.getElementById('statAiMsgs').textContent=state.stats.aiMessages||0;
  const allBatches=getBatches(state.words, state.batchLearn.size||20);
  const completedBatches=allBatches.filter(isBatchComplete).length;
  const statBatchesEl=document.getElementById('statBatches');
  if (statBatchesEl) statBatchesEl.textContent=`${completedBatches}/${allBatches.length}`;
  const pct=total>0?Math.round((known/total)*100):0;
  document.getElementById('progressPct').textContent=pct+'%';
  document.getElementById('progressBarLg').style.width=pct+'%';
  document.getElementById('streakCount').textContent=state.stats.streak;
  const diffWords=state.words.filter(w=>state.stats.ratings[w.korean]==='hard');
  document.getElementById('difficultSection').style.display=diffWords.length>0?'block':'none';
  const difficultListEl = document.getElementById('difficultList');
  const diffMeta = paginateList('difficultWords', diffWords, renderStats, 20);
  difficultListEl.innerHTML = diffMeta.pageItems.map(w=>`<span class="diff-chip" title="${w.meaning}">${w.korean}</span>`).join('');
  mountListPagination(difficultListEl, 'difficultWords', diffMeta, 'từ');
}

// ============ SIDE TRANSLATION PANEL (CHỈ DỊCH NGHĨA TRỰC TIẾP) ============
function toggleSideTranslatePanel() {
  const panel = document.getElementById('sideTranslatePanel');
  if (panel) panel.classList.toggle('active');
}

async function quickSideTranslate() {
  const inputEl = document.getElementById('sideTransInput');
  const outEl = document.getElementById('sideTransOutput');
  if (!inputEl || !outEl) return;
  const q = inputEl.value.trim();
  if (!q) { outEl.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Nhập văn bản cần dịch...</span>'; return; }

  outEl.innerHTML = '<span style="color:var(--accent-light); font-size:0.85rem;">⚡ Đang dịch nhanh...</span>';

  if (!GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình!', 'error');
    return;
  }

  const prompt = `Bạn là công cụ dịch thuật cực kỳ nhanh và chính xác. 
Dịch đoạn văn sau (Nếu là Tiếng Việt -> dịch sang Tiếng Hàn; Nếu là Tiếng Hàn -> dịch sang Tiếng Việt).
Văn bản: "${q}"

QUY TẮC BẮT BUỘC (TUÂN THỦ 100%):
- CHỈ TRẢ VỀ DUY NHẤT BẢN DỊCH NGHĨA.
- KHÔNG GIẢI THÍCH, KHÔNG CHÚ THÍCH PHỤ, KHÔNG THÊM BẤT KỲ VĂN BẢN NÀO KHÁC.`;

  try {
    const res = await GEMINI.call(prompt, '', { temperature: 0.1 });
    const cleanTrans = res.trim().replace(/^"|"$/g, '');
    const safeQ = escStr(q);
    const safeT = escStr(cleanTrans);
    outEl.innerHTML = `
      <div style="font-size:1.05rem; font-weight:700; color:var(--text-primary); line-height:1.5; font-family:'Noto Sans KR',sans-serif;">${cleanTrans}</div>
      <div style="margin-top:8px; display:flex; gap:6px;">
        <button class="mini-audio-btn" onclick="speakBilingual('${safeQ}', '${safeT}')">🔊 Nghe đọc song ngữ</button>
      </div>
    `;
  } catch(e) {
    outEl.innerHTML = `<span style="color:var(--red); font-size:0.85rem;">❌ Lỗi dịch: ${escapePracticeHtml(e.message)}</span>`;
  }
}

function quickSideTranslateWithText(text) {
  toggleSideTranslatePanel();
  const inp = document.getElementById('sideTransInput');
  if (inp) {
    inp.value = text;
    quickSideTranslate();
  }
}

// ============ MASTER STUDY SUITE (3 GIAI ĐOẠN) ============
let masterScopeMode = 'single'; // 'single', 'multi', 'all'
let masterStudyState = null;

function setMasterScopeMode(mode) {
  masterScopeMode = mode;
  ['single', 'multi', 'all'].forEach(m => {
    const btn = document.getElementById(`mscope-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const singleWrap = document.getElementById('masterSingleLessonWrap');
  const multiWrap = document.getElementById('masterMultiLessonWrap');

  if (singleWrap) singleWrap.style.display = mode === 'single' ? 'flex' : 'none';
  if (multiWrap) multiWrap.style.display = mode === 'multi' ? 'flex' : 'none';

  if (mode === 'single') populateMasterSingleLessonSelect();
  if (mode === 'multi') populateMasterMultiLessonCheckboxes();
}

function populateMasterSingleLessonSelect() {
  const sel = document.getElementById('masterSingleLessonSelect');
  if (!sel) return;
  const lessons = getUniqueLessons();
  sel.innerHTML = lessons.map(l => `<option value="${escStr(l)}">${l}</option>`).join('');
}

function populateMasterMultiLessonCheckboxes() {
  const grid = document.getElementById('masterCheckboxGrid');
  if (!grid) return;
  const lessons = getUniqueLessons();
  grid.innerHTML = lessons.map((l, i) => `
    <label class="master-cb-item">
      <input type="checkbox" value="${escStr(l)}" class="master-l-cb" ${i===0?'checked':''} />
      <span>${l}</span>
    </label>
  `).join('');
}

function getSelectedMasterLessons() {
  if (masterScopeMode === 'all') return getUniqueLessons();
  if (masterScopeMode === 'single') {
    const sel = document.getElementById('masterSingleLessonSelect');
    return sel ? [sel.value] : ['Bài 1'];
  }
  if (masterScopeMode === 'multi') {
    const cbs = document.querySelectorAll('.master-l-cb:checked');
    const selected = Array.from(cbs).map(c => c.value);
    return selected.length > 0 ? selected : getUniqueLessons().slice(0, 2);
  }
  return ['Bài 1'];
}

function updateMasterStepsBar(stage) {
  [1, 2, 3].forEach(s => {
    const pill = document.getElementById(`mstep-${s}`);
    if (!pill) return;
    pill.classList.remove('active', 'done');
    if (s === stage) pill.classList.add('active');
    else if (s < stage) pill.classList.add('done');
  });
}

async function startMasterStudySuite() {
  const selectedLessons = getSelectedMasterLessons();
  if (!selectedLessons.length) {
    showToast('⚠️ Vui lòng chọn ít nhất 1 bài học!', 'error');
    return;
  }

  updateMasterStepsBar(1);
  const exBox = document.getElementById('gpExercises');
  if (!exBox) return;

  exBox.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang khởi tạo Giai đoạn 1: Bài tập Ngữ pháp cho bài: ${selectedLessons.join(', ')}...</span></div>`;

  if (!GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình!', 'error');
    return;
  }

  const targetGrammar = state.grammar.filter(g => selectedLessons.includes(g.lesson || 'Bài 1'));
  const useGrammar = targetGrammar.length > 0 ? targetGrammar : DEFAULT_GRAMMAR.slice(0, 4);

  const targetWords = state.words.filter(w => selectedLessons.includes(w.lesson || 'Bài 1'));
  const useWords = targetWords.length > 0 ? targetWords : state.words.slice(0, 10);

  const grammarList = useGrammar.map(g => g.title).join(', ');
  const wordList = useWords.slice(0, 15).map(w => `${w.korean}(${w.meaning})`).join(', ');

  const prompt = `Bạn là giáo viên tiếng Hàn. Bạn đang tạo Giai đoạn 1 của bài Ôn Luyện Ngữ Pháp & Từ Vựng Tổng Hợp.
Bài học chọn ôn: ${selectedLessons.join(', ')}
Cấu trúc ngữ pháp trọng tâm: ${grammarList}
Từ vựng có trong bài: ${wordList}

Hãy tạo đúng 5 câu bài tập thực hành ngữ pháp.
Trả về EXACT JSON:
{
  "exercises": [
    {
      "id": 1,
      "type": "vn2kr",
      "prompt": "Câu tiếng Việt cần dịch sang tiếng Hàn",
      "answer": "Đáp án tiếng Hàn chính xác",
      "hint": "Từ vựng chìa khóa hoặc ngữ pháp cần dùng",
      "explanation": "Giải thích cấu trúc và cách chia"
    }
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.5 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const parsed = JSON.parse(match[0]);

    masterStudyState = {
      stage: 1,
      selectedLessons: selectedLessons,
      exercises: parsed.exercises || [],
      userAnswers: {},
      submitted: false
    };

    renderMasterStage1UI();
    showToast(`🚀 Giai đoạn 1: Luyện Ngữ Pháp cho [${selectedLessons.join(', ')}]!`, 'success');
  } catch(e) {
    exBox.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo bài tập: ${escapePracticeHtml(e.message)}</p></div>`;
  }
}

function renderMasterStage1UI() {
  const exBox = document.getElementById('gpExercises');
  const st = masterStudyState;
  if (!exBox || !st || !st.exercises.length) return;

  updateMasterStepsBar(1);
  const submitted = st.submitted;

  const html = st.exercises.map((ex, idx) => {
    const userAns = st.userAnswers[idx] || '';
    const isCorrect = submitted && userAns.trim().toLowerCase() === ex.answer.trim().toLowerCase();

    return `
      <div class="gp-exercise ${submitted ? (isCorrect ? 'gp-correct' : 'gp-wrong') : ''}" style="margin-bottom:16px;">
        <div class="gp-ex-badge">Câu ${idx + 1}: ${ex.type === 'vn2kr' ? '🇻🇳 → 🇰🇷 Dịch sang tiếng Hàn' : '🇰🇷 → 🇻🇳 Dịch sang tiếng Việt'}</div>
        <div class="gp-ex-prompt">${ex.prompt}</div>
        ${ex.hint ? `<div class="gp-ex-hint">💡 Gợi ý: ${ex.hint}</div>` : ''}
        <div class="gp-ex-input-row" style="margin-top:8px;">
          <input type="text" id="mstage1_ans_${idx}" class="gp-ex-input" value="${escStr(userAns)}" ${submitted ? 'disabled' : ''} placeholder="Nhập đáp án..." onchange="masterStudyState.userAnswers[${idx}] = this.value.trim()" />
          <button class="mini-audio-btn" onclick="quickSideTranslateWithText('${escStr(ex.prompt)}')">⚡ Dịch nghĩa</button>
        </div>
        ${submitted ? `
          <div style="margin-top:8px; font-weight:700; font-size:0.9rem; color:${isCorrect ? 'var(--green)' : 'var(--red)'};">
            ${isCorrect ? '🎉 Đúng rồi!' : `❌ Chưa đúng. Đáp án: <strong class="font-kr" style="color:var(--green)">${ex.answer}</strong>`}
          </div>
          ${ex.explanation ? `<div style="margin-top:6px; font-size:0.85rem; color:var(--text-muted);">🧑‍🏫 <strong>Giải thích:</strong> ${ex.explanation}</div>` : ''}
        ` : ''}
      </div>
    `;
  }).join('');

  exBox.innerHTML = `
    <div style="margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:10px;">
      <h3 style="margin:0; color:var(--accent-light);">📐 Giai Đoạn 1: Luyện Ngữ Pháp (${st.selectedLessons.join(', ')})</h3>
      <p style="margin:4px 0 0; font-size:0.85rem; color:var(--text-secondary);">Hoàn thành 5 câu bên dưới. Sau đó AI sẽ tự động trích xuất các từ vựng sai/mới để luyện chép 10 lần!</p>
    </div>
    <div>${html}</div>
    <div style="margin-top:20px; text-align:center;">
      ${!submitted ? `
        <button class="btn btn-primary btn-lg" onclick="submitMasterStage1()">✅ Nộp Bài Giai Đoạn 1 ➔ Chuyển Sang Luyện Từ Vựng</button>
      ` : `
        <button class="btn btn-accent btn-lg" onclick="startMasterStage2Vocab10x()">🚀 Chuyển Sang Giai Đoạn 2: Luyện Chép 10 Lần Từ Vựng ➔</button>
      `}
    </div>
  `;
}

async function submitMasterStage1() {
  const st = masterStudyState;
  if (!st || st.submitted) return;

  st.exercises.forEach((ex, idx) => {
    const inp = document.getElementById(`mstage1_ans_${idx}`);
    if (inp) st.userAnswers[idx] = inp.value.trim();
  });

  st.submitted = true;
  renderMasterStage1UI();
  showToast('✅ Đã nộp bài Giai đoạn 1! Nhấn nút bên dưới để chuyển sang Luyện từ vựng 10 lần.', 'success', 3500);
}

async function startMasterStage2Vocab10x() {
  const st = masterStudyState;
  if (!st) return;

  st.stage = 2;
  updateMasterStepsBar(2);

  const exBox = document.getElementById('gpExercises');
  if (!exBox) return;

  exBox.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang phân tích câu sai & trích xuất các từ vựng trọng tâm từ Giai đoạn 1...</span></div>`;

  const selectedLessons = st.selectedLessons;
  const lessonWords = state.words.filter(w => selectedLessons.includes(w.lesson || 'Bài 1'));
  const useWords = lessonWords.length > 0 ? lessonWords : state.words.slice(0, 8);

  st.extractedVocab = useWords.slice(0, 6);
  st.vocab10xIndex = 0;
  st.vocab10xCounts = {};
  st.extractedVocab.forEach(w => st.vocab10xCounts[w.korean] = 0);

  renderMasterStage2Vocab10xUI();
}

function renderMasterStage2Vocab10xUI() {
  const exBox = document.getElementById('gpExercises');
  const st = masterStudyState;
  if (!exBox || !st || !st.extractedVocab.length) return;

  const curWord = st.extractedVocab[st.vocab10xIndex];
  const curCount = st.vocab10xCounts[curWord.korean] || 0;
  const isWordDone = curCount >= 10;
  const totalDone = st.extractedVocab.filter(w => (st.vocab10xCounts[w.korean]||0) >= 10).length;

  exBox.innerHTML = `
    <div style="margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:10px;">
      <span class="master-badge">✏️ GIAI ĐOẠN 2: LUYỆN CHÉP 10 LẦN</span>
      <h3 style="margin:6px 0 2px; color:var(--accent-light);">Ghi Nhớ Từ Vựng Trọng Tâm & Từ Hay Sai (${totalDone}/${st.extractedVocab.length} từ đã thuộc)</h3>
      <p style="margin:0; font-size:0.85rem; color:var(--text-secondary);">Gõ từ tiếng Hàn đúng 10 lần. Khi gõ xong hệ thống sẽ phát âm song ngữ Hàn + Việt cho bạn nhớ lâu!</p>
    </div>

    <!-- Current Word 10x Card -->
    <div class="card batch-10x-card" style="padding:24px; max-width:600px; margin:0 auto; text-align:center;">
      <div style="font-size:0.8rem; color:var(--text-muted);">Từ thứ ${st.vocab10xIndex + 1} / ${st.extractedVocab.length}</div>
      <div class="batch-10x-kr font-kr" style="font-size:2.2rem; color:var(--accent-light); margin:8px 0;">${curWord.korean}</div>
      <div class="batch-10x-vi" style="font-size:1.1rem; font-weight:700; color:var(--text-primary);">🇻🇳 ${curWord.meaning}</div>
      ${curWord.roman ? `<div style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">[ ${curWord.roman} ]</div>` : ''}

      <!-- Progress bar for 10x -->
      <div style="margin:16px 0 8px;">
        <div style="font-size:0.85rem; font-weight:700; color:var(--gold);">Tiến độ: ${curCount}/10 lần ${isWordDone ? '🎉 (Đã thuộc!)' : ''}</div>
        <div style="width:100%; height:8px; background:var(--bg-input); border-radius:4px; margin-top:6px; overflow:hidden;">
          <div style="width:${(curCount/10)*100}%; height:100%; background:linear-gradient(90deg, var(--accent), var(--green)); transition:width 0.2s ease;"></div>
        </div>
      </div>

      <!-- Typing Input -->
      <div style="margin-top:16px;">
        <input type="text" id="mstage2_input" class="batch-10x-input font-kr" placeholder="Gõ từ '${curWord.korean}' tại đây..." autocomplete="off" onkeydown="if(event.key==='Enter')checkMasterVocab10xStep()" />
        <div style="font-size:0.78rem; color:var(--text-muted); margin-top:6px;">Nhấn <kbd>Enter</kbd> sau mỗi lần gõ đúng</div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:18px;">
        <button class="btn btn-ghost btn-sm" ${st.vocab10xIndex === 0 ? 'disabled' : ''} onclick="prevMasterVocab10xWord()">← Từ trước</button>
        <button class="btn btn-ghost btn-sm" onclick="TTS.speak('${escStr(curWord.korean)}')">🔊 Nghe đọc Hàn</button>
        <button class="btn btn-ghost btn-sm" ${st.vocab10xIndex === st.extractedVocab.length - 1 ? 'disabled' : ''} onclick="nextMasterVocab10xWord()">Từ tiếp →</button>
      </div>
    </div>

    <div style="margin-top:24px; text-align:center;">
      <button class="btn btn-accent btn-lg" onclick="startMasterFinalGrammarExam()">🚀 Chuyển Sang Giai Đoạn 3: Đề Thi Ngữ Pháp Chốt Hạ ➔</button>
    </div>
  `;

  setTimeout(() => {
    const inp = document.getElementById('mstage2_input');
    if (inp) inp.focus();
  }, 100);
}

function checkMasterVocab10xStep() {
  const st = masterStudyState;
  if (!st) return;
  const curWord = st.extractedVocab[st.vocab10xIndex];
  const inp = document.getElementById('mstage2_input');
  if (!inp) return;

  const typed = inp.value.trim();
  if (typed === curWord.korean) {
    st.vocab10xCounts[curWord.korean] = (st.vocab10xCounts[curWord.korean] || 0) + 1;
    inp.value = '';
    const newCount = st.vocab10xCounts[curWord.korean];

    if (newCount === 10) {
      speakBilingual(curWord.korean, curWord.meaning);
      showToast(`🎉 Xuất sắc! Thuộc từ "${curWord.korean}" (10/10 lần)!`, 'success');
      if (st.vocab10xIndex < st.extractedVocab.length - 1) {
        st.vocab10xIndex++;
      }
    } else {
      TTS.speak(curWord.korean);
    }
    renderMasterStage2Vocab10xUI();
  } else {
    showToast(`❌ Bạn gõ "${typed}". Cần gõ đúng: "${curWord.korean}"`, 'error');
    inp.classList.add('shake-error');
    setTimeout(() => inp.classList.remove('shake-error'), 400);
  }
}

function prevMasterVocab10xWord() {
  if (!masterStudyState || masterStudyState.vocab10xIndex <= 0) return;
  masterStudyState.vocab10xIndex--;
  renderMasterStage2Vocab10xUI();
}

function nextMasterVocab10xWord() {
  if (!masterStudyState || masterStudyState.vocab10xIndex >= masterStudyState.extractedVocab.length - 1) return;
  masterStudyState.vocab10xIndex++;
  renderMasterStage2Vocab10xUI();
}

async function startMasterFinalGrammarExam() {
  const st = masterStudyState;
  if (!st) return;

  st.stage = 3;
  updateMasterStepsBar(3);

  const exBox = document.getElementById('gpExercises');
  if (!exBox) return;

  exBox.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang thiết lập Giai đoạn 3: Đề Thi Ngữ Pháp Tổng Hợp Chốt Hạ cho bài [${st.selectedLessons.join(', ')}]...</span></div>`;

  if (!GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình!', 'error');
    return;
  }

  const prompt = `Tạo Giai đoạn 3: Đề Thi Ngữ Pháp Tổng Hợp Chốt Hạ cho bài học: ${st.selectedLessons.join(', ')}.
Tạo đúng 5 câu trắc nghiệm tổng hợp ngữ pháp nâng cao.
Trả về EXACT JSON:
{
  "examTitle": "Đề Thi Ngữ Pháp Tổng Hợp Chốt Hạ - ${st.selectedLessons.join(', ')}",
  "questions": [
    {
      "id": 1,
      "question": "Nội dung câu hỏi trắc nghiệm tiếng Hàn...",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explain": "Giải thích chi tiết đáp án"
    }
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.5 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const parsed = JSON.parse(match[0]);

    st.examTitle = parsed.examTitle;
    st.examQuestions = parsed.questions || [];
    st.examUserAnswers = {};
    st.examSubmitted = false;

    renderMasterFinalExamUI();
  } catch(e) {
    exBox.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo đề thi: ${escapePracticeHtml(e.message)}</p></div>`;
  }
}

function renderMasterFinalExamUI() {
  const exBox = document.getElementById('gpExercises');
  const st = masterStudyState;
  if (!exBox || !st || !st.examQuestions.length) return;

  updateMasterStepsBar(3);
  const submitted = st.examSubmitted;

  const html = st.examQuestions.map((q, idx) => {
    const userAns = st.examUserAnswers[idx];
    const isCorrect = userAns === q.answer;

    return `
      <div class="card" style="background:var(--bg-input); border:1px solid var(--border); padding:16px; margin-bottom:14px; border-radius:var(--radius);">
        <div style="font-weight:800; font-size:1rem; color:var(--text-primary); margin-bottom:10px;">
          Câu ${idx + 1}: ${q.question}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${q.options.map(opt => {
            const selected = userAns === opt;
            let optClass = 'quiz-option';
            if (submitted) {
              if (opt === q.answer) optClass += ' correct';
              else if (selected) optClass += ' wrong';
            } else if (selected) {
              optClass += ' selected';
            }
            return `
              <button class="${optClass}" style="text-align:left; font-family:'Noto Sans KR',sans-serif;" ${submitted ? 'disabled' : ''} onclick="selectMasterExamOption(${idx}, '${escStr(opt)}')">
                ${opt}
              </button>
            `;
          }).join('')}
        </div>
        ${submitted ? `
          <div class="quiz-feedback ${isCorrect ? 'feedback-correct' : 'feedback-wrong'}" style="display:block; margin-top:10px; padding:10px; border-radius:8px;">
            <div style="font-weight:800;">${isCorrect ? '🎉 Chính xác!' : '❌ Chưa chính xác!'}</div>
            <div style="font-size:0.85rem; margin-top:4px;">💡 <strong>Giải thích:</strong> ${q.explain}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  exBox.innerHTML = `
    <div style="margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:10px;">
      <span class="master-badge">🏆 GIAI ĐOẠN 3: ĐỀ THI CHỐT HẠ</span>
      <h3 style="margin:6px 0 2px; color:var(--accent-light);">${st.examTitle}</h3>
      <p style="margin:0; font-size:0.85rem; color:var(--text-secondary);">Kiểm tra lại toàn bộ kiến thức ngữ pháp đã chép từ vựng để hoàn thành lộ trình!</p>
    </div>
    <div>${html}</div>
    <div style="margin-top:20px; text-align:center;">
      ${!submitted ? `
        <button class="btn btn-primary btn-lg" onclick="submitMasterFinalExam()">✅ Nộp Bài Thi & Hoàn Thành Lộ Trình</button>
      ` : `
        <button class="btn btn-accent btn-lg" onclick="startMasterStudySuite()">🔄 Làm Lại Lộ Trình Ôn Mới</button>
      `}
    </div>
  `;
}

function selectMasterExamOption(qIdx, choice) {
  if (!masterStudyState || masterStudyState.examSubmitted) return;
  masterStudyState.examUserAnswers[qIdx] = choice;
  renderMasterFinalExamUI();
}

function submitMasterFinalExam() {
  const st = masterStudyState;
  if (!st || st.examSubmitted) return;

  st.examSubmitted = true;
  let correctCount = 0;
  st.examQuestions.forEach((q, idx) => {
    if (st.examUserAnswers[idx] === q.answer) correctCount++;
  });

  const xpEarned = correctCount * 10 + 20;
  addXP(xpEarned);
  saveState();
  renderMasterFinalExamUI();
  showToast(`🏆 HOÀN THÀNH LỘ TRÌNH! Đúng ${correctCount}/${st.examQuestions.length} câu (+${xpEarned} XP)`, 'success', 5000);
}

// ============ SEARCH ============
function initSearch() {
  const input=document.getElementById('searchInput'), results=document.getElementById('searchResults');
  input.addEventListener('input', () => {
    const q=input.value.trim().toLowerCase();
    if (!q||state.words.length===0) { results.style.display='none'; return; }
    const matches=state.words.filter(w=>w.korean.includes(q)||(w.meaning||'').toLowerCase().includes(q)||(w.roman||'').toLowerCase().includes(q)).slice(0,8);
    if (matches.length===0) { results.style.display='none'; return; }
    results.style.display='block';
    results.innerHTML=matches.map(w=>`
      <div class="search-result-item" onclick="goToWord('${escStr(w.korean)}')">
        <div class="sri-korean">${w.korean}</div>
        <div><div class="sri-meaning">${w.meaning}</div><div style="font-size:0.72rem;color:var(--text-muted)">${w.roman||''}</div></div>
      </div>`).join('');
  });
  document.addEventListener('click', e=>{ if (!e.target.closest('.topbar-search')) results.style.display='none'; });
}
function goToWord(korean) {
  const idx=state.words.findIndex(w=>w.korean===korean);
  if (idx>=0) { state.learn.index=idx; setMode('learn'); }
  document.getElementById('searchInput').value='';
  document.getElementById('searchResults').style.display='none';
}


// ============ CLASSROOM CONTENT SYNC ============
function applyClassroomLearningSync(payload, { quiet = false } = {}) {
  const data = payload || {};
  const classId = data.classId ?? null;
  const incomingWords = Array.isArray(data.words) ? data.words : [];
  const incomingGrammar = Array.isArray(data.grammar) ? data.grammar : [];

  lastClassroomLearningSync = { ...data, words: incomingWords, grammar: incomingGrammar };

  // Khi đổi lớp, bỏ phần học liệu Classroom cũ nhưng giữ các mục người dùng tự thêm.
  const localWords = (state.words || []).filter((word) => !word.__classroomSynced);
  const localGrammar = (state.grammar || []).filter((grammar) => !grammar.__classroomSynced);

  const wordMap = new Map(localWords.map((word) => [String(word.korean || '').trim(), word]));
  incomingWords.forEach((word) => {
    const key = String(word.korean || '').trim();
    if (!key) return;
    wordMap.set(key, {
      ...wordMap.get(key),
      ...word,
      __classroomSynced: true,
      __classroomClassId: classId,
    });
  });

  const grammarMap = new Map(localGrammar.map((g) => [String(g.title || '').trim(), g]));
  incomingGrammar.forEach((grammar) => {
    const key = String(grammar.title || '').trim();
    if (!key) return;
    grammarMap.set(key, {
      ...grammarMap.get(key),
      ...grammar,
      __classroomSynced: true,
      __classroomClassId: classId,
    });
  });

  state.words = [...wordMap.values()];
  state.grammar = [...grammarMap.values()];

  const lessonNames = [
    ...incomingWords.map((word) => word.lesson),
    ...incomingGrammar.map((grammar) => grammar.lesson),
  ].filter(Boolean);
  state.lessons = [...new Set([...(state.lessons || []), ...lessonNames])];

  renderWordChips();
  renderGrammarChips();
  renderLessonSelectors();
  saveState();

  if (!quiet) {
    showToast(`📚 Đã đồng bộ ${incomingWords.length} từ vựng · ${incomingGrammar.length} ngữ pháp từ lớp học`, 'success', 2400);
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data || {};

  if (data.type === 'CLASSROOM_LEARNING_SYNC') {
    applyClassroomLearningSync(data);
    return;
  }

  // Tương thích với bản Classroom cũ chỉ gửi từ vựng.
  if (data.type === 'CLASSROOM_VOCAB_SYNC') {
    applyClassroomLearningSync({ ...data, grammar: data.grammar || [] });
    return;
  }

  if (data.type === 'CLASSROOM_SETTINGS_SYNC' && data.settings) {
    const settings = data.settings;
    if (settings.personality && PERSONALITIES[settings.personality]) selectPersonality(settings.personality, false);
  }
});

// ============ KEYBOARD ============
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.key==='ArrowRight'||e.key==='n') {
      if (state.currentMode==='learn') nextLearnCard();
      if (state.currentMode==='flashcard') nextFlash();
    }
    if (e.key==='ArrowLeft'||e.key==='p') {
      if (state.currentMode==='learn') prevLearnCard();
      if (state.currentMode==='flashcard') prevFlash();
    }
    if (e.key===' ') { e.preventDefault(); if (state.currentMode==='flashcard') flipCard(); }
    if (e.key==='Enter') {
      if (state.currentMode==='fill') checkFill();
      if (state.currentMode==='writing') checkWrite();
    }
  });
}

// ============ INIT APP ============
async function initApp() {
  if (classroomSession()?.user) document.body.classList.add('classroom-embedded');
  loadState();
  TTS.init();

  // NAV
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // MOBILE MENU
  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('overlay').classList.add('show');
  });

  // THEME TOGGLE
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    document.getElementById('themeToggle').textContent = isDark ? '🌙' : '☀️';
    localStorage.setItem('hq_theme', isDark ? 'dark' : 'light');
  });
  const theme = localStorage.getItem('hq_theme');
  if (theme==='light') {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
    document.getElementById('themeToggle').textContent = '☀️';
  }

  // ADD WORDS
  document.getElementById('addWordsBtn').addEventListener('click', async () => {
    const raw = document.getElementById('wordInput').value;
    const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
    if (lines.length===0) { showToast('⚠️ Nhập ít nhất 1 từ!','error'); return; }
    document.getElementById('addWordsBtn').disabled = true;
    const count = await processWords(lines);
    document.getElementById('addWordsBtn').disabled = false;
    if (count>0) {
      showToast(`✅ Đã thêm ${count} từ! +${count*3} XP`,'success');
      addXP(count*3); updateStreak();
      wordPagination.page = Math.max(1, Math.ceil(state.words.length / wordPagination.pageSize));
    } else showToast('ℹ️ Từ đã được thêm trước đó!','info');
    renderWordChips(); saveState();
    document.getElementById('wordInput').value = '';
  });

  // CLEAR WORDS
  document.getElementById('clearWordsBtn').addEventListener('click', () => {
    if (state.words.length===0) return;
    if (confirm(`Xóa toàn bộ ${state.words.length} từ?`)) {
      state.words=[]; state.learn.known={};
      renderWordChips(); saveState(); showToast('🗑 Đã xóa hết','info');
    }
  });

  // ADD GRAMMAR
  document.getElementById('addGrammarBtn').addEventListener('click', async () => {
    const title = document.getElementById('grammarTitle').value.trim();
    const body = document.getElementById('grammarFormula').value.trim();
    if (!title) { showToast('⚠️ Nhập tên công thức!','error'); return; }
    document.getElementById('addGrammarBtn').disabled = true;
    await addGrammar(title, body);
    document.getElementById('addGrammarBtn').disabled = false;
    document.getElementById('grammarTitle').value = '';
    document.getElementById('grammarFormula').value = '';
    renderGrammarChips(); saveState();
    showToast(`✅ Đã thêm: ${title}`,'success'); addXP(10);
  });

  // ENTER for inputs
  ['fillInput','writeInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key==='Enter') { e.preventDefault(); id==='fillInput'?checkFill():checkWrite(); }
    });
  });

  // CHECK IF CLASSROOM AI BRIDGE IS AVAILABLE
  if (GEMINI.getKey()) {
    updateApiIndicator(true);
    document.getElementById('aiPowerBadge').style.display = 'flex';
  }

  // PERSONALITY
  selectPersonality(state.personality, false);

  // INIT UI
  renderWordChips();
  renderGrammarChips();
  initSearch();
  initKeyboard();

  // Update displays
  document.getElementById('xpCount').textContent = state.stats.xp + ' XP';
  document.getElementById('streakCount').textContent = state.stats.streak;

  // Set home active
  document.getElementById('nav-home').classList.add('active');
  document.getElementById('page-home').classList.add('active');

  renderLessonSelectors();
  updateStreak();

  if (classroomSession()?.user) {
    await hydrateClassroomLearningState();
  }
}

window.addEventListener('DOMContentLoaded', initApp);

// ============================================================
// ============ SMART SRS VOCAB WEIGHTING ============
// ============================================================
// Returns a weighted shuffled list – new/hard words appear more frequently
function smartSRSShuffle(words) {
  if (!words.length) return [];
  const weighted = [];
  words.forEach(w => {
    const rating = state.stats.ratings[w.korean] || 'new';
    const seen = state.stats.wordSeenCount[w.korean] || 0;
    // Weight: hard=4, new=3, medium=2, easy=1 (fewer repeats)
    let weight = 3;
    if (rating === 'hard') weight = 5;
    else if (rating === 'medium') weight = 3;
    else if (rating === 'easy') weight = 1;
    // Reduce weight for very frequently seen words
    if (seen > 10) weight = Math.max(1, weight - 1);
    for (let i = 0; i < weight; i++) weighted.push(w);
  });
  return shuffle(weighted);
}

function trackWordSeen(korean) {
  if (!state.stats.wordSeenCount) state.stats.wordSeenCount = {};
  state.stats.wordSeenCount[korean] = (state.stats.wordSeenCount[korean] || 0) + 1;
}

// ============================================================
// ============ GRAMMAR PRACTICE MODE ============
// ============================================================
let gpDifficulty = 'easy';
function setGpDifficulty(level, btn) {
  gpDifficulty = level;
  document.querySelectorAll('.gp-diff-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const labels = { easy: '🟢 Dễ', medium: '🟡 Thường', hard: '🔴 Khó' };
  showToast(`Mức độ: ${labels[level]} — ${level==='easy'?'Chỉ dùng từ đã học':level==='medium'?'Có thêm từ mới':'Đề thi TOPIK thật'}`, 'info', 2000);
}

function initGrammarPractice() {
  const list = document.getElementById('gpGrammarList');
  const empty = document.getElementById('gpEmptyGrammar');
  if (!state.grammar || state.grammar.length === 0) {
    state.grammar = [...DEFAULT_GRAMMAR];
    saveState();
  }
  const grammar = getActiveGrammar().length > 0 ? getActiveGrammar() : state.grammar;
  if (grammar.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    mountListPagination(list, 'grammarPracticeList', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('grammarPracticeList') }, 'ngữ pháp');
    return;
  }
  empty.style.display = 'none';
  const gpEntries = grammar.map((g, i) => ({ g, i }));
  const gpMeta = paginateList('grammarPracticeList', gpEntries, initGrammarPractice, 10);
  list.innerHTML = gpMeta.pageItems.map(({g, i}) => `
    <div class="gp-grammar-item ${(state.grammarPractice.selectedIndex === i || (state.grammarPractice.selectedIndex < 0 && i === 0)) ? 'active' : ''}" onclick="selectGrammarForPractice(${i})">
      <div class="gp-grammar-icon">📐</div>
      <div class="gp-grammar-name">${g.title} <span style="font-size:0.7rem;color:var(--text-muted)">(${g.lesson || 'Bài 1'})</span></div>
    </div>
  `).join('');
  mountListPagination(list, 'grammarPracticeList', gpMeta, 'ngữ pháp');

  if (state.grammarPractice.selectedIndex < 0 || state.grammarPractice.selectedIndex >= grammar.length) {
    selectGrammarForPractice(0);
  } else {
    const g = grammar[state.grammarPractice.selectedIndex];
    if (g && document.getElementById('gpSelectedTitle')) {
      document.getElementById('gpSelectedTitle').textContent = `📐 ${g.title}`;
    }
  }

  if (state.grammarPractice.exercises.length > 0) {
    renderGrammarExercises();
  }
}

function selectGrammarForPractice(idx) {
  state.grammarPractice.selectedIndex = idx;
  state.grammarPractice.exercises = [];
  state.grammarPractice.answers = {};
  state.grammarPractice.submitted = false;
  document.querySelectorAll('.gp-grammar-item').forEach((el, i) => el.classList.toggle('active', i === idx));
  const grammar = getActiveGrammar();
  const g = grammar[idx] || state.grammar[idx];
  if (!g) return;
  document.getElementById('gpSelectedTitle').textContent = `📐 ${g.title}`;
  document.getElementById('gpExercises').innerHTML = `
    <div class="gp-loading">
      <div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
      <span>Nhấn <strong>"🤖 Tạo bài tập"</strong> để AI sinh bài tập cho cấu trúc này</span>
    </div>
  `;
}

async function generateGrammarExercises() {
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }
  const grammar = getActiveGrammar();
  let idx = state.grammarPractice.selectedIndex;
  if (idx < 0 || idx >= grammar.length) {
    if (grammar.length > 0) {
      idx = 0;
      selectGrammarForPractice(0);
    } else {
      showToast('⚠️ Chưa có cấu trúc ngữ pháp nào trong bài này!', 'error'); return;
    }
  }
  const g = grammar[idx] || state.grammar[idx];
  if (!g) { showToast('⚠️ Chưa chọn cấu trúc ngữ pháp!', 'error'); return; }
  const diff = gpDifficulty || 'easy';
  const words = getActiveWords();
  const allVocab = shuffle([...words]).slice(0, 12).map(w => `${w.korean}(${w.meaning})`).join(', ');

  const topics = ['Du lịch & Khách sạn', 'Ăn uống & Nhà hàng', 'Công sở & Giao tiếp công việc', 'Trường học & Bạn bè', 'Mua sắm & Đời sống hàng ngày', 'Sở thích & Cuối tuần', 'Gia đình & Sức khỏe'];
  const randomTopic = topics[Math.floor(Math.random() * topics.length)];
  const randomSeed = Math.floor(Math.random() * 10000);

  // Difficulty-based prompt instructions
  const diffInstructions = {
    easy: `QUAN TRỌNG - Mức DỄ: Chỉ được dùng các từ vựng đã học sau: ${allVocab}.
Câu ngắn, cấu trúc đơn giản, dễ hiểu, dễ điền. Tuyệt đối KHÔNG dùng từ ngoài danh sách này.`,
    medium: `Mức THƯỜNG: Dùng chủ yếu từ vựng đã học (${allVocab}), nhưng có thể thêm 2-3 từ mới phù hợp chủ đề ${randomTopic}. Câu tự nhiên hơn, tình huống đa dạng. Nếu có từ mới, hãy chú thích trong phần "hint".`,
    hard: `Mức KHÓ (sát TOPIK): Tự do dùng từ phù hợp chủ đề ${randomTopic}, có thể xuất hiện nhiều từ mới. Câu phức tạp, dài, đòi hỏi suy luận. (Từ tham khảo: ${allVocab})`
  };

  const exBox = document.getElementById('gpExercises');
  const diffLabels = { easy: '🟢 Dễ', medium: '🟡 Thường', hard: '🔴 Khó' };
  exBox.innerHTML = `<div class="gp-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang tạo bài tập ${diffLabels[diff]} (${randomTopic})...</span></div>`;

  const prompt = `Bạn là giáo viên tiếng Hàn. Hãy tạo 4 câu bài tập luyện cấu trúc ngữ pháp: "${g.title}"
${g.body ? `Giải thích ngữ pháp: ${g.body.slice(0, 200)}` : ''}

Chủ đề bài tập: ${randomTopic} (seed: ${randomSeed})

${diffInstructions[diff]}

4 bài tập: 2 câu Việt ➔ Hàn (type: vn2kr), 2 câu Hàn ➔ Việt (type: kr2vn). "hint" là gợi ý ngắn gọn về từ chìa khóa hoặc cấu trúc cần dùng. 
Đồng thời cung cấp "explanation" là lời giải thích chi tiết dễ hiểu bằng tiếng Việt về cách đặt câu, cách chia động từ và lý do áp dụng ngữ pháp này.

Trả lời CHÍNH XÁC định dạng JSON (không thêm bất kỳ text nào ngoài JSON):
{
  "exercises": [
    {"type":"vn2kr","prompt":"câu tiếng Việt","answer":"câu tiếng Hàn","hint":"gợi ý","explanation":"giải thích chi tiết đặt câu và cấu trúc"},
    {"type":"kr2vn","prompt":"câu tiếng Hàn","answer":"câu tiếng Việt","hint":"gợi ý","explanation":"giải thích chi tiết đặt câu và cấu trúc"}
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: diff === 'easy' ? 0.4 : diff === 'medium' ? 0.7 : 0.85 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const parsed = JSON.parse(match[0]);
    state.grammarPractice.exercises = parsed.exercises || [];
    state.grammarPractice.answers = {};
    state.grammarPractice.submitted = false;
    renderGrammarExercises();
    showToast(`✅ Đã tạo 4 bài tập ${diffLabels[diff]} mới!`, 'success');
    addXP(5);
  } catch(e) {
    exBox.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo bài tập: ${escapePracticeHtml(e.message)}</p></div>`;
    showToast('❌ Lỗi tạo bài tập. Thử lại!', 'error');
  }
}

async function startGrammarComprehensiveTest() {
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }
  const grammar = getActiveGrammar();
  if (grammar.length === 0) { showToast('⚠️ Chưa có ngữ pháp nào!', 'error'); return; }

  const overlay = document.getElementById('gpCompOverlay');
  const content = document.getElementById('gpCompContent');
  overlay.style.display = 'flex';
  content.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang tạo bài kiểm tra tổng hợp...</span></div>`;

  const words = getActiveWords();
  const vocab = shuffle([...words]).slice(0, 15).map(w => `${w.korean}(${w.meaning})`).join(', ');
  const grammarList = grammar.map(g => g.title).join(', ');

  const prompt = `Bạn là giáo viên tiếng Hàn. Hãy tạo bài kiểm tra ngữ pháp tổng hợp.
Các cấu trúc cần kiểm tra: ${grammarList}
Từ vựng đã học: ${vocab}

Yêu cầu:
Tạo ${Math.min(grammar.length * 2, 8)} câu hỏi (mỗi câu trúng vào ít nhất 1 cấu trúc ngữ pháp trong danh sách).
Dùng từ vựng đã học là chủ yếu để người học dễ làm.
Nếu có dùng từ mới ngoài danh sách, hãy ghi nghĩa của từ mới đó vào gợi ý (hint).
Đồng thời, thêm trường "explanation" giải thích ngắn gọn, dễ hiểu lý do dùng cấu trúc đó và cách biến đổi từ.

Trả lời CHÍNH XÁC định dạng JSON (không thêm text khác):
{
  "questions": [
    {"grammar":"tên cấu trúc","type":"vn2kr","prompt":"câu tiếng Việt","answer":"câu tiếng Hàn","hint":"gợi ý","explanation":"giải thích chi tiết đặt câu và ngữ pháp"},
    {"grammar":"tên cấu trúc","type":"kr2vn","prompt":"câu tiếng Hàn","answer":"dịch tiếng Việt","hint":"gợi ý","explanation":"giải thích chi tiết đặt câu và ngữ pháp"}
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.6, maxOutputTokens: 2500 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON error');
    const data = JSON.parse(match[0]);
    const qs = data.questions || [];
    window._compAnswers = {};
    window._compQuestions = qs;
    window._compSubmitted = false;
    renderCompTest(qs);
    showToast(`✅ Đề kiểm tra ${qs.length} câu đã sẵn sàng!`, 'success');
  } catch(e) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo đề: ${escapePracticeHtml(e.message)}
    <button class="btn btn-ai btn-sm" onclick="startGrammarComprehensiveTest()">🔄 Thử lại</button></p></div>`;
  }
}

function renderCompTest(qs) {
  const content = document.getElementById('gpCompContent');
  if (!content) return;
  const submitted = window._compSubmitted;
  const answers = window._compAnswers || {};

  const html = qs.map((q, i) => {
    const isVn2kr = q.type === 'vn2kr';
    const ans = answers[i] || '';
    const isOk = submitted && (ans.trim().toLowerCase() === q.answer.trim().toLowerCase());
    return `
      <div class="comp-q-item ${submitted ? (isOk?'comp-ok':'comp-err') : ''}" style="margin-bottom:15px; padding:15px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-input);">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="font-size:0.8rem; font-weight:700; color:var(--accent-light);">📐 ${q.grammar}</span>
          <span style="font-size:0.75rem; color:var(--text-muted);">${isVn2kr ? '🇻🇳 → 🇰🇷 Dịch sang tiếng Hàn' : '🇰🇷 → 🇻🇳 Dịch sang tiếng Việt'}</span>
        </div>
        <div style="font-size:1.05rem; font-weight:700; color:var(--text-primary); margin-bottom:6px; ${isVn2kr?'':'font-family:Noto Sans KR,sans-serif'}">${q.prompt}</div>
        <div style="font-size:0.8rem; color:var(--gold); margin-bottom:8px;">💡 ${q.hint}</div>
        <div style="display:flex; gap:8px;">
          <input type="text" class="ldial-q-input" id="compinput${i}" value="${ans.replace(/"/g,'&quot;')}" 
            placeholder="${isVn2kr?'Nhập tiếng Hàn...':'Nhập tiếng Việt...'}" ${submitted?'disabled':''}
            style="${isVn2kr?'font-family:Noto Sans KR,sans-serif':''}; flex:1;" />
          ${isVn2kr ? `<button class="mini-audio-btn" onclick="TTS.speak('${escStr(q.answer)}')">🔊</button>` : `<button class="mini-audio-btn" onclick="TTS.speak('${escStr(q.prompt)}')">🔊</button>`}
        </div>
        ${submitted ? `
          <div style="margin-top:10px; font-size:0.9rem; font-weight:600; color:${isOk?'var(--green)':'var(--red)'}">
            ${isOk ? '✅ Đúng rồi!' : `❌ Sai rồi. Đáp án đúng: <strong style="font-family:Noto Sans KR,sans-serif; color:var(--green);">${q.answer}</strong>`}
          </div>
          ${q.explanation ? `
            <div style="margin-top:8px; padding:10px; background:rgba(0,212,170,0.05); border-left:3px solid var(--teal); border-radius:var(--radius-sm); font-size:0.82rem; line-height:1.4; color:var(--text-muted);">
              🧑‍🏫 <strong>Giải thích:</strong> ${q.explanation}
            </div>
          ` : ''}
        ` : ''}
      </div>`;
  }).join('');

  const score = submitted ? qs.filter((q,i) => (answers[i]||'').trim().toLowerCase() === q.answer.trim().toLowerCase()).length : 0;
  const actions = submitted
    ? `<div style="margin: 15px 0; font-size:1.1rem; font-weight:700; text-align:center;">🏆 Kết quả: <span style="color:var(--accent-light);">${score}/${qs.length}</span> đúng — +${score*15} XP</div>
       <div class="ldial-actions"><button class="btn btn-ai" onclick="startGrammarComprehensiveTest()">🔄 Đề mới</button><button class="btn btn-ghost" onclick="closeGrammarCompTest()">Đóng</button></div>`
    : `<div class="ldial-actions"><button class="btn btn-primary" onclick="submitCompTest()">✅ Nộp bài</button><button class="btn btn-ghost" onclick="closeGrammarCompTest()">Hủy</button></div>`;

  content.innerHTML = `<div style="max-height: 60vh; overflow-y: auto; padding-right:5px;">${html}</div>${actions}`;
}

function submitCompTest() {
  const qs = window._compQuestions || [];
  qs.forEach((q,i) => {
    const inp = document.getElementById(`compinput${i}`);
    window._compAnswers[i] = inp ? inp.value.trim() : '';
  });
  window._compSubmitted = true;
  const score = qs.filter((q,i) => (window._compAnswers[i]||'').trim().toLowerCase() === q.answer.trim().toLowerCase()).length;
  addXP(score * 15);
  saveState();
  renderCompTest(qs);
  showToast(`🏆 ${score}/${qs.length} đúng! +${score*15} XP`, score>=qs.length*0.7?'success':'info', 3000);
}

function closeGrammarCompTest() {
  document.getElementById('gpCompOverlay').style.display = 'none';
}


function renderGrammarExercises() {
  const exs = state.grammarPractice.exercises;
  const submitted = state.grammarPractice.submitted;
  if (!exs.length) return;

  const html = exs.map((ex, i) => {
    const isVn2kr = ex.type === 'vn2kr';
    const ans = state.grammarPractice.answers[i] || '';
    const isCorrect = submitted && ans.trim() === ex.answer.trim();
    const safePrompt = escStr(ex.prompt);
    const safeAnswer = escStr(ex.answer);
    return `
      <div class="gp-exercise ${submitted ? (isCorrect ? 'gp-correct' : 'gp-wrong') : ''}">
        <div class="gp-ex-badge">${isVn2kr ? '🇻🇳 → 🇰🇷 Dịch sang tiếng Hàn' : '🇰🇷 → 🇻🇳 Dịch sang tiếng Việt'}</div>
        <div class="gp-ex-prompt">${ex.prompt}</div>
        ${(gpDifficulty !== 'easy' && ex.hint) ? `<div class="gp-ex-hint">💡 ${ex.hint}</div>` : ''}
        <div class="gp-ex-input-row">
          <input type="text" class="gp-ex-input ${submitted ? (isCorrect ? 'input-correct' : 'input-wrong') : ''}" 
            id="gpInput${i}" value="${ans.replace(/"/g,'&quot;')}" 
            placeholder="${isVn2kr ? 'Nhập tiếng Hàn...' : 'Nhập tiếng Việt...'}"
            ${submitted ? 'disabled' : ''}
            onkeydown="if(event.key==='Enter') checkGrammarExercise()"
          />
          <button class="mini-audio-btn" onclick="TTS.speak('${safePrompt}')" title="Nghe">🔊</button>
        </div>
        ${submitted ? `
          <div class="gp-ex-result ${isCorrect ? 'gp-result-ok' : 'gp-result-err'}">
            ${isCorrect ? '✅ Chính xác!' : `❌ Đáp án đúng: <strong>${ex.answer}</strong>`}
            ${isVn2kr ? `<button class="mini-audio-btn" onclick="TTS.speak('${safeAnswer}')" style="margin-left:8px">🔊</button>` : ''}
          </div>
          ${ex.explanation ? `
            <div class="gp-ex-explanation" style="margin-top: 10px; padding: 12px; background: rgba(108, 99, 255, 0.06); border-left: 3px solid var(--accent); border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary); text-align: left;">
              🧑‍🏫 <strong>Giải thích:</strong> ${ex.explanation}
            </div>
          ` : ''}
        ` : ''}
      </div>
    `;
  }).join('');

  const submitBtn = submitted ? `
    <button class="btn btn-ai" onclick="generateGrammarExercises()">🔄 Tạo bài mới</button>
    <button class="btn btn-ghost" onclick="resetGrammarPractice()">🔁 Làm lại bài này</button>
  ` : `
    <button class="btn btn-primary" onclick="checkGrammarExercise()">✅ Kiểm tra</button>
  `;

  document.getElementById('gpExercises').innerHTML = `
    <div class="gp-exercises-list">${html}</div>
    <div class="gp-ex-actions">${submitBtn}</div>
  `;
}

function checkGrammarExercise() {
  const exs = state.grammarPractice.exercises;
  if (!exs.length) return;
  // Collect all answers
  exs.forEach((_, i) => {
    const input = document.getElementById(`gpInput${i}`);
    if (input) state.grammarPractice.answers[i] = input.value;
  });
  state.grammarPractice.submitted = true;
  // Calculate score
  const correct = exs.filter((ex, i) =>
    (state.grammarPractice.answers[i] || '').trim() === ex.answer.trim()
  ).length;
  renderGrammarExercises();
  const pct = Math.round((correct / exs.length) * 100);
  showToast(`🎯 ${correct}/${exs.length} đúng (${pct}%) +${correct * 8} XP`, correct === exs.length ? 'success' : 'info', 3500);
  addXP(correct * 8);
  state.stats.totalAnswered += exs.length;
  state.stats.totalCorrect += correct;
  saveState();
}

function resetGrammarPractice() {
  state.grammarPractice.answers = {};
  state.grammarPractice.submitted = false;
  renderGrammarExercises();
}

// ============================================================
// ============ EXAM / LUYỆN ĐỀ MODULE ============
// ============================================================
function initExam() {
  document.getElementById('examSetup').style.display = 'block';
  document.getElementById('examRunning').style.display = 'none';
  document.getElementById('examResult').style.display = 'none';
  renderExamHistory();
}

function renderExamHistory() {
  const hist = state.stats.examHistory || [];
  const el = document.getElementById('examHistoryList');
  if (!hist.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">Chưa có lịch sử</p>';
    mountListPagination(el, 'examHistory', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('examHistory') }, 'lần thi');
    return;
  }
  const ordered = [...hist].reverse();
  const meta = paginateList('examHistory', ordered, renderExamHistory, 10);
  el.innerHTML = meta.pageItems.map(h => `
    <div class="exam-hist-item">
      <span class="exam-hist-type">${h.type}</span>
      <span class="exam-hist-score" style="color:${h.pct>=70?'var(--green)':'var(--orange)'}">${h.score}/${h.total} (${h.pct}%)</span>
      <span class="exam-hist-date">${h.date}</span>
    </div>`).join('');
  mountListPagination(el, 'examHistory', meta, 'lần thi');
}

async function startExam(type) {
  if (!state.words || state.words.length < 4) {
    state.words = [...DEFAULT_WORDS];
    saveState();
  }
  if (!state.grammar || state.grammar.length === 0) {
    state.grammar = [...DEFAULT_GRAMMAR];
    saveState();
  }
  if (type === 'ai' && !GEMINI.getKey()) {
    showToast('⚠️ AI chưa được Admin cấu hình cho chế độ AI!', 'error'); openSettings(); return;
  }

  state.exam.type = type;
  state.exam.answers = {};
  state.exam.current = 0;

  const labels = { vocab: '📚 Từ vựng', grammar: '📐 Ngữ pháp', mixed: '🎯 Tổng hợp', ai: '🤖 AI tạo đề' };
  document.getElementById('examTypeBadge').textContent = labels[type] || type;

  document.getElementById('examSetup').style.display = 'none';
  document.getElementById('examRunning').style.display = 'block';
  document.getElementById('examResult').style.display = 'none';

  if (type === 'ai') {
    document.getElementById('examBody').innerHTML = `<div class="gp-loading" style="padding:40px"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang tạo đề thi riêng...</span></div>`;
    await generateAIExam();
  } else {
    buildExamQuestions(type);
  }
  renderExamQuestion();
  startExamTimer();
}

function buildExamQuestions(type) {
  const qs = [];
  // Build a rich pool of words using state.words + default VOCAB_DB items
  const dictWords = Object.entries(VOCAB_DB).map(([k, v]) => ({
    korean: k,
    meaning: v.meaning,
    pos: v.pos || '명사',
    roman: v.roman || k,
    example: `${k}을/를 공부해요.`,
    exampleViet: `Tôi học ${v.meaning}.`
  }));
  const fullWordPool = [...state.words, ...dictWords];
  const shuffledWords = shuffle(fullWordPool);

  if (type === 'vocab' || type === 'mixed') {
    // MC: Korean → Vietnamese
    shuffledWords.slice(0, type === 'mixed' ? 8 : 12).forEach(w => {
      const wrong = getRandom(fullWordPool, 3, [w]).map(x => x.meaning);
      qs.push({ qtype: 'mc', direction: 'kr2vn', question: w.korean, hint: w.roman || '', correct: w.meaning, options: shuffle([w.meaning, ...wrong]) });
    });
    // MC: Vietnamese → Korean
    shuffledWords.slice(0, type === 'mixed' ? 5 : 10).forEach(w => {
      const wrong = getRandom(fullWordPool, 3, [w]).map(x => x.korean);
      qs.push({ qtype: 'mc', direction: 'vn2kr', question: w.meaning, hint: w.pos || '명사', correct: w.korean, options: shuffle([w.korean, ...wrong]) });
    });
  }
  
  if (type === 'grammar' || type === 'mixed') {
    // Fill-in using example sentences from vocabulary pool
    const exampleWords = shuffledWords.filter(w => w.example);
    exampleWords.slice(0, type === 'mixed' ? 5 : 10).forEach(w => {
      const blanked = w.example.includes(w.korean) ? w.example.replace(w.korean, '______') : `${w.example} (______ Focus)`;
      qs.push({ qtype: 'fill', question: blanked, hint: `(${w.meaning}) ${w.roman || ''}`, correct: w.korean, exampleViet: w.exampleViet || '' });
    });

    // Grammar structures from user's grammar list + default grammar
    const grammars = getActiveGrammar().length > 0 ? getActiveGrammar() : (state.grammar.length > 0 ? state.grammar : [
      { title: '-ㅂ니다/습니다', body: 'Đuôi câu trang trọng lịch sự' },
      { title: '-아/어/여요', body: 'Đuôi câu thân mật lịch sự' },
      { title: '은/는', body: 'Tiểu từ chủ đề' },
      { title: '이/가', body: 'Tiểu từ chủ ngữ' },
      { title: '을/를', body: 'Tiểu từ tân ngữ' }
    ]);

    grammars.forEach(g => {
      qs.push({
        qtype: 'fill',
        question: `Hãy hoàn thành câu sử dụng ngữ pháp "${g.title}":`,
        hint: g.body ? g.body.slice(0, 80) : 'Chọn/điền dạng đúng',
        correct: g.title,
        exampleViet: `Cấu trúc: ${g.title}`
      });
    });
  }

  if (type === 'mixed') {
    shuffledWords.slice(0, 5).forEach(w => {
      const wrong = getRandom(fullWordPool, 3, [w]).map(x => x.korean);
      qs.push({ qtype: 'audio', question: w.meaning, hint: w.pos || '명사', correct: w.korean, options: shuffle([w.korean, ...wrong]), listenWord: w.korean });
    });
  }

  const finalQs = shuffle(qs);
  state.exam.questions = finalQs.length > 0 ? finalQs.slice(0, type === 'vocab' ? 20 : type === 'grammar' ? 15 : 25) : [
    { qtype: 'mc', direction: 'kr2vn', question: '한국어', hint: 'han-guk-eo', correct: 'tiếng Hàn', options: ['tiếng Hàn', 'tiếng Nhật', 'tiếng Anh', 'tiếng Trung'] }
  ];
}

async function generateAIExam() {
  const activeW = getActiveWords();
  const activeG = getActiveGrammar();
  const vocabList = shuffle([...activeW]).slice(0, 15).map(w => `${w.korean}(${w.meaning})`).join(', ');
  const grammarList = activeG.slice(0, 5).map(g => g.title).join(', ');

  const prompt = `Bạn là giám khảo đề thi TOPIK tiếng Hàn (TOPIK I / TOPIK II). 
Hãy tạo đề thi thử TOPIK gồm 10 câu trắc nghiệm chuẩn format TOPIK thật cho người Việt.

Dựa trên từ vựng & ngữ pháp này:
${vocabList ? `- Từ vựng: ${vocabList}` : ''}
${grammarList ? `- Ngữ pháp: ${grammarList}` : ''}

CÁC DẠNG CÂU HỎI FORMAT TOPIK THẬT:
1. [TOPIK 읽기] 다음 ( )에 들어갈 가장 알맞은 것을 고르십시오. (Chọn từ/ngữ pháp điền vào chỗ trống)
2. [TOPIK 읽기] 밑줄 친 부분과 의미가 비슷한 것을 고르십시오. (Chọn đáp án gần nghĩa)
3. [TOPIK 읽기] 다음 글을 읽고 내용과 같은 것을 고르십시오. (Đọc đoạn văn ngắn 2-3 câu và chọn ý đúng)

Trả lời CHÍNH XÁC định dạng JSON (không thêm text ngoài JSON):
{
  "questions": [
    {
      "qtype": "mc",
      "direction": "kr2vn",
      "question": "[TOPIK 읽기] 다음 ( )에 들어갈 가장 알맞은 것을 고르십시오.\\n\\n오늘은 날씨가 좋아서 공원에 ( ).",
      "hint": "Chọn từ điền vào chỗ trống",
      "correct": "가요",
      "options": ["가요", "봐요", "마셔요", "자요"]
    }
  ]
}`;
  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.6, maxOutputTokens: 2500 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const parsed = JSON.parse(match[0]);
    if (!parsed.questions || !parsed.questions.length) throw new Error('Empty questions');
    state.exam.questions = parsed.questions;
    showToast(`✅ Đã tạo đề thi TOPIK chuẩn AI!`, 'success');
  } catch(e) {
    buildExamQuestions('vocab');
    showToast('⚠️ AI chưa phản hồi, đã khởi tạo bộ đề mặc định!', 'info');
  }
}

function renderExamQuestion() {
  const qs = state.exam.questions;
  const cur = state.exam.current;
  if (!qs.length) return;
  const q = qs[cur];
  const total = qs.length;

  document.getElementById('examQNum').textContent = `Câu ${cur + 1}/${total}`;
  document.getElementById('examProgressFill').style.width = `${((cur + 1) / total) * 100}%`;

  // Dots nav
  document.getElementById('examDots').innerHTML = qs.map((_, i) => {
    const ans = state.exam.answers[i];
    let cls = 'exam-dot';
    if (i === cur) cls += ' exam-dot-active';
    else if (ans !== undefined) cls += ' exam-dot-answered';
    return `<button class="${cls}" onclick="examNav(${i - cur})">${i + 1}</button>`;
  }).join('');

  document.getElementById('examPrevBtn').disabled = cur === 0;
  document.getElementById('examNextBtn').textContent = cur === total - 1 ? '🏁 Nộp bài' : 'Tiếp →';

  let bodyHTML = '';
  if (q.qtype === 'mc' || q.qtype === 'audio') {
    const isKr = q.direction !== 'vn2kr';
    bodyHTML = `
      <div class="exam-q-card">
        <div class="exam-q-badge">${q.qtype === 'audio' ? '🔊 Nghe & chọn đáp án' : isKr ? '🇰🇷 → 🇻🇳 Chọn nghĩa tiếng Việt' : '🇻🇳 → 🇰🇷 Chọn từ tiếng Hàn'}</div>
        <div class="exam-q-text" style="${isKr ? 'font-family:\'Noto Sans KR\',sans-serif;font-size:2rem;font-weight:900' : 'font-size:1.4rem;font-weight:700'}">${q.question}</div>
        ${q.hint ? `<div class="exam-q-hint">${q.hint}</div>` : ''}
        ${q.qtype === 'audio' && q.listenWord ? `<button class="btn btn-ghost btn-sm" onclick="TTS.speak('${escStr(q.listenWord)}')">🔊 Nghe từ</button>` : ''}
        <div class="exam-options">
          ${(q.options || []).map(opt => `
            <button class="exam-option ${state.exam.answers[cur] === opt ? 'exam-opt-selected' : ''}" onclick="selectExamAnswer('${escStr(opt)}')">${opt}</button>
          `).join('')}
        </div>
      </div>
    `;
  } else if (q.qtype === 'fill') {
    bodyHTML = `
      <div class="exam-q-card">
        <div class="exam-q-badge">✏️ Điền từ tiếng Hàn vào chỗ trống</div>
        <div class="exam-q-text" style="font-family:'Noto Sans KR',sans-serif;font-size:1.2rem;font-weight:600;line-height:1.8">${q.question}</div>
        ${q.exampleViet ? `<div class="exam-q-hint">📌 ${q.exampleViet}</div>` : ''}
        ${q.hint ? `<div class="exam-q-hint">💡 ${q.hint}</div>` : ''}
        <input type="text" class="fill-input" id="examFillInput" value="${(state.exam.answers[cur] || '').replace(/"/g,'&quot;')}" 
          placeholder="Nhập từ tiếng Hàn..." 
          oninput="state.exam.answers[${cur}]=this.value"
          onkeydown="if(event.key==='Enter') examNav(1)"
          style="font-family:'Noto Sans KR',sans-serif;font-size:1.2rem;margin-top:16px;max-width:340px"
        />
      </div>
    `;
  }
  document.getElementById('examBody').innerHTML = bodyHTML;
  // Focus fill input
  const fi = document.getElementById('examFillInput');
  if (fi) setTimeout(() => fi.focus(), 100);
}

function selectExamAnswer(opt) {
  state.exam.answers[state.exam.current] = opt;
  renderExamQuestion();
}

function examNav(delta) {
  const total = state.exam.questions.length;
  const next = state.exam.current + delta;
  if (next >= total) { endExam(); return; }
  if (next < 0) return;
  state.exam.current = next;
  renderExamQuestion();
}

function startExamTimer() {
  state.exam.startTime = Date.now();
  clearInterval(state.exam.timerInterval);
  state.exam.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.exam.startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const el = document.getElementById('examTimer');
    if (el) el.textContent = `⏱ ${m}:${s}`;
  }, 1000);
}

function endExam() {
  clearInterval(state.exam.timerInterval);
  const qs = state.exam.questions;
  if (!qs.length) return;

  let correct = 0;
  const review = [];
  qs.forEach((q, i) => {
    const userAns = (state.exam.answers[i] || '').trim();
    const isOk = userAns === q.correct.trim();
    if (isOk) correct++;
    review.push({ q, userAns, isOk });
  });
  const pct = Math.round((correct / qs.length) * 100);
  const elapsed = Math.floor((Date.now() - state.exam.startTime) / 1000);

  // Save history
  if (!state.stats.examHistory) state.stats.examHistory = [];
  const labels = { vocab: '📚 Từ vựng', grammar: '📐 Ngữ pháp', mixed: '🎯 Tổng hợp', ai: '🤖 AI' };
  state.stats.examHistory.push({ type: labels[state.exam.type] || state.exam.type, score: correct, total: qs.length, pct, date: new Date().toLocaleDateString('vi') });
  addXP(Math.round(pct * 0.5));
  saveState();

  // Show result
  document.getElementById('examRunning').style.display = 'none';
  document.getElementById('examResult').style.display = 'flex';
  const [emoji, title] = pct >= 90 ? ['🏆', 'Xuất sắc!'] : pct >= 70 ? ['🎉', 'Tốt lắm!'] : pct >= 50 ? ['😊', 'Khá ổn!'] : ['📖', 'Cần luyện thêm!'];
  document.getElementById('examResultEmoji').textContent = emoji;
  document.getElementById('examResultTitle').textContent = title;
  document.getElementById('examResultScore').textContent = `${correct}/${qs.length} (${pct}%)`;
  document.getElementById('examResultStats').innerHTML = `<span>⏱ ${Math.floor(elapsed/60)}p${elapsed%60}s</span> · <span>+${Math.round(pct*0.5)} XP</span>`;

  // Review section
  document.getElementById('examReview').innerHTML = `
    <h4 style="margin:16px 0 10px;color:var(--text-secondary);font-size:.9rem">📋 Xem lại bài làm:</h4>
    ${review.map((r, i) => `
      <div class="exam-review-item ${r.isOk ? 'review-ok' : 'review-err'}">
        <span class="review-num">${i+1}</span>
        <div class="review-content">
          <div class="review-q">${r.q.question}</div>
          ${r.isOk ? `<div class="review-a ok">✅ ${r.userAns || '(bỏ qua)'}</div>` : `
            <div class="review-a err">❌ Bạn: ${r.userAns || '(bỏ qua)'}</div>
            <div class="review-a ok">✅ Đúng: ${r.q.correct}</div>
          `}
        </div>
      </div>
    `).join('')}
  `;
}

function resetExam() {
  clearInterval(state.exam.timerInterval);
  state.exam = { type: '', questions: [], current: 0, answers: {}, startTime: 0, timerInterval: null };
  initExam();
}

// ============================================================
// ============================================================
// ============ DICTIONARY MODULE ============
// ============================================================
let dictViewMode = localStorage.getItem('hq_dict_view_mode') || 'cols3';
function setDictViewMode(mode, btn) {
  dictViewMode = mode;
  localStorage.setItem('hq_dict_view_mode', mode);
  document.querySelectorAll('.dict-view-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = btn || document.getElementById(`dview-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');
  renderFullDictionaryList();
}

function populateDictLessonFilter() {
  const select = document.getElementById('dictLessonFilter');
  if (!select) return;
  const currentVal = select.value || 'all';
  const lessons = (state.lessons && state.lessons.length > 0) ? state.lessons : ['Bài 1', 'Bài 2', 'Bài 3', 'Bài 4', 'Bài 5'];
  
  select.innerHTML = `
    <option value="all">Tất cả bài học</option>
    ${lessons.map(l => `<option value="${l}">${l}</option>`).join('')}
    <option value="Từ điển hệ thống">Từ điển hệ thống</option>
  `;
  if (Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function initDictionary() {
  const input = document.getElementById('dictInput');
  if (input) {
    input.onkeydown = e => { if (e.key === 'Enter') dictSearch(); };
  }
  populateDictLessonFilter();
  setDictViewMode(dictViewMode);
  switchDictTab('allwords');
  renderDictMyWords();
  renderDictHistory();
}

function switchDictTab(tab) {
  const tabs = ['allwords', 'result', 'mywords', 'history', 'conjugate'];
  tabs.forEach(t => {
    const btn = document.getElementById(`dtab-${t}`);
    const content = document.getElementById(`dictTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (content) content.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'allwords') {
    populateDictLessonFilter();
    renderFullDictionaryList();
  }
  if (tab === 'mywords') renderDictMyWords();
  if (tab === 'history') renderDictHistory();
}

function getAllDictionaryWords() {
  const wordMap = new Map();

  // 1. Add state.words (User's active/learned words)
  (state.words || []).forEach(w => {
    if (w && w.korean) {
      wordMap.set(w.korean, {
        korean: w.korean,
        roman: w.roman || w.korean,
        meaning: w.meaning || 'Chưa có nghĩa',
        pos: w.pos || '명사',
        tip: w.tip || '',
        example: w.example || '',
        exampleViet: w.exampleViet || '',
        lesson: w.lesson || 'Bài 1',
        isUserWord: true,
        isSaved: (state.dict && state.dict.savedWords) ? state.dict.savedWords.includes(w.korean) : false
      });
    }
  });

  // 2. Add VOCAB_DB items if not already added
  Object.entries(VOCAB_DB).forEach(([korean, v]) => {
    if (!wordMap.has(korean)) {
      wordMap.set(korean, {
        korean: korean,
        roman: v.roman || korean,
        meaning: v.meaning || 'Chưa có nghĩa',
        pos: v.pos || '명사',
        tip: v.tip || '',
        example: v.example || '',
        exampleViet: v.exampleViet || '',
        lesson: 'Từ điển hệ thống',
        isUserWord: false,
        isSaved: (state.dict && state.dict.savedWords) ? state.dict.savedWords.includes(korean) : false
      });
    }
  });

  // 3. Add any additional saved dictionary words
  if (state.dict && state.dict.savedWords) {
    state.dict.savedWords.forEach(korean => {
      if (!wordMap.has(korean)) {
        wordMap.set(korean, {
          korean: korean,
          roman: korean,
          meaning: 'Từ đã lưu',
          pos: '명사',
          tip: '',
          example: '',
          exampleViet: '',
          lesson: 'Từ đã lưu',
          isUserWord: false,
          isSaved: true
        });
      }
    });
  }

  return Array.from(wordMap.values());
}

function handleDictFilterChange() {
  resetListPagination('dictAll');
  const allwordsTab = document.getElementById('dtab-allwords');
  if (allwordsTab && allwordsTab.classList.contains('active')) {
    renderFullDictionaryList();
  }
}

function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const items = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) items.push('ellipsis-left');
  for (let page = start; page <= end; page++) items.push(page);
  if (end < totalPages - 1) items.push('ellipsis-right');
  items.push(totalPages);
  return items;
}

function renderFullDictionaryList() {
  const container = document.getElementById('dictAllwordsList');
  const countBadge = document.getElementById('dictCountBadge');
  if (!container) return;

  container.className = `dict-list-container view-${dictViewMode}`;

  const allWords = getAllDictionaryWords();

  const searchInput = (document.getElementById('dictInput')?.value || '').trim().toLowerCase();
  const lessonFilter = document.getElementById('dictLessonFilter')?.value || 'all';
  const posFilter = document.getElementById('dictPosFilter')?.value || 'all';
  const sourceFilter = document.getElementById('dictSourceFilter')?.value || 'all';
  const sortFilter = document.getElementById('dictSortFilter')?.value || 'kr-asc';

  let filtered = allWords.filter(w => {
    // 1. Text filter (Korean, Romanization, Meaning)
    if (searchInput) {
      const matchKr = w.korean.toLowerCase().includes(searchInput);
      const matchRoman = (w.roman || '').toLowerCase().includes(searchInput);
      const matchMeaning = (w.meaning || '').toLowerCase().includes(searchInput);
      if (!matchKr && !matchRoman && !matchMeaning) return false;
    }

    // 2. Lesson filter
    if (lessonFilter !== 'all') {
      if ((w.lesson || 'Bài 1') !== lessonFilter) return false;
    }

    // 3. POS filter
    if (posFilter !== 'all') {
      if ((w.pos || '') !== posFilter) return false;
    }

    // 4. Source filter
    if (sourceFilter === 'mywords' && !w.isUserWord) return false;
    if (sourceFilter === 'saved' && !w.isSaved) return false;

    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sortFilter === 'kr-asc') return a.korean.localeCompare(b.korean, 'ko');
    if (sortFilter === 'vi-asc') return (a.meaning || '').localeCompare(b.meaning || '', 'vi');
    if (sortFilter === 'roman-asc') return (a.roman || '').localeCompare(b.roman || '');
    return 0;
  });

  const totalFiltered = filtered.length;

  if (countBadge) {
    countBadge.textContent = totalFiltered !== allWords.length
      ? `Hiển thị: ${totalFiltered} / ${allWords.length} từ`
      : `Hiển thị: ${totalFiltered} từ`;
  }

  if (totalFiltered === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🔍</div>
        <p>Không tìm thấy từ vựng nào khớp với bộ lọc đã chọn.</p>
      </div>
    `;
    mountListPagination(container, 'dictAll', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('dictAll') }, 'từ');
    return;
  }

  const dictMeta = paginateList('dictAll', filtered, renderFullDictionaryList, 30);
  container.innerHTML = dictMeta.pageItems.map(w => {
    const safeKr = escStr(w.korean);

    if (dictViewMode === 'cols5') {
      return `
        <div class="dict-word-card cols5-card">
          <div class="dw-top">
            <span class="dw-korean font-kr">${w.korean}</span>
            <button class="mini-audio-btn" onclick="TTS.speak('${safeKr}')" title="Nghe phát âm">🔊</button>
          </div>
          <div class="dw-roman">[ ${w.roman || w.korean} ]</div>
          <div class="dw-meaning">🇻🇳 ${w.meaning}</div>
          <div class="dw-footer-compact">
            <span class="dict-pos-badge" style="font-size:0.7rem; padding:1px 6px">${w.pos || '명사'}</span>
            <div style="display:flex; gap:4px; align-items:center;">
              <button class="mini-audio-btn" onclick="quickDictDetail('${safeKr}')" title="Xem chi tiết">🔍</button>
              ${!w.isSaved 
                ? `<button class="mini-audio-btn" onclick="saveDictWord('${safeKr}')" title="Lưu từ">⭐</button>` 
                : `<button class="mini-audio-btn" onclick="removeSavedWord('${safeKr}')" style="color:var(--gold)" title="Bỏ lưu">★</button>`
              }
              ${!w.isUserWord 
                ? `<button class="mini-audio-btn" onclick="addDictWordToMyList('${safeKr}')" title="Thêm vào bài học">➕</button>`
                : `<span style="font-size:0.75rem; color:var(--green)">✓</span>`
              }
            </div>
          </div>
        </div>
      `;
    }

    if (dictViewMode === 'cols3') {
      return `
        <div class="dict-word-card cols3-card">
          <div class="dw-top">
            <div class="dw-main">
              <span class="dw-korean font-kr">${w.korean}</span>
              <span class="dict-pos-badge">${w.pos || '명사'}</span>
            </div>
            <button class="mini-audio-btn" onclick="TTS.speak('${safeKr}')" title="Nghe phát âm">🔊</button>
          </div>
          <div class="dw-roman">[ ${w.roman || w.korean} ]</div>
          <div class="dw-meaning">🇻🇳 <strong>Nghĩa:</strong> ${w.meaning}</div>
          ${w.example ? `<div class="dw-example-compact font-kr" title="${escStr(w.example)}">📌 ${w.example}</div>` : ''}
          <div class="dw-footer-row">
            <span class="dw-lesson-tag">${w.lesson || 'Bài 1'}</span>
            <div class="dw-actions">
              <button class="btn btn-ghost btn-sm" onclick="quickDictDetail('${safeKr}')" title="Xem chi tiết">🔍 Chi tiết</button>
              ${!w.isSaved 
                ? `<button class="btn btn-ghost btn-sm" onclick="saveDictWord('${safeKr}')">⭐</button>` 
                : `<button class="btn btn-ghost btn-sm" onclick="removeSavedWord('${safeKr}')" style="color:var(--gold)">★</button>`
              }
              ${!w.isUserWord 
                ? `<button class="btn btn-primary btn-sm" onclick="addDictWordToMyList('${safeKr}')">➕</button>`
                : `<span class="dict-in-list">✅</span>`
              }
            </div>
          </div>
        </div>
      `;
    }

    // Default: cols1 (Full detail row card)
    return `
      <div class="dict-word-card cols1-card">
        <div class="dw-top">
          <div class="dw-main">
            <span class="dw-korean font-kr">${w.korean}</span>
            <span class="dw-roman">[ ${w.roman || w.korean} ]</span>
            <span class="dict-pos-badge">${w.pos || '명사'}</span>
          </div>
          <span class="dw-lesson-tag">${w.lesson || 'Bài 1'}</span>
        </div>
        <div class="dw-meaning">🇻🇳 <strong>Nghĩa:</strong> ${w.meaning}</div>
        ${w.example ? `
          <div class="dw-example font-kr">
            📌 <strong>Ví dụ:</strong> ${w.example}
            ${w.exampleViet ? `<div class="dw-example-vi">${w.exampleViet}</div>` : ''}
          </div>
        ` : ''}
        ${w.tip ? `<div class="dict-tip" style="margin-top:4px; font-size:0.8rem">💡 ${w.tip}</div>` : ''}
        <div class="dw-actions">
          <button class="mini-audio-btn" onclick="TTS.speak('${safeKr}')" title="Nghe phát âm">🔊 Nghe phát âm</button>
          <button class="btn btn-ghost btn-sm" onclick="quickDictDetail('${safeKr}')" title="Xem phân tích chi tiết AI">🔍 Tra chi tiết AI</button>
          ${!w.isSaved 
            ? `<button class="btn btn-ghost btn-sm" onclick="saveDictWord('${safeKr}')">⭐ Lưu vào từ điển</button>` 
            : `<button class="btn btn-ghost btn-sm" onclick="removeSavedWord('${safeKr}')" style="color:var(--gold)">★ Đã lưu</button>`
          }
          ${!w.isUserWord 
            ? `<button class="btn btn-primary btn-sm" onclick="addDictWordToMyList('${safeKr}')">➕ Thêm vào bài học</button>`
            : `<span class="dict-in-list">✅ Đã có trong bài học</span>`
          }
        </div>
      </div>
    `;
  }).join('');
  mountListPagination(container, 'dictAll', dictMeta, 'từ');
}

function quickDictDetail(korean) {
  const input = document.getElementById('dictInput');
  if (input) input.value = korean;
  dictSearch();
}

async function dictSearch() {
  const q = document.getElementById('dictInput').value.trim();
  if (!q) return;
  const result = document.getElementById('dictResult');
  switchDictTab('result');

  // Check local vocabulary first
  const localWord = state.words.find(w => w.korean === q || w.meaning.toLowerCase().includes(q.toLowerCase()));
  const dbWord = VOCAB_DB[q];
  const foundWord = localWord || (dbWord ? { korean: q, ...dbWord } : null);

  // Add to history
  if (!state.dict) state.dict = { history: [], savedWords: [] };
  if (!state.dict.history.includes(q)) state.dict.history.unshift(q);
  if (state.dict.history.length > 30) state.dict.history.pop();

  if (foundWord) {
    result.innerHTML = renderDictCard(foundWord, true);
    TTS.speak(foundWord.korean);
  } else if (GEMINI.getKey()) {
    result.innerHTML = `<div class="gp-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 Đang tra từ điển AI...</span></div>`;
    try {
      let aiData;
      // Detect if Korean or Vietnamese input
      const isKorean = /[가-힣]/.test(q);
      if (isKorean) {
        aiData = await GEMINI.generateVocab(q);
        aiData.korean = q;
      } else {
        const prompt = `Từ tiếng Việt: "${q}". Cho biết từ tiếng Hàn tương đương và thông tin học tập. Trả lời JSON:
{"korean":"từ tiếng Hàn","roman":"phiên âm","meaning":"${q}","pos":"từ loại Hàn","tip":"mẹo nhớ","example":"câu ví dụ Hàn","exampleViet":"câu ví dụ Việt"}`;
        const raw = await GEMINI.call(prompt, '', { temperature: 0.4 });
        const match = raw.match(/\{[\s\S]*\}/);
        aiData = match ? JSON.parse(match[0]) : null;
      }
      if (aiData) {
        result.innerHTML = renderDictCard(aiData, false);
        if (aiData.korean) TTS.speak(aiData.korean);
      } else throw new Error('Không tìm thấy');
    } catch(e) {
      result.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Không tìm thấy "${escapePracticeHtml(q)}" trong kho từ. AI hệ thống tạm chưa sẵn sàng để tra thêm.</p></div>`;
    }
  } else {
    result.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Không tìm thấy trong kho từ. AI hệ thống tạm chưa sẵn sàng để tra thêm.</p></div>`;
  }
}

function renderDictCard(w, isLocal) {
  const inMyList = state.words.some(x => x.korean === w.korean);
  const safeKr = escStr(w.korean || '');
  const safeEx = escStr(w.example || '');
  return `
    <div class="dict-card">
      <div class="dict-card-top">
        <div>
          <div class="dict-word" style="font-family:'Noto Sans KR',sans-serif">${w.korean || ''}</div>
          <div class="dict-roman">${w.roman || ''}</div>
        </div>
        <div class="dict-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="TTS.speak('${safeKr}')" title="Nghe">🔊 Nghe</button>
          ${!inMyList ? `<button class="btn btn-primary btn-sm" onclick="addDictWordToMyList('${safeKr}')" title="Thêm vào từ vựng">➕ Thêm</button>` : `<span class="dict-in-list">✅ Đã có</span>`}
          ${!state.dict.savedWords.includes(w.korean) ? `<button class="btn btn-ai btn-sm" onclick="saveDictWord('${safeKr}')">⭐ Lưu</button>` : `<button class="btn btn-ghost btn-sm" onclick="removeSavedWord('${safeKr}')" style="color:var(--gold)">★ Đã lưu</button>`}
        </div>
      </div>
      <div class="dict-pos-badge">${w.pos || ''}</div>
      <div class="dict-meaning">${w.meaning || ''}</div>
      ${w.example ? `
        <div class="dict-example-block">
          <div class="dict-example-label">Ví dụ <button class="mini-audio-btn" onclick="TTS.speak('${safeEx}')" title="Nghe ví dụ">🔊</button></div>
          <div class="dict-example-kr" style="font-family:'Noto Sans KR',sans-serif">${w.example}</div>
          <div class="dict-example-vt">${w.exampleViet || ''}</div>
        </div>` : ''}
      ${w.tip ? `<div class="dict-tip">💡 ${w.tip}</div>` : ''}
      ${isLocal ? '<div class="dict-source-badge">📚 Từ vựng của bạn</div>' : '<div class="dict-source-badge ai-badge-dict">🤖 AI tra từ điển</div>'}
    </div>
  `;
}

function addDictWordToMyList(korean) {
  const dbData = VOCAB_DB[korean];
  const data = dbData ? { korean, ...dbData } : { korean, roman: korean, meaning: '(chưa có nghĩa)', pos: '명사', tip: '', example: '', exampleViet: '' };
  if (!state.words.find(w => w.korean === korean)) {
    state.words.push(data);
    renderWordChips();
    saveState();
    showToast(`✅ Đã thêm "${korean}" vào bài học của bạn!`, 'success');
  } else {
    showToast('ℹ️ Từ đã có trong danh sách bài học!', 'info');
  }
  handleDictFilterChange(false);
}

function saveDictWord(korean) {
  if (!state.dict.savedWords) state.dict.savedWords = [];
  if (!state.dict.savedWords.includes(korean)) {
    state.dict.savedWords.push(korean);
    saveState();
    showToast(`⭐ Đã lưu "${korean}"!`, 'success');
    renderDictMyWords();
    handleDictFilterChange(false);
  }
}
function removeSavedWord(korean) {
  if (!state.dict.savedWords) state.dict.savedWords = [];
  state.dict.savedWords = state.dict.savedWords.filter(w => w !== korean);
  saveState();
  showToast(`Đã bỏ lưu "${korean}"`, 'info');
  renderDictMyWords();
  handleDictFilterChange(false);
}

function renderDictMyWords() {
  const el = document.getElementById('dictMywords');
  if (!el) return;
  const saved = (state.dict && state.dict.savedWords) || [];
  if (!saved.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><p>Chưa lưu từ nào. Tra từ và nhấn ⭐ để lưu.</p></div>';
    mountListPagination(el, 'dictSaved', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('dictSaved') }, 'từ');
    return;
  }
  const meta = paginateList('dictSaved', saved, renderDictMyWords, 20);
  el.innerHTML = meta.pageItems.map(k => {
    const w = state.words.find(x => x.korean === k) || VOCAB_DB[k] || {};
    const safeK = escStr(k);
    return `<div class="dict-saved-item">
      <div style="font-family:'Noto Sans KR',sans-serif;font-weight:800;font-size:1.1rem;color:var(--accent-light)">${k}</div>
      <div style="font-size:.82rem;color:var(--text-secondary)">${w.meaning || ''}</div>
      <div class="dict-saved-actions">
        <button class="mini-audio-btn" onclick="TTS.speak('${safeK}')">🔊</button>
        <button class="mini-audio-btn" onclick="removeSavedWord('${safeK}')">🗑</button>
      </div>
    </div>`;
  }).join('');
  mountListPagination(el, 'dictSaved', meta, 'từ');
}

function renderDictHistory() {
  const el = document.getElementById('dictHistoryList');
  if (!el) return;
  const hist = (state.dict && state.dict.history) || [];
  if (!hist.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🕐</div><p>Chưa có lịch sử tra từ</p></div>';
    mountListPagination(el, 'dictHistory', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('dictHistory') }, 'lượt tra');
    return;
  }
  const meta = paginateList('dictHistory', hist, renderDictHistory, 20);
  el.innerHTML = meta.pageItems.map((k, pageIndex) => {
    const safeK = escStr(k);
    const originalIndex = meta.start + pageIndex;
    return `<button class="dict-hist-item" onclick="document.getElementById('dictInput').value='${safeK}';dictSearch();switchDictTab('result')">
      <span style="font-family:'Noto Sans KR',sans-serif;font-weight:700">${k}</span>
      <span style="color:var(--text-muted);font-size:.75rem">${originalIndex === 0 ? 'Vừa tra' : ''}</span>
    </button>`;
  }).join('');
  mountListPagination(el, 'dictHistory', meta, 'lượt tra');
}

async function dictAIAnalyze() {
  const q = document.getElementById('dictInput').value.trim();
  if (!q) { showToast('⚠️ Nhập từ trước!', 'error'); return; }
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }
  switchDictTab('result');
  const result = document.getElementById('dictResult');
  result.innerHTML = `<div class="gp-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang phân tích chi tiết...</span></div>`;

  const prompt = `Bạn là chuyên gia tiếng Hàn. Phân tích chi tiết từ/cụm từ tiếng Hàn: "${q}" cho người Việt học tiếng Hàn.
Bao gồm:
1. 📖 Nghĩa đầy đủ (các nghĩa khác nhau nếu có)
2. 🔤 Gốc từ / Hanja (nếu có)
3. 📝 Cách dùng trong câu (3 ví dụ đa dạng, có dịch)
4. 🔗 Từ liên quan / phái sinh
5. ⚠️ Lỗi người Việt hay gặp
6. 💡 Mẹo ghi nhớ vui
Viết bằng tiếng Việt, trình bày rõ ràng với emoji.`;

  try {
    const analysis = await GEMINI.call(prompt, '', { temperature: 0.6, maxOutputTokens: 1500 });
    const safeQ = escStr(q);
    result.innerHTML = `
      <div class="dict-ai-analysis">
        <div class="dict-ai-header">🤖 Phân tích AI: <span style="font-family:'Noto Sans KR',sans-serif;color:var(--accent-light)">${q}</span></div>
        <div class="dict-ai-body">${analysis.replace(/\n/g, '<br>').replace(/([가-힣]+)/g, '<span style="font-family:Noto Sans KR,sans-serif;font-weight:700;color:var(--teal)">$1</span>')}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="TTS.speak('${safeQ}')">🔊 Nghe phát âm</button>
      </div>
    `;
    state.stats.aiMessages++;
    addXP(3);
    saveState();
  } catch(e) {
    result.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi: ${escapePracticeHtml(e.message)}</p></div>`;
  }
}

async function dictConjugate() {
  const verb = document.getElementById('conjInput').value.trim();
  if (!verb) { showToast('⚠️ Nhập động từ!', 'error'); return; }
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }

  const el = document.getElementById('conjResult');
  el.innerHTML = `<div class="gp-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>Đang tạo biến thể...</span></div>`;

  const prompt = `Bạn là giáo viên tiếng Hàn. Cho động từ/tính từ tiếng Hàn: "${verb}"
Hãy liệt kê các dạng biến thể quan trọng nhất theo bảng JSON:
{
  "base": "dạng từ điển",
  "forms": [
    {"label":"Hiện tại lịch sự (해요체)","form":"...","example":"...","exViet":"..."},
    {"label":"Quá khứ lịch sự","form":"...","example":"...","exViet":"..."},
    {"label":"Tương lai/dự đoán","form":"...","example":"...","exViet":"..."},
    {"label":"Phủ định lịch sự","form":"...","example":"...","exViet":"..."},
    {"label":"Mệnh lệnh lịch sự","form":"...","example":"...","exViet":"..."},
    {"label":"Đề nghị cùng làm","form":"...","example":"...","exViet":"..."}
  ]
}
Chỉ trả JSON.`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.3, maxOutputTokens: 1500 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const data = JSON.parse(match[0]);
    el.innerHTML = `
      <div class="conj-card">
        <div class="conj-header">🔄 Biến thể của <span style="font-family:'Noto Sans KR',sans-serif;font-size:1.3rem;font-weight:900;color:var(--accent-light)">${data.base || verb}</span></div>
        <div class="conj-grid">
          ${(data.forms || []).map(f => {
            const safeForm = escStr(f.form || '');
            return `
              <div class="conj-item">
                <div class="conj-label">${f.label}</div>
                <div class="conj-form" style="font-family:'Noto Sans KR',sans-serif">${f.form} <button class="mini-audio-btn" onclick="TTS.speak('${safeForm}')" title="Nghe">🔊</button></div>
                <div class="conj-ex" style="font-family:'Noto Sans KR',sans-serif">${f.example || ''}</div>
                <div class="conj-ex-vt">${f.exViet || ''}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    state.stats.aiMessages++;
    addXP(3);
    saveState();
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi: ${escapePracticeHtml(e.message)}. Thử lại!</p></div>`;
  }
}

// ============ TRANSLATE MODULE ============
function initTranslate() {
  document.getElementById('translateInput').focus();
}

function updateTranslateCharCount() {
  const input = document.getElementById('translateInput').value;
  const count = document.getElementById('translateCharCount');
  if (input.length > 1000) {
    document.getElementById('translateInput').value = input.substring(0, 1000);
  }
  count.textContent = `${Math.min(input.length, 1000)} / 1000`;
}

function clearTranslateInput() {
  document.getElementById('translateInput').value = '';
  updateTranslateCharCount();
  document.getElementById('translateResultCard').style.display = 'none';
}

function swapTranslateLanguages() {
  const src = document.getElementById('translateSrcLang');
  const dest = document.getElementById('translateDestLang');
  const temp = src.value;
  src.value = dest.value;
  dest.value = temp;
  updateTranslatePlaceholders();
}

function handleSrcLangChange() {
  const src = document.getElementById('translateSrcLang').value;
  const dest = document.getElementById('translateDestLang');
  dest.value = src === 'ko' ? 'vi' : 'ko';
  updateTranslatePlaceholders();
}

function handleDestLangChange() {
  const dest = document.getElementById('translateDestLang').value;
  const src = document.getElementById('translateSrcLang');
  src.value = dest === 'ko' ? 'vi' : 'ko';
  updateTranslatePlaceholders();
}

function updateTranslatePlaceholders() {
  const src = document.getElementById('translateSrcLang').value;
  const input = document.getElementById('translateInput');
  if (src === 'ko') {
    input.placeholder = "Nhập văn bản tiếng Hàn cần dịch...";
  } else {
    input.placeholder = "Nhập văn bản tiếng Việt cần dịch...";
  }
}

let lastSrcText = "";
let lastDestText = "";
let lastSrcLang = "ko";
let lastDestLang = "vi";

async function runTranslateAI() {
  const text = document.getElementById('translateInput').value.trim();
  if (!text) { showToast('Vui lòng nhập văn bản cần dịch!', 'error'); return; }
  if (!GEMINI.getKey()) { showToast('AI chưa được Admin cấu hình!', 'error'); return; }

  const srcLang = document.getElementById('translateSrcLang').value;
  const destLang = document.getElementById('translateDestLang').value;

  const resultCard = document.getElementById('translateResultCard');
  resultCard.style.display = 'block';

  const resultText = document.getElementById('translateResultText');
  const romanText = document.getElementById('translateRomanText');
  const breakdown = document.getElementById('translateBreakdown');
  
  resultText.innerHTML = `<div class="gp-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>AI đang dịch và phân tích câu...</span></div>`;
  romanText.style.display = 'none';
  document.getElementById('translateBreakdownSec').style.display = 'none';

  const direction = srcLang === 'ko' ? 'tiếng Hàn sang tiếng Việt' : 'tiếng Việt sang tiếng Hàn';

  const prompt = `Bạn là chuyên gia ngôn ngữ và giáo viên tiếng Hàn xuất sắc. 
Hãy dịch đoạn văn bản sau từ ${direction}:
"${text}"

Yêu cầu:
1. Dịch nghĩa tự nhiên, mượt mà, chính xác ngữ cảnh.
2. Nếu dịch từ tiếng Hàn sang tiếng Việt, cung cấp phiên âm Romanization của câu gốc tiếng Hàn.
3. Nếu dịch từ tiếng Việt sang tiếng Hàn, cung cấp phiên âm Romanization của câu kết quả tiếng Hàn.
4. Liệt kê các từ vựng nổi bật (động từ, danh từ, tính từ...) trong câu (bao gồm nghĩa, giải thích ngắn, và từ gốc Hán-Hàn nếu có).
5. Liệt kê các cấu trúc ngữ pháp nổi bật được sử dụng trong câu.

Trả về kết quả dưới định dạng JSON CHÍNH XÁC (không chứa bất kỳ văn bản giải thích nào khác ngoài JSON):
{
  "translatedText": "bản dịch tiếng Việt hoặc tiếng Hàn",
  "roman": "phiên âm câu tiếng Hàn",
  "vocabulary": [
    {"word": "từ tiếng Hàn", "meaning": "nghĩa tiếng Việt", "explanation": "Hán Việt hoặc ghi chú cách dùng"}
  ],
  "grammar": [
    {"structure": "cấu trúc ngữ pháp tiếng Hàn", "meaning": "nghĩa tiếng Việt", "explanation": "cách dùng cấu trúc"}
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.3, maxOutputTokens: 2000 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Không tìm thấy JSON hợp lệ từ AI');
    const data = JSON.parse(match[0]);

    lastSrcText = text;
    lastDestText = data.translatedText || "";
    lastSrcLang = srcLang;
    lastDestLang = destLang;

    resultText.textContent = data.translatedText || "";
    
    if (data.roman) {
      romanText.textContent = `[ ${data.roman} ]`;
      romanText.style.display = 'block';
    } else {
      romanText.style.display = 'none';
    }

    // Build breakdown HTML
    let breakdownHtml = "";

    if (data.vocabulary && data.vocabulary.length > 0) {
      breakdownHtml += `<h5 style="margin: 5px 0; color: var(--accent-light);">📚 Từ vựng:</h5>`;
      data.vocabulary.forEach(v => {
        const safeWord = escStr(v.word);
        const safeMeaning = escStr(v.meaning);
        breakdownHtml += `
          <div class="tr-item">
            <div class="tr-item-left">
              <div class="tr-item-word">${v.word}</div>
              <div class="tr-item-meaning">${v.meaning}</div>
              ${v.explanation ? `<div class="tr-item-explanation">${v.explanation}</div>` : ''}
            </div>
            <div class="tr-item-btn">
              <button class="btn btn-ghost btn-xs" onclick="addWordFromTranslate('${safeWord}', '${safeMeaning}')">⭐ Lưu từ</button>
              <button class="mini-audio-btn" onclick="TTS.speak('${safeWord}')">🔊</button>
            </div>
          </div>
        `;
      });
    }

    if (data.grammar && data.grammar.length > 0) {
      breakdownHtml += `<h5 style="margin: 15px 0 5px 0; color: var(--teal);">📐 Ngữ pháp:</h5>`;
      data.grammar.forEach(g => {
        breakdownHtml += `
          <div class="tr-item" style="border-left: 3px solid var(--teal);">
            <div class="tr-item-left">
              <div class="tr-item-word" style="color: var(--teal);">${g.structure}</div>
              <div class="tr-item-meaning">${g.meaning}</div>
              ${g.explanation ? `<div class="tr-item-explanation">${g.explanation}</div>` : ''}
            </div>
          </div>
        `;
      });
    }

    if (breakdownHtml) {
      breakdown.innerHTML = breakdownHtml;
      document.getElementById('translateBreakdownSec').style.display = 'block';
    } else {
      document.getElementById('translateBreakdownSec').style.display = 'none';
    }

    state.stats.aiMessages++;
    addXP(5);
    saveState();

  } catch (e) {
    resultText.innerHTML = `<span style="color: var(--red);">⚠️ Không thể dịch câu này. Lỗi: ${escapePracticeHtml(e.message)}</span>`;
  }
}

async function addWordFromTranslate(korean, meaning) {
  if (state.words.find(x => x.korean === korean)) {
    showToast('Từ này đã có trong danh sách từ vựng!', 'info');
    return;
  }
  
  showToast(`⏳ Đang lấy thông tin chi tiết cho "${korean}"...`, 'info');
  let data;
  if (VOCAB_DB[korean]) {
    data = { korean, ...VOCAB_DB[korean] };
  } else if (GEMINI.getKey()) {
    try {
      const aiData = await GEMINI.generateVocab(korean);
      data = { korean, ...aiData };
    } catch (e) {
      data = {
        korean,
        roman: korean,
        meaning: meaning || 'Chưa có nghĩa',
        pos: '명사',
        tip: 'Tự động lưu từ chức năng Dịch',
        example: `${korean}이에요.`,
        exampleViet: `Đây là ${korean}.`
      };
    }
  } else {
    data = {
      korean,
      roman: korean,
      meaning: meaning || 'Chưa có nghĩa',
      pos: '명사',
      tip: 'Tự động lưu từ chức năng Dịch',
      example: `${korean}이에요.`,
      exampleViet: `Đây là ${korean}.`
    };
  }
  
  data.lesson = state.activeLesson !== 'all' ? state.activeLesson : (state.lessons[0] || 'Bài 1');
  state.words.push(data);
  saveState();
  if (typeof renderWordChips === 'function') renderWordChips();
  showToast(`✅ Đã lưu từ "${korean}" vào bài học ${data.lesson}!`, 'success');
}

function speakTranslateText(type) {
  if (type === 'src') {
    const lang = lastSrcLang === 'ko' ? 'ko-KR' : 'vi-VN';
    TTS.speak(lastSrcText, lang);
  } else {
    const lang = lastDestLang === 'ko' ? 'ko-KR' : 'vi-VN';
    TTS.speak(lastDestText, lang);
  }
}

// ============ INDEXEDDB FOR PDF STORAGE ============
const PDF_DB = {
  dbName: 'HQ_PDF_STORE',
  storeName: 'pdfs',
  db: null,
  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = (e) => reject(e);
    });
  },
  async savePDF(pdfItem) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(pdfItem);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  },
  async getAllPDFs() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e);
    });
  },
  async deletePDF(id) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  }
};

// ============ PDF STUDY MODULE ============
let activePdfItem = null;

async function initPdfStudy() {
  await renderPdfList();
}

async function handlePdfUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') {
    showToast('Vui lòng chọn file định dạng .pdf!', 'error');
    return;
  }
  showToast(`⏳ Đang lưu file "${file.name}"...`, 'info');
  const reader = new FileReader();
  reader.onload = async function(evt) {
    const dataUrl = evt.target.result;
    const pdfItem = {
      id: 'pdf_' + Date.now(),
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      date: new Date().toLocaleDateString('vi-VN'),
      dataUrl: dataUrl
    };
    try {
      await PDF_DB.savePDF(pdfItem);
      showToast(`✅ Đã lưu "${file.name}" vào tủ sách!`, 'success');
      await renderPdfList();
      openPdfItem(pdfItem);
    } catch(err) {
      showToast('❌ Lỗi khi lưu file PDF.', 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function renderPdfList() {
  const pdfs = await PDF_DB.getAllPDFs();
  const listEl = document.getElementById('pdfList');
  const countEl = document.getElementById('pdfCount');
  if (countEl) countEl.textContent = pdfs.length;
  if (!listEl) return;
  if (!pdfs.length) {
    listEl.innerHTML = `<p style="color:var(--text-muted);font-size:0.82rem;padding:10px">Chưa có file PDF nào trong tủ sách.</p>`;
    mountListPagination(listEl, 'pdfList', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('pdfList') }, 'file');
    return;
  }
  const meta = paginateList('pdfList', pdfs, renderPdfList, 10);
  listEl.innerHTML = meta.pageItems.map(p => `
    <div class="pdf-item ${activePdfItem && activePdfItem.id === p.id ? 'active' : ''}" onclick="fetchAndOpenPdf('${p.id}')">
      <div class="pdf-item-left"><span class="pdf-item-icon">📄</span><div style="overflow:hidden">
        <div class="pdf-item-title" title="${escStr(p.name)}">${p.name}</div>
        <div class="pdf-item-meta">${p.size} • ${p.date}</div>
      </div></div>
      <button class="mini-audio-btn" onclick="event.stopPropagation(); deletePdfItem('${p.id}')" title="Xóa PDF">🗑</button>
    </div>`).join('');
  mountListPagination(listEl, 'pdfList', meta, 'file');
}

async function fetchAndOpenPdf(id) {
  const pdfs = await PDF_DB.getAllPDFs();
  const target = pdfs.find(p => p.id === id);
  if (target) openPdfItem(target);
}

function openPdfItem(pdfItem) {
  activePdfItem = pdfItem;
  renderPdfList();
  const toolbar = document.getElementById('pdfToolbar');
  const emptyState = document.getElementById('pdfEmptyState');
  const wrapper = document.getElementById('pdfFrameWrapper');
  const iframe = document.getElementById('pdfIframe');
  const activeName = document.getElementById('pdfActiveName');

  if (activeName) activeName.textContent = pdfItem.name;
  if (toolbar) toolbar.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';
  if (wrapper) wrapper.style.display = 'block';

  if (iframe) {
    iframe.src = pdfItem.dataUrl;
  }
  showToast(`📄 Đã mở "${pdfItem.name}"!`, 'info');
}

function closeActivePdf() {
  activePdfItem = null;
  renderPdfList();
  document.getElementById('pdfToolbar').style.display = 'none';
  document.getElementById('pdfEmptyState').style.display = 'flex';
  document.getElementById('pdfFrameWrapper').style.display = 'none';
  document.getElementById('pdfIframe').src = '';
}

async function deletePdfItem(id) {
  if (confirm('Bạn có chắc muốn xóa file PDF này khỏi tủ sách?')) {
    await PDF_DB.deletePDF(id);
    if (activePdfItem && activePdfItem.id === id) closeActivePdf();
    await renderPdfList();
    showToast('🗑 Đã xóa file PDF!', 'info');
  }
}

async function analyzeActivePdfAI() {
  if (!activePdfItem) return;
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }
  
  showToast('🤖 AI đang phân tích từ vựng tiêu biểu từ PDF...', 'info');
  const prompt = `Bạn là trợ lý tiếng Hàn.
Tên file PDF: "${activePdfItem.name}".
Hãy tạo danh sách 6 từ vựng tiếng Hàn quan trọng và 1 cấu trúc ngữ pháp tiêu biểu mang chủ đề tài liệu này.

Trả về EXACT JSON:
{
  "vocab": [
    {"korean": "한국어", "meaning": "tiếng Hàn", "pos": "명사", "example": "한국어를 공부해요.", "exampleViet": "Tôi học tiếng Hàn."}
  ],
  "grammar": {
    "title": "cấu trúc ngữ pháp tiêu biểu",
    "body": "giải thích chi tiết"
  }
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.5, maxOutputTokens: 1800 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const data = JSON.parse(match[0]);

    if (data.vocab && data.vocab.length) {
      let added = 0;
      data.vocab.forEach(v => {
        if (!state.words.find(w => w.korean === v.korean)) {
          state.words.push({ ...v, lesson: 'Từ PDF: ' + activePdfItem.name.slice(0, 15) });
          added++;
        }
      });
      if (data.grammar && data.grammar.title) {
        if (!state.grammar.find(g => g.title === data.grammar.title)) {
          state.grammar.push({ title: data.grammar.title, body: data.grammar.body || '', lesson: 'Tài liệu PDF' });
        }
      }
      saveState();
      renderLessonSelectors();
      showToast(`✅ AI đã tự động trích xuất & thêm ${added} từ vựng từ PDF vào bài học!`, 'success');
    }
  } catch(e) {
    showToast('⚠️ Lỗi phân tích AI: ' + e.message, 'error');
  }
}

function createHomeworkFromActivePdf() {
  if (!activePdfItem) return;
  setMode('homework');
  openHomeworkModal();
  switchHwModalTab('paste');
  const pasteTab = document.getElementById('hwPasteTextarea');
  if (pasteTab) {
    pasteTab.value = `[Đề bài tập từ PDF: ${activePdfItem.name}]\nCâu 1: Dịch các câu chính trong tài liệu sang tiếng Hàn.\nCâu 2: Đặt 2 câu hội thoại áp dụng kiến thức trong bài đọc PDF.`;
  }
}

// ============ HOMEWORK (BTVN) MODULE ============
function initHomework() {
  if (!state.homework) state.homework = { history: [], current: null };
  renderHomeworkHistory();
  if (state.homework.current) {
    renderActiveHomework();
  } else {
    document.getElementById('hwEmptyState').style.display = 'flex';
    document.getElementById('hwActiveView').style.display = 'none';
  }
}

function openHomeworkModal() {
  document.getElementById('hwModalOverlay').style.display = 'flex';
}
function closeHomeworkModal() {
  document.getElementById('hwModalOverlay').style.display = 'none';
}

function switchHwModalTab(tab) {
  const genBtn = document.getElementById('hwTabGen');
  const pasteBtn = document.getElementById('hwTabPaste');
  const genTab = document.getElementById('hwModalGenTab');
  const pasteTab = document.getElementById('hwModalPasteTab');

  if (tab === 'gen') {
    genBtn.classList.add('active'); pasteBtn.classList.remove('active');
    genTab.style.display = 'block'; pasteTab.style.display = 'none';
  } else {
    pasteBtn.classList.add('active'); genBtn.classList.remove('active');
    pasteTab.style.display = 'block'; genTab.style.display = 'none';
  }
}

async function submitCreateHomework() {
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }
  const isGen = document.getElementById('hwTabGen').classList.contains('active');

  closeHomeworkModal();
  const mainArea = document.getElementById('hwActiveView');
  const emptyState = document.getElementById('hwEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  if (mainArea) {
    mainArea.style.display = 'block';
    mainArea.innerHTML = `<div class="ldial-loading"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 AI đang khởi tạo Bài Tập Về Nhà...</span></div>`;
  }

  if (isGen) {
    const src = document.getElementById('hwSourceSelect').value;
    const diff = document.getElementById('hwDiffSelect').value;
    const count = parseInt(document.getElementById('hwCountSelect').value) || 8;
    const words = getActiveWords();
    const vocabHint = words.slice(0, 15).map(w=>`${w.korean}(${w.meaning})`).join(', ');

    const prompt = `Bạn là giáo viên tiếng Hàn chuẩn bị Bài Tập Về Nhà (BTVN) cho học viên Việt Nam.
Nguồn đề bài: ${src === 'vocab' ? 'Từ vựng đã học' : src === 'grammar' ? 'Cấu trúc ngữ pháp' : 'Đề thi TOPIK'}
Mức độ: ${diff} (${diff === 'easy' ? 'dễ, chỉ dùng từ đã học' : diff === 'medium' ? 'thường' : 'khó'})
Từ vựng tham khảo: ${vocabHint || 'tiếng Hàn cơ bản'}

Yêu cầu: Tạo đúng ${count} câu bài tập thực hành (dịch câu Việt -> Hàn, dịch Hàn -> Việt, điền đuôi câu/tiểu từ).
Cho mỗi câu hỏi, tạo gợi ý ngắn (hint).

Trả lời EXACT JSON:
{
  "title": "Bài Tập Về Nhà - ${new Date().toLocaleDateString('vi-VN')}",
  "questions": [
    {"id": 1, "prompt": "Câu hỏi / Đề bài", "hint": "Gợi ý"}
  ]
}`;

    try {
      const raw = await GEMINI.call(prompt, '', { temperature: 0.7, maxOutputTokens: 2500 });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Invalid JSON');
      const data = JSON.parse(match[0]);

      state.homework.current = {
        id: 'hw_' + Date.now(),
        title: data.title || 'Bài Tập Về Nhà AI',
        date: new Date().toLocaleDateString('vi-VN'),
        questions: data.questions || [],
        userAnswers: {},
        submitted: false,
        grading: null
      };
      saveState();
      renderActiveHomework();
      showToast('✅ Đã tạo Bài Tập Về Nhà thành công!', 'success');
    } catch(e) {
      if (mainArea) mainArea.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Lỗi tạo BTVN: ${escapePracticeHtml(e.message)}</p></div>`;
    }
  } else {
    // Self paste
    const pasteText = document.getElementById('hwPasteTextarea').value.trim();
    if (!pasteText) { showToast('⚠️ Vui lòng dán nội dung đề bài!', 'error'); return; }

    const lines = pasteText.split('\n').filter(l => l.trim().length > 0);
    const questions = lines.map((line, idx) => ({
      id: idx + 1,
      prompt: line,
      hint: 'Đề bài tự dán vào'
    }));

    state.homework.current = {
      id: 'hw_' + Date.now(),
      title: 'BTVN Tự Nhập - ' + new Date().toLocaleDateString('vi-VN'),
      date: new Date().toLocaleDateString('vi-VN'),
      questions: questions,
      userAnswers: {},
      submitted: false,
      grading: null
    };
    saveState();
    renderActiveHomework();
    showToast('✅ Đã nhập BTVN thành công!', 'success');
  }
}

function renderActiveHomework() {
  const hw = state.homework.current;
  if (!hw) return;
  const mainArea = document.getElementById('hwActiveView');
  const emptyState = document.getElementById('hwEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  if (mainArea) mainArea.style.display = 'block';

  const submitted = hw.submitted;
  const grading = hw.grading;

  const qsHtml = hw.questions.map((q, i) => {
    const userAns = hw.userAnswers[i] || '';
    const qGrade = grading ? (grading.results && grading.results[i]) : null;
    const status = qGrade ? qGrade.status : '';

    return `
      <div class="hw-q-item ${submitted ? status : ''}">
        <div class="hw-q-title">❓ Câu ${i+1}: ${q.prompt}</div>
        ${q.hint ? `<div class="hw-q-hint">💡 Gợi ý: ${q.hint}</div>` : ''}
        <textarea class="hw-q-textarea" id="hwInput${i}" rows="2" placeholder="Nhập câu trả lời bằng tiếng Hàn hoặc tiếng Việt..." ${submitted ? 'disabled' : ''}>${userAns.replace(/"/g, '&quot;')}</textarea>
        ${qGrade ? `
          <div class="hw-correction-box ${status}">
            <div style="font-weight:800; font-size:0.9rem">
              ${status === 'correct' ? '✅ Chính xác!' : status === 'imperfect' ? '⚠️ Cần sửa lại cho tự nhiên:' : '❌ Chưa chính xác!'}
            </div>
            ${qGrade.correctAnswer ? `<div>✨ <strong>Đáp án gợi ý:</strong> <span style="font-family:Noto Sans KR,sans-serif; color:var(--teal); font-weight:700">${qGrade.correctAnswer}</span></div>` : ''}
            <div>🧑‍🏫 <strong>Giải thích chi tiết của AI:</strong> ${qGrade.explanation}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const vocabList = (submitted && grading && grading.vocab) ? grading.vocab : [];
  const vocabCardHtml = (submitted && grading) ? `
    <div class="card hw-vocab-card" style="background:var(--bg-card); border:1px dashed var(--accent); padding:18px; margin-bottom:15px; border-radius:var(--radius);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <div>
          <h4 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
            <span>🎯</span> Ôn Tập & Kiểm Tra Từ Vựng Bài Tập Này ${vocabList.length ? `(${vocabList.length} từ)` : ''}
          </h4>
          <span style="font-size:0.8rem; color:var(--text-muted);">Các từ vựng cốt lõi được AI tự động tổng hợp từ đề bài và bài làm của bạn</span>
        </div>
        ${!vocabList.length ? `
          <button class="btn btn-ghost btn-sm" onclick="extractHwVocabWithAI()">✨ AI Trích xuất từ vựng BTVN này</button>
        ` : ''}
      </div>

      ${vocabList.length > 0 ? `
        <div class="hw-vocab-chips" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
          ${vocabList.map(v => `
            <div class="hw-vocab-chip" style="background:var(--bg-input); border:1px solid var(--border); padding:6px 12px; border-radius:20px; font-size:0.85rem; display:flex; align-items:center; gap:6px;">
              <span class="font-kr" style="font-weight:700; color:var(--accent-light);">${v.korean}</span>
              <span style="color:var(--text-secondary);">(${v.meaning})</span>
              <button class="mini-audio-btn" onclick="speakBilingual('${escStr(v.korean)}', '${escStr(v.meaning)}')">🔊</button>
            </div>
          `).join('')}
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-accent btn-md" onclick="startHwVocab10xPractice()">✏️ Luyện chép 10 lần các từ BTVN này</button>
          <button class="btn btn-primary btn-md" onclick="startHwVocabQuiz()">❓ Kiểm tra Trắc nghiệm từ BTVN</button>
          <button class="btn btn-ghost btn-sm" onclick="addHwVocabToWordList()">➕ Thêm vào Sổ từ vựng</button>
        </div>
      ` : ''}
    </div>
  ` : '';

  const gradeHeader = (submitted && grading) ? `
    <div class="card" style="background:linear-gradient(135deg, rgba(108,99,255,0.12), rgba(0,212,170,0.12)); border:1px solid var(--accent); padding:20px; margin-bottom:15px; text-align:center;">
      <div style="font-size:2rem; font-weight:900; color:var(--accent-light);">💯 Điểm số: ${grading.grade}</div>
      <div style="font-size:0.95rem; color:var(--text-secondary); margin-top:6px;">🧑‍🏫 <strong>Nhận xét chung của AI:</strong> ${grading.feedback}</div>
    </div>
  ` : '';

  const actions = submitted ? `
    <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
      <button class="btn btn-secondary" onclick="redoActiveHomework()">🔁 Làm Lại Bài Này</button>
      <button class="btn btn-ai" onclick="openHomeworkModal()">➕ Làm Bài Tập Mới</button>
    </div>
  ` : `
    <div style="display:flex; gap:10px; margin-top:15px;">
      <button class="btn btn-primary btn-lg" onclick="submitHomeworkForGrading()">✅ Nộp BTVN & Nhờ AI Chấm Điểm</button>
    </div>
  `;

  mainArea.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-header">
        <div>
          <h3 style="margin:0; font-size:1.2rem; font-weight:800; color:var(--text-primary);">${hw.title}</h3>
          <span style="font-size:0.8rem; color:var(--text-muted);">Ngày giao: ${hw.date} • ${hw.questions.length} câu</span>
        </div>
      </div>
      ${gradeHeader}
      ${vocabCardHtml}
      <div style="display:flex; flex-direction:column; gap:16px;">${qsHtml}</div>
      ${actions}
    </div>
  `;
}

function redoActiveHomework() {
  const hw = state.homework.current;
  if (!hw) return;
  hw.submitted = false;
  hw.grading = null;
  hw.userAnswers = {};
  saveState();
  renderActiveHomework();
  showToast('🔁 Đã mở lại bài tập! Bạn có thể làm lại và nhờ AI chấm lại.', 'info');
}

async function submitHomeworkForGrading() {
  const hw = state.homework.current;
  if (!hw || !hw.questions.length) return;
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }

  // Collect answers
  hw.questions.forEach((q, i) => {
    const input = document.getElementById(`hwInput${i}`);
    if (input) hw.userAnswers[i] = input.value.trim();
  });

  showToast('🤖 AI đang chấm điểm & kiểm tra ngữ pháp chi tiết...', 'info');

  const qaPair = hw.questions.map((q, i) => ({
    questionNum: i + 1,
    prompt: q.prompt,
    userAnswer: hw.userAnswers[i] || '(Chưa làm)'
  }));

  const prompt = `Bạn là giáo viên tiếng Hàn chuyên nghiệp đang chấm Bài Tập Về Nhà (BTVN) cho học sinh Việt Nam.
Danh sách các câu hỏi và bài làm của học sinh:
${JSON.stringify(qaPair, null, 2)}

Yêu cầu chấm điểm:
1. Đánh giá từng câu: "correct" (Đúng), "imperfect" (Đúng ý nhưng sai nhỏ/chưa tự nhiên), hoặc "wrong" (Sai).
2. Cung cấp đáp án chuẩn ("correctAnswer") bằng tiếng Hàn hoặc tiếng Việt.
3. Giải thích chi tiết ("explanation") tại sao đúng/sai, phân tích lỗi sai ngữ pháp, quy tắc chia động từ, từ vựng hoặc tiểu từ.
4. Cho tổng điểm tổng quát (ví dụ "9.0 / 10" hoặc "85 / 100") và viết nhận xét chung ("feedback") khích lệ người học.
5. TRÍCH XUẤT 4 TRẾN 8 TỪ VỰNG TIẾNG HÀN QUAN TRỌNG / MỚI NỔI BẬT ("vocab") xuất hiện trong bài tập, câu trả lời hoặc đáp án gợi ý để học sinh làm bài tập kiểm tra lại.

Trả lời CHÍNH XÁC định dạng JSON (không thêm văn bản ngoài JSON):
{
  "grade": "8.5 / 10",
  "scorePct": 85,
  "feedback": "Nhận xét tổng quan của AI về bài làm...",
  "results": [
    {
      "questionNum": 1,
      "status": "correct",
      "correctAnswer": "câu trả lời chuẩn",
      "explanation": "giải thích chi tiết cách dùng từ & ngữ pháp"
    }
  ],
  "vocab": [
    {
      "korean": "từ_tiếng_Hàn",
      "meaning": "nghĩa_tiếng_Việt",
      "roman": "phiên_âm",
      "example": "ví_dụ_ngắn"
    }
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.3, maxOutputTokens: 3000 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON');
    const grading = JSON.parse(match[0]);

    hw.submitted = true;
    hw.grading = grading;

    // Save to history
    state.homework.history.unshift({ ...hw });
    state.stats.aiMessages++;
    addXP(25);
    saveState();

    renderActiveHomework();
    renderHomeworkHistory();
    showToast(`🏆 Đã chấm xong! Điểm số: ${grading.grade}`, 'success', 4000);
  } catch(e) {
    showToast('❌ Lỗi AI chấm bài: ' + e.message, 'error');
  }
}

function addHwVocabToWordList() {
  const hw = state.homework.current;
  if (!hw || !hw.grading || !hw.grading.vocab || !hw.grading.vocab.length) {
    showToast('⚠️ Không có từ vựng nào để thêm!', 'info');
    return [];
  }

  const vocabList = hw.grading.vocab;
  let addedCount = 0;
  const addedWords = [];

  vocabList.forEach(v => {
    if (!v.korean) return;
    const cleanKr = v.korean.trim();
    let existing = state.words.find(w => w.korean.trim() === cleanKr);
    if (!existing) {
      existing = {
        korean: cleanKr,
        meaning: (v.meaning || '').trim(),
        roman: (v.roman || cleanKr).trim(),
        example: (v.example || '').trim(),
        exampleViet: '',
        pos: '명사',
        lesson: 'Bài tập về nhà',
        dateAdded: new Date().toISOString()
      };
      state.words.push(existing);
      addedCount++;
    }
    addedWords.push(existing);
  });

  saveState();
  if (typeof renderWordList === 'function') renderWordList();
  if (addedCount > 0) {
    showToast(`✅ Đã thêm ${addedCount} từ vựng BTVN vào Sổ từ vựng!`, 'success', 2500);
  }
  return addedWords;
}

function startHwVocab10xPractice() {
  const addedWords = addHwVocabToWordList();
  const hw = state.homework.current;
  if (!hw || !hw.grading || !hw.grading.vocab || !hw.grading.vocab.length) return;

  const firstKr = hw.grading.vocab[0].korean;
  startQuick10xWord(firstKr);
}

function startHwVocabQuiz() {
  const addedWords = addHwVocabToWordList();
  const hw = state.homework.current;
  if (!hw || !hw.grading || !hw.grading.vocab || !hw.grading.vocab.length) return;

  if (state.words.length < 4) {
    showToast('⚠️ Cần ít nhất 4 từ vựng trong hệ thống để mở Trắc nghiệm!', 'error');
    return;
  }

  const firstKr = hw.grading.vocab[0].korean;
  const words = getActiveWords();
  const size = state.batchLearn.size || 20;
  const batches = getBatches(words, size);
  let foundBatchIdx = 0;
  for (let i = 0; i < batches.length; i++) {
    if (batches[i].some(w => w.korean === firstKr)) {
      foundBatchIdx = i;
      break;
    }
  }

  setMode('batch');
  startBatchTest(foundBatchIdx);
}

async function extractHwVocabWithAI() {
  const hw = state.homework.current;
  if (!hw) return;
  if (!GEMINI.getKey()) { showToast('⚠️ AI chưa được Admin cấu hình!', 'error'); return; }

  showToast('🤖 AI đang trích xuất danh sách từ vựng từ BTVN...', 'info');
  const qaText = hw.questions.map((q, i) => `Câu ${i+1}: ${q.prompt}\nĐáp án: ${hw.userAnswers[i]||''}\n${hw.grading && hw.grading.results && hw.grading.results[i] ? 'Đáp án gợi ý: ' + (hw.grading.results[i].correctAnswer||'') : ''}`).join('\n\n');

  const prompt = `Trích xuất 4 đến 8 từ vựng tiếng Hàn quan trọng/mới nhất có trong bài tập về nhà sau:
${qaText}

Trả lời CHÍNH XÁC định dạng JSON:
{
  "vocab": [
    {"korean": "từ_Hàn", "meaning": "nghĩa_Việt", "roman": "phiên_âm", "example": "ví_dụ_ngắn"}
  ]
}`;

  try {
    const raw = await GEMINI.call(prompt, '', { temperature: 0.3 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      if (!hw.grading) hw.grading = {};
      hw.grading.vocab = data.vocab || [];
      saveState();
      renderActiveHomework();
      showToast(`✅ Đã trích xuất ${hw.grading.vocab.length} từ vựng từ bài tập!`, 'success');
    }
  } catch(e) {
    showToast('❌ Lỗi trích xuất từ vựng: ' + e.message, 'error');
  }
}

function renderHomeworkHistory() {
  const listEl = document.getElementById('hwHistoryList');
  if (!listEl) return;
  const history = (state.homework && state.homework.history) || [];
  if (!history.length) {
    listEl.innerHTML = `<p style="color:var(--text-muted);font-size:0.82rem;padding:10px">Chưa có lịch sử làm BTVN.</p>`;
    mountListPagination(listEl, 'homeworkHistory', { totalItems:0, totalPages:1, start:0, end:0, pg:getListPaginationState('homeworkHistory') }, 'bài');
    return;
  }
  const entries = history.map((item, idx) => ({ item, idx }));
  const meta = paginateList('homeworkHistory', entries, renderHomeworkHistory, 10);
  listEl.innerHTML = meta.pageItems.map(({item, idx}) => `
    <div class="hw-history-item" onclick="loadHistoryHomework(${idx})">
      <div class="hw-hist-top"><span class="hw-hist-title">${item.title}</span>${item.grading ? `<span class="hw-hist-score">${item.grading.grade}</span>` : ''}</div>
      <span class="hw-hist-date">${item.date} • ${item.questions.length} câu</span>
    </div>`).join('');
  mountListPagination(listEl, 'homeworkHistory', meta, 'bài');
}

function loadHistoryHomework(idx) {
  const item = state.homework.history[idx];
  if (item) {
    state.homework.current = item;
    renderActiveHomework();
  }
}

// ============ FLOATING AI ROBOT ASSISTANT ============
const ROBOT_TIPS = [
  "Hôm nay bạn đã duy trì chuỗi học rất tốt! Cùng cố gắng tích lũy thêm XP nhé 🔥",
  "Học tiếng Hàn theo cụm từ và câu ví dụ giúp bạn nhớ lâu gấp 3 lần đấy! 💡",
  "Muốn luyện nghe phát âm chuẩn? Bấm vào biểu tượng 🔊 bên cạnh mỗi từ nhé! 🎧",
  "BTVN sau khi làm xong hãy nhấn Nộp bài để AI chấm điểm và giải thích ngữ pháp chi tiết nha! 📑",
  "Tải file PDF sách tiếng Hàn lên để tớ tự động trích xuất từ vựng vào bài học giúp bạn! 📄",
  "Luyện ngữ pháp ở mức Dễ chỉ sử dụng từ đã học, rất thích hợp để củng cố kiến thức! 🟢",
  "Bạn có thể đổi chế độ xem từ điển sang 1 Cột, 3 Cột, hoặc 5 Cột để tìm từ dễ hơn đấy! 📖"
];

function updateRobotTipForMode(mode) {
  const tips = {
    home: "안녕! Hôm nay bạn muốn học từ vựng hay luyện BTVN với tớ nè? 🤖✨",
    learn: "Học từ vựng nào! Nhớ bấm nút 🔊 để nghe phát âm chuẩn nhé 📚",
    batch: "Học hết 1 bộ rồi bấm ✅ Kiểm tra – đúng 100% mới mở khóa bộ tiếp theo nhé! 🎯",
    flashcard: "Lật thẻ Flashcard liên tục giúp bộ não ghi nhớ phản xạ cực nhanh! ⚡",
    grammarPractice: "Chọn 🟢 Dễ nếu ôn từ đã học, hoặc 🔴 Khó để thử sức TOPIK nhé! 📐",
    pdfStudy: "Tải file PDF sách lên và bấm 🤖 AI Trích Từ Vựng để nạp từ vào bài học nhé! 📄",
    homework: "Làm bài xong nhấn ✅ Nộp BTVN để tớ chấm điểm & sửa lỗi ngữ pháp chi tiết nha! 📑",
    dictionary: "Thử đổi bộ lọc 1 Cột / 3 Cột / 5 Cột để xem toàn bộ từ vựng dễ hơn nè! 📖",
    listenDial: "Nghe đoạn hội thoại nhiều lần và chọn đáp án chuẩn xác nhé! 🎙️",
    exam: "Cố lên! Làm đề TOPIK thật cẩn thận để đạt điểm tuyệt đối nha! 📝",
    translate: "Dịch thuật AI có phân tích cú pháp câu & biến thể từ vựng nữa đấy! 🌐",
    aichat: "Nhắn tin tiếng Hàn với tớ để luyện phản xạ giao tiếp tự nhiên nhé! 💬"
  };
  const bubbleText = document.getElementById('robotBubbleText');
  if (bubbleText && tips[mode]) {
    bubbleText.textContent = tips[mode];
  }
}

function interactWithRobot() {
  const overlay = document.getElementById('robotModalOverlay');
  if (overlay) overlay.style.display = 'flex';
  generateRobotRandomTip();
}

function closeRobotModal() {
  const overlay = document.getElementById('robotModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

function hideRobotBubble() {
  const bubble = document.getElementById('robotBubble');
  if (bubble) bubble.style.display = 'none';
}

function generateRobotRandomTip() {
  const tipEl = document.getElementById('robotModalTip');
  const randomTip = ROBOT_TIPS[Math.floor(Math.random() * ROBOT_TIPS.length)];
  if (tipEl) tipEl.textContent = randomTip;
}
// =============================================================
// SENTENCE PRACTICE MODULE — Luyện viết câu AI theo sách
// Tiếng Hàn Tổng Hợp Dành Cho Người Việt Nam – Sơ cấp 1
// =============================================================

// ---- TEXTBOOK DATA (20 bài) ----
const SP_BOOK_DATA = [
  {
    id: 1,
    title: '안녕하세요',
    topic: 'Chào hỏi & Giới thiệu bản thân',
    grammar: ['N이에요/예요', 'N은/는 (chủ đề)', 'N이/가 아니에요', '저는 ~이에요/예요'],
    vocab: [
      { kr: '안녕하세요', rom: 'annyeonghaseyo', vn: 'Xin chào' },
      { kr: '저', rom: 'jeo', vn: 'Tôi (khiêm nhường)' },
      { kr: '이름', rom: 'ireum', vn: 'Tên' },
      { kr: '학생', rom: 'haksaeng', vn: 'Học sinh / Sinh viên' },
      { kr: '선생님', rom: 'seonsaengnim', vn: 'Giáo viên / Thầy/Cô' },
      { kr: '사람', rom: 'saram', vn: 'Người' },
      { kr: '한국', rom: 'hanguk', vn: 'Hàn Quốc' },
      { kr: '베트남', rom: 'beteunam', vn: 'Việt Nam' },
      { kr: '반갑습니다', rom: 'bangapseumnida', vn: 'Rất vui được gặp bạn' },
      { kr: '네', rom: 'ne', vn: 'Vâng / Đúng' },
      { kr: '아니요', rom: 'aniyo', vn: 'Không' },
    ],
    sampleSentences: [
      { kr: '저는 학생이에요.', vn: 'Tôi là học sinh.' },
      { kr: '저는 베트남 사람이에요.', vn: 'Tôi là người Việt Nam.' },
      { kr: '저는 선생님이 아니에요.', vn: 'Tôi không phải là giáo viên.' },
      { kr: '안녕하세요, 반갑습니다!', vn: 'Xin chào, rất vui được gặp bạn!' },
      { kr: '이름이 뭐예요?', vn: 'Tên bạn là gì?' },
    ],
  },
  {
    id: 2,
    title: '이것이 무엇입니까?',
    topic: 'Đây là cái gì? — Đại từ chỉ định & Số đếm',
    grammar: ['이/그/저 + N', 'N이 뭐예요?', '하나, 둘... (số đếm thuần Hàn)', '~개 (đếm đồ vật)'],
    vocab: [
      { kr: '이것', rom: 'igeot', vn: 'Cái này' },
      { kr: '그것', rom: 'geugeot', vn: 'Cái đó' },
      { kr: '저것', rom: 'jeogeot', vn: 'Cái kia' },
      { kr: '책', rom: 'chaek', vn: 'Quyển sách' },
      { kr: '가방', rom: 'gabang', vn: 'Túi / Cặp' },
      { kr: '볼펜', rom: 'bolpen', vn: 'Bút bi' },
      { kr: '핸드폰', rom: 'haendeupon', vn: 'Điện thoại di động' },
      { kr: '컴퓨터', rom: 'keompyuteo', vn: 'Máy tính' },
      { kr: '뭐', rom: 'mwo', vn: 'Cái gì' },
      { kr: '하나', rom: 'hana', vn: 'Một (thuần Hàn)' },
      { kr: '둘', rom: 'dul', vn: 'Hai (thuần Hàn)' },
    ],
    sampleSentences: [
      { kr: '이것이 뭐예요?', vn: 'Cái này là cái gì?' },
      { kr: '이것은 책이에요.', vn: 'Cái này là quyển sách.' },
      { kr: '저것은 제 가방이에요.', vn: 'Cái kia là túi của tôi.' },
      { kr: '볼펜이 두 개 있어요.', vn: 'Có hai cái bút bi.' },
      { kr: '그것은 핸드폰이 아니에요.', vn: 'Cái đó không phải là điện thoại.' },
    ],
  },
  {
    id: 3,
    title: '어디에 있어요?',
    topic: 'Ở đâu? — Vị trí và địa điểm',
    grammar: ['N에 있어요/없어요', '위치 명사 (위/아래/앞/뒤/옆)', 'N에 가요', 'N에서'],
    vocab: [
      { kr: '어디', rom: 'eodi', vn: 'Ở đâu' },
      { kr: '학교', rom: 'hakgyo', vn: 'Trường học' },
      { kr: '집', rom: 'jip', vn: 'Nhà' },
      { kr: '병원', rom: 'byeongwon', vn: 'Bệnh viện' },
      { kr: '은행', rom: 'eunhaeng', vn: 'Ngân hàng' },
      { kr: '식당', rom: 'sikdang', vn: 'Nhà hàng / Quán ăn' },
      { kr: '위', rom: 'wi', vn: 'Trên / Phía trên' },
      { kr: '아래', rom: 'arae', vn: 'Dưới / Phía dưới' },
      { kr: '앞', rom: 'ap', vn: 'Trước / Phía trước' },
      { kr: '뒤', rom: 'dwi', vn: 'Sau / Phía sau' },
      { kr: '옆', rom: 'yeop', vn: 'Bên cạnh' },
      { kr: '있어요', rom: 'isseoyo', vn: 'Có / Ở (tồn tại)' },
      { kr: '없어요', rom: 'eopsseoyo', vn: 'Không có / Không ở' },
    ],
    sampleSentences: [
      { kr: '학교가 어디에 있어요?', vn: 'Trường học ở đâu?' },
      { kr: '책이 책상 위에 있어요.', vn: 'Quyển sách ở trên bàn.' },
      { kr: '병원은 은행 옆에 있어요.', vn: 'Bệnh viện ở bên cạnh ngân hàng.' },
      { kr: '저는 집에 있어요.', vn: 'Tôi đang ở nhà.' },
      { kr: '고양이가 소파 아래에 있어요.', vn: 'Con mèo ở dưới ghế sofa.' },
    ],
  },
  {
    id: 4,
    title: '몇 시예요?',
    topic: 'Mấy giờ rồi? — Thời gian & Lịch hẹn',
    grammar: ['N시 N분이에요', '~에 가요/와요', '오전/오후', '고유어 수 + 시 / 한자어 수 + 분'],
    vocab: [
      { kr: '몇', rom: 'myeot', vn: 'Mấy / Bao nhiêu' },
      { kr: '시', rom: 'si', vn: 'Giờ' },
      { kr: '분', rom: 'bun', vn: 'Phút' },
      { kr: '오전', rom: 'ojeon', vn: 'Buổi sáng (AM)' },
      { kr: '오후', rom: 'ohu', vn: 'Buổi chiều (PM)' },
      { kr: '지금', rom: 'jigeum', vn: 'Bây giờ' },
      { kr: '일어나요', rom: 'ireonayo', vn: 'Thức dậy' },
      { kr: '자요', rom: 'jayo', vn: 'Ngủ' },
      { kr: '먹어요', rom: 'meogeoyo', vn: 'Ăn' },
      { kr: '시작해요', rom: 'sijakaeyo', vn: 'Bắt đầu' },
      { kr: '끝나요', rom: 'kkeunnayo', vn: 'Kết thúc' },
    ],
    sampleSentences: [
      { kr: '지금 몇 시예요?', vn: 'Bây giờ là mấy giờ?' },
      { kr: '오전 열 시예요.', vn: 'Là 10 giờ sáng.' },
      { kr: '저는 오전 일곱 시에 일어나요.', vn: 'Tôi thức dậy lúc 7 giờ sáng.' },
      { kr: '수업은 오후 두 시에 시작해요.', vn: 'Lớp học bắt đầu lúc 2 giờ chiều.' },
      { kr: '몇 시에 자요?', vn: 'Mấy giờ bạn đi ngủ?' },
    ],
  },
  {
    id: 5,
    title: '얼마예요?',
    topic: 'Bao nhiêu tiền? — Mua sắm & Số đếm Hán-Hàn',
    grammar: ['한자어 수 (일, 이, 삼...)', 'N이/가 얼마예요?', '~하고 (và)', 'N을/를 주세요'],
    vocab: [
      { kr: '얼마', rom: 'eolma', vn: 'Bao nhiêu (tiền)' },
      { kr: '원', rom: 'won', vn: 'Won (tiền Hàn)' },
      { kr: '주세요', rom: 'juseyo', vn: 'Cho tôi xin / Làm ơn cho' },
      { kr: '사과', rom: 'sagwa', vn: 'Quả táo' },
      { kr: '우유', rom: 'uyu', vn: 'Sữa' },
      { kr: '물', rom: 'mul', vn: 'Nước' },
      { kr: '빵', rom: 'ppang', vn: 'Bánh mì' },
      { kr: '천', rom: 'cheon', vn: 'Nghìn (1000)' },
      { kr: '만', rom: 'man', vn: 'Mười nghìn (10.000)' },
      { kr: '싸요', rom: 'ssayo', vn: 'Rẻ' },
      { kr: '비싸요', rom: 'bissayo', vn: 'Đắt' },
    ],
    sampleSentences: [
      { kr: '이 사과가 얼마예요?', vn: 'Quả táo này bao nhiêu tiền?' },
      { kr: '오천 원이에요.', vn: 'Là 5.000 won.' },
      { kr: '물 하나 주세요.', vn: 'Cho tôi một chai nước.' },
      { kr: '너무 비싸요.', vn: 'Đắt quá.' },
      { kr: '사과하고 우유를 주세요.', vn: 'Cho tôi táo và sữa.' },
    ],
  },
  {
    id: 6,
    title: '불고기 주세요',
    topic: 'Gọi món ăn — Nhà hàng & Thức ăn',
    grammar: ['N 주세요', 'N을/를 먹어요/마셔요', '~하고 같이', 'N이/가 맛있어요'],
    vocab: [
      { kr: '불고기', rom: 'bulgogi', vn: 'Thịt nướng Hàn Quốc' },
      { kr: '비빔밥', rom: 'bibimbap', vn: 'Cơm trộn' },
      { kr: '김치찌개', rom: 'kimchijjigae', vn: 'Canh kim chi' },
      { kr: '삼겹살', rom: 'samgyeopsal', vn: 'Ba chỉ nướng' },
      { kr: '맛있어요', rom: 'massisseoyo', vn: 'Ngon' },
      { kr: '맛없어요', rom: 'maseopsseoyo', vn: 'Không ngon' },
      { kr: '마셔요', rom: 'masyeoyo', vn: 'Uống' },
      { kr: '배고파요', rom: 'baegopayo', vn: 'Đói' },
      { kr: '배불러요', rom: 'baebulleoyo', vn: 'No' },
      { kr: '메뉴', rom: 'menyu', vn: 'Thực đơn' },
    ],
    sampleSentences: [
      { kr: '불고기 주세요.', vn: 'Cho tôi thịt nướng.' },
      { kr: '비빔밥이 맛있어요.', vn: 'Cơm trộn ngon.' },
      { kr: '저는 물을 마셔요.', vn: 'Tôi uống nước.' },
      { kr: '배고파요. 뭐 먹어요?', vn: 'Đói rồi. Ăn gì vậy?' },
      { kr: '메뉴 주세요.', vn: 'Cho tôi xem thực đơn.' },
    ],
  },
  {
    id: 7,
    title: '한국어를 공부해요',
    topic: 'Động từ và hoạt động hàng ngày',
    grammar: ['동사 + 아/어요 (hiện tại lịch sự)', 'N을/를 (tân ngữ)', '~고 (liên kết)'],
    vocab: [
      { kr: '공부해요', rom: 'gongbuhaeyo', vn: 'Học tập' },
      { kr: '일해요', rom: 'ilhaeyo', vn: 'Làm việc' },
      { kr: '운동해요', rom: 'undonghaeyo', vn: 'Tập thể dục' },
      { kr: '쉬어요', rom: 'swieyo', vn: 'Nghỉ ngơi' },
      { kr: '만나요', rom: 'mannayo', vn: 'Gặp gỡ' },
      { kr: '전화해요', rom: 'jeonhwahaeyo', vn: 'Gọi điện' },
      { kr: '봐요', rom: 'bwayo', vn: 'Xem / Nhìn' },
      { kr: '들어요', rom: 'deuroyo', vn: 'Nghe' },
      { kr: '써요', rom: 'sseoyo', vn: 'Viết' },
      { kr: '읽어요', rom: 'ilgeoyo', vn: 'Đọc' },
    ],
    sampleSentences: [
      { kr: '저는 한국어를 공부해요.', vn: 'Tôi học tiếng Hàn.' },
      { kr: '친구를 만나요.', vn: 'Tôi gặp bạn.' },
      { kr: '음악을 들어요.', vn: 'Tôi nghe nhạc.' },
      { kr: '책을 읽고 공부해요.', vn: 'Tôi đọc sách và học tập.' },
      { kr: '운동하고 쉬어요.', vn: 'Tôi tập thể dục rồi nghỉ ngơi.' },
    ],
  },
  {
    id: 8,
    title: '이번 주말에 뭐 해요?',
    topic: 'Cuối tuần này làm gì? — Kế hoạch & Thời gian',
    grammar: ['이번/다음 + 시간', '~에 (thời gian)', '~고 싶어요 (muốn làm gì)', 'N하고 같이'],
    vocab: [
      { kr: '주말', rom: 'jumal', vn: 'Cuối tuần' },
      { kr: '이번', rom: 'ibeon', vn: 'Lần này / Tuần này' },
      { kr: '다음', rom: 'daeum', vn: 'Tiếp theo / Sau' },
      { kr: '영화', rom: 'yeonghwa', vn: 'Phim' },
      { kr: '여행', rom: 'yeohaeng', vn: 'Du lịch' },
      { kr: '쇼핑', rom: 'syoping', vn: 'Mua sắm' },
      { kr: '등산', rom: 'deungsan', vn: 'Leo núi' },
      { kr: '같이', rom: 'gachi', vn: 'Cùng nhau' },
      { kr: '고 싶어요', rom: 'go sipeoyo', vn: 'Muốn (làm gì)' },
      { kr: '재미있어요', rom: 'jaemiisseoyo', vn: 'Thú vị / Vui' },
    ],
    sampleSentences: [
      { kr: '이번 주말에 뭐 해요?', vn: 'Cuối tuần này bạn làm gì?' },
      { kr: '영화를 보고 싶어요.', vn: 'Tôi muốn xem phim.' },
      { kr: '같이 쇼핑하고 싶어요.', vn: 'Tôi muốn đi mua sắm cùng nhau.' },
      { kr: '다음 주에 여행해요.', vn: 'Tuần sau tôi đi du lịch.' },
      { kr: '등산이 재미있어요.', vn: 'Leo núi thú vị.' },
    ],
  },
  {
    id: 9,
    title: '날씨가 어때요?',
    topic: 'Thời tiết & Mùa trong năm',
    grammar: ['형용사 + 아/어요', 'N이/가 어때요?', '~아서/어서 (vì... nên...)', '봄/여름/가을/겨울'],
    vocab: [
      { kr: '날씨', rom: 'nalsi', vn: 'Thời tiết' },
      { kr: '더워요', rom: 'deowoyo', vn: 'Nóng' },
      { kr: '추워요', rom: 'chuwoyo', vn: 'Lạnh' },
      { kr: '따뜻해요', rom: 'ttatteutaeyo', vn: 'Ấm áp' },
      { kr: '시원해요', rom: 'siwonhaeyo', vn: 'Mát mẻ' },
      { kr: '비가 와요', rom: 'biga wayo', vn: 'Trời mưa' },
      { kr: '눈이 와요', rom: 'nuni wayo', vn: 'Trời tuyết' },
      { kr: '맑아요', rom: 'malgayo', vn: 'Trời trong / Quang đãng' },
      { kr: '봄', rom: 'bom', vn: 'Mùa xuân' },
      { kr: '여름', rom: 'yeoreum', vn: 'Mùa hè' },
      { kr: '가을', rom: 'gaeul', vn: 'Mùa thu' },
      { kr: '겨울', rom: 'gyeoul', vn: 'Mùa đông' },
    ],
    sampleSentences: [
      { kr: '오늘 날씨가 어때요?', vn: 'Hôm nay thời tiết thế nào?' },
      { kr: '너무 더워요.', vn: 'Nóng quá.' },
      { kr: '봄에는 따뜻해요.', vn: 'Mùa xuân thì ấm áp.' },
      { kr: '비가 와서 우산을 써요.', vn: 'Trời mưa nên tôi dùng ô.' },
      { kr: '겨울에 눈이 와요.', vn: 'Mùa đông có tuyết.' },
    ],
  },
  {
    id: 10,
    title: '가족을 소개해요',
    topic: 'Giới thiệu gia đình — Từ xưng hô gia đình',
    grammar: ['저의/제 + N (của tôi)', 'N이/가 있어요/없어요', '~는/은 (chủ đề)', '몇 명이에요?'],
    vocab: [
      { kr: '가족', rom: 'gajok', vn: 'Gia đình' },
      { kr: '아버지', rom: 'abeoji', vn: 'Bố / Cha' },
      { kr: '어머니', rom: 'eomeoni', vn: 'Mẹ' },
      { kr: '오빠', rom: 'oppa', vn: 'Anh trai (nữ gọi)' },
      { kr: '언니', rom: 'eonni', vn: 'Chị gái (nữ gọi)' },
      { kr: '형', rom: 'hyeong', vn: 'Anh trai (nam gọi)' },
      { kr: '누나', rom: 'nuna', vn: 'Chị gái (nam gọi)' },
      { kr: '남동생', rom: 'namdongsaeng', vn: 'Em trai' },
      { kr: '여동생', rom: 'yeodongsaeng', vn: 'Em gái' },
      { kr: '할아버지', rom: 'harabeoji', vn: 'Ông' },
      { kr: '할머니', rom: 'halmeoni', vn: 'Bà' },
    ],
    sampleSentences: [
      { kr: '우리 가족은 네 명이에요.', vn: 'Gia đình tôi có bốn người.' },
      { kr: '제 아버지는 선생님이에요.', vn: 'Bố tôi là giáo viên.' },
      { kr: '여동생이 있어요.', vn: 'Tôi có em gái.' },
      { kr: '오빠는 회사원이에요.', vn: 'Anh trai là nhân viên công ty.' },
      { kr: '할머니는 집에 계세요.', vn: 'Bà đang ở nhà.' },
    ],
  },
  {
    id: 11,
    title: '무엇을 배워요?',
    topic: 'Học gì? — Trường học & Môn học',
    grammar: ['~을/를 배워요', '~에서 (nơi thực hiện)', 'N이/가 어려워요/쉬워요'],
    vocab: [
      { kr: '배워요', rom: 'baeweoyo', vn: 'Học / Học được' },
      { kr: '가르쳐요', rom: 'gareucheoyo', vn: 'Dạy' },
      { kr: '수업', rom: 'sueop', vn: 'Lớp học' },
      { kr: '숙제', rom: 'sukje', vn: 'Bài tập về nhà' },
      { kr: '시험', rom: 'siheom', vn: 'Kỳ thi' },
      { kr: '어려워요', rom: 'eoryeowoyo', vn: 'Khó' },
      { kr: '쉬워요', rom: 'swiwoyo', vn: 'Dễ' },
      { kr: '도서관', rom: 'doseogwan', vn: 'Thư viện' },
      { kr: '교실', rom: 'gyosil', vn: 'Phòng học' },
    ],
    sampleSentences: [
      { kr: '저는 한국어를 배워요.', vn: 'Tôi học tiếng Hàn.' },
      { kr: '도서관에서 공부해요.', vn: 'Tôi học ở thư viện.' },
      { kr: '한국어 시험이 어려워요.', vn: 'Bài thi tiếng Hàn khó.' },
      { kr: '숙제를 해요.', vn: 'Tôi làm bài tập về nhà.' },
      { kr: '한국어가 재미있어요.', vn: 'Tiếng Hàn thú vị.' },
    ],
  },
  {
    id: 12,
    title: '지하철을 타요',
    topic: 'Đi lại bằng phương tiện giao thông',
    grammar: ['N을/를 타요', '~에서 ~까지', 'N으로/로 가요', '얼마나 걸려요?'],
    vocab: [
      { kr: '지하철', rom: 'jihacheol', vn: 'Tàu điện ngầm' },
      { kr: '버스', rom: 'beoseu', vn: 'Xe buýt' },
      { kr: '택시', rom: 'taeksi', vn: 'Taxi' },
      { kr: '비행기', rom: 'bihaenggi', vn: 'Máy bay' },
      { kr: '기차', rom: 'gicha', vn: 'Tàu hỏa' },
      { kr: '타요', rom: 'tayo', vn: 'Lên / Đi (phương tiện)' },
      { kr: '내려요', rom: 'naeryeoyo', vn: 'Xuống (phương tiện)' },
      { kr: '걸려요', rom: 'geollyeoyo', vn: 'Mất (thời gian)' },
      { kr: '까지', rom: 'kkaji', vn: 'Đến (điểm cuối)' },
      { kr: '역', rom: 'yeok', vn: 'Ga' },
    ],
    sampleSentences: [
      { kr: '지하철을 타요.', vn: 'Tôi đi tàu điện ngầm.' },
      { kr: '집에서 학교까지 버스를 타요.', vn: 'Từ nhà đến trường tôi đi xe buýt.' },
      { kr: '얼마나 걸려요?', vn: 'Mất bao lâu?' },
      { kr: '삼십 분 걸려요.', vn: 'Mất 30 phút.' },
      { kr: '다음 역에서 내려요.', vn: 'Tôi xuống ở ga tiếp theo.' },
    ],
  },
  {
    id: 13,
    title: '어제 뭐 했어요?',
    topic: 'Hôm qua làm gì? — Thì quá khứ',
    grammar: ['동사 + 았/었어요 (quá khứ)', '어제/그저께', '~에 갔어요'],
    vocab: [
      { kr: '어제', rom: 'eoje', vn: 'Hôm qua' },
      { kr: '그저께', rom: 'geujeokkae', vn: 'Hôm kia' },
      { kr: '지난주', rom: 'jinannju', vn: 'Tuần trước' },
      { kr: '갔어요', rom: 'gasseoyo', vn: 'Đã đi' },
      { kr: '봤어요', rom: 'bwasseoyo', vn: 'Đã xem' },
      { kr: '먹었어요', rom: 'meogeosseoyo', vn: 'Đã ăn' },
      { kr: '만났어요', rom: 'mannasseoyo', vn: 'Đã gặp' },
      { kr: '공부했어요', rom: 'gongbuhaesseoyo', vn: 'Đã học' },
      { kr: '재미있었어요', rom: 'jaemiisseosseoyo', vn: 'Đã thú vị' },
      { kr: '피곤했어요', rom: 'pigonhaesseoyo', vn: 'Đã mệt' },
    ],
    sampleSentences: [
      { kr: '어제 뭐 했어요?', vn: 'Hôm qua bạn làm gì?' },
      { kr: '친구를 만났어요.', vn: 'Tôi đã gặp bạn.' },
      { kr: '영화를 봤어요.', vn: 'Tôi đã xem phim.' },
      { kr: '어제 공부를 많이 했어요.', vn: 'Hôm qua tôi đã học nhiều.' },
      { kr: '재미있었어요.', vn: 'Đã rất vui.' },
    ],
  },
  {
    id: 14,
    title: '전화번호가 뭐예요?',
    topic: 'Số điện thoại & Liên lạc',
    grammar: ['N이/가 뭐예요?', '한자어 숫자 đọc số', 'N 좀 알려 주세요'],
    vocab: [
      { kr: '전화번호', rom: 'jeonhwabeonho', vn: 'Số điện thoại' },
      { kr: '이메일', rom: 'imeil', vn: 'Email' },
      { kr: '주소', rom: 'juso', vn: 'Địa chỉ' },
      { kr: '알려 주세요', rom: 'allyeo juseyo', vn: 'Làm ơn cho tôi biết' },
      { kr: '문자', rom: 'munja', vn: 'Tin nhắn SMS' },
      { kr: '연락해요', rom: 'yeollakaeyo', vn: 'Liên lạc' },
      { kr: '받아요', rom: 'badayo', vn: 'Nhận' },
      { kr: '보내요', rom: 'bonaeyo', vn: 'Gửi' },
    ],
    sampleSentences: [
      { kr: '전화번호가 뭐예요?', vn: 'Số điện thoại của bạn là gì?' },
      { kr: '이메일 주소 좀 알려 주세요.', vn: 'Làm ơn cho tôi biết địa chỉ email.' },
      { kr: '문자 보내요.', vn: 'Tôi gửi tin nhắn.' },
      { kr: '나중에 연락해요.', vn: 'Sau này liên lạc nhé.' },
    ],
  },
  {
    id: 15,
    title: '취미가 뭐예요?',
    topic: 'Sở thích & Thời gian rảnh',
    grammar: ['취미가 뭐예요?', '~을/를 좋아해요', '~도 (cũng)'],
    vocab: [
      { kr: '취미', rom: 'chwimi', vn: 'Sở thích' },
      { kr: '독서', rom: 'dokseo', vn: 'Đọc sách' },
      { kr: '요리', rom: 'yori', vn: 'Nấu ăn' },
      { kr: '게임', rom: 'geim', vn: 'Chơi game' },
      { kr: '그림', rom: 'geurim', vn: 'Vẽ tranh' },
      { kr: '음악', rom: 'eumak', vn: 'Âm nhạc' },
      { kr: '좋아해요', rom: 'joahaeyo', vn: 'Thích' },
      { kr: '싫어해요', rom: 'sireohaeyo', vn: 'Không thích' },
      { kr: '자주', rom: 'jaju', vn: 'Thường xuyên' },
      { kr: '가끔', rom: 'gakkeum', vn: 'Đôi khi' },
    ],
    sampleSentences: [
      { kr: '취미가 뭐예요?', vn: 'Sở thích của bạn là gì?' },
      { kr: '저는 독서를 좋아해요.', vn: 'Tôi thích đọc sách.' },
      { kr: '음악 듣는 것을 좋아해요.', vn: 'Tôi thích nghe nhạc.' },
      { kr: '저도 요리를 좋아해요.', vn: 'Tôi cũng thích nấu ăn.' },
      { kr: '가끔 게임해요.', vn: 'Đôi khi tôi chơi game.' },
    ],
  },
  {
    id: 16,
    title: '몸이 아파요',
    topic: 'Sức khỏe & Bệnh tật',
    grammar: ['N이/가 아파요', '어디가 아파요?', '~아야/어야 돼요 (phải...)'],
    vocab: [
      { kr: '아파요', rom: 'apayo', vn: 'Đau / Bệnh' },
      { kr: '머리', rom: 'meori', vn: 'Đầu' },
      { kr: '배', rom: 'bae', vn: 'Bụng' },
      { kr: '목', rom: 'mok', vn: 'Cổ họng' },
      { kr: '열이 나요', rom: 'yeori nayo', vn: 'Bị sốt' },
      { kr: '기침해요', rom: 'gichimhaeyo', vn: 'Ho' },
      { kr: '약', rom: 'yak', vn: 'Thuốc' },
      { kr: '병원에 가요', rom: 'byeongwone gayo', vn: 'Đi bệnh viện' },
      { kr: '괜찮아요', rom: 'gwaenchanhayo', vn: 'Ổn / Không sao' },
    ],
    sampleSentences: [
      { kr: '어디가 아파요?', vn: 'Bạn đau ở đâu?' },
      { kr: '머리가 아파요.', vn: 'Tôi bị đau đầu.' },
      { kr: '열이 나요.', vn: 'Tôi bị sốt.' },
      { kr: '병원에 가야 돼요.', vn: 'Bạn phải đi bệnh viện.' },
      { kr: '약을 먹고 쉬어야 돼요.', vn: 'Bạn cần uống thuốc và nghỉ ngơi.' },
    ],
  },
  {
    id: 17,
    title: '옷이 마음에 들어요?',
    topic: 'Quần áo & Mua sắm',
    grammar: ['마음에 들어요/안 들어요', 'N이/가 어때요?', '더 + 형용사'],
    vocab: [
      { kr: '옷', rom: 'ot', vn: 'Quần áo' },
      { kr: '티셔츠', rom: 'tisyeocheu', vn: 'Áo phông' },
      { kr: '바지', rom: 'baji', vn: 'Quần' },
      { kr: '치마', rom: 'chima', vn: 'Váy' },
      { kr: '신발', rom: 'sinbal', vn: 'Giày' },
      { kr: '마음에 들어요', rom: 'maeume deureoyo', vn: 'Thích / Vừa ý' },
      { kr: '크다', rom: 'keuda', vn: 'To / Rộng' },
      { kr: '작다', rom: 'jakda', vn: 'Nhỏ / Chật' },
      { kr: '다른', rom: 'dareun', vn: 'Khác' },
    ],
    sampleSentences: [
      { kr: '이 옷이 마음에 들어요?', vn: 'Bạn có thích bộ quần áo này không?' },
      { kr: '네, 마음에 들어요.', vn: 'Vâng, tôi thích.' },
      { kr: '조금 커요. 작은 거 있어요?', vn: 'Hơi rộng. Có cái nhỏ hơn không?' },
      { kr: '다른 색 있어요?', vn: 'Có màu khác không?' },
      { kr: '이 신발이 예뻐요.', vn: 'Đôi giày này đẹp.' },
    ],
  },
  {
    id: 18,
    title: '음식을 만들어요',
    topic: 'Nấu ăn & Công thức',
    grammar: ['먼저 ~ 다음에 ~', '~고 나서 (sau khi...)', '~(으)세요 (mệnh lệnh lịch sự)'],
    vocab: [
      { kr: '만들어요', rom: 'mandureoyo', vn: 'Làm / Chế biến' },
      { kr: '넣어요', rom: 'neoheoyo', vn: 'Cho vào' },
      { kr: '끓여요', rom: 'kkeulyeoyo', vn: 'Đun sôi' },
      { kr: '볶아요', rom: 'bokkayo', vn: 'Xào' },
      { kr: '썰어요', rom: 'sseoreoyo', vn: 'Thái / Cắt' },
      { kr: '먼저', rom: 'meonjeo', vn: 'Đầu tiên' },
      { kr: '다음에', rom: 'daeume', vn: 'Sau đó' },
      { kr: '간장', rom: 'ganjang', vn: 'Nước tương' },
    ],
    sampleSentences: [
      { kr: '불고기를 만들어요.', vn: 'Tôi làm thịt nướng.' },
      { kr: '먼저 고기를 썰어요.', vn: 'Đầu tiên thái thịt.' },
      { kr: '간장을 조금 넣어요.', vn: 'Cho một ít nước tương vào.' },
      { kr: '볶고 나서 먹어요.', vn: 'Sau khi xào xong thì ăn.' },
    ],
  },
  {
    id: 19,
    title: '여행을 가고 싶어요',
    topic: 'Du lịch & Đặt phòng',
    grammar: ['~고 싶어요/싶지 않아요', '~(으)ㄹ 수 있어요/없어요'],
    vocab: [
      { kr: '여행', rom: 'yeohaeng', vn: 'Du lịch' },
      { kr: '호텔', rom: 'hotel', vn: 'Khách sạn' },
      { kr: '예약', rom: 'yeyak', vn: 'Đặt trước' },
      { kr: '관광', rom: 'gwangwang', vn: 'Tham quan' },
      { kr: '사진을 찍어요', rom: 'sajineul jjigeoyo', vn: 'Chụp ảnh' },
      { kr: '지도', rom: 'jido', vn: 'Bản đồ' },
      { kr: '추천해요', rom: 'ucheonhaeyo', vn: 'Giới thiệu / Khuyên' },
    ],
    sampleSentences: [
      { kr: '한국에 여행을 가고 싶어요.', vn: 'Tôi muốn đi du lịch Hàn Quốc.' },
      { kr: '호텔을 예약할 수 있어요?', vn: 'Tôi có thể đặt phòng không?' },
      { kr: '사진을 찍어도 돼요?', vn: 'Tôi có thể chụp ảnh không?' },
      { kr: '길을 잃었어요. 도와주세요.', vn: 'Tôi bị lạc đường. Làm ơn giúp tôi.' },
      { kr: '어디를 추천해요?', vn: 'Bạn giới thiệu đi đâu?' },
    ],
  },
  {
    id: 20,
    title: '한국 생활이 어때요?',
    topic: 'Cuộc sống ở Hàn Quốc — Trải nghiệm',
    grammar: ['~(으)ㄴ 것 같아요', '~지만 (nhưng)', '~아/어 보이다'],
    vocab: [
      { kr: '생활', rom: 'saenghwal', vn: 'Cuộc sống' },
      { kr: '적응해요', rom: 'jeogeunghaeyo', vn: 'Thích nghi' },
      { kr: '힘들어요', rom: 'himdureoyo', vn: 'Vất vả / Khó khăn' },
      { kr: '그렇지만', rom: 'geureochiman', vn: 'Nhưng mà' },
      { kr: '점점', rom: 'jeomjeom', vn: 'Dần dần' },
      { kr: '익숙해요', rom: 'iksukaeyo', vn: 'Quen rồi' },
      { kr: '그리워요', rom: 'geuriwoyo', vn: 'Nhớ / Nhớ nhà' },
      { kr: '행복해요', rom: 'haengbokaeyo', vn: 'Hạnh phúc' },
    ],
    sampleSentences: [
      { kr: '한국 생활이 어때요?', vn: 'Cuộc sống ở Hàn Quốc thế nào?' },
      { kr: '처음에는 힘들었지만 지금은 익숙해요.', vn: 'Lúc đầu vất vả nhưng bây giờ quen rồi.' },
      { kr: '음식이 좀 달라요.', vn: 'Thức ăn hơi khác một chút.' },
      { kr: '베트남이 그리워요.', vn: 'Tôi nhớ Việt Nam.' },
      { kr: '점점 행복해져요.', vn: 'Dần dần trở nên hạnh phúc hơn.' },
    ],
  },
];

// ---- STATE ----
let spState = { lessonIdx: 0, total: 0, correct: 0, currentQuestion: null, answered: false };

// ---- INIT ----
function initSentencePractice() {
  const sel = document.getElementById('spLessonSelect');
  if (!sel) return;
  sel.innerHTML = SP_BOOK_DATA.map((b, i) =>
    `<option value="${i}">Bài ${b.id}: ${b.title}</option>`
  ).join('');
  sel.value = String(spState.lessonIdx);
  spUpdateLesson();
  spUpdateStatsDisplay();
}

function spUpdateLesson() {
  const sel = document.getElementById('spLessonSelect');
  if (!sel) return;
  spState.lessonIdx = parseInt(sel.value) || 0;
  const lesson = SP_BOOK_DATA[spState.lessonIdx];
  const banner = document.getElementById('spLessonBanner');
  if (banner && lesson) {
    banner.innerHTML = `<div style="width:100%">
      <div class="sp-banner-title">📚 Bài ${lesson.id}: ${lesson.title}</div>
      <div class="sp-banner-topic">🎯 Chủ đề: ${lesson.topic}</div>
      <div class="sp-banner-tags">${lesson.grammar.map(g=>`<span class="sp-banner-tag">📐 ${g}</span>`).join('')}</div>
      <div class="sp-banner-vocab" style="margin-top:8px">📝 Từ vựng: ${lesson.vocab.slice(0,6).map(v=>`<strong>${v.kr}</strong> (${v.vn})`).join(', ')}${lesson.vocab.length>6?'...':''}</div>
    </div>`;
  }
  const wrap = document.getElementById('spExerciseWrap');
  if (wrap) wrap.style.display = 'none';
}

// ---- GENERATE ----
async function spGenerate() {
  if (!GEMINI.getKey()) { showToast('AI chưa được Admin cấu hình!','error'); return; }
  const lesson = SP_BOOK_DATA[spState.lessonIdx];
  const dirSel = document.getElementById('spDirectionSelect');
  const typeSel = document.getElementById('spTypeSelect');
  let dir = dirSel ? dirSel.value : 'vn2kr';
  if (dir === 'random') dir = Math.random() > 0.5 ? 'vn2kr' : 'kr2vn';
  const type = typeSel ? typeSel.value : 'sentence';

  document.getElementById('spLoading').style.display = 'block';
  document.getElementById('spExerciseWrap').style.display = 'none';
  const genBtn = document.getElementById('spGenBtn');
  if (genBtn) { genBtn.disabled = true; genBtn.innerHTML = '<span>⏳</span> Đang tạo...'; }

  try {
    const q = await spCallAI(lesson, dir, type);
    spState.currentQuestion = q; spState.answered = false;
    spRenderQuestion(q, dir);
  } catch(e) {
    if (!spState.recentQuestions) spState.recentQuestions = [];
    const unusedSamples = lesson.sampleSentences.filter(s => !spState.recentQuestions.includes(s.kr) && !spState.recentQuestions.includes(s.vn));
    const pool = unusedSamples.length > 0 ? unusedSamples : lesson.sampleSentences;
    const s = pool[Math.floor(Math.random() * pool.length)];
    const qText = dir === 'vn2kr' ? s.vn : s.kr;
    const aText = dir === 'vn2kr' ? s.kr : s.vn;
    const q = { direction: dir, questionText: qText, answerText: aText,
      hint:'(Câu từ sách)', vocabHints: lesson.vocab.slice(0,3).map(v=>v.kr), grammarNote: lesson.grammar[0]||'', explanation:'' };
    spState.recentQuestions.push(qText);
    if (spState.recentQuestions.length > 20) spState.recentQuestions.shift();
    spState.currentQuestion = q; spState.answered = false;
    spRenderQuestion(q, dir);
    showToast('AI lỗi, dùng câu mẫu từ sách.','warning');
  } finally {
    document.getElementById('spLoading').style.display = 'none';
    if (genBtn) { genBtn.disabled = false; genBtn.innerHTML = '<span>✨</span> Tạo câu bài tập'; }
  }
}

async function spCallAI(lesson, direction, type) {
  if (!spState.recentQuestions) spState.recentQuestions = [];
  const vocabList = lesson.vocab.map(v=>`${v.kr}=${v.vn}`).join(', ');
  const grammarList = lesson.grammar.join(', ');
  const samples = lesson.sampleSentences.map(s=>`[KR]${s.kr}|[VN]${s.vn}`).join('\n');
  const avoidStr = spState.recentQuestions.length > 0
    ? `\nCÁC CÂU ĐÃ TẠO TRƯỚC ĐÂY (TUYỆT ĐỐI KHÔNG LẶP LẠI CÁC CÂU NÀY): \n${spState.recentQuestions.slice(-10).map(q => `- ${q}`).join('\n')}\n`
    : '';

  const typeInstruct = { sentence:'Tạo câu giao tiếp tự nhiên phù hợp chủ đề.',
    vocab:`Tạo câu dùng ít nhất một trong: ${lesson.vocab.slice(0,4).map(v=>v.kr).join(', ')}.`,
    grammar:`Tạo câu áp dụng ngữ pháp: ${lesson.grammar[0]||''}. ` }[type]||'Tạo câu ngắn gọn.';
  const langFrom = direction==='vn2kr'?'tiếng Việt':'tiếng Hàn';
  const langTo   = direction==='vn2kr'?'tiếng Hàn':'tiếng Việt';
  const prompt = `Bạn là giáo viên dạy sách "Tiếng Hàn Tổng Hợp Sơ cấp 1".
Bài ${lesson.id}: ${lesson.title}
Chủ đề: ${lesson.topic}
Ngữ pháp: ${grammarList}
Từ vựng: ${vocabList}
Câu mẫu chuẩn:
${samples}
${avoidStr}
QUY TẮC NGHIÊM NGẶT (PHẢI THỰC HIỆN ĐÚNG 100%):
1. LOGIC THỰC TẾ 100%: Nội dung câu phải thực tế và hợp lý trong cuộc sống. CẤM các câu phi lý (CẤM: em lớn tuổi hơn anh/chị, đồ vật biết nói, thời gian sai bét...).
2. DỊCH CHUẨN XÁC & SÁT NGHĨA 100%: Câu tiếng Việt và tiếng Hàn phải tương đương nghĩa tuyệt đối, chuẩn ngữ pháp Sơ cấp 1.
3. NHIỆM VỤ: ${typeInstruct} Câu cho "${langFrom}" → học viên dịch sang "${langTo}".

JSON trả về:
{"questionText":"câu ${langFrom} chuẩn logic","answerText":"đáp án ${langTo} dịch sát nghĩa","hint":"gợi ý ngắn","vocabHints":["từ1","từ2"],"grammarNote":"cấu trúc ngữ pháp","explanation":"giải thích tiếng Việt"}`;
  const raw = await GEMINI.call(prompt, '', { temperature:0.3, maxOutputTokens:512 });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Bad JSON');
  const p = JSON.parse(match[0]);

  if (p.questionText) {
    spState.recentQuestions.push(p.questionText);
    if (spState.recentQuestions.length > 20) spState.recentQuestions.shift();
  }

  return { direction, questionText:p.questionText||'', answerText:p.answerText||'',
    hint:p.hint||'', vocabHints:Array.isArray(p.vocabHints)?p.vocabHints:[],
    grammarNote:p.grammarNote||'', explanation:p.explanation||'' };
}

function spRenderQuestion(q, direction) {
  document.getElementById('spExerciseWrap').style.display = 'block';
  document.getElementById('spDirBadge').textContent = direction==='vn2kr'?'🇻🇳 → 🇰🇷 Dịch sang Tiếng Hàn':'🇰🇷 → 🇻🇳 Dịch sang Tiếng Việt';
  document.getElementById('spQuestionLabel').textContent = direction==='vn2kr'?'Dịch câu sau sang tiếng Hàn:':'Dịch câu sau sang tiếng Việt:';
  document.getElementById('spQuestionSentence').textContent = q.questionText;
  document.getElementById('spQuestionHint').textContent = q.hint||'';
  const lesson = SP_BOOK_DATA[spState.lessonIdx];
  const hc = document.getElementById('spVocabHints');
  if (q.vocabHints && q.vocabHints.length) {
    hc.innerHTML = '<span style="font-size:.75rem;color:var(--text-muted);margin-right:4px">💡 Từ gợi ý:</span>'+
      q.vocabHints.map(hk=>{ const v=lesson.vocab.find(lv=>lv.kr===hk||lv.kr.includes(hk))||{kr:hk,vn:''};
        return `<span class="sp-hint-chip"><span class="sp-hint-kr">${v.kr}</span>${v.vn?' = '+v.vn:''}</span>`; }).join('');
  } else { hc.innerHTML=''; }
  const inp = document.getElementById('spAnswerInput');
  inp.value=''; inp.disabled=false;
  document.getElementById('spFeedback').style.display='none';
  document.getElementById('spNextActions').style.display='none';
  document.getElementById('spAnswerActions').style.display='flex';
  document.getElementById('spCheckBtn').style.display='';
  document.getElementById('spShowBtn').style.display='';
  setTimeout(()=>inp.focus(),100);
}

// ---- CHECK ----
async function spCheckAnswer() {
  if (spState.answered) return;
  const q = spState.currentQuestion; if (!q) return;
  const userAnswer = (document.getElementById('spAnswerInput').value||'').trim();
  if (!userAnswer) { showToast('Nhập câu dịch của bạn trước!','warning'); return; }
  spState.answered = true; spState.total++;
  spState.lastUserAnswer = userAnswer;
  const btn = document.getElementById('spCheckBtn');
  if (btn) { btn.disabled=true; btn.textContent='⏳ AI đang chấm...'; }
  try {
    const result = await spAIGrade(q, userAnswer);
    spShowFeedback(result, q, userAnswer);
    if (result.score >= 70) spState.correct++;
  } catch(e) {
    const ok = spBasicCheck(userAnswer, q.answerText);
    spShowFeedback({score:ok?100:30,verdict:ok?'correct':'wrong',note:'',corrected:q.answerText,explanation:q.explanation||''}, q, userAnswer);
    if (ok) spState.correct++;
  } finally { if (btn){btn.disabled=false;btn.textContent='✅ Kiểm tra';} }
  document.getElementById('spAnswerInput').disabled=true;
  document.getElementById('spAnswerActions').style.display='none';
  document.getElementById('spNextActions').style.display='flex';
  spUpdateStatsDisplay(); addXP(5);
}

async function spAIGrade(q, userAnswer) {
  const lesson = SP_BOOK_DATA[spState.lessonIdx];
  const dir = q.direction==='vn2kr'?'Tiếng Việt → Tiếng Hàn':'Tiếng Hàn → Tiếng Việt';
  const prompt = `Chấm bài dịch tiếng Hàn cho học sinh Việt Nam.\nBài ${lesson.id}: ${lesson.title}\nChiều dịch: ${dir}\nCâu gốc: "${q.questionText}"\nĐáp án chuẩn: "${q.answerText}"\nCâu học sinh: "${userAnswer}"\n${q.grammarNote?`Ngữ pháp: ${q.grammarNote}`:''}\n\nJSON: {"score":<0-100>,"verdict":"<correct|partial|wrong>","note":"nhận xét 1-2 câu tiếng Việt","corrected":"câu đúng","explanation":"giải thích ngữ pháp tiếng Việt"}`;
  const raw = await GEMINI.call(prompt,'',{temperature:0.3,maxOutputTokens:400});
  const match = raw.match(/\{[\s\S]*\}/); if (!match) throw new Error('Bad JSON');
  return JSON.parse(match[0]);
}

function spBasicCheck(user, correct) {
  const n = s=>s.toLowerCase().replace(/[.,!?]/g,'').trim();
  return n(user)===n(correct);
}

function spShowFeedback(result, q, userAnswer) {
  const fb = document.getElementById('spFeedback');
  fb.style.display='block';
  const score = result.score||0;
  let cls, icon;
  if (score>=85){cls='sp-ok';icon='🎉';} else if(score>=50){cls='sp-wrong';icon='🤔';} else{cls='sp-wrong';icon='❌';}
  const scoreColor = score>=85?'var(--green)':score>=50?'var(--gold)':'#ef4444';
  const userText = userAnswer || spState.lastUserAnswer || '';
  fb.className=`sp-feedback ${cls}`;
  fb.innerHTML=`
    <div class="sp-fb-header">${icon} ${score>=85?'Xuất sắc!':score>=50?'Gần đúng rồi!':'Chưa chính xác'}</div>
    <div class="sp-fb-score">Điểm: <span class="sp-score-val" style="color:${scoreColor}">${score}/100</span>${result.verdict==='partial'?'<span style="color:var(--gold);margin-left:8px">— Đúng một phần</span>':''}</div>
    ${result.note?`<div class="sp-fb-explanation">📝 ${result.note}</div>`:''}
    <div style="margin-top:10px;display:grid;gap:8px">
      ${userText ? `
      <div style="padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;">
        <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:2px">✏️ Câu bạn đã nhập:</div>
        <div style="font-weight:600;color:var(--text-primary);font-family:'Noto Sans KR',sans-serif">${escStr(userText)}</div>
      </div>` : ''}
      <div style="padding:10px 14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:10px;">
        <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:2px">✅ Đáp án chuẩn:</div>
        <div style="font-weight:700;color:var(--green);font-family:'Noto Sans KR',sans-serif">${escStr(result.corrected||q.answerText)}</div>
      </div>
    </div>
    ${result.explanation?`<div class="sp-fb-grammar-notes"><strong>📐 Giải thích:</strong><br>${result.explanation}</div>`:''}
    ${q.grammarNote?`<div style="margin-top:8px;font-size:.8rem;color:var(--text-muted)">💡 Cấu trúc: <em>${q.grammarNote}</em></div>`:''}`;
}

function spShowAnswer() {
  if (spState.answered) return;
  const q = spState.currentQuestion; if (!q) return;
  spState.answered=true; spState.total++;
  const fb = document.getElementById('spFeedback');
  fb.style.display='block'; fb.className='sp-feedback sp-reveal';
  fb.innerHTML=`<div class="sp-fb-header">👁 Đáp án</div><div class="sp-fb-answer">${q.answerText}</div>
    ${q.explanation?`<div class="sp-fb-grammar-notes"><strong>📐 Giải thích:</strong><br>${q.explanation}</div>`:''}
    ${q.grammarNote?`<div style="margin-top:8px;font-size:.8rem;color:var(--text-muted)">💡 Cấu trúc: <em>${q.grammarNote}</em></div>`:''}`;
  document.getElementById('spAnswerInput').disabled=true;
  document.getElementById('spAnswerActions').style.display='none';
  document.getElementById('spNextActions').style.display='flex';
  spUpdateStatsDisplay();
}

function spListenQuestion() {
  const q = spState.currentQuestion; if (!q) return;
  const krText = q.direction==='vn2kr'?q.answerText:q.questionText;
  if (krText) TTS.speak(krText);
}

function spRetryCurrent() {
  spState.answered = false;
  const q = spState.currentQuestion; if (!q) return;
  const inp = document.getElementById('spAnswerInput');
  if (inp) {
    inp.disabled = false;
    if (spState.lastUserAnswer) inp.value = spState.lastUserAnswer;
    setTimeout(() => {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 50);
  }
  document.getElementById('spFeedback').style.display = 'none';
  document.getElementById('spNextActions').style.display = 'none';
  document.getElementById('spAnswerActions').style.display = 'flex';
}

function spReset() {
  spState.answered=false;
  spState.lastUserAnswer = '';
  const q = spState.currentQuestion; if (!q) return;
  const inp = document.getElementById('spAnswerInput');
  inp.value=''; inp.disabled=false;
  document.getElementById('spFeedback').style.display='none';
  document.getElementById('spNextActions').style.display='none';
  document.getElementById('spAnswerActions').style.display='flex';
  setTimeout(()=>inp.focus(),50);
}

function spUpdateStatsDisplay() {
  const t=spState.total, c=spState.correct;
  const total=document.getElementById('spStatTotal'), correct=document.getElementById('spStatCorrect'), pct=document.getElementById('spStatPct');
  if(total) total.textContent=t;
  if(correct) correct.textContent=c;
  if(pct) pct.textContent=t>0?Math.round((c/t)*100)+'%':'—';
}

// ============ SPEED MATCH GAME ============
let matchState = {
  active: false,
  timerLimit: 45,
  timer: 45,
  isFrozen: false,
  freezeTimeout: null,
  timerInterval: null,
  score: 0,
  combo: 0,
  maxCombo: 0,
  selectedCard: null,
  matchedPairs: 0,
  totalPairs: 0,
  cards: [],
  lifelines: { hint: 1, time: 1, freeze: 1 }
};

function changeMatchTimeLimit(val) {
  matchState.timerLimit = parseInt(val) || 0;
  startMatchGame();
  showToast(matchState.timerLimit === 0 ? '♾️ Đã cài: Vô hạn thời gian' : `⏱️ Đã cài: ${matchState.timerLimit} giây`, 'info');
}

function initMatchGame() {
  const words = getActiveWords();
  const emptyEl = document.getElementById('matchEmpty');
  const bodyEl = document.getElementById('matchGameBody');
  if (!words || words.length < 4) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (bodyEl) bodyEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (bodyEl) bodyEl.style.display = 'block';
  const vic = document.getElementById('matchVictory');
  if (vic) vic.style.display = 'none';
  startMatchGame();
}

function startMatchGame() {
  if (matchState.timerInterval) clearInterval(matchState.timerInterval);
  if (matchState.freezeTimeout) clearTimeout(matchState.freezeTimeout);

  const words = getActiveWords();
  if (!words || words.length < 4) return;

  const pool = shuffle([...words]).slice(0, Math.min(8, words.length));
  matchState.totalPairs = pool.length;
  matchState.matchedPairs = 0;
  matchState.score = 0;
  matchState.combo = 0;
  matchState.maxCombo = 0;
  matchState.timer = matchState.timerLimit;
  matchState.isFrozen = false;
  matchState.active = true;
  matchState.selectedCard = null;

  // Reset Lifelines
  matchState.lifelines = { hint: 1, time: 1, freeze: 1 };
  updateLifelineUI();

  const timerEl = document.getElementById('matchTimer');
  const comboEl = document.getElementById('matchCombo');
  const scoreEl = document.getElementById('matchScore');
  const vic = document.getElementById('matchVictory');

  if (timerEl) timerEl.textContent = matchState.timerLimit === 0 ? '♾️' : matchState.timer;
  if (comboEl) comboEl.textContent = matchState.combo;
  if (scoreEl) scoreEl.textContent = matchState.score;
  if (vic) vic.style.display = 'none';

  const cards = [];
  pool.forEach((w, idx) => {
    cards.push({ id: `kr_${idx}`, pairId: idx, text: w.korean, type: 'kr', word: w });
    cards.push({ id: `vn_${idx}`, pairId: idx, text: w.meaning, type: 'vn', word: w });
  });

  matchState.cards = shuffle(cards);
  const grid = document.getElementById('matchGrid');
  if (grid) {
    grid.innerHTML = matchState.cards.map(c => `
      <div class="match-card ${c.type}" id="card_${c.id}" data-pair="${c.pairId}" onclick="clickMatchCard('${c.id}', ${c.pairId})">
        <span>${c.text}</span>
      </div>
    `).join('');
  }

  if (matchState.timerLimit > 0) {
    matchState.timerInterval = setInterval(() => {
      if (!matchState.active || matchState.isFrozen) return;
      matchState.timer--;
      if (timerEl) timerEl.textContent = matchState.timer;
      if (matchState.timer <= 0) {
        clearInterval(matchState.timerInterval);
        matchState.active = false;
        showToast('⌛ Hết giờ! Thử lại ván mới nhé!','warning');
      }
    }, 1000);
  }
}

function updateLifelineUI() {
  const hBtn = document.getElementById('btnHelpHint');
  const tBtn = document.getElementById('btnHelpTime');
  const fBtn = document.getElementById('btnHelpFreeze');

  const hCnt = document.getElementById('countHelpHint');
  const tCnt = document.getElementById('countHelpTime');
  const fCnt = document.getElementById('countHelpFreeze');

  if (hCnt) hCnt.textContent = matchState.lifelines.hint;
  if (tCnt) tCnt.textContent = matchState.lifelines.time;
  if (fCnt) fCnt.textContent = matchState.lifelines.freeze;

  if (hBtn) hBtn.disabled = matchState.lifelines.hint <= 0 || !matchState.active;
  if (tBtn) tBtn.disabled = matchState.lifelines.time <= 0 || !matchState.active || matchState.timerLimit === 0;
  if (fBtn) fBtn.disabled = matchState.lifelines.freeze <= 0 || !matchState.active || matchState.timerLimit === 0;
}

function useMatchHint() {
  if (!matchState.active || matchState.lifelines.hint <= 0) return;
  matchState.lifelines.hint--;
  updateLifelineUI();

  // Find first un-matched pair
  const grid = document.getElementById('matchGrid');
  if (!grid) return;
  const unmatched = Array.from(grid.querySelectorAll('.match-card:not(.matched)'));
  if (unmatched.length < 2) return;

  const pairMap = {};
  unmatched.forEach(el => {
    const p = el.getAttribute('data-pair');
    if (!pairMap[p]) pairMap[p] = [];
    pairMap[p].push(el);
  });

  const validPairs = Object.values(pairMap).filter(arr => arr.length === 2);
  if (validPairs.length > 0) {
    const pair = validPairs[0];
    pair[0].classList.add('matched');
    pair[1].classList.add('matched');
    matchState.matchedPairs++;
    matchState.score += 30;
    const scoreEl = document.getElementById('matchScore');
    if (scoreEl) scoreEl.textContent = matchState.score;
    showToast('💡 AI đã gợi ý và mở 1 cặp từ!','success');

    if (matchState.matchedPairs >= matchState.totalPairs) {
      finishMatchGame();
    }
  }
}

function useMatchTimeBonus() {
  if (!matchState.active || matchState.lifelines.time <= 0 || matchState.timerLimit === 0) return;
  matchState.lifelines.time--;
  matchState.timer += 15;
  updateLifelineUI();
  const timerEl = document.getElementById('matchTimer');
  if (timerEl) timerEl.textContent = matchState.timer;
  showToast('⏱️ +15 giây vào đồng hồ!','success');
}

function useMatchFreeze() {
  if (!matchState.active || matchState.lifelines.freeze <= 0 || matchState.timerLimit === 0) return;
  matchState.lifelines.freeze--;
  matchState.isFrozen = true;
  updateLifelineUI();

  const timerEl = document.getElementById('matchTimer');
  if (timerEl) timerEl.textContent = '❄️ 10s';
  showToast('❄️ Đã đóng băng thời gian 10 giây!','info');

  matchState.freezeTimeout = setTimeout(() => {
    matchState.isFrozen = false;
    if (timerEl) timerEl.textContent = matchState.timer;
    showToast('🔥 Đồng hồ tiếp tục chạy!','info');
  }, 10000);
}

function clickMatchCard(id, pairId) {
  if (!matchState.active) return;
  const cardEl = document.getElementById(`card_${id}`);
  if (!cardEl || cardEl.classList.contains('matched')) return;

  if (cardEl.classList.contains('kr')) {
    TTS.speak(cardEl.textContent.trim());
  }

  if (!matchState.selectedCard) {
    matchState.selectedCard = { id, pairId, el: cardEl };
    cardEl.classList.add('selected');
  } else {
    const prev = matchState.selectedCard;
    if (prev.id === id) {
      prev.el.classList.remove('selected');
      matchState.selectedCard = null;
      return;
    }

    if (prev.pairId === pairId) {
      prev.el.classList.remove('selected');
      prev.el.classList.add('matched');
      cardEl.classList.add('matched');

      matchState.combo++;
      if (matchState.combo > matchState.maxCombo) matchState.maxCombo = matchState.combo;
      const pts = 20 * matchState.combo;
      matchState.score += pts;
      matchState.matchedPairs++;

      const comboEl = document.getElementById('matchCombo');
      const scoreEl = document.getElementById('matchScore');
      if (comboEl) comboEl.textContent = matchState.combo;
      if (scoreEl) scoreEl.textContent = matchState.score;
      matchState.selectedCard = null;

      if (matchState.matchedPairs >= matchState.totalPairs) {
        finishMatchGame();
      }
    } else {
      cardEl.classList.add('wrong');
      prev.el.classList.add('wrong');
      matchState.combo = 0;
      const comboEl = document.getElementById('matchCombo');
      if (comboEl) comboEl.textContent = '0';

      setTimeout(() => {
        cardEl.classList.remove('wrong', 'selected');
        prev.el.classList.remove('wrong', 'selected');
      }, 400);
      matchState.selectedCard = null;
    }
  }
}

function finishMatchGame() {
  if (matchState.timerInterval) clearInterval(matchState.timerInterval);
  if (matchState.freezeTimeout) clearTimeout(matchState.freezeTimeout);
  matchState.active = false;
  const timeTaken = matchState.timerLimit > 0 ? (matchState.timerLimit - matchState.timer) : 30;
  const bonusXP = Math.max(10, Math.round(matchState.score / 10));
  addXP(bonusXP);

  const vicTxt = document.getElementById('victoryText');
  const vicSc = document.getElementById('vicScore');
  const vicCb = document.getElementById('vicCombo');
  const vicXP = document.getElementById('vicXP');
  const vic = document.getElementById('matchVictory');

  if (vicTxt) vicTxt.textContent = matchState.timerLimit > 0 ? `Bạn đã hoàn thành trong ${timeTaken} giây!` : `Bạn đã ghép hoàn thành xuất sắc!`;
  if (vicSc) vicSc.textContent = matchState.score;
  if (vicCb) vicCb.textContent = `${matchState.maxCombo}x`;
  if (vicXP) vicXP.textContent = `+${bonusXP} XP`;
  if (vic) vic.style.display = 'flex';
}

// ============ KOREAN NUMBERS MODULE ============
const SINO_NUMBERS_DATA = [
  { val: 0, kr: '영 / 공', rom: 'yeong / gong', note: '0 (Công trong SDT, 영 trong nhiệt độ/toán)' },
  { val: 1, kr: '일', rom: 'il', note: 'Một' },
  { val: 2, kr: '이', rom: 'i', note: 'Hai' },
  { val: 3, kr: '삼', rom: 'sam', note: 'Ba' },
  { val: 4, kr: '사', rom: 'sa', note: 'Bốn' },
  { val: 5, kr: '오', rom: 'o', note: 'Năm' },
  { val: 6, kr: '육', rom: 'yuk', note: 'Sáu' },
  { val: 7, kr: '칠', rom: 'chil', note: 'Bảy' },
  { val: 8, kr: '팔', rom: 'pal', note: 'Tám' },
  { val: 9, kr: '구', rom: 'gu', note: 'Chín' },
  { val: 10, kr: '십', rom: 'sip', note: 'Mười' },
  { val: 20, kr: '이십', rom: 'isip', note: 'Hai mươi' },
  { val: 30, kr: '삼십', rom: 'samsip', note: 'Ba mươi' },
  { val: 50, kr: '오십', rom: 'osip', note: 'Năm mươi' },
  { val: 100, kr: '백', rom: 'baek', note: 'Một trăm' },
  { val: 1000, kr: '천', rom: 'cheon', note: 'Một nghìn' },
  { val: 10000, kr: '만', rom: 'man', note: 'Mười nghìn (1 vạn)' },
  { val: 100000, kr: '십만', rom: 'singman', note: 'Một trăm nghìn' },
  { val: 1000000, kr: '백만', rom: 'baengman', note: 'Một triệu' },
  { val: 100000000, kr: '억', rom: 'eok', note: 'Một trăm triệu (1 ức)' }
];

const NATIVE_NUMBERS_DATA = [
  { val: 1, kr: '하나', rom: 'hana', countForm: '한 (한 개 - 1 cái)', note: 'Một' },
  { val: 2, kr: '둘', rom: 'dul', countForm: '두 (두 개 - 2 cái)', note: 'Hai' },
  { val: 3, kr: '셋', rom: 'set', countForm: '세 (세 개 - 3 cái)', note: 'Ba' },
  { val: 4, kr: '넷', rom: 'net', countForm: '네 (네 개 - 4 cái)', note: 'Bốn' },
  { val: 5, kr: '다섯', rom: 'daseot', countForm: '다섯 개', note: 'Năm' },
  { val: 6, kr: '여섯', rom: 'yeoseot', countForm: '여섯 개', note: 'Sáu' },
  { val: 7, kr: '일곱', rom: 'ilgop', countForm: '일곱 개', note: 'Bảy' },
  { val: 8, kr: '여덟', rom: 'yeodeol', countForm: '여덟 개', note: 'Tám' },
  { val: 9, kr: '아홉', rom: 'ahop', countForm: '아홉 개', note: 'Chín' },
  { val: 10, kr: '열', rom: 'yeol', countForm: '열 개', note: 'Mười' },
  { val: 20, kr: '스물', rom: 'seumul', countForm: '스무 (스무 살 - 20 tuổi)', note: 'Hai mươi' },
  { val: 30, kr: '서른', rom: 'seoreun', countForm: '서른 개', note: 'Ba mươi' },
  { val: 40, kr: '마흔', rom: 'maheun', countForm: '마흔 개', note: 'Bốn mươi' },
  { val: 50, kr: '쉰', rom: 'swin', countForm: '쉰 개', note: 'Năm mươi' },
  { val: 60, kr: '예순', rom: 'yesun', countForm: '예순 개', note: 'Sáu mươi' },
  { val: 70, kr: '일흔', rom: 'ilheun', countForm: '일흔 개', note: 'Bảy mươi' },
  { val: 80, kr: '여든', rom: 'yeodeun', countForm: '여든 개', note: 'Tám mươi' },
  { val: 90, kr: '아흔', rom: 'aheun', countForm: '아흔 개', note: 'Chín mươi' }
];

function initNumbersPage() {
  renderSinoTable();
  renderNativeTable();
  loadPersonalNumNotes();
}

function loadPersonalNumNotes() {
  const saved = localStorage.getItem('hq_num_personal_notes') || '';
  const textarea = document.getElementById('numPersonalNotes');
  if (textarea) textarea.value = saved;
}

let numNotesTimeout = null;
function savePersonalNumNotes(val) {
  const status = document.getElementById('numNotesStatus');
  if (status) status.textContent = '⏳ Đang lưu...';
  if (numNotesTimeout) clearTimeout(numNotesTimeout);
  numNotesTimeout = setTimeout(() => {
    localStorage.setItem('hq_num_personal_notes', val);
    if (status) status.textContent = '✔ Đã lưu';
  }, 400);
}

function renderSinoTable() {
  const grid = document.getElementById('sinoTableGrid');
  if (!grid) return;
  const meta = paginateList('sinoNumbers', SINO_NUMBERS_DATA, renderSinoTable, 20);
  grid.innerHTML = meta.pageItems.map(item => `
    <div class="num-card-item">
      <div>
        <div class="num-val">${item.val.toLocaleString()}</div>
        <div class="num-kr">${item.kr}</div>
        <div class="num-rom">[ ${item.rom} ] · ${item.note}</div>
      </div>
      <button class="mini-audio-btn" onclick="TTS.speak('${item.kr.split('/')[0].trim()}')" title="Nghe">🔊</button>
    </div>
  `).join('');
  mountListPagination(grid, 'sinoNumbers', meta, 'số');
}

function renderNativeTable() {
  const grid = document.getElementById('nativeTableGrid');
  if (!grid) return;
  const meta = paginateList('nativeNumbers', NATIVE_NUMBERS_DATA, renderNativeTable, 20);
  grid.innerHTML = meta.pageItems.map(item => `
    <div class="num-card-item">
      <div>
        <div class="num-val">${item.val}</div>
        <div class="num-kr">${item.kr}</div>
        <div class="num-rom">[ ${item.rom} ]</div>
        <div class="num-count-form">👉 Dạng đếm: ${item.countForm}</div>
      </div>
      <button class="mini-audio-btn" onclick="TTS.speak('${item.kr}')" title="Nghe">🔊</button>
    </div>
  `).join('');
  mountListPagination(grid, 'nativeNumbers', meta, 'số');
}

function switchNumTab(tab) {
  document.querySelectorAll('.num-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.num-tab-content').forEach(c => c.style.display = 'none');

  if (tab === 'sino') {
    document.getElementById('tabBtnSino').classList.add('active');
    document.getElementById('tabSino').style.display = 'block';
  } else if (tab === 'native') {
    document.getElementById('tabBtnNative').classList.add('active');
    document.getElementById('tabNative').style.display = 'block';
  } else if (tab === 'tips') {
    document.getElementById('tabBtnTips').classList.add('active');
    document.getElementById('tabTips').style.display = 'block';
  }
}

function numToSinoKorean(n) {
  if (n === 0) return '영';
  const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const bigUnits = ['', '만', '억'];

  function convertUnder10000(num) {
    if (num === 0) return '';
    let str = '';
    const d1000 = Math.floor(num / 1000);
    const d100 = Math.floor((num % 1000) / 100);
    const d10 = Math.floor((num % 100) / 10);
    const d1 = num % 10;

    if (d1000 > 0) str += (d1000 > 1 ? units[d1000] : '') + '천';
    if (d100 > 0) str += (d100 > 1 ? units[d100] : '') + '백';
    if (d10 > 0) str += (d10 > 1 ? units[d10] : '') + '십';
    if (d1 > 0) str += units[d1];
    return str;
  }

  let result = '';
  let parts = [];
  let temp = n;
  while (temp > 0) {
    parts.push(temp % 10000);
    temp = Math.floor(temp / 10000);
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const partStr = convertUnder10000(parts[i]);
    if (partStr) {
      result += partStr + (bigUnits[i] || '') + ' ';
    }
  }

  return result.trim() || '영';
}

function numToNativeKorean(n) {
  if (n <= 0 || n > 99) return 'Chỉ đếm từ 1 đến 99 (Từ 100 trở lên dùng số Hán-Hàn)';
  const tensMap = { 10:'열', 20:'스물', 30:'서른', 40:'마흔', 50:'쉰', 60:'예순', 70:'일흔', 80:'여든', 90:'아흔' };
  const onesMap = { 1:'하나', 2:'둘', 3:'셋', 4:'넷', 5:'다섯', 6:'여섯', 7:'일곱', 8:'여덟', 9:'아홉' };

  const ten = Math.floor(n / 10) * 10;
  const one = n % 10;

  if (ten === 0) return onesMap[one];
  if (one === 0) return tensMap[ten];
  return tensMap[ten] + onesMap[one];
}

function runNumConverter(val) {
  const resDiv = document.getElementById('numConvResults');
  if (!resDiv) return;
  const n = parseInt(val);
  if (isNaN(n) || n < 0) {
    resDiv.style.display = 'none';
    return;
  }

  const sinoKr = numToSinoKorean(n);
  const nativeKr = numToNativeKorean(n);

  document.getElementById('resSinoKr').textContent = sinoKr;
  document.getElementById('resSinoRom').textContent = `Dạng đọc Hán Hàn: ${sinoKr}`;

  document.getElementById('resNativeKr').textContent = nativeKr;
  document.getElementById('resNativeRom').textContent = n <= 99 ? `Dạng đọc Thuần Hàn: ${nativeKr}` : 'Từ 100 trở lên quy ước dùng hệ Hán-Hàn';

  resDiv.style.display = 'grid';
}

// ============ NOTEBOOK MODULE ============
const NB_STORAGE_KEY = 'hq_notebook_v2';
const NB_DEFAULT_TABS = [
  { id: 'tab_1', name: '📒 Ghi chú chung', content: '' },
  { id: 'tab_2', name: '📘 Từ vựng', content: '' },
  { id: 'tab_3', name: '📐 Ngữ pháp', content: '' },
];
let nbState = { tabs: [], activeTabId: null };
let nbSaveTimer = null;

function initNotebook() {
  loadNbState();
  renderNbTabs();
  // Dùng displayNbTab (không lưu-trước) cho lần hiển thị đầu tiên, vì lúc
  // này ô soạn thảo chưa có nội dung gì để lưu — nếu gọi switchNbTab ở đây
  // sẽ ghi đè nội dung đã lưu của trang đang chọn thành rỗng.
  displayNbTab(nbState.activeTabId || nbState.tabs[0]?.id);
}

function loadNbState() {
  try {
    const raw = localStorage.getItem(NB_STORAGE_KEY);
    if (raw) {
      nbState = JSON.parse(raw);
      if (!nbState.tabs || nbState.tabs.length === 0) nbState.tabs = NB_DEFAULT_TABS.map(t => ({...t}));
    } else {
      nbState = { tabs: NB_DEFAULT_TABS.map(t => ({...t})), activeTabId: NB_DEFAULT_TABS[0].id };
    }
  } catch(e) {
    nbState = { tabs: NB_DEFAULT_TABS.map(t => ({...t})), activeTabId: NB_DEFAULT_TABS[0].id };
  }
}

function saveNbState() {
  const status = document.getElementById('nbSaveStatus');
  if (status) status.textContent = '⏳ Đang lưu...';
  if (nbSaveTimer) clearTimeout(nbSaveTimer);
  nbSaveTimer = setTimeout(() => {
    localStorage.setItem(NB_STORAGE_KEY, JSON.stringify(nbState));
    if (status) status.textContent = '✔ Đã lưu';
  }, 400);
}

function renderNbTabs() {
  const bar = document.getElementById('nbTabsBar');
  if (!bar) return;
  bar.innerHTML = nbState.tabs.map(tab => `
    <div class="nb-tab ${tab.id === nbState.activeTabId ? 'active' : ''}"
         onclick="switchNbTab('${tab.id}')"
         ondblclick="renameNbTab('${tab.id}')"
         title="Nhấn đúp để đổi tên">
      ${escStr(tab.name)}
    </div>
  `).join('');
}

function switchNbTab(tabId) {
  // Save current content first (chỉ áp dụng khi đang chuyển từ 1 trang đang
  // hiển thị thật sự — nếu trang đó đã bị xóa/không tồn tại thì bỏ qua).
  const editor = document.getElementById('nbEditor');
  const currentTab = nbState.tabs.find(t => t.id === nbState.activeTabId);
  if (currentTab && editor) currentTab.content = editor.value;
  displayNbTab(tabId);
}

function displayNbTab(tabId) {
  const editor = document.getElementById('nbEditor');
  nbState.activeTabId = tabId;
  const tab = nbState.tabs.find(t => t.id === tabId);
  if (!tab || !editor) return;

  editor.value = tab.content || '';
  updateNbWordCount(editor.value);
  renderNbTabs();
  editor.focus();
}

function addNbTab() {
  const id = 'tab_' + Date.now();
  const name = '📝 Trang ' + (nbState.tabs.length + 1);
  nbState.tabs.push({ id, name, content: '' });
  saveNbState();
  renderNbTabs();
  switchNbTab(id);
}

function deleteNbTab() {
  if (nbState.tabs.length <= 1) { showToast('Cần ít nhất 1 trang!'); return; }
  if (!confirm('Xóa trang này? Nội dung sẽ mất vĩnh viễn!')) return;
  const idx = nbState.tabs.findIndex(t => t.id === nbState.activeTabId);
  nbState.tabs.splice(idx, 1);
  const newActive = nbState.tabs[Math.max(0, idx - 1)]?.id;
  // Không gán nbState.activeTabId ở đây — switchNbTab() bên dưới sẽ tự làm
  // việc đó. Nếu gán trước, switchNbTab sẽ tưởng nhầm trang MỚI là trang
  // đang hiển thị và lưu đè nội dung còn sót trên màn hình (của trang vừa
  // xóa) vào trang mới, làm mất nội dung trang mới.
  saveNbState();
  renderNbTabs();
  switchNbTab(newActive);
}

function renameNbTab(tabId) {
  const tab = nbState.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const newName = prompt('Đổi tên trang:', tab.name);
  if (newName && newName.trim()) {
    tab.name = newName.trim();
    saveNbState();
    renderNbTabs();
  }
}

function onNbEditorInput(val) {
  const tab = nbState.tabs.find(t => t.id === nbState.activeTabId);
  if (tab) tab.content = val;
  updateNbWordCount(val);
  saveNbState();
}

function updateNbWordCount(val) {
  const count = document.getElementById('nbWordCount');
  if (count) count.textContent = `${val.length} ký tự`;
}

function insertNbText(text) {
  const editor = document.getElementById('nbEditor');
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const before = editor.value.substring(0, start);
  const after = editor.value.substring(end);
  editor.value = before + text + after;
  editor.selectionStart = editor.selectionEnd = start + text.length;
  editor.focus();
  onNbEditorInput(editor.value);
}

function insertNbTemplate(type) {
  const templates = {
    vocab: `\n📘 TỪ VỰNG MỚI\n───────────────────\n한국어 (Hàn) | Tiếng Việt | Phiên âm\n─────────────|────────────|──────────\n            |            |\n            |            |\n            |            |\n`,
    grammar: `\n📐 NGỮ PHÁP\n───────────────────\n🔹 Cấu trúc: \n🔹 Công thức: \n🔹 Ví dụ:\n   • 한국어: \n   • Tiếng Việt: \n🔹 Lưu ý: \n`,
    rule: `\n📌 QUY TẮC CẦN NHỚ\n───────────────────\n✅ Khi nào dùng: \n❌ Không dùng khi: \n💡 Mẹo nhớ: \n🔥 Ví dụ thực tế: \n`,
  };
  insertNbText(templates[type] || '');
}

function copyNbContent() {
  const editor = document.getElementById('nbEditor');
  if (!editor) return;
  navigator.clipboard.writeText(editor.value).then(() => showToast('✅ Đã copy nội dung!'));
}

function clearNbContent() {
  if (!confirm('Xóa toàn bộ nội dung trang này?')) return;
  const editor = document.getElementById('nbEditor');
  if (editor) { editor.value = ''; onNbEditorInput(''); }
}

// ============ GRAMMAR GAME MODULE ============
const GG_QUESTIONS = [
  // === CƠ BẢN (Level 1) ===
  { level: 1, grammar: 'ân/là (N + 이에요/예요) — Là N', prompt: 'Tôi là sinh viên.', answer: ['저는', '학생이에요', '.'], distractors: ['선생님이에요', '저를', '학생을', '입니다'], explain: '저는 = Tôi (chủ ngữ). N + 이에요: "là N" với 이 sau phụ âm, 예요 sau nguyên âm.' },
  { level: 1, grammar: '은/는 — Trợ từ chủ ngữ / chủ đề', prompt: 'Tôi là học sinh.', answer: ['저는', '학생이에요', '.'], distractors: ['선생님이에요', '저를', '학생을', '이에요'], explain: '저는: "안nyeonghaseyo" + 는 (chủ đề sau nguyên âm). 학생이에요: "là học sinh".' },
  { level: 1, grammar: '을/를 — Trợ từ tân ngữ', prompt: 'Tôi ăn cơm.', answer: ['저는', '밥을', '먹어요', '.'], distractors: ['밥은', '밥이', '마셔요', '자요'], explain: '밥을: "áo" + 을 (tân ngữ sau phụ âm cuối). 먹어요: "ăn" (hiện tại lịch sự).' },
  { level: 1, grammar: '에 — Trợ từ nơi chốn / thời gian', prompt: 'Tôi đi học lúc 8 giờ.', answer: ['저는', '8시에', '학교에', '가요', '.'], distractors: ['8시를', '학교를', '와요', '먹어요'], explain: '에: chỉ thời gian (8시에) và địa điểm đến (학교에).' },
  { level: 1, grammar: '이/가 있다 — Có N', prompt: 'Tôi có em gái.', answer: ['저는', '여동생이', '있어요', '.'], distractors: ['여동생을', '여동생은', '없어요', '이에요'], explain: '여동생이 있어요: "Có em gái". 이 là trợ từ chủ ngữ sau phụ âm cuối.' },
  { level: 1, grammar: '에서 — Nơi hành động xảy ra', prompt: 'Tôi học tiếng Hàn ở trường.', answer: ['저는', '학교에서', '한국어를', '공부해요', '.'], distractors: ['학교에', '학교를', '한국어가', '배워요'], explain: '에서: nơi hành động xảy ra. 학교에서 = "ở trường".' },

  // === TRUNG CẤP (Level 2) ===
  { level: 2, grammar: 'V-고 싶다 — Muốn làm gì', prompt: 'Tôi muốn đi Hàn Quốc.', answer: ['저는', '한국에', '가고', '싶어요', '.'], distractors: ['한국을', '한국은', '가서', '싶습니다'], explain: 'V-고 싶다: Muốn làm gì đó. 가다 → 가고 싶어요.' },
  { level: 2, grammar: 'A/V-지 않다 — Phủ định', prompt: 'Tôi không thích cà phê.', answer: ['저는', '커피를', '좋아하지', '않아요', '.'], distractors: ['커피가', '좋아해요', '없어요', '싫어요'], explain: 'V-지 않다: phủ định lịch sự. 좋아하다 → 좋아하지 않아요.' },
  { level: 2, grammar: 'V-았/었다 — Quá khứ', prompt: 'Hôm qua tôi đã xem phim.', answer: ['어제', '저는', '영화를', '봐어요', '.'], distractors: ['오늘', '영화가', '봐요', '봐았습니까'], explain: '봐어요 = 보다 (xem) + 았어요 (quá khứ lịch sự).' },
  { level: 2, grammar: 'V-(으)마 거예요 — Tương lai', prompt: 'Ngày mai tôi sẽ đi mua sắm.', answer: ['내일', '저는', '쇼핑을', '할', '거예요', '.'], distractors: ['어제', '쇼핑이', '했어요', '해요'], explain: 'V-(으)ḷ 거예요: ý định tương lai. 하다 → 할 거예요.' },
  { level: 2, grammar: 'V-고 — Liên kết hành động', prompt: 'Tôi ăn sáng rồi đi học.', answer: ['저는', '아침을', '먹고', '학교에', '가요', '.'], distractors: ['아침이', '먹어서', '학교를', '와요'], explain: 'V-고: nối 2 hành động liên tiếp. 먹다 → 먹고.' },

  // === NÂNG CAO (Level 3) ===
  { level: 3, grammar: 'A-아/어서 — Vì/nên (lý do)', prompt: 'Vì trời lạnh nên tôi mặc áo khoác.', answer: ['날씨가', '추워서', '저는', '코트를', '입어요', '.'], distractors: ['추워도', '추워니까', '코트가', '벗어요'], explain: 'A-아/어서: nêu nguyên nhân. 충다 → 추워서.' },
  { level: 3, grammar: 'V-(으)세요 — Mệnh lệnh lịch sự', prompt: 'Hãy ngồi xuống đây.', answer: ['여기', '앉으세요', '.'], distractors: ['앉아요', '앉습니다', '여기를', '앉아라'], explain: 'V-(으)세요: lệnh/yêu cầu lịch sự. 앉다 → 앉으세요.' },
  { level: 3, grammar: 'N한테/에게 — Cho / đến (người)', prompt: 'Tôi gửi tin nhắn cho bạn.', answer: ['저는', '친구한테', '메시지를', '보내요', '.'], distractors: ['친구에서', '친구를', '메시지가', '받아요'], explain: '한테/에게: dùng cho người nhận. 친구한테 = "cho/đến bạn".' },
  { level: 3, grammar: 'V-지만 — Nhưng / Tuy nhiên', prompt: 'Tôi thích học nhưng mệt quá.', answer: ['공부하는', '것을', '좋아하지만', '너무', '피곤해요', '.'], distractors: ['좋아하고', '좋아해서', '너무를', '피곤합니다'], explain: 'V-지만: mệnh đề đối lập. 좋아하다 → 좋아하지만.' },
  { level: 3, grammar: 'V-(으)면 — Nếu / Khi', prompt: 'Nếu trời đẹp tôi sẽ đi dạo.', answer: ['날씨가', '좋으면', '산책할', '거예요', '.'], distractors: ['좋아서', '좋지만', '산책해요', '다녀요'], explain: 'A/V-(으)면: câu điều kiện. 좋다 → 좋으면 (nếu trời đẹp).' },
];

let ggState = {
  questions: [],
  current: 0,
  score: 0,
  lives: 3,
  selected: [],
  hintUsed: false,
  answered: false,
  results: [],  // per-question results
};

let ggSelectedLevel = 0; // 0 = tất cả

function initGrammarGame() {
  // Show level picker screen
  document.getElementById('ggGameover').style.display = 'none';
  const resultsEl = document.getElementById('ggResults');
  if (resultsEl) resultsEl.style.display = 'none';

  // Hide game elements
  document.getElementById('ggGrammarTag').style.display = 'none';
  document.getElementById('ggPrompt').closest('.gg-prompt-card').style.display = 'none';
  document.querySelector('.gg-built-row').style.display = 'none';
  document.getElementById('ggTiles').style.display = 'none';
  document.querySelector('.gg-actions').style.display = 'none';
  document.getElementById('ggFeedback').style.display = 'none';
  document.querySelector('.gg-progress-wrap').style.display = 'none';
  document.getElementById('ggScore').textContent = '0';
  document.getElementById('ggLives').textContent = '❤️❤️❤️';
  document.getElementById('ggProgress').textContent = '—';

  // Show level picker
  let picker = document.getElementById('ggLevelPicker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'ggLevelPicker';
    document.getElementById('page-grammarGame').insertBefore(picker, document.getElementById('ggGrammarTag'));
  }
  picker.innerHTML = `
    <div class="gg-level-picker">
      <div class="gg-level-title">🎯 Chọn cấp độ luyện tập</div>
      <p class="gg-level-sub">Chọn đúng cấp độ bạn đang học để câu hỏi phù hợp với kiến thức của bạn!</p>
      <div class="gg-level-cards">
        <div class="gg-level-card" onclick="startGrammarGame(1)">
          <div class="gg-lc-icon">🌱</div>
          <div class="gg-lc-name">Cơ bản</div>
          <div class="gg-lc-desc">Trợ từ 은/는, 을/를, 에, 에서, 이/가 있다</div>
          <div class="gg-lc-count">${GG_QUESTIONS.filter(q=>q.level===1).length} câu hỏi</div>
        </div>
        <div class="gg-level-card" onclick="startGrammarGame(2)">
          <div class="gg-lc-icon">📘</div>
          <div class="gg-lc-name">Trung cấp</div>
          <div class="gg-lc-desc">고 싶다, 지 않다, 과거/tương lai, V-고</div>
          <div class="gg-lc-count">${GG_QUESTIONS.filter(q=>q.level===2).length} câu hỏi</div>
        </div>
        <div class="gg-level-card" onclick="startGrammarGame(3)">
          <div class="gg-lc-icon">🔥</div>
          <div class="gg-lc-name">Nâng cao</div>
          <div class="gg-lc-desc">아/어서, (으)세요, 지만, (으)면, 한테</div>
          <div class="gg-lc-count">${GG_QUESTIONS.filter(q=>q.level===3).length} câu hỏi</div>
        </div>
        <div class="gg-level-card gg-lc-all" onclick="startGrammarGame(0)">
          <div class="gg-lc-icon">🏆</div>
          <div class="gg-lc-name">Tất cả</div>
          <div class="gg-lc-desc">Trộn ngẫu nhiên tất cả cấp độ</div>
          <div class="gg-lc-count">${GG_QUESTIONS.length} câu hỏi</div>
        </div>
      </div>
    </div>
  `;
  picker.style.display = 'block';
}

function startGrammarGame(level) {
  ggSelectedLevel = level;
  const pool = level === 0 ? GG_QUESTIONS : GG_QUESTIONS.filter(q => q.level === level);
  const picked = shuffle([...pool]).slice(0, Math.min(10, pool.length));

  ggState = { questions: picked, current: 0, score: 0, lives: 3, selected: [], hintUsed: false, answered: false, results: [] };

  // Hide picker
  const picker = document.getElementById('ggLevelPicker');
  if (picker) picker.style.display = 'none';
  const resultsEl = document.getElementById('ggResults');
  if (resultsEl) resultsEl.style.display = 'none';

  // Show game UI
  document.getElementById('ggGrammarTag').style.display = '';
  document.getElementById('ggPrompt').closest('.gg-prompt-card').style.display = '';
  document.querySelector('.gg-built-row').style.display = '';
  document.getElementById('ggTiles').style.display = '';
  document.querySelector('.gg-actions').style.display = '';
  document.querySelector('.gg-progress-wrap').style.display = '';

  ggRender();
  ggUpdateScore();
}

function ggRender() {
  const q = ggState.questions[ggState.current];
  if (!q) { ggEndGame(); return; }

  ggState.selected = [];
  ggState.hintUsed = false;
  ggState.answered = false;

  document.getElementById('ggGrammarPoint').textContent = q.grammar;
  document.getElementById('ggPrompt').textContent = q.prompt;
  document.getElementById('ggFeedback').style.display = 'none';
  ggUpdateBuilt();
  ggUpdateProgress();

  // Build shuffled tile pool
  const allTiles = shuffle([...q.answer.filter(t => t !== '.'), ...q.distractors]);
  const tilesArea = document.getElementById('ggTiles');
  tilesArea.innerHTML = allTiles.map((word, i) => `
    <div class="gg-tile" id="gg-tile-${i}" onclick="ggSelectTile(${i}, '${word.replace(/'/g,"\\'")}')">
      ${word}
    </div>
  `).join('');
}

function ggSelectTile(idx, word) {
  if (ggState.answered) return;
  const tile = document.getElementById(`gg-tile-${idx}`);
  if (!tile || tile.classList.contains('used')) return;
  tile.classList.add('used');
  ggState.selected.push({ idx, word });
  ggUpdateBuilt();
}

function ggUpdateBuilt() {
  const area = document.getElementById('ggBuiltSentence');
  if (ggState.selected.length === 0) {
    area.innerHTML = '<span class="gg-placeholder">Bấm vào các từ bên dưới để xây câu...</span>';
  } else {
    area.innerHTML = ggState.selected.map((s, i) =>
      `<div class="gg-built-tile" onclick="ggRemoveTile(${i})" title="Bấm để bỏ từ này">${s.word}</div>`
    ).join('');
  }
}

function ggRemoveTile(idx) {
  if (ggState.answered) return;
  const removed = ggState.selected.splice(idx, 1)[0];
  const tile = document.getElementById(`gg-tile-${removed.idx}`);
  if (tile) tile.classList.remove('used');
  ggUpdateBuilt();
}

function ggClear() {
  if (ggState.answered) return;
  ggState.selected = [];
  document.querySelectorAll('.gg-tile').forEach(t => t.classList.remove('used'));
  ggUpdateBuilt();
}

function ggSubmit() {
  if (ggState.answered || ggState.selected.length === 0) return;
  const q = ggState.questions[ggState.current];
  const userAnswer = ggState.selected.map(s => s.word).join(' ');
  const correctAnswer = q.answer.filter(t => t !== '.').join(' ');
  const correct = userAnswer === correctAnswer;

  ggState.answered = true;
  // Track result
  ggState.results.push({ prompt: q.prompt, grammar: q.grammar, userAnswer, correctAnswer: q.answer.join(' '), correct, explain: q.explain, skipped: false });

  const fb = document.getElementById('ggFeedback');
  fb.style.display = 'block';

  if (correct) {
    const pts = ggState.hintUsed ? 5 : 10;
    ggState.score += pts;
    fb.className = 'gg-feedback correct';
    fb.innerHTML = `✅ Chính xác! +${pts} điểm<div class="gg-fb-explain">💡 ${q.explain}</div>`;
    TTS.speak(q.answer.join(' ').replace('.', ''));
  } else {
    ggState.lives--;
    fb.className = 'gg-feedback wrong';
    fb.innerHTML = `❌ Chưa đúng rồi!<div class="gg-fb-answer">Câu đúng: <strong>${q.answer.join(' ')}</strong></div><div class="gg-fb-explain">💡 ${q.explain}</div>`;
    if (ggState.lives <= 0) {
      setTimeout(() => ggEndGame(true), 2000);
      ggUpdateScore();
      return;
    }
  }
  ggUpdateScore();
  setTimeout(() => {
    ggState.current++;
    ggRender();
  }, 2200);
}

function ggHint() {
  if (ggState.answered || ggState.hintUsed) return;
  const q = ggState.questions[ggState.current];
  // Highlight the next correct tile
  const nextCorrect = q.answer.filter(t => t !== '.')[ggState.selected.length];
  if (!nextCorrect) return;
  ggState.hintUsed = true;

  document.querySelectorAll('.gg-tile').forEach(tile => {
    tile.classList.remove('hint-glow');
    if (tile.textContent.trim() === nextCorrect && !tile.classList.contains('used')) {
      tile.classList.add('hint-glow');
      setTimeout(() => tile.classList.remove('hint-glow'), 2500);
    }
  });
}

function ggSkip() {
  if (ggState.answered) return;
  ggState.lives--;
  const q = ggState.questions[ggState.current];
  // Track as skipped/wrong
  ggState.results.push({ prompt: q.prompt, grammar: q.grammar, userAnswer: '(bỏ qua)', correctAnswer: q.answer.join(' '), correct: false, explain: q.explain, skipped: true });
  const fb = document.getElementById('ggFeedback');
  fb.style.display = 'block';
  fb.className = 'gg-feedback wrong';
  fb.innerHTML = `⏭️ Bỏ qua!<div class="gg-fb-answer">Câu đúng: <strong>${q.answer.join(' ')}</strong></div>`;
  ggState.answered = true;
  ggUpdateScore();
  if (ggState.lives <= 0) { setTimeout(() => ggEndGame(true), 1800); return; }
  setTimeout(() => { ggState.current++; ggRender(); }, 2000);
}

function ggUpdateScore() {
  const hearts = '❤️'.repeat(Math.max(0, ggState.lives)) + '🖤'.repeat(Math.max(0, 3 - ggState.lives));
  document.getElementById('ggScore').textContent = ggState.score;
  document.getElementById('ggLives').textContent = hearts;
  document.getElementById('ggProgress').textContent = `${Math.min(ggState.current + 1, ggState.questions.length)}/${ggState.questions.length}`;
}

function ggUpdateProgress() {
  const pct = ((ggState.current) / ggState.questions.length) * 100;
  const bar = document.getElementById('ggProgressBar');
  if (bar) bar.style.width = Math.max(5, pct) + '%';
}

function ggEndGame(outOfLives = false) {
  document.getElementById('ggProgressBar').style.width = '100%';

  // Show summary header in gameover card
  const go = document.getElementById('ggGameover');
  const correctCount = ggState.results.filter(r => r.correct).length;
  const totalAnswered = ggState.results.length;
  document.getElementById('ggGoScore').textContent = ggState.score;
  if (outOfLives) {
    document.getElementById('ggGoEmoji').textContent = '💔';
    document.getElementById('ggGoTitle').textContent = 'Hết tim rồi!';
    document.getElementById('ggGoMsg').textContent = `Đúng ${correctCount}/${totalAnswered} câu. Tiếp tục ôn luyện bạn nhé!`;
  } else if (ggState.score >= 80) {
    document.getElementById('ggGoEmoji').textContent = '🏆';
    document.getElementById('ggGoTitle').textContent = 'Xuất sắc!';
    document.getElementById('ggGoMsg').textContent = `Đúng ${correctCount}/${totalAnswered} câu. Ngữ pháp của bạn rất tốt!`;
  } else {
    document.getElementById('ggGoEmoji').textContent = '🎉';
    document.getElementById('ggGoTitle').textContent = 'Hoàn thành!';
    document.getElementById('ggGoMsg').textContent = `Đúng ${correctCount}/${totalAnswered} câu. Tiếp tục luyện tập nhé!`;
  }
  go.style.display = 'none'; // don't use overlay

  // Hide game UI, show results panel instead
  document.getElementById('ggGrammarTag').style.display = 'none';
  document.getElementById('ggPrompt').closest('.gg-prompt-card').style.display = 'none';
  document.querySelector('.gg-built-row').style.display = 'none';
  document.getElementById('ggTiles').style.display = 'none';
  document.querySelector('.gg-actions').style.display = 'none';
  document.getElementById('ggFeedback').style.display = 'none';
  document.querySelector('.gg-progress-wrap').style.display = 'none';

  ggShowResults(outOfLives, correctCount);
}

function ggShowResults(outOfLives, correctCount) {
  let resultsEl = document.getElementById('ggResults');
  if (!resultsEl) {
    resultsEl = document.createElement('div');
    resultsEl.id = 'ggResults';
    document.getElementById('page-grammarGame').appendChild(resultsEl);
  }

  const total = ggState.results.length;
  const wrongItems = ggState.results.filter(r => !r.correct);
  const emoji = outOfLives ? '💔' : correctCount >= total * 0.8 ? '🏆' : '🎉';

  resultsEl.innerHTML = `
    <div class="gg-results-header">
      <div class="gg-results-summary">
        <span class="gg-results-emoji">${emoji}</span>
        <div>
          <div class="gg-results-title">Kết quả cuội game</div>
          <div class="gg-results-stats">
            🏆 Điểm: <strong>${ggState.score}</strong> &nbsp;|
            ✅ Đúng: <strong class="clr-green">${correctCount}/${total}</strong> &nbsp;|
            ❌ Sai: <strong class="clr-red">${total - correctCount}</strong>
          </div>
        </div>
      </div>
      <div class="gg-results-btns">
        <button class="btn btn-primary" onclick="initGrammarGame()">🔄 Chơi lại</button>
      </div>
    </div>

    <div class="gg-results-list">
      ${ggState.results.map((r, i) => `
        <div class="gg-result-item ${r.correct ? 'res-correct' : 'res-wrong'}">
          <div class="gg-res-num">${r.correct ? '✅' : (r.skipped ? '⏭️' : '❌')} Câu ${i + 1}</div>
          <div class="gg-res-body">
            <div class="gg-res-grammar">📐 ${r.grammar}</div>
            <div class="gg-res-prompt">🆻🇳 ${r.prompt}</div>
            ${!r.correct ? `<div class="gg-res-user">Bạn đã chọn: <span class="gg-res-wrong-ans">${r.userAnswer}</span></div>` : ''}
            <div class="gg-res-correct">✅ Đáp án: <strong class="gg-res-correct-ans">${r.correctAnswer}</strong></div>
            <div class="gg-res-explain">💡 ${r.explain}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  resultsEl.style.display = 'block';
}

// ============ IRREGULARS MODULE (BẤT QUY TẮC TIẾNG HÀN) ============
const IRREGULAR_DATA = [
  {
    id: 'b',
    name: '1. Bất quy tắc ㅂ (ㅂ 불규칙)',
    badge: 'ㅂ → 워 / 와',
    summary: 'Động từ/Tính từ có pachim ㅂ, khi gặp đuôi nguyên âm (아/어, (으)ㄹ...) thì ㅂ chuyển thành 워 (hoặc 와 đối với 돕다, 곱다).',
    rule: [
      '• <strong>+ 아/어/여요:</strong> ㅂ đổi thành <strong>워요</strong> (vd: 춥다 → 추워요). Riêng <em>돕다</em> và <em>곱다</em> đổi thành <strong>와요</strong> (도와요, 고와요).',
      '• <strong>+ 습니다/ㅂ니다:</strong> Giữ nguyên ㅂ (vd: 춥습니다, 돕습니다).',
      '• <strong>+ (으)ㄹ 거예요:</strong> Đổi thành <strong>우 + ㄹ 거예요</strong> (vd: 추울 거예요).'
    ],
    words: [
      { kr: '춥다', vi: 'lạnh', informal: '추워요', formal: '춥습니다', past: '추웠어요', future: '추울 거예요' },
      { kr: '덥다', vi: 'nóng', informal: '더워요', formal: '덥습니다', past: '더웠어요', future: '더울 거예요' },
      { kr: '맵다', vi: 'cay', informal: '매워요', formal: '맵습니다', past: '매웠어요', future: '매울 거예요' },
      { kr: '돕다', vi: 'giúp đỡ', informal: '도와요', formal: '돕습니다', past: '도왔어요', future: '도울 거예요' },
      { kr: '어렵다', vi: 'khó', informal: '어려워요', formal: '어렵습니다', past: '어려웠어요', future: '어려울 거예요' },
      { kr: '쉬운', vi: 'dễ', informal: '쉬워요', formal: '쉽습니다', past: '쉬웠어요', future: '쉬울 거예요' },
      { kr: '귀엽다', vi: 'dễ thương', informal: '귀여워요', formal: '귀엽습니다', past: '귀여웠어요', future: '귀여울 거예요' },
    ],
    exceptions: [
      { kr: '입다', vi: 'mặc (áo)', conj: '입어요' },
      { kr: '잡다', vi: 'bắt/nắm', conj: '잡아요' },
      { kr: '씹다', vi: 'nhai', conj: '씹어요' },
      { kr: '뽑다', vi: 'nhổ/chọn', conj: '뽑아요' },
      { kr: '접다', vi: 'gấp/gập', conj: '접어요' }
    ]
  },
  {
    id: 'd',
    name: '2. Bất quy tắc ㄷ (ㄷ 불규칙)',
    badge: 'ㄷ → ㄹ',
    summary: 'Động từ có pachim ㄷ, khi gặp đuôi bắt đầu bằng nguyên âm (아/어, (으)ㄴ...) thì ㄷ đổi thành ㄹ.',
    rule: [
      '• <strong>+ 아/어/여요:</strong> ㄷ đổi thành <strong>ㄹ + 어요/아요</strong> (vd: 듣다 → 들어요).',
      '• <strong>+ 습니다/ㅂ니다:</strong> Giữ nguyên ㄷ (vd: 듣습니다).',
      '• <strong>+ (으)ㄹ 거예요:</strong> Đổi thành <strong>ㄹ + 을 거예요</strong> (vd: 들을 거예요).'
    ],
    words: [
      { kr: '듣다', vi: 'nghe', informal: '들어요', formal: '듣습니다', past: '들었어요', future: '들을 거예요' },
      { kr: '걷다', vi: 'đi bộ', informal: '걸어요', formal: '걷습니다', past: '걸었어요', future: '걸을 거예요' },
      { kr: '묻다', vi: 'hỏi', informal: '물어요', formal: '묻습니다', past: '물었어요', future: '물을 거예요' },
      { kr: '싣다', vi: 'chất/chở', informal: '실어요', formal: '싣습니다', past: '실었어요', future: '실을 거예요' },
      { kr: '깨닫다', vi: 'nhận ra', informal: '깨달아요', formal: '깨닫습니다', past: '깨달았어요', future: '깨달을 거예요' },
    ],
    exceptions: [
      { kr: '닫다', vi: 'đóng (cửa)', conj: '닫아요' },
      { kr: '받다', vi: 'nhận', conj: '받아요' },
      { kr: '믿다', vi: 'tin tưởng', conj: '믿어요' },
      { kr: '얻다', vi: 'đạt được', conj: '얻아요' }
    ]
  },
  {
    id: 'r',
    name: '3. Bất quy tắc ㄹ (ㄹ 불규칙)',
    badge: 'ㄹ Mất khi gặp ㄴ, ㅂ, ㅅ, (으)',
    summary: 'Động từ/Tính từ có pachim ㄹ, khi kết hợp với đuôi bắt đầu bằng ㄴ, ㅂ, ㅅ, (으) thì pachim ㄹ biến mất.',
    rule: [
      '• <strong>+ 습니다/ㅂ니다:</strong> Bỏ ㄹ, thêm <strong>ㅂ니다</strong> (vd: 살다 → 삽니다).',
      '• <strong>+ (으)세요:</strong> Bỏ ㄹ, thêm <strong>세요</strong> (vd: 살다 → 사세요).',
      '• <strong>+ 는 (định ngữ):</strong> Bỏ ㄹ, thêm <strong>는</strong> (vd: 살다 → 사는).'
    ],
    words: [
      { kr: '살다', vi: 'sống', informal: '살아요', formal: '삽니다', past: '살았어요', future: '살 거예요' },
      { kr: '만들다', vi: 'làm/chế tạo', informal: '만들어요', formal: '만듭니다', past: '만들었어요', future: '만들 거예요' },
      { kr: '알다', vi: 'biết', informal: '알아요', formal: '압니다', past: '알았어요', future: '알 거예요' },
      { kr: '팔다', vi: 'bán', informal: '팔아요', formal: '팝니다', past: '팔았어요', future: '팔 거예요' },
      { kr: '놀다', vi: 'chơi', informal: '놀아요', formal: '놉니다', past: '놀았어요', future: '놀 거예요' },
    ],
    exceptions: [
      { kr: 'Tất cả gốc ㄹ', vi: 'đều tuân theo quy tắc này (không có ngoại lệ)', conj: 'Mất ㄹ khi gặp ㄴ, ㅂ, ㅅ, 으' }
    ]
  },
  {
    id: 'h',
    name: '4. Bất quy tắc ㅎ (ㅎ 불규칙)',
    badge: 'ㅎ Mất + Đổi thành 애/얘',
    summary: 'Tính từ kết thúc bằng pachim ㅎ, khi gặp nguyên âm (아/어) hoặc ㄴ, ㅂ, ㅅ thì ㅎ mất. Đuôi 아/어 biến thành 애 (hoặc 얘 nếu có 야).',
    rule: [
      '• <strong>+ 아/어/여요:</strong> Bỏ ㅎ, chuyển nguyên âm thành <strong>애/얘</strong> (vd: 그렇다 → 그래요, 하얗다 → 하얘요).',
      '• <strong>+ (으)ㄴ (định ngữ):</strong> Bỏ ㅎ, thêm <strong>ㄴ</strong> (vd: 그렇다 → 그런, 까맣다 → 까만).',
      '• <strong>+ (으)면:</strong> Bỏ ㅎ + 면 (vd: 그렇다 → 그러면).'
    ],
    words: [
      { kr: '그렇다', vi: 'như thế', informal: '그래요', formal: '그렇습니다', past: '그랬어요', future: '그럴 거예요' },
      { kr: '어떻다', vi: 'thế nào', informal: '어때요', formal: '어떻습니까', past: '어땠어요', future: '어떨 거예요' },
      { kr: '까맣다', vi: 'đen', informal: '까매요', formal: '까맣습니다', past: '까맸어요', future: '까맬 거예요' },
      { kr: '노랗다', vi: 'vàng', informal: '노래요', formal: '노랗습니다', past: '노랬어요', future: '노랠 거예요' },
      { kr: '빨갛다', vi: 'đỏ', informal: '빨개요', formal: '빨갛습니다', past: '빨깩어요', future: '빨갤 거예요' },
      { kr: '하얗다', vi: 'trắng', informal: '하얘요', formal: '하얗습니다', past: '하얬어요', future: '하얠 거예요' },
    ],
    exceptions: [
      { kr: '좋다', vi: 'tốt/thích', conj: '좋아요' },
      { kr: '놓다', vi: 'đặt/để', conj: '놓아요' },
      { kr: '넣다', vi: 'bỏ vào', conj: '넣아요' },
      { kr: '낳다', vi: 'sinh (con)', conj: '낳아요' }
    ]
  },
  {
    id: 's',
    name: '5. Bất quy tắc ㅅ (ㅅ 불규칙)',
    badge: 'ㅅ Mất khi gặp nguyên âm',
    summary: 'Động từ/Tính từ có pachim ㅅ, khi gặp đuôi bắt đầu bằng nguyên âm (아/어, (으)...) thì pachim ㅅ biến mất.',
    rule: [
      '• <strong>+ 아/어/여요:</strong> Bỏ ㅅ, giữ nguyên âm trước đó (vd: 짓다 → 지어요, 낫다 → 나아요).',
      '• <strong>+ 습니다/ㅂ니다:</strong> Giữ nguyên ㅅ (vd: 짓습니다).',
      '• <strong>+ (으)ㄴ/(으)ㄹ:</strong> Bỏ ㅅ nhưng vẫn giữ 으 (vd: 짓다 → 지은).'
    ],
    words: [
      { kr: '짓다', vi: 'xây/dựng/nấu (cơm)', informal: '지어요', formal: '짓습니다', past: '지었어요', future: '지을 거예요' },
      { kr: '낫다', vi: 'tốt hơn/khỏi bệnh', informal: '나아요', formal: '낫습니다', past: '나았어요', future: '나을 거예요' },
      { kr: '잇다', vi: 'nối/kết nối', informal: '이어요', formal: '잇습니다', past: '이었어요', future: '이을 거예요' },
      { kr: '붓다', vi: 'sưng/rót (nước)', informal: '부어요', formal: '붓습니다', past: '부었어요', future: '부을 거예요' },
      { kr: '젓다', vi: 'khuấy/chèo', informal: '저어요', formal: '젓습니다', past: '저었어요', future: '저을 거예요' },
    ],
    exceptions: [
      { kr: '벗다', vi: 'cởi (áo/giày)', conj: '벗어요' },
      { kr: '씻다', vi: 'rửa', conj: '씻어요' },
      { kr: '웃다', vi: 'cười', conj: '웃어요' },
      { kr: '빗다', vi: 'chải (tóc)', conj: '빗어요' },
      { kr: '빼앗다', vi: 'cướp/tước', conj: '빼앗아요' }
    ]
  },
  {
    id: 'reu',
    name: '6. Bất quy tắc 르 (르 불규칙)',
    badge: '르 → ㄹ+라 / ㄹ+러',
    summary: 'Động từ/Tính từ kết thúc bằng 르, khi gặp đuôi 아/어 thì 르 đổi thành 라/러 đồng thời thêm pachim ㄹ vào âm tiết đứng trước.',
    rule: [
      '• Nếu âm trước có nguyên âm <strong>ㅏ/ㅗ</strong> → Đổi thành <strong>ㄹ + 라</strong> (vd: 모르다 → 몰라요, 빠르다 → 빨라요).',
      '• Nếu âm trước có nguyên âm khác (ㅓ/ㅜ/ㅡ/ㅣ) → Đổi thành <strong>ㄹ + 러</strong> (vd: 부르다 → 불러요, 기르다 → 길러요).'
    ],
    words: [
      { kr: '모르다', vi: 'không biết', informal: '몰라요', formal: '모릅니다', past: '몰랐어요', future: '모를 거예요' },
      { kr: '빠르다', vi: 'nhanh', informal: '빨라요', formal: '빠릅니다', past: '빨랐어요', future: '빠를 거예요' },
      { kr: '부르다', vi: 'gọi/hát/no', informal: '불러요', formal: '부릅니다', past: '불렀어요', future: '부를 거예요' },
      { kr: '다르다', vi: 'khác', informal: '달라요', formal: '다릅니다', past: '달랐어요', future: '다를 거예요' },
      { kr: '고르다', vi: 'chọn', informal: '골라요', formal: '고릅니다', past: '골랐어요', future: '고를 거예요' },
      { kr: '기르다', vi: 'nuôi/trồng', informal: '길러요', formal: '기릅니다', past: '길렀어요', future: '기를 거예요' },
    ],
    exceptions: [
      { kr: '따르다', vi: 'theo/rót', conj: '따라요 (chỉ theo quy tắc 으)' },
      { kr: '치르다', vi: 'thực hiện/trả giá', conj: '치러요 (chỉ theo quy tắc 으)' }
    ]
  },
  {
    id: 'eu',
    name: '7. Bất quy tắc 으 (으 불규칙)',
    badge: '으 Mất khi gặp 아/어',
    summary: 'Động từ/Tính từ có nguyên âm cuối 으, khi gặp đuôi 아/어 thì 으 bị lược bỏ. Căn cứ nguyên âm trước đó để chọn 아 hay 어.',
    rule: [
      '• Âm tiết trước chứa nguyên âm <strong>ㅏ/ㅗ</strong> → Bỏ 으, thêm <strong>아</strong> (vd: 바쁘다 → 바빠요, 아프다 → 아파요).',
      '• Âm tiết trước chứa nguyên âm khác (hoặc từ chỉ có 1 âm) → Bỏ 으, thêm <strong>어</strong> (vd: 예쁘다 → 예뻐요, 크다 → 커요, 쓰다 → 써요).'
    ],
    words: [
      { kr: '바쁘다', vi: 'bận', informal: '바빠요', formal: '바쁩니다', past: '바빴어요', future: '바쁠 거예요' },
      { kr: '아프다', vi: 'đau/ốm', informal: '아파요', formal: '아픕니다', past: '아팠어요', future: '아플 거예요' },
      { kr: '예쁘다', vi: 'đẹp', informal: '예뻐요', formal: '예쁩니다', past: '예뻤어요', future: '예쁠 거예요' },
      { kr: '크다', vi: 'to/lớn', informal: '커요', formal: '큽니다', past: '컸어요', future: '클 거예요' },
      { kr: '쓰다', vi: 'viết/dùng/đắng/đội', informal: '써요', formal: '씁니다', past: '썼어요', future: '쓸 거예요' },
      { kr: '나쁘다', vi: 'xấu/tồi', informal: '나빠요', formal: '나쁩니다', past: '나빴어요', future: '나쁠 거예요' },
      { kr: '슬프다', vi: 'buồn', informal: '슬퍼요', formal: '슬픕니다', past: '슬펐어요', future: '슬플 거예요' },
    ],
    exceptions: [
      { kr: 'Các từ 으', vi: 'đều tuân thủ quy tắc này (quy tắc phổ biến nhất tiếng Hàn)', conj: 'Bỏ 으 khi gặp 아/어' }
    ]
  }
];

let currentIrrFilter = 'all';

function initIrregularsPage() {
  filterIrregulars('all');
}

function filterIrregulars(ruleId) {
  currentIrrFilter = ruleId;
  document.querySelectorAll('#page-irregulars .irr-tab').forEach((tab, idx) => {
    tab.classList.toggle('active', (ruleId === 'all' && idx === 0) || tab.getAttribute('onclick')?.includes(`'${ruleId}'`));
  });
  renderIrregularsList();
}

function renderIrregularsList() {
  const container = document.getElementById('irrCardsList');
  if (!container) return;

  const filtered = currentIrrFilter === 'all' ? IRREGULAR_DATA : IRREGULAR_DATA.filter(item => item.id === currentIrrFilter);

  const meta = paginateList('irregularRules', filtered, renderIrregularsList, 10);
  container.innerHTML = meta.pageItems.map(item => `
    <div class="irr-card" id="irr-rule-${item.id}">
      <div class="irr-card-header">
        <div class="irr-card-title">
          <span>${item.name}</span>
          <span class="irr-badge">${item.badge}</span>
        </div>
      </div>

      <div class="irr-card-desc" style="color:var(--text-muted);font-size:0.92rem;line-height:1.6;">${item.summary}</div>

      <div class="irr-formula-box">
        ${item.rule.map(r => `<div class="irr-formula-row">${r}</div>`).join('')}
      </div>

      <div class="irr-table-wrap">
        <table class="irr-table">
          <thead>
            <tr>
              <th>Nguyên thể</th>
              <th>Thân mật (-아/어/여요)</th>
              <th>Trang trọng (-습니다)</th>
              <th>Quá khứ</th>
              <th>Tương lai (-ㄹ 거예요)</th>
              <th>Phát âm</th>
            </tr>
          </thead>
          <tbody>
            ${item.words.map(w => `
              <tr>
                <td><strong class="irr-word-kr">${w.kr}</strong> <span class="irr-word-vi">(${w.vi})</span></td>
                <td>${w.informal}</td>
                <td>${w.formal}</td>
                <td>${w.past}</td>
                <td>${w.future}</td>
                <td><button class="irr-tts-btn" onclick="TTS.speak('${w.kr}')" title="Nghe phát âm">🔊</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      ${item.exceptions && item.exceptions.length > 0 ? `
        <div class="irr-exception-box">
          <div class="irr-exc-title">⚠️ Từ NGOẠI LỆ (Chia quy tắc bình thường, KHÔNG biến đổi):</div>
          <div class="irr-exc-tags">
            ${item.exceptions.map(e => `
              <div class="irr-exc-tag">
                <strong>${e.kr}</strong><small>(${e.vi} → ${e.conj})</small>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `).join('');
  mountListPagination(container, 'irregularRules', meta, 'quy tắc');
}

function testIrrConjugate() {
  const input = document.getElementById('irrInput').value.trim();
  const resDiv = document.getElementById('irrConjResult');
  if (!input) { showToast('Vui lòng nhập từ tiếng Hàn!'); return; }

  let matchWord = null;
  let matchRule = null;
  let isException = false;

  for (const rule of IRREGULAR_DATA) {
    const foundWord = rule.words.find(w => w.kr === input);
    if (foundWord) {
      matchWord = foundWord;
      matchRule = rule;
      break;
    }
    const foundExc = rule.exceptions.find(e => e.kr === input);
    if (foundExc) {
      matchWord = { kr: foundExc.kr, vi: foundExc.vi, informal: foundExc.conj, formal: input + '습니다', past: input + '었어요', future: input + '을 거예요' };
      matchRule = rule;
      isException = true;
      break;
    }
  }

  resDiv.style.display = 'block';
  if (matchWord) {
    resDiv.innerHTML = `
      <div class="irr-res-tag">
        ${isException ? '⚠️ Từ NGOẠI LỆ (Chia quy tắc bình thường)' : '⚡ Thuộc: ' + matchRule.name}
      </div>
      <div class="irr-res-grid">
        <div class="irr-res-box">
          <div class="irr-res-lbl">Nguyên thể & Nghĩa</div>
          <div class="irr-res-val">${matchWord.kr} <small style="font-size:0.85rem;color:var(--text-muted)">(${matchWord.vi})</small> <button class="irr-tts-btn" onclick="TTS.speak('${matchWord.kr}')">🔊</button></div>
        </div>
        <div class="irr-res-box">
          <div class="irr-res-lbl">Thân mật (-아/어/여요)</div>
          <div class="irr-res-val">${matchWord.informal} <button class="irr-tts-btn" onclick="TTS.speak('${matchWord.informal}')">🔊</button></div>
        </div>
        <div class="irr-res-box">
          <div class="irr-res-lbl">Trang trọng (-습니다/ㅂ니다)</div>
          <div class="irr-res-val">${matchWord.formal} <button class="irr-tts-btn" onclick="TTS.speak('${matchWord.formal}')">🔊</button></div>
        </div>
        <div class="irr-res-box">
          <div class="irr-res-lbl">Quá khứ (-았/었어요)</div>
          <div class="irr-res-val">${matchWord.past} <button class="irr-tts-btn" onclick="TTS.speak('${matchWord.past}')">🔊</button></div>
        </div>
        <div class="irr-res-box">
          <div class="irr-res-lbl">Tương lai (-(으)ㄹ 거예요)</div>
          <div class="irr-res-val">${matchWord.future} <button class="irr-tts-btn" onclick="TTS.speak('${matchWord.future}')">🔊</button></div>
        </div>
      </div>
    `;
  } else {
    resDiv.innerHTML = `
      <div class="irr-res-tag" style="background:rgba(239,68,68,0.12);color:#ef4444">
        🔍 Không tìm thấy từ "${escStr(input)}" trong danh sách mẫu!
      </div>
      <p style="margin:8px 0 0;font-size:0.9rem;color:var(--text-muted)">
        💡 Mẹo: Hãy thử gõ các từ nguyên thể mẫu như <strong>춥다, 듣다, 살다, 그렇다, 짓다, 모르다, 바쁘다, 입다, 닫다, 벗다</strong>...
      </p>
    `;
  }
}




