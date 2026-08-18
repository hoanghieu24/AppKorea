import { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Clock3, FilePlus2,
  FileSpreadsheet, ImagePlus, ListPlus, LoaderCircle, Plus, ScanLine, School, Send, Sparkles, Trash2, Type,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

const freshQuestion = (patch = {}) => ({
  type: 'MULTIPLE_CHOICE', prompt: '', sharedContext: '', optionsText: '', correctAnswer: '', explanation: '', topic: 'Từ vựng', points: 1,
  ...patch,
});

const headerKey = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

const splitOptions = (value) => String(value || '').split(/\r?\n|\||;/).map((item) => item.trim()).filter(Boolean);

// Từ 2.3.12, giao diện tạo bài chỉ còn 2 loại:
// - MULTIPLE_CHOICE: có từ 2 lựa chọn trở lên.
// - ESSAY: mọi câu tự nhập/điền/dịch/viết, AI chấm theo đáp án tham khảo nếu có.
// SHORT_TEXT vẫn được backend giữ để tương thích dữ liệu cũ, nhưng importer/UI mới không sinh loại này nữa.
const normalizeType = (value, hasOptions) => {
  const key = headerKey(value);
  if (['multiplechoice', 'tracnghiem', 'mcq'].includes(key)) return 'MULTIPLE_CHOICE';
  if (['essay', 'tuluan', 'shorttext', 'traloinho', 'dientu', 'short'].includes(key)) return 'ESSAY';
  return hasOptions ? 'MULTIPLE_CHOICE' : 'ESSAY';
};

function extractJson(text) {
  if (text && typeof text === 'object') {
    if (Array.isArray(text)) return { questions: text };
    return text;
  }

  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI trả về nội dung rỗng.');

  const candidates = [raw];

  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match?.[1]) candidates.push(match[1].trim());
  }

  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(raw.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = raw.indexOf('[');
  const arrayEnd = raw.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(raw.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of [...new Set(candidates)]) {
    const cleaned = candidate
      .replace(/^\uFEFF/, '')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) return { questions: parsed };
      if (Array.isArray(parsed?.questions)) return parsed;

      const nested = [
        parsed?.data,
        parsed?.result,
        parsed?.output,
        parsed?.items,
        parsed?.questionList,
        parsed?.cauHoi,
        parsed?.cau_hoi,
      ];

      for (const value of nested) {
        if (Array.isArray(value)) return { questions: value };
        if (Array.isArray(value?.questions)) return { ...parsed, questions: value.questions };
      }

      return parsed;
    } catch {
      // thử candidate tiếp theo
    }
  }

  throw new Error('AI trả về JSON lỗi định dạng.');
}

function aiQuestionList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.questions)) return payload.questions;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;
  return [];
}

function splitOcrIntoChunks(text, maxChars = 10500) {
  const lines = String(text || '').split(/\r?\n/);
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = line;
    } else {
      current = next;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [String(text || '').trim()];
}

function preprocessImageForOcr(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const maxWidth = 2600;
        const scale = Math.min(2.2, Math.max(1.35, maxWidth / Math.max(1, img.naturalWidth)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Grayscale + tăng tương phản nhẹ. Không threshold trắng/đen quá gắt
        // vì chữ Hàn nét mảnh rất dễ mất nét.
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          const boosted = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.42 + 128)));
          const clean = boosted > 238 ? 255 : boosted;
          data[i] = clean;
          data[i + 1] = clean;
          data[i + 2] = clean;
        }

        ctx.putImageData(imageData, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không mở được ảnh để xử lý OCR.'));
    };

    img.src = url;
  });
}

function looksLikeBrokenOcr(text) {
  const value = String(text || '').trim();
  if (!value) return true;

  const compact = value.replace(/\s+/g, '');
  const letters = (compact.match(/[A-Za-zÀ-ỹ가-힣]/g) || []).length;
  const digits = (compact.match(/\d/g) || []).length;

  const digitInsideWord = /[A-Za-zÀ-ỹ가-힣]\d|\d[A-Za-zÀ-ỹ가-힣]/.test(value);
  const suspiciousLongNumber = (value.match(/\d{4,}/g) || []).length >= 1;
  const repeatedZeros = /0{3,}/.test(value);
  const digitRatio = digits / Math.max(1, letters + digits);

  return digitInsideWord || repeatedZeros || (suspiciousLongNumber && digitRatio > 0.08) || digitRatio > 0.18;
}

function shouldRunEnhancedOcr(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  const compact = value.replace(/\s+/g, '');
  const letters = (compact.match(/[A-Za-zÀ-ỹ가-힣]/g) || []).length;
  const readableRatio = letters / Math.max(1, compact.length);
  const unknownGlyphs = (compact.match(/[�□]/g) || []).length;
  return value.length < 55 || letters < 28 || readableRatio < 0.34 || unknownGlyphs >= 3;
}

const OCR_STAGE_ORDER = ['prepare', 'scan', 'ai', 'done'];

function imageQuestionPrompt({ rawOcr, enhancedOcr, retry = false, previousQuestions = [] }) {
  const previous = previousQuestions.length
    ? `\nKẾT QUẢ LẦN TRƯỚC CÓ THỂ ĐANG SAI OCR:\n${JSON.stringify(previousQuestions)}\n`
    : '';

  return `${retry ? 'LẦN TRƯỚC VẪN CÒN CHỮ OCR RÁC. HÃY PHỤC DỰNG LẠI CẨN THẬN HƠN.\n\n' : ''}
Bạn là giáo viên tiếng Hàn người Việt đang nhập bài tập từ ảnh.

QUAN TRỌNG:
Hai khối bên dưới là OCR của CÙNG MỘT ẢNH. OCR có thể sai RẤT NẶNG:
- mất dấu tiếng Việt,
- chữ bị biến thành số,
- ký tự Hàn bị đọc sai,
- dính/tách từ sai.

Ví dụ kiểu OCR sai:
"Cubi tudn 0000, 16103 di leo 10008 vèi Lan..."
KHÔNG ĐƯỢC chép nguyên chuỗi rác này vào câu hỏi.
Phải phục dựng thành câu tiếng Việt tự nhiên nếu ngữ cảnh đủ chắc chắn.
Nếu không đủ chắc chắn, ghi "[không đọc rõ]" ở đúng đoạn đó, KHÔNG tự bịa.

QUY TẮC PHỤC DỰNG:
1. Nếu nội dung gốc là tiếng Việt → giữ tiếng Việt, sửa lại dấu và chữ OCR sai.
2. Nếu nội dung gốc là tiếng Hàn → giữ nguyên Hangul, KHÔNG phiên âm sang Latin.
3. Không dịch sang ngôn ngữ khác nếu ảnh không yêu cầu dịch.
4. Giữ nguyên ý, số câu, tên riêng, số liệu thật trong ảnh.
5. Nếu 2 OCR mâu thuẫn, ưu tiên phương án tạo thành câu có nghĩa trong ngữ cảnh giáo trình tiếng Hàn sơ cấp.
6. KHÔNG biến số OCR rác thành số thật nếu không chắc chắn.
7. Sau khi phục dựng văn bản, mới tách câu hỏi.

ĐẦU RA:
CHỈ trả JSON thuần, không markdown, không giải thích ngoài JSON:
{
  "questions": [
    {
      "type": "MULTIPLE_CHOICE|ESSAY",
      "prompt": "câu hỏi đã phục dựng sạch, không còn OCR rác",
      "options": [],
      "correctAnswer": "",
      "explanation": "",
      "topic": "Tổng hợp",
      "points": 1
    }
  ]
}

Nếu có lựa chọn A/B/C/D hoặc ①②③④ thì đưa vào options.
Chỉ dùng 2 loại: MULTIPLE_CHOICE hoặc ESSAY. Mọi câu điền từ, trả lời ngắn, dịch, viết câu đều là ESSAY để AI chấm.
Nếu đáp án tham khảo không hiện rõ trong ảnh thì correctAnswer = "".
Nếu không chắc loại câu thì dùng ESSAY.
Tối đa 25 câu/lần.
${previous}
OCR LẦN 1 (ảnh gốc):
${rawOcr}

OCR LẦN 2 (ảnh đã tăng nét):
${enhancedOcr}`;
}

async function repairBrokenQuestionsWithAI(api, ocrPair, questions) {
  const broken = questions.filter((q) => looksLikeBrokenOcr(q?.prompt));
  if (!broken.length) return questions;

  const aiResult = await api('/learning/ai', {
    method: 'POST',
    toast: false,
    body: JSON.stringify({
      systemPrompt: 'Bạn chuyên sửa lỗi OCR Việt-Hàn. Không được để số/ký tự rác lọt vào câu hỏi nếu chúng rõ ràng là lỗi OCR. Chỉ trả JSON hợp lệ.',
      prompt: imageQuestionPrompt({
        rawOcr: ocrPair.raw,
        enhancedOcr: ocrPair.enhanced,
        retry: true,
        previousQuestions: questions,
      }),
      temperature: 0,
      maxOutputTokens: 4096,
      jsonMode: true,
    }),
  });

  const parsed = extractJson(aiResult?.text ?? aiResult ?? '');
  const repaired = aiQuestionList(parsed)
    .map((q) => typeof q === 'string' ? { prompt: q, type: 'ESSAY' } : q)
    .filter((q) => String(q?.prompt ?? '').trim().length >= 2);

  return repaired.length ? repaired : questions;
}

const SHARED_CONTEXT_START = '[[APPKOREA_SHARED_CONTEXT]]';
const SHARED_CONTEXT_END = '[[/APPKOREA_SHARED_CONTEXT]]';

function encodeSharedContextPrompt(prompt, sharedContext = '') {
  const question = String(prompt || '').trim();
  const context = String(sharedContext || '').trim();
  if (!context) return question;
  return `${SHARED_CONTEXT_START}\n${context}\n${SHARED_CONTEXT_END}\n${question}`;
}

function importedQuestion(raw = {}) {
  const options = Array.isArray(raw.options) ? raw.options.map(String).filter(Boolean) : splitOptions(raw.optionsText ?? raw.options ?? raw.luaChon ?? raw.luachon);
  const answer = String(raw.correctAnswer ?? raw.answer ?? raw.dapAn ?? raw.dapan ?? '').trim();
  const prompt = String(raw.prompt ?? raw.question ?? raw.cauHoi ?? raw.cauhoi ?? raw.noiDung ?? raw.noidung ?? '').trim();
  const type = normalizeType(raw.type ?? raw.loai, options.length >= 2);
  const sharedContext = String(raw.sharedContext ?? raw.context ?? raw.stimulus ?? raw.passage ?? raw.deChung ?? '').trim();
  return freshQuestion({
    type,
    prompt,
    sharedContext,
    optionsText: options.join('\n'),
    correctAnswer: answer,
    explanation: String(raw.explanation ?? raw.giaiThich ?? raw.giaithich ?? '').trim(),
    topic: String(raw.topic ?? raw.chuDe ?? raw.chude ?? 'Tổng hợp').trim() || 'Tổng hợp',
    points: Number(raw.points ?? raw.diem ?? 1) || 1,
  });
}


const EXCEL_STAGE_ORDER = ['read', 'structure', 'ai', 'apply', 'done'];

const cleanExcelText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const normalizeQuestionNumber = (value) => cleanExcelText(value)
  .replace(/^(?:câu|cau|question|q)\s*/i, '')
  .replace(/[.:)\-–—]+$/g, '')
  .trim();

const looksLikeSectionHeading = (value) => {
  const text = cleanExcelText(value);
  if (!text) return false;
  return /^(?:câu|cau|question)\s*\d+\s*[-–—]\s*(?:(?:câu|cau|question)\s*)?\d+/i.test(text)
    || /^(?:phần|phan|section)\s+(?:[ivxlcdm]+|\d+)/i.test(text);
};


const canonicalExcelLine = (value) => cleanExcelText(value)
  .replace(/^\*+|\*+$/g, '')
  .replace(/^[\-–—•]+\s*/, '')
  .trim();

const stripListMarker = (value) => canonicalExcelLine(value)
  .replace(/^(?:[A-Ha-h]|\d+|[①②③④⑤⑥⑦⑧])[.)\-:]\s*/, '')
  .trim();

const sectionQuestionRange = (value) => {
  const text = cleanExcelText(value);
  const match = text.match(/(?:câu|cau|question)?\s*(\d+)\s*[-–—]\s*(?:(?:câu|cau|question)\s*)?(\d+)/i);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
};

const inSectionRange = (number, range) => {
  const value = Number(number);
  return Boolean(range && Number.isFinite(value) && value >= range.from && value <= range.to);
};

const looksLikeReadingSection = (value) => /đọc|doan\s*van|đoạn\s*văn|reading|읽|글을/i.test(cleanExcelText(value));
const looksLikeAudioSection = (value) => /nghe|listening|듣/i.test(cleanExcelText(value));

function parseExcelRuleBased(semanticRows = []) {
  const questions = [];
  const answerMap = new Map();
  const detachedValues = new Set();
  let assignmentTitle = '';
  let instructions = '';
  let currentSection = '';
  let currentSectionRange = null;
  let current = null;
  let answerKeyMode = false;
  let sawQuestion = false;
  let pendingContext = '';

  const takePendingContext = () => {
    const context = String(pendingContext || '').trim();
    if (context) detachedValues.add(cleanExcelText(context).toLowerCase());
    pendingContext = '';
    return context;
  };

  const flushCurrent = () => {
    if (!current) return;

    if (current.numericItems.length === 1 && !current.options.length && !current.correctAnswer) {
      // Mẫu rất hay gặp trong file giáo viên:
      // Câu 1: ...
      // 1. /한구거/
      // Câu 2: ...
      // Khi chỉ có DUY NHẤT một dòng đánh số trước câu kế tiếp, coi đó là đáp án tham khảo.
      current.correctAnswer = current.numericItems[0].text;
      detachedValues.add(current.numericItems[0].text.toLowerCase());
    } else if (current.numericItems.length >= 2 && !current.options.length) {
      // Có 1./2./3./4. liên tiếp => đây là danh sách lựa chọn, không phải các câu hỏi mới.
      current.options = current.numericItems.map((item) => item.text);
      current.numericItems.forEach((item) => detachedValues.add(item.text.toLowerCase()));
    }

    const prompt = String(current.prompt || '').trim();
    if (prompt && !looksLikeSectionHeading(prompt)) {
      questions.push({
        number: current.number,
        type: normalizeType('', current.options.length >= 2),
        prompt,
        sharedContext: current.sharedContext || '',
        options: current.options,
        correctAnswer: current.correctAnswer,
        explanation: current.explanation,
        topic: currentSection || 'Tổng hợp',
        points: 1,
      });
    }
    current = null;
  };

  const startQuestion = (number, prompt) => {
    flushCurrent();
    sawQuestion = true;
    answerKeyMode = false;
    current = {
      number: String(number),
      prompt: cleanExcelText(prompt),
      sharedContext: takePendingContext(),
      options: [],
      numericItems: [],
      correctAnswer: '',
      explanation: '',
    };
  };

  for (const row of semanticRows) {
    const values = (row.cells || []).map((cell) => canonicalExcelLine(cell.value)).filter(Boolean);
    if (!values.length) continue;
    const primaryText = canonicalExcelLine(values[0]);
    const rowText = canonicalExcelLine(values.join(' '));
    const sheetKey = headerKey(row.sheet || '');

    if (/dapan|answer|answerkey/.test(sheetKey) || /đáp\s*án/i.test(String(row.sheet || ''))) answerKeyMode = true;

    if (/^(?:đáp\s*án|dap\s*an|answer\s*key|answers?)\s*:?\s*$/i.test(rowText)) {
      flushCurrent();
      answerKeyMode = true;
      pendingContext = '';
      continue;
    }

    // "Câu 26-28: Đọc đoạn văn..." là tiêu đề phần, không phải một câu hỏi.
    if (looksLikeSectionHeading(primaryText)) {
      flushCurrent();
      currentSection = primaryText;
      currentSectionRange = sectionQuestionRange(primaryText);
      answerKeyMode = false;
      pendingContext = '';
      continue;
    }

    const instructionMatch = rowText.match(/^(?:hướng\s*dẫn|huong\s*dan|yêu\s*cầu|yeu\s*cau|lưu\s*ý|luu\s*y)\s*[:\-]?\s*(.+)$/i);
    if (instructionMatch) {
      if (!instructions) instructions = cleanExcelText(instructionMatch[1]);
      continue;
    }

    if (answerKeyMode) {
      const answerLine = rowText.match(/^(?:câu\s*)?(\d+)\s*[.):\-]\s*(.+)$/i);
      const splitAnswerLine = values.length >= 2 && /^\d+[.):\-]?$/.test(values[0])
        ? [values[0], values[0].match(/^\d+/)?.[0] || '', values.slice(1).join(' ')] : null;
      const matchedAnswer = answerLine || splitAnswerLine;
      if (matchedAnswer) {
        answerMap.set(matchedAnswer[1], stripListMarker(matchedAnswer[2]));
        continue;
      }
    }

    // Hỗ trợ "Câu 1: ...", "Câu 7. ..." và cả "Câu 1" | "...".
    const questionMatch = primaryText.match(/^(?:câu|cau|question|q)\s*(\d+)\s*(?:[.):\-]\s*|\s+)(.+)$/i);
    if (questionMatch) {
      startQuestion(questionMatch[1], questionMatch[2]);
      continue;
    }

    // Có đề chỉ ghi đúng "Câu 21" rồi nội dung/hội thoại nằm ở các dòng bên dưới.
    const questionMarkerOnly = primaryText.match(/^(?:câu|cau|question|q)\s*(\d+)\s*[.):\-]?$/i);
    if (questionMarkerOnly) {
      startQuestion(questionMarkerOnly[1], '');
      continue;
    }

    if (values.length >= 2) {
      const marker = values[0].match(/^(?:câu|cau|question|q)\s*(\d+)\s*[.):\-]?$/i);
      if (marker) {
        startQuestion(marker[1], values.slice(1).join(' '));
        continue;
      }
    }

    // Một số đề dùng trực tiếp "26. ...", "27. ...", "34. ..." thay vì chữ "Câu".
    // Chỉ coi đây là câu hỏi khi số đó nằm trong range của tiêu đề phần hiện tại,
    // nhờ vậy 1./2./3./4. bên dưới vẫn được hiểu là đáp án/lựa chọn.
    const bareQuestion = primaryText.match(/^(\d+)\s*[.)]\s*(.+)$/);
    const bareQuestionNumber = Number(bareQuestion?.[1]);
    const currentQuestionNumber = Number(current?.number);
    if (bareQuestion
      && inSectionRange(bareQuestion[1], currentSectionRange)
      && (!current || !Number.isFinite(currentQuestionNumber) || bareQuestionNumber > currentQuestionNumber)) {
      startQuestion(bareQuestion[1], bareQuestion[2]);
      continue;
    }

    if (current) {
      const explicitAnswer = rowText.match(/^(?:đáp\s*án(?:\s*đúng)?|dap\s*an(?:\s*dung)?|answer|correct\s*answer)\s*[:\-]\s*(.+)$/i);
      if (explicitAnswer) {
        current.correctAnswer = stripListMarker(explicitAnswer[1]);
        detachedValues.add(current.correctAnswer.toLowerCase());
        continue;
      }

      const explanation = rowText.match(/^(?:giải\s*thích|giai\s*thich|explanation)\s*[:\-]\s*(.+)$/i);
      if (explanation) {
        current.explanation = cleanExcelText(explanation[1]);
        continue;
      }

      // Hội thoại A: / B: là phần thân đề, không phải lựa chọn A/B.
      if (/^[A-Z]:\s*/.test(rowText)) {
        current.prompt = `${String(current.prompt || '').trim()}\n${rowText}`.trim();
        continue;
      }

      // Nhiều lựa chọn 1./2./3./4. nằm cùng một hàng nhưng ở các cột khác nhau.
      const numericCells = values.map((value) => value.match(/^(\d+)\s*[.)\-:]?\s+(.+)$/)).filter(Boolean);
      if (numericCells.length >= 2) {
        for (const matched of numericCells) {
          const optionText = cleanExcelText(matched[2]);
          if (optionText) {
            current.numericItems.push({ marker: matched[1], text: optionText });
            detachedValues.add(optionText.toLowerCase());
          }
        }
        continue;
      }

      // A./B./C./D. là lựa chọn. Không dùng dấu ':' để tránh nhầm hội thoại A:/B:.
      const letterChoice = rowText.match(/^([A-Ha-h])[.)\-]\s*(.+)$/);
      const circledChoice = rowText.match(/^([①②③④⑤⑥⑦⑧])\s*(.+)$/);
      const splitLetterChoice = values.length >= 2 && /^[A-Ha-h][.)\-]?$/.test(values[0])
        ? [values[0], values[0].charAt(0), values.slice(1).join(' ')] : null;
      if (letterChoice || circledChoice || splitLetterChoice) {
        const optionText = cleanExcelText((letterChoice || circledChoice || splitLetterChoice)[2]);
        if (optionText) {
          current.options.push(optionText);
          detachedValues.add(optionText.toLowerCase());
        }
        continue;
      }

      const numericLine = rowText.match(/^(\d+)\s*[.)\-:]\s*(.+)$/);
      const splitNumericLine = values.length >= 2 && /^\d+[.)\-:]?$/.test(values[0])
        ? [values[0], values[0].match(/^\d+/)?.[0] || '', values.slice(1).join(' ')] : null;
      if (numericLine || splitNumericLine) {
        const matched = numericLine || splitNumericLine;
        const optionText = cleanExcelText(matched[2]);
        if (optionText) current.numericItems.push({ marker: matched[1], text: optionText });
        continue;
      }

      // Dòng chấm để học sinh tự viết trong Excel không phải câu hỏi/đáp án.
      if (/^[.…_\-\s]{8,}$/.test(rowText)) continue;
    }

    // Đoạn văn dùng chung của một nhóm câu đọc hiểu là NGỮ CẢNH/ĐỀ,
    // không được biến thành câu hỏi riêng. Giữ riêng ở sharedContext của CÂU ĐẦU TIÊN
    // để UI hiển thị thành 'Đề chung' một lần, không trộn vào nội dung câu hỏi.
    if (!current && currentSectionRange && looksLikeReadingSection(currentSection) && rowText.length >= 80) {
      pendingContext = pendingContext ? `${pendingContext}\n${rowText}` : rowText;
      detachedValues.add(cleanExcelText(rowText).toLowerCase());
      continue;
    }

    // Với phần nghe, một đoạn mô tả/transcript độc lập cũng là ngữ cảnh chứ không phải câu hỏi.
    if (!current && currentSectionRange && looksLikeAudioSection(currentSection) && rowText.length >= 80) {
      pendingContext = pendingContext ? `${pendingContext}\n${rowText}` : rowText;
      detachedValues.add(cleanExcelText(rowText).toLowerCase());
      continue;
    }

    // Trước câu hỏi đầu tiên, dòng ngắn độc lập thường là tiêu đề toàn bài.
    if (!sawQuestion && !assignmentTitle && rowText.length <= 220 && !/^(?:stt|số\s*câu|loại|câu\s*hỏi|question|prompt|nội\s*dung)/i.test(rowText)) {
      // File đề thi thường gộp "ĐỀ THI ... / Thời gian ... / Họ và Tên ..." vào cùng một ô.
      // Chỉ lấy phần tên đề làm Tiêu đề, không kéo cả thông tin thí sinh vào.
      const titleOnly = rowText.split(/\s+(?:thời\s*gian(?:\s*làm\s*bài)?|họ\s*và\s*tên|ho\s*va\s*ten)\s*[:：]/i)[0].trim();
      assignmentTitle = titleOnly || rowText;
    }
  }

  flushCurrent();

  for (const question of questions) {
    const mapped = question.number ? answerMap.get(question.number) : '';
    if (mapped && !question.correctAnswer) {
      question.correctAnswer = resolveChoiceAnswer(mapped, question.options);
    }
    question.type = normalizeType(question.type, question.options.length >= 2);
  }

  return { assignmentTitle, instructions, questions, answerMap, detachedValues };
}

function mergeRuleQuestionsWithAI(ruleParsed, aiQuestions = [], aiAnswerMap = new Map()) {
  const aiByNumber = new Map();
  const leftovers = [];

  for (const question of aiQuestions) {
    const number = normalizeQuestionNumber(question.number || '');
    if (number && !aiByNumber.has(number)) aiByNumber.set(number, question);
    else leftovers.push(question);
  }

  const merged = ruleParsed.questions.map((ruleQuestion) => {
    const aiQuestion = aiByNumber.get(ruleQuestion.number) || {};
    aiByNumber.delete(ruleQuestion.number);
    const options = ruleQuestion.options.length ? ruleQuestion.options : (aiQuestion.options || []);
    const mappedAnswer = aiAnswerMap.get(ruleQuestion.number) || ruleParsed.answerMap.get(ruleQuestion.number) || '';
    const correctAnswer = resolveChoiceAnswer(
      ruleQuestion.correctAnswer || aiQuestion.correctAnswer || mappedAnswer,
      options,
    );
    return {
      ...aiQuestion,
      ...ruleQuestion,
      options,
      correctAnswer,
      explanation: aiQuestion.explanation || ruleQuestion.explanation || '',
      topic: ruleQuestion.topic || aiQuestion.topic || 'Tổng hợp',
      type: normalizeType(aiQuestion.type || ruleQuestion.type, options.length >= 2),
    };
  });

  const detached = ruleParsed.detachedValues || new Set();
  const cleanLeftovers = [...aiByNumber.values(), ...leftovers].filter((question) => {
    const prompt = stripListMarker(question?.prompt || '').toLowerCase();
    if (!prompt) return false;
    for (const detachedText of detached) {
      if (!detachedText) continue;
      if (prompt === detachedText) return false;
      // Đoạn văn dài đôi khi AI thêm/bớt dấu cách vài ký tự. Nếu phần lớn nội dung trùng
      // với một context/option đã rule-parser nhận diện thì không được tạo câu hỏi rác.
      if (detachedText.length >= 80 && (prompt.includes(detachedText) || detachedText.includes(prompt))) return false;
    }
    return true;
  });

  return [...merged, ...cleanLeftovers];
}

function parseExcelFallback(rows) {
  const known = new Set(['cauhoi', 'question', 'prompt', 'noidung', 'loai', 'type', 'luachon', 'options', 'dapan', 'answer', 'giaithich', 'explanation', 'chude', 'topic', 'diem', 'points']);
  const firstKeys = (rows[0] || []).map(headerKey);
  const hasHeader = firstKeys.some((key) => known.has(key));

  if (hasHeader) {
    const indexOf = (...aliases) => firstKeys.findIndex((key) => aliases.includes(key));
    const idx = {
      prompt: indexOf('cauhoi', 'question', 'prompt', 'noidung'),
      type: indexOf('loai', 'type'),
      options: indexOf('luachon', 'options'),
      answer: indexOf('dapan', 'answer'),
      explanation: indexOf('giaithich', 'explanation'),
      topic: indexOf('chude', 'topic'),
      points: indexOf('diem', 'points'),
    };
    return rows.slice(1).map((row) => ({
      prompt: idx.prompt >= 0 ? row[idx.prompt] : row[0],
      type: idx.type >= 0 ? row[idx.type] : '',
      options: idx.options >= 0 ? row[idx.options] : '',
      answer: idx.answer >= 0 ? row[idx.answer] : '',
      explanation: idx.explanation >= 0 ? row[idx.explanation] : '',
      topic: idx.topic >= 0 ? row[idx.topic] : 'Tổng hợp',
      points: idx.points >= 0 ? row[idx.points] : 1,
    }));
  }

  return rows.map((row) => ({
    prompt: row[0],
    answer: row[1] || '',
    options: row[2] || '',
    topic: row[3] || 'Tổng hợp',
  }));
}

function workbookRowsForAI(XLSX, workbook) {
  const output = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });

    rows.forEach((row, rowIndex) => {
      const cells = (row || []).map((value, colIndex) => ({
        col: XLSX.utils.encode_col(colIndex),
        value: cleanExcelText(value),
      })).filter((cell) => cell.value);
      if (cells.length) output.push({ sheet: sheetName, row: rowIndex + 1, cells });
    });
  }
  return output;
}

function chunkExcelRows(rows, { maxRows = 28, maxChars = 6900 } = {}) {
  const chunks = [];
  let current = [];
  let currentChars = 0;

  const rowLine = (item) => `[${item.sheet}!${item.row}] ${item.cells.map((cell) => `${cell.col}=${JSON.stringify(cell.value)}`).join(' | ')}`;

  for (const item of rows) {
    const line = rowLine(item);
    const wouldOverflow = current.length && (current.length >= maxRows || currentChars + line.length + 1 > maxChars);
    if (wouldOverflow) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push({ ...item, line });
    currentChars += line.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function excelSemanticPrompt({ rowsText, chunkIndex, chunkCount, knownTitle = '', knownSection = '' }) {
  return `Bạn là giáo viên tiếng Hàn người Việt. Hãy đọc dữ liệu Excel như một ĐỀ BÀI THẬT, hiểu NGỮ NGHĨA trước rồi mới phân loại. Không được coi mỗi dòng là một câu hỏi.

MỤC TIÊU:
- Nếu là TIÊU ĐỀ TOÀN BÀI (ví dụ: "Ôn tập Bài 5") -> assignmentTitle.
- Nếu là TIÊU ĐỀ NHÓM/PHẦN (ví dụ: "Câu 1-5: Chọn phương án đúng") -> KHÔNG tạo thành câu hỏi. Dùng nó làm topic/section cho các câu phía sau.
- Nếu sau tiêu đề kiểu "Câu 26-28: Đọc đoạn văn..." có một ĐOẠN VĂN DÀI rồi mới tới câu 26, 27, 28 -> đoạn văn đó là NGỮ CẢNH/ĐỀ CHUNG, TUYỆT ĐỐI KHÔNG tạo thành một question riêng. Đưa đoạn văn đó vào trường sharedContext của CÂU ĐẦU TIÊN trong nhóm (câu 26). prompt của câu 26 CHỈ chứa câu hỏi 26; câu 27/28 chỉ giữ câu hỏi riêng và sharedContext="".
- Nếu là CÂU HỎI -> prompt. Nhận biết cả "Câu 26: ..." và dạng chỉ có "26. ..." khi số 26 nằm trong range của tiêu đề phần hiện tại.
- Nếu là LỰA CHỌN A/B/C/D, ①②③④ hoặc 1./2./3./4. -> options của đúng câu, không tạo câu mới.
- Nếu là hội thoại dạng "A: ..." / "B: ..." nằm dưới một câu -> đó là NỘI DUNG CÂU HỎI, không phải lựa chọn A/B.
- Nếu là ĐÁP ÁN / ĐÁP ÁN ĐÚNG / ANSWER KEY -> correctAnswer của đúng câu, KHÔNG tạo thành câu hỏi mới.
- Nếu là GIẢI THÍCH -> explanation.
- Nếu là HƯỚNG DẪN chung -> instructions.
- Giữ nguyên tiếng Hàn/Hangul. Không tự dịch nếu đề không yêu cầu.
- Nếu Excel ghi rõ đáp án thì dùng đúng đáp án đó. Với câu MULTIPLE_CHOICE có từ 2 lựa chọn trở lên nhưng không có answer key, được phép tự xác định đáp án đúng CHỈ khi chắc chắn theo nội dung/kiến thức tiếng Hàn; nếu không chắc thì correctAnswer="". Với ESSAY, correctAnswer là đáp án tham khảo nếu file có, nếu không thì để trống.
- Nhận biết cả file có cột chuẩn lẫn file trình bày tự do, ô gộp, đáp án nằm ở cuối đề hoặc sheet khác.
- Dựa vào số câu (1, 2, Câu 3...) để nối answer key với đúng câu.
- Các dòng như "Câu 1 - 5: Chọn phương án đúng" chỉ là tiêu đề phần, tuyệt đối không đưa vào questions.
- Chỉ dùng HAI loại câu: MULTIPLE_CHOICE và ESSAY. Không trả SHORT_TEXT. Câu điền từ, trả lời ngắn, dịch, viết câu đều là ESSAY để AI chấm.

QUY TẮC RẤT QUAN TRỌNG VỚI DÒNG ĐÁNH SỐ:
Ví dụ Excel có liên tiếp:
Câu 1: Phát âm đúng của từ “한국어” là:
1. /한구거/
Câu 2: ...
=> "Câu 1: ..." là prompt của câu 1; "1. /한구거/" là correctAnswer của câu 1. TUYỆT ĐỐI không tạo "1. /한구거/" thành câu hỏi mới.
Nếu sau một câu hỏi có NHIỀU dòng liên tiếp 1./2./3./4. (hoặc A./B./C./D.) trước khi sang "Câu X" tiếp theo thì các dòng đó là options.
Nếu chỉ có DUY NHẤT một dòng 1. ... rồi chuyển sang "Câu X" tiếp theo thì ưu tiên hiểu đó là đáp án của câu hiện tại.
Ví dụ đọc hiểu:
Câu 26-28: Đọc đoạn văn và trả lời câu hỏi
<đoạn văn tiếng Hàn dài>
26. 이 글의 제목으로 ...
1. ...
2. ...
3. ...
4. ...
27. ...
=> CHỈ tạo câu 26, 27, 28. KHÔNG tạo <đoạn văn> thành câu hỏi. sharedContext của câu 26 = <đoạn văn>; prompt câu 26 = "이 글의 제목으로 ...". Câu 27/28 có sharedContext="".

Đây là phần ${chunkIndex + 1}/${chunkCount} của workbook.
${knownTitle ? `Tiêu đề toàn bài đã nhận diện trước đó: ${JSON.stringify(knownTitle)}\n` : ''}${knownSection ? `Ngữ cảnh phần gần nhất: ${JSON.stringify(knownSection)}\n` : ''}
CHỈ TRẢ JSON THUẦN theo dạng:
{
  "assignmentTitle": "",
  "instructions": "",
  "lastSectionTitle": "",
  "questions": [
    {
      "number": "1",
      "type": "MULTIPLE_CHOICE|ESSAY",
      "prompt": "",
      "sharedContext": "",
      "options": [],
      "correctAnswer": "",
      "explanation": "",
      "topic": "",
      "points": 1
    }
  ],
  "answerMap": [
    { "number": "1", "answer": "A" }
  ]
}

Nếu chunk chỉ chứa answer key thì questions=[] và điền answerMap.
Nếu chunk chỉ chứa tiêu đề/hướng dẫn thì questions=[].
Tối đa chỉ trả các câu thật sự xuất hiện trong dữ liệu dưới đây.

DỮ LIỆU EXCEL (tọa độ ô được giữ để hiểu bố cục):
${rowsText}`;
}

function resolveChoiceAnswer(answer, options = []) {
  const value = cleanExcelText(answer);
  if (!value || !options.length) return value;
  const letter = value.match(/^([A-H])(?:[.)\-:]|$)/i)?.[1]?.toUpperCase();
  if (letter) {
    const index = letter.charCodeAt(0) - 65;
    if (options[index]) return options[index];
  }
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'].indexOf(value.charAt(0));
  if (circled >= 0 && options[circled]) return options[circled];
  return value;
}

function normalizeExcelAIQuestion(raw = {}, sectionFallback = '') {
  const prompt = cleanExcelText(raw.prompt ?? raw.question ?? raw.cauHoi ?? raw.cauhoi ?? raw.noiDung ?? raw.noidung);
  if (!prompt || looksLikeSectionHeading(prompt)) return null;
  const options = Array.isArray(raw.options) ? raw.options.map(cleanExcelText).filter(Boolean) : splitOptions(raw.optionsText ?? raw.options ?? raw.luaChon ?? raw.luachon);
  const answer = cleanExcelText(raw.correctAnswer ?? raw.answer ?? raw.dapAn ?? raw.dapan);
  return {
    number: normalizeQuestionNumber(raw.number ?? raw.no ?? raw.stt ?? raw.index ?? ''),
    type: normalizeType(raw.type ?? raw.loai, options.length >= 2),
    prompt,
    sharedContext: cleanExcelText(raw.sharedContext ?? raw.context ?? raw.stimulus ?? raw.passage ?? raw.deChung),
    options,
    correctAnswer: answer,
    explanation: cleanExcelText(raw.explanation ?? raw.giaiThich ?? raw.giaithich),
    topic: cleanExcelText(raw.topic ?? raw.chuDe ?? raw.chude ?? sectionFallback ?? 'Tổng hợp') || 'Tổng hợp',
    points: Number(raw.points ?? raw.diem ?? 1) || 1,
  };
}

export default function AssignmentsPage({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClassId = user.role === 'TEACHER' ? searchParams.get('classId') || '' : '';
  const [assignments, setAssignments] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [studentFilter, setStudentFilter] = useState('PENDING');
  const [classes, setClasses] = useState([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [inputMode, setInputMode] = useState('single');
  const [bulkText, setBulkText] = useState('');
  const [importing, setImporting] = useState('');
  const [excelProgress, setExcelProgress] = useState(0);
  const [excelStatus, setExcelStatus] = useState({ stage: 'read', title: '', detail: '' });
  const [excelSeconds, setExcelSeconds] = useState(0);
  const [excelSummary, setExcelSummary] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState({ stage: 'prepare', title: '', detail: '' });
  const [ocrSeconds, setOcrSeconds] = useState(0);
  const [form, setForm] = useState({ classId: '', type: 'HOMEWORK', title: '', instructions: '', dueAt: '', timeLimitMinutes: '', questions: [freshQuestion()], publishNow: true });

  const load = async () => {
    setListLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '8' });
    if (selectedClassId) params.set('classId', selectedClassId);
    if (user.role === 'STUDENT') params.set('view', studentFilter);
    const assignmentPath = `/assignments?${params.toString()}`;
    const [assignmentData, classData] = await Promise.all([api(assignmentPath), api('/classes')]);
    setAssignments(assignmentData.assignments); setPagination(assignmentData.pagination); setClasses(classData.classes);
    setForm((old) => ({ ...old, classId: selectedClassId || old.classId || String(classData.classes[0]?.id || '') }));
    setListLoading(false);
  };
  useEffect(() => { load().catch((err) => { setMessage(err.message); setListLoading(false); }); }, [selectedClassId, page, studentFilter]);
  useEffect(() => {
    if (importing !== 'excel') { setExcelSeconds(0); return undefined; }
    const startedAt = Date.now();
    setExcelSeconds(0);
    const timer = window.setInterval(() => setExcelSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [importing]);
  useEffect(() => {
    if (importing !== 'excel') return undefined;
    const capByStage = { read: 22, structure: 38, ai: 88, apply: 97, done: 100 };
    const timer = window.setInterval(() => {
      setExcelProgress((old) => {
        const cap = capByStage[excelStatus.stage] ?? 95;
        if (old >= cap) return old;
        const step = old < 35 ? 2 : 1;
        return Math.min(cap, old + step);
      });
    }, 420);
    return () => window.clearInterval(timer);
  }, [importing, excelStatus.stage]);
  useEffect(() => {
    if (importing !== 'image') { setOcrSeconds(0); return undefined; }
    const startedAt = Date.now();
    setOcrSeconds(0);
    const timer = window.setInterval(() => setOcrSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [importing]);

  const updateQuestion = (index, patch) => setForm((old) => ({ ...old, questions: old.questions.map((question, i) => i === index ? { ...question, ...patch } : question) }));
  const removeQuestion = (index) => setForm((old) => ({ ...old, questions: old.questions.filter((_, i) => i !== index) }));
  const appendQuestions = (items, label) => {
    const valid = items.map(importedQuestion).filter((item) => item.prompt.length >= 2);
    if (!valid.length) throw new Error('Không tìm thấy câu hỏi hợp lệ để thêm.');
    setForm((old) => {
      const current = old.questions.length === 1 && !old.questions[0].prompt.trim() ? [] : old.questions;
      const room = Math.max(0, 100 - current.length);
      return { ...old, questions: [...current, ...valid.slice(0, room)] };
    });
    setMessage(`Đã thêm ${Math.min(valid.length, 100)} câu từ ${label}. Bạn có thể sửa lại từng câu trước khi giao.`);
  };

  const addBulkQuestions = () => {
    try {
      const lines = bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      appendQuestions(lines.map((prompt) => ({ prompt, type: 'ESSAY', topic: 'Tổng hợp', points: 1 })), 'ô nhập nhiều câu');
      setBulkText('');
    } catch (err) { setMessage(err.message); }
  };

  const importExcel = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting('excel');
    setExcelProgress(3);
    setExcelSummary(null);
    setExcelStatus({
      stage: 'read',
      title: 'Đang mở file Excel',
      detail: 'Hệ thống đọc cấu trúc workbook trước, chưa vội coi mỗi dòng là một câu hỏi.',
    });
    setMessage('Đang đọc file Excel...');

    try {
      const XLSX = await import('xlsx');
      setExcelProgress(9);
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      if (!workbook.SheetNames?.length) throw new Error('File Excel không có sheet dữ liệu.');

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const firstSheetRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '', raw: false, blankrows: false });
      const semanticRows = workbookRowsForAI(XLSX, workbook);
      if (!semanticRows.length) throw new Error('File Excel không có dữ liệu để đọc.');
      // Parser quy tắc xử lý trước các mẫu rõ ràng để tránh AI tách nhầm
      // dòng đáp án "1. ..." thành một câu hỏi mới. AI phía sau chỉ bổ sung phần mơ hồ.
      const ruleParsed = parseExcelRuleBased(semanticRows);

      setExcelProgress(23);
      setExcelStatus({
        stage: 'structure',
        title: `Đã đọc ${workbook.SheetNames.length} sheet · đang hiểu bố cục đề`,
        detail: 'AI sẽ phân biệt tiêu đề, tiêu đề phần, câu hỏi, lựa chọn và đáp án trước khi đưa vào form.',
      });

      const chunks = chunkExcelRows(semanticRows);
      const rawQuestions = [];
      const answerMap = new Map();
      let detectedTitle = ruleParsed.assignmentTitle || '';
      let detectedInstructions = ruleParsed.instructions || '';
      let lastSection = '';
      let aiSucceeded = false;
      let aiFailure = null;

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const progress = 39 + Math.round(((chunkIndex + 0.25) / Math.max(1, chunks.length)) * 45);
        setExcelProgress(Math.min(86, progress));
        setExcelStatus({
          stage: 'ai',
          title: `AI đang phân loại nội dung · phần ${chunkIndex + 1}/${chunks.length}`,
          detail: 'Tiêu đề → ô Tiêu đề · câu hỏi → Nội dung câu hỏi · đáp án → ô Đáp án. Dòng tiêu đề phần sẽ không bị tạo thành câu hỏi.',
        });
        setMessage(`AI đang đọc cấu trúc Excel ${chunkIndex + 1}/${chunks.length}...`);

        try {
          const aiResult = await api('/learning/ai', {
            method: 'POST',
            toast: false,
            body: JSON.stringify({
              systemPrompt: 'Bạn là giáo viên tiếng Hàn người Việt chuyên chuyển đề Excel thành dữ liệu bài tập có cấu trúc. Phải hiểu ngữ nghĩa và bố cục trước khi phân loại. Chỉ trả JSON hợp lệ.',
              prompt: excelSemanticPrompt({
                rowsText: chunk.map((item) => item.line).join('\n'),
                chunkIndex,
                chunkCount: chunks.length,
                knownTitle: detectedTitle,
                knownSection: lastSection,
              }),
              temperature: 0,
              maxOutputTokens: 4096,
              jsonMode: true,
            }),
          });

          const parsed = extractJson(aiResult?.text ?? aiResult ?? '');
          aiSucceeded = true;

          const titleCandidate = cleanExcelText(parsed?.assignmentTitle ?? parsed?.title ?? parsed?.tenBai ?? parsed?.tieuDe);
          if (!detectedTitle && titleCandidate && !looksLikeSectionHeading(titleCandidate)) detectedTitle = titleCandidate;

          const instructionCandidate = cleanExcelText(parsed?.instructions ?? parsed?.instruction ?? parsed?.huongDan ?? parsed?.huongdan);
          if (!detectedInstructions && instructionCandidate) detectedInstructions = instructionCandidate;

          const sectionCandidate = cleanExcelText(parsed?.lastSectionTitle ?? parsed?.sectionTitle ?? parsed?.section ?? parsed?.topic);
          if (sectionCandidate) lastSection = sectionCandidate;

          for (const item of aiQuestionList(parsed)) {
            const normalized = normalizeExcelAIQuestion(item, lastSection);
            if (normalized) rawQuestions.push(normalized);
          }

          const answers = Array.isArray(parsed?.answerMap) ? parsed.answerMap
            : Array.isArray(parsed?.answers) ? parsed.answers
              : Array.isArray(parsed?.dapAn) ? parsed.dapAn : [];
          for (const item of answers) {
            const number = normalizeQuestionNumber(item?.number ?? item?.no ?? item?.stt ?? item?.questionNumber ?? item?.cau);
            const answer = cleanExcelText(item?.answer ?? item?.correctAnswer ?? item?.dapAn ?? item?.dapan);
            if (number && answer) answerMap.set(number, answer);
          }
        } catch (error) {
          aiFailure = error;
          console.warn(`Excel AI chunk ${chunkIndex + 1} lỗi:`, error);
          break;
        }
      }

      if (aiSucceeded && (rawQuestions.length || ruleParsed.questions.length) && !aiFailure) {
        const seen = new Set();
        const ruleMerged = mergeRuleQuestionsWithAI(ruleParsed, rawQuestions, answerMap);
        const mergedQuestions = ruleMerged.map((question) => {
          const mappedAnswer = question.number ? (answerMap.get(question.number) || ruleParsed.answerMap.get(question.number)) : '';
          const finalAnswer = resolveChoiceAnswer(question.correctAnswer || mappedAnswer || '', question.options);
          return { ...question, correctAnswer: finalAnswer };
        }).filter((question) => {
          const key = `${question.number || ''}|${question.prompt.toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        setExcelProgress(92);
        setExcelStatus({
          stage: 'apply',
          title: 'Đã hiểu đề · đang lắp dữ liệu vào đúng ô',
          detail: `${mergedQuestions.length} câu được nhận diện. Đang gắn đáp án, lựa chọn và chủ đề vào từng câu.`,
        });

        const valid = mergedQuestions.map(importedQuestion).filter((item) => item.prompt.length >= 2);
        if (!valid.length) throw new Error('AI đã đọc file nhưng không tìm thấy câu hỏi hợp lệ.');

        const answerCount = valid.filter((item) => item.correctAnswer).length;
        setForm((old) => {
          const current = old.questions.length === 1 && !old.questions[0].prompt.trim() ? [] : old.questions;
          const room = Math.max(0, 100 - current.length);
          return {
            ...old,
            title: detectedTitle || old.title,
            instructions: detectedInstructions || old.instructions,
            questions: [...current, ...valid.slice(0, room)],
          };
        });

        setExcelSummary({
          fileName: file.name,
          title: detectedTitle,
          questionCount: Math.min(valid.length, 100),
          answerCount,
          aiUsed: true,
          fallback: false,
        });
        setExcelProgress(100);
        setExcelStatus({
          stage: 'done',
          title: `Xong · AI đã phân loại ${Math.min(valid.length, 100)} câu`,
          detail: detectedTitle
            ? `Tiêu đề “${detectedTitle}” đã được đưa lên ô Tiêu đề; ${answerCount} đáp án được gắn vào đúng câu.`
            : `${answerCount} đáp án được gắn vào đúng câu. Không thấy tiêu đề toàn bài đủ rõ để tự điền.`,
        });
        setMessage(`Excel AI: đã thêm ${Math.min(valid.length, 100)} câu${detectedTitle ? ` · tiêu đề: ${detectedTitle}` : ''} · ${answerCount} câu có đáp án.`);
      } else {
        setExcelStatus({
          stage: 'apply',
          title: 'AI chưa đọc được cấu trúc · đang dùng bộ nhập dự phòng',
          detail: 'Hệ thống sẽ đọc theo cột chuẩn để không làm mất dữ liệu. Hãy kiểm tra lại các câu sau khi nhập.',
        });
        setExcelProgress(90);
        const fallbackQuestions = ruleParsed.questions.length ? ruleParsed.questions : parseExcelFallback(firstSheetRows);
        appendQuestions(fallbackQuestions, `Excel “${file.name}” (parser dự phòng)`);
        if (ruleParsed.assignmentTitle || ruleParsed.instructions) {
          setForm((old) => ({
            ...old,
            title: ruleParsed.assignmentTitle || old.title,
            instructions: ruleParsed.instructions || old.instructions,
          }));
        }
        const validFallback = fallbackQuestions.map(importedQuestion).filter((item) => item.prompt.length >= 2);
        setExcelSummary({
          fileName: file.name,
          title: '',
          questionCount: validFallback.length,
          answerCount: validFallback.filter((item) => item.correctAnswer).length,
          aiUsed: false,
          fallback: true,
        });
        setExcelProgress(100);
        setExcelStatus({
          stage: 'done',
          title: `Đã nhập dự phòng ${validFallback.length} câu`,
          detail: aiFailure?.message || 'AI không trả cấu trúc hợp lệ nên file được đọc theo cột truyền thống.',
        });
        if (aiFailure) setMessage(`AI phân loại Excel chưa khả dụng (${aiFailure.message}). Đã nhập theo cấu trúc cột dự phòng; hãy kiểm tra lại trước khi giao.`);
      }
    } catch (err) {
      console.error('Import Excel lỗi:', err);
      setExcelStatus({ stage: 'read', title: 'Chưa nhập được Excel', detail: err?.message || 'Không đọc được file Excel.' });
      setMessage(err?.message || 'Không đọc được file Excel.');
    } finally {
      window.setTimeout(() => {
        setImporting('');
        setExcelProgress(0);
      }, 1400);
    }
  };

  const downloadExcelTemplate = async () => {
    const XLSX = await import('xlsx');
    const rows = [
      { 'Câu hỏi': '저는 학생___ 입니다. Chọn đáp án đúng.', 'Loại': 'MULTIPLE_CHOICE', 'Lựa chọn': '은|는|이|가', 'Đáp án': '은', 'Giải thích': 'Dùng 은 sau phụ âm.', 'Chủ đề': 'Trợ từ', 'Điểm': 1 },
      { 'Câu hỏi': 'Dịch sang tiếng Hàn: Tôi là học sinh.', 'Loại': 'ESSAY', 'Lựa chọn': '', 'Đáp án': '저는 학생입니다.', 'Giải thích': '', 'Chủ đề': 'Bài 1', 'Điểm': 1 },
      { 'Câu hỏi': 'Viết 3 câu giới thiệu bản thân bằng tiếng Hàn.', 'Loại': 'ESSAY', 'Lựa chọn': '', 'Đáp án': '', 'Giải thích': '', 'Chủ đề': 'Viết', 'Điểm': 2 },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'CauHoi');
    XLSX.writeFile(wb, 'mau-giao-bai-hanquoc.xlsx');
  };

  const importImagesWithAI = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;

    setImporting('image');
    setOcrProgress(4);
    setOcrStatus({
      stage: 'prepare',
      title: 'Đang khởi động bộ đọc ảnh',
      detail: 'Lần đầu trên máy này có thể chậm hơn một chút vì trình duyệt cần nạp OCR.',
    });
    setMessage('Đang chuẩn bị OCR...');

    try {
      const Tesseract = await import('tesseract.js');
      setOcrProgress(8);
      setOcrStatus({
        stage: 'prepare',
        title: 'Đang nạp tiếng Việt + tiếng Hàn',
        detail: 'Bộ OCR sẽ được trình duyệt cache để những lần quét sau nhanh hơn.',
      });

      let activeFileIndex = 0;
      const worker = await Tesseract.createWorker(['vie', 'kor'], 1, {
        logger: (info) => {
          const status = String(info?.status || '');
          const progress = Number(info?.progress || 0);

          if (status === 'recognizing text') {
            const fileProgress = (activeFileIndex + progress) / Math.max(1, files.length);
            setOcrProgress(Math.max(18, Math.min(60, 18 + Math.round(fileProgress * 42))));
            setOcrStatus((old) => ({
              ...old,
              stage: old.stage === 'enhance' ? 'enhance' : 'scan',
              title: old.stage === 'enhance' ? 'Đang đọc lại vùng chữ khó' : `Đang đọc ảnh ${activeFileIndex + 1}/${files.length}`,
              detail: old.stage === 'enhance'
                ? 'Ảnh này hơi khó đọc nên hệ thống đang tăng nét một lần duy nhất.'
                : 'OCR đang nhận diện chữ Việt/Hàn ngay trên máy của bạn.',
            }));
          } else if (/loading|initializing/i.test(status)) {
            setOcrProgress((old) => Math.max(old, Math.min(17, 8 + Math.round(progress * 9))));
          }
        },
      });

      try {
        if (typeof worker.setParameters === 'function') {
          await worker.setParameters({
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
          });
        }
      } catch {
        // Một số bản Tesseract không nhận đủ parameter; OCR vẫn chạy bình thường.
      }

      const ocrPages = [];

      try {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          activeFileIndex = i;
          setOcrStatus({
            stage: 'scan',
            title: `Đang đọc ảnh ${i + 1}/${files.length}`,
            detail: 'Giữ tab này mở; hệ thống đang nhận diện chữ, không bị treo đâu 👀',
          });
          setMessage(`OCR ảnh ${i + 1}/${files.length}...`);

          const rawResult = await worker.recognize(file);
          const raw = String(rawResult?.data?.text || '').trim();
          let enhanced = raw;

          // Bản cũ luôn OCR hai lần. Bản này chỉ tăng nét + đọc lại khi lượt đầu thật sự kém,
          // nên ảnh rõ sẽ nhanh gần gấp đôi.
          if (shouldRunEnhancedOcr(raw)) {
            setOcrStatus({
              stage: 'enhance',
              title: `Ảnh ${i + 1} hơi khó đọc · đang tăng nét`,
              detail: 'Chỉ ảnh chưa rõ mới chạy lượt OCR thứ hai để tránh chờ thừa.',
            });
            setOcrProgress((old) => Math.max(old, 52));
            try {
              const canvas = await preprocessImageForOcr(file);
              const enhancedResult = await worker.recognize(canvas);
              enhanced = String(enhancedResult?.data?.text || '').trim() || raw;
            } catch (error) {
              console.warn('Preprocess OCR fallback:', error);
            }
          }

          if (raw.length >= 4 || enhanced.length >= 4) {
            ocrPages.push({ fileName: file.name, raw: raw || enhanced, enhanced: enhanced || raw });
          }
        }
      } finally {
        await worker.terminate();
      }

      if (!ocrPages.length) {
        throw new Error('Không đọc được chữ trong ảnh. Hãy dùng ảnh rõ, thẳng và đủ sáng.');
      }

      setOcrProgress(66);
      setOcrStatus({
        stage: 'ai',
        title: 'OCR xong · AI đang tách câu hỏi',
        detail: 'AI đang sửa lỗi nhận dạng, phân loại câu và dựng đáp án/lựa chọn.',
      });
      setMessage('Đã đọc xong ảnh. AI đang tách câu hỏi...');

      const allQuestions = [];
      const failures = [];

      for (let pageIndex = 0; pageIndex < ocrPages.length; pageIndex += 1) {
        const page = ocrPages[pageIndex];
        const rawChunks = splitOcrIntoChunks(page.raw);
        const enhancedChunks = splitOcrIntoChunks(page.enhanced);
        const chunkCount = Math.max(rawChunks.length, enhancedChunks.length, 1);

        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
          const label = `${page.fileName}${chunkCount > 1 ? ` · phần ${chunkIndex + 1}` : ''}`;
          const rawChunk = rawChunks[chunkIndex] || rawChunks.at(-1) || '';
          const enhancedChunk = enhancedChunks[chunkIndex] || enhancedChunks.at(-1) || '';

          const itemProgress = pageIndex + (chunkIndex + 1) / chunkCount;
          setOcrProgress(Math.min(96, 66 + Math.round((itemProgress / ocrPages.length) * 30)));
          setOcrStatus({
            stage: 'ai',
            title: `AI đang dựng câu hỏi · ${pageIndex + 1}/${ocrPages.length}`,
            detail: chunkCount > 1 ? `Đang xử lý phần ${chunkIndex + 1}/${chunkCount} của ${page.fileName}` : `Đang xử lý ${page.fileName}`,
          });
          setMessage(`AI đang sửa OCR + tách câu: ${label} 🧠`);

          let questions = [];

          for (let attempt = 0; attempt < 2 && !questions.length; attempt += 1) {
            try {
              const aiResult = await api('/learning/ai', {
                method: 'POST',
                toast: false,
                body: JSON.stringify({
                  systemPrompt: 'Bạn là giáo viên tiếng Hàn người Việt và chuyên phục dựng OCR. Không được chép nguyên chuỗi OCR vô nghĩa. Chỉ trả JSON hợp lệ.',
                  prompt: imageQuestionPrompt({
                    rawOcr: rawChunk,
                    enhancedOcr: enhancedChunk,
                    retry: attempt > 0,
                  }),
                  temperature: 0,
                  maxOutputTokens: 4096,
                  jsonMode: attempt === 0,
                }),
              });

              const parsed = extractJson(aiResult?.text ?? aiResult ?? '');
              questions = aiQuestionList(parsed)
                .map((q) => typeof q === 'string' ? { prompt: q, type: 'ESSAY' } : q)
                .filter((q) => String(
                  q?.prompt ?? q?.question ?? q?.cauHoi ?? q?.cauhoi ?? q?.noiDung ?? q?.noidung ?? ''
                ).trim().length >= 2);

              if (questions.length && questions.some((q) => looksLikeBrokenOcr(q?.prompt))) {
                setOcrStatus({
                  stage: 'ai',
                  title: 'AI đang sửa vài câu OCR chưa đẹp',
                  detail: 'Sắp xong rồi — hệ thống đang loại ký tự rác trước khi đưa vào bài.',
                });
                questions = await repairBrokenQuestionsWithAI(
                  api,
                  { raw: rawChunk, enhanced: enhancedChunk },
                  questions,
                );
              }

              const usable = questions.filter((q) => !looksLikeBrokenOcr(q?.prompt));
              if (usable.length) questions = usable;
              else if (questions.length && attempt === 0) questions = [];
            } catch (error) {
              console.warn(`Image OCR/AI attempt ${attempt + 1} lỗi:`, error);
              questions = [];
            }
          }

          if (questions.length) allQuestions.push(...questions);
          else failures.push(label);
        }
      }

      if (!allQuestions.length) {
        throw new Error('Ảnh chưa đủ rõ để nhận diện câu hỏi. Vui lòng thử ảnh rõ nét hơn hoặc cắt sát vùng đề bài.');
      }

      appendQuestions(allQuestions, `${files.length} ảnh AI quét`);
      setOcrProgress(100);
      setOcrStatus({
        stage: 'done',
        title: `Xong rồi · đã dựng ${allQuestions.length} câu`,
        detail: failures.length ? `Có ${failures.length} phần ảnh quá mờ đã được bỏ qua.` : 'Câu hỏi đã được thêm xuống dưới để giáo viên kiểm tra lại.',
      });

      if (failures.length) {
        setMessage(`Đã thêm ${allQuestions.length} câu hỏi thành công (bỏ qua ${failures.length} phần ảnh không rõ nội dung).`);
      } else {
        setMessage(`Đã nhận diện và thêm thành công ${allQuestions.length} câu hỏi từ ảnh.`);
      }
    } catch (err) {
      console.error('Import ảnh bài tập lỗi:', err);
      setOcrStatus({ stage: 'prepare', title: 'Quét ảnh chưa thành công', detail: err?.message || 'Không quét được ảnh.' });
      setMessage(err?.message || 'Không quét được ảnh.');
    } finally {
      window.setTimeout(() => {
        setImporting('');
        setOcrProgress(0);
      }, 1200);
    }
  };

  const createAssignment = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      const payload = {
        classId: Number(form.classId), type: form.type, title: form.title, instructions: form.instructions,
        dueAt: form.dueAt || null, timeLimitMinutes: form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
        questions: form.questions.map((q) => ({
          type: q.type, prompt: encodeSharedContextPrompt(q.prompt, q.sharedContext), correctAnswer: q.correctAnswer, explanation: q.explanation, topic: q.topic,
          points: Number(q.points), options: q.type === 'MULTIPLE_CHOICE' ? q.optionsText.split('\n').map((x) => x.trim()).filter(Boolean) : [],
        })),
      };
      const created = await api('/assignments', { method: 'POST', body: JSON.stringify(payload) });
      if (form.publishNow) await api(`/assignments/${created.id}/publish`, { method: 'POST' });
      setMessage(form.publishNow ? 'Đã tạo và giao bài cho toàn bộ học sinh trong lớp.' : created.message);
      setCreating(false); setForm({ classId: form.classId, type: 'HOMEWORK', title: '', instructions: '', dueAt: '', timeLimitMinutes: '', questions: [freshQuestion()], publishNow: true });
      await load();
    } catch (err) { setMessage(err.message); }
  };
  const publish = async (id) => {
    try { const data = await api(`/assignments/${id}/publish`, { method: 'POST' }); setMessage(data.message); await load(); }
    catch (err) { setMessage(err.message); }
  };

  if (user.role === 'STUDENT') return <StudentAssignments assignments={assignments} message={message} filter={studentFilter} setFilter={(value) => { setStudentFilter(value); setPage(1); }} pagination={pagination} page={page} setPage={setPage} loading={listLoading} />;
  const selectedClass = classes.find((item) => String(item.id) === selectedClassId);
  const modes = [
    ['single', Plus, 'Thêm từng câu', 'Soạn và chỉnh từng câu như hiện tại'],
    ['excel', FileSpreadsheet, 'Thêm từ Excel', 'AI hiểu tiêu đề · câu hỏi · đáp án'],
    ['image', ImagePlus, 'Ảnh → AI quét', 'OCR ảnh rồi AI tự tách thành câu'],
    ['bulk', ListPlus, 'Nhiều câu một ô', 'Mỗi dòng là một câu hỏi'],
  ];

  return <>
    <PageHeader eyebrow="GIÁO VIÊN" title="Bài tập & bài kiểm tra" subtitle={selectedClass ? `Đang xem riêng lớp ${selectedClass.name}. Bài của lớp khác không hiển thị trong danh sách này.` : 'Đang xem tất cả lớp. Mỗi bài vẫn chỉ thuộc đúng một lớp.'} action={<button className="btn primary" onClick={() => { setCreating((v) => !v); if (selectedClassId) setForm((old) => ({ ...old, classId: selectedClassId })); }}><FilePlus2 size={18} /> Tạo bài mới</button>} />
    {message && <div className="notice">{message}</div>}
    <div className="assignment-class-filter"><div><School size={17} /><span><strong>Lọc theo lớp</strong><small>Tách lộ trình và bài tập của từng lớp</small></span></div><select value={selectedClassId} onChange={(e) => { const value = e.target.value; setPage(1); setSearchParams(value ? { classId: value } : {}); }}><option value="">Tất cả lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></div>
    {creating && <form className="panel assignment-builder" onSubmit={createAssignment}>
      <div className="panel-title"><div><span>BÀI MỚI</span><h3>Soạn nội dung</h3></div><button type="button" className="btn ghost" onClick={() => setCreating(false)}>Đóng</button></div>
      <div className="form-grid three">
        <label>Lớp<select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required><option value="">Chọn lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Loại<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="HOMEWORK">Bài tập về nhà</option><option value="TEST">Bài kiểm tra</option></select></label>
        <label>Hạn nộp<input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
        <label className="span-2">Tiêu đề<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ôn tập Bài 5" required /></label>
        <label>Thời gian (phút)<input type="number" min="1" max="360" value={form.timeLimitMinutes} onChange={(e) => setForm({ ...form, timeLimitMinutes: e.target.value })} placeholder="Tùy chọn" /></label>
        <label className="span-3">Hướng dẫn<textarea rows="2" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Làm cẩn thận, kiểm tra lại trước khi nộp..." /></label>
      </div>

      <div className="question-source-block">
        <div className="question-source-title"><div><Type size={18} /><strong>Chọn cách thêm câu hỏi</strong></div><span>Tối đa 100 câu / bài</span></div>
        <div className="question-source-grid">
          {modes.map(([id, Icon, title, note]) => <button key={id} type="button" className={`question-source-card ${inputMode === id ? 'active' : ''}`} onClick={() => setInputMode(id)}><Icon size={19} /><span><strong>{title}</strong><small>{note}</small></span></button>)}
        </div>
        {inputMode === 'single' && <div className="question-source-action single"><span>Thêm một câu trống rồi nhập nội dung ở danh sách bên dưới.</span><button type="button" className="btn secondary small" onClick={() => setForm((old) => ({ ...old, questions: [...old.questions, freshQuestion()] }))}><Plus size={16} /> Thêm từng câu</button></div>}
        {inputMode === 'excel' && <div className={`question-source-action ${importing === 'excel' ? 'ocr-running' : ''}`}><div><strong>Excel → AI đọc cấu trúc đề</strong><p>Bộ đọc nhận diện mẫu rõ ràng trước, AI xử lý phần mơ hồ: tiêu đề → ô Tiêu đề, câu hỏi → Nội dung câu hỏi, lựa chọn → Lựa chọn, đáp án → ô Đáp án. Đoạn văn dùng chung cho “Câu 26-28” được giữ làm đề/ngữ cảnh và không bị tính thành câu riêng. Chỉ có 2 loại: Trắc nghiệm và Tự luận · AI chấm.</p>{importing === 'excel' && <div className="ocr-processing-card excel-processing-card"><div className="ocr-processing-head"><div className={`ocr-orb ${excelStatus.stage === 'ai' ? 'ai' : excelStatus.stage === 'done' ? 'done' : ''}`}><FileSpreadsheet size={18} /></div><div className="ocr-status-copy"><strong>{excelStatus.title || 'Đang đọc Excel...'}</strong><small>{excelStatus.detail || 'Hệ thống vẫn đang xử lý file.'}</small></div><div className="ocr-time"><b>{excelProgress}%</b><span>{excelSeconds}s</span></div></div><div className="ocr-progress excel-progress"><i style={{ width: `${excelProgress}%` }} /><em /></div><div className="ocr-stepper five">{[['read', 'Đọc file'], ['structure', 'Hiểu bố cục'], ['ai', 'AI phân loại'], ['apply', 'Gắn dữ liệu'], ['done', 'Hoàn tất']].map(([stage, label]) => { const current = EXCEL_STAGE_ORDER.indexOf(excelStatus.stage); const index = EXCEL_STAGE_ORDER.indexOf(stage); const done = current > index || excelStatus.stage === 'done'; const active = current === index && excelStatus.stage !== 'done'; return <span key={stage} className={`${done ? 'done' : ''} ${active ? 'active' : ''}`}><i>{done ? '✓' : active ? <Sparkles size={11} /> : '•'}</i>{label}</span>; })}</div><div className="ocr-wait-note"><span className="ocr-live-dot" />AI đang đọc theo ngữ nghĩa, không phải cứ mỗi dòng Excel là một câu hỏi.</div></div>}{importing !== 'excel' && excelSummary && <div className={`excel-import-summary ${excelSummary.fallback ? 'fallback' : ''}`}><span><CheckCircle2 size={14} /> {excelSummary.aiUsed ? 'AI đã phân loại' : 'Đã nhập dự phòng'}</span>{excelSummary.title && <span>Tiêu đề: <b>{excelSummary.title}</b></span>}<span><b>{excelSummary.questionCount}</b> câu hỏi</span><span><b>{excelSummary.answerCount}</b> đáp án</span></div>}</div><div className="source-buttons"><button type="button" className="btn ghost small" onClick={downloadExcelTemplate} disabled={Boolean(importing)}><FileSpreadsheet size={16} /> Tải file mẫu</button><label className={`btn secondary small file-button ${importing ? 'disabled' : ''}`}>{importing === 'excel' ? <LoaderCircle className="spin" size={16} /> : <FileSpreadsheet size={16} />} {importing === 'excel' ? 'AI đang đọc...' : 'Chọn Excel'}<input type="file" accept=".xlsx,.xls" onChange={importExcel} disabled={Boolean(importing)} /></label></div></div>}
        {inputMode === 'image' && <div className={`question-source-action ${importing === 'image' ? 'ocr-running' : ''}`}><div><strong>Ảnh → OCR → AI tách câu</strong><p>Ảnh rõ sẽ chỉ OCR một lượt cho nhanh; ảnh khó đọc mới tự tăng nét và quét lại. Không cần nhập API key ở máy giáo viên.</p>{importing === 'image' && <div className="ocr-processing-card"><div className="ocr-processing-head"><div className={`ocr-orb ${ocrStatus.stage}`}><ScanLine size={18} /></div><div className="ocr-status-copy"><strong>{ocrStatus.title || 'Đang xử lý ảnh...'}</strong><small>{ocrStatus.detail || 'Hệ thống vẫn đang chạy.'}</small></div><div className="ocr-time"><b>{ocrProgress}%</b><span>{ocrSeconds}s</span></div></div><div className="ocr-progress"><i style={{ width: `${ocrProgress}%` }} /><em /></div><div className="ocr-stepper four">{[['prepare', 'Khởi động'], ['scan', 'Đọc ảnh'], ['ai', 'AI tách câu'], ['done', 'Hoàn tất']].map(([stage, label]) => { const normalizedStage = ocrStatus.stage === 'enhance' ? 'scan' : ocrStatus.stage; const current = OCR_STAGE_ORDER.indexOf(normalizedStage); const index = OCR_STAGE_ORDER.indexOf(stage); const done = current > index || normalizedStage === 'done'; const active = current === index && normalizedStage !== 'done'; return <span key={stage} className={`${done ? 'done' : ''} ${active ? 'active' : ''}`}><i>{done ? '✓' : active ? <Sparkles size={11} /> : '•'}</i>{label}</span>; })}</div><div className="ocr-wait-note"><span className="ocr-live-dot" />Trang không bị treo · cứ để tab mở, hệ thống đang xử lý thật.</div></div>}</div><label className={`btn secondary small file-button ${importing ? 'disabled' : ''}`}>{importing === 'image' ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />} {importing === 'image' ? 'Đang quét...' : 'Chọn ảnh'}<input type="file" accept="image/*" multiple onChange={importImagesWithAI} disabled={Boolean(importing)} /></label></div>}
        {inputMode === 'bulk' && <div className="question-source-action bulk"><div><strong>Dán nhiều câu vào một ô</strong><p>Mỗi câu chỉ cần xuống dòng. Hệ thống thêm thành Tự luận · AI chấm; sau đó có thể đổi từng câu sang Trắc nghiệm nếu có các lựa chọn.</p></div><textarea rows="7" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={'Câu 1: Dịch câu sau sang tiếng Hàn...\nCâu 2: Viết 3 câu về cuối tuần...\nCâu 3: Hãy đặt câu với -고 싶다...'} /><button type="button" className="btn secondary small" onClick={addBulkQuestions} disabled={!bulkText.trim()}><ListPlus size={16} /> Thêm các dòng</button></div>}
      </div>

      <div className="question-builder-head"><div><strong>Câu hỏi đã thêm</strong><span>{form.questions.length} câu</span></div><button type="button" className="btn secondary small" onClick={() => setForm({ ...form, questions: [...form.questions, freshQuestion()] })}><Plus size={16} /> Thêm câu</button></div>
      <div className="question-builder-list">
        {form.questions.map((question, index) => <div className="question-edit" key={index}>
          <div className="question-number">{index + 1}</div>
          <div className="question-edit-main">
            <div className="question-meta-row">
              <select value={question.type === 'SHORT_TEXT' ? 'ESSAY' : question.type} onChange={(e) => updateQuestion(index, { type: e.target.value })}><option value="MULTIPLE_CHOICE">Trắc nghiệm</option><option value="ESSAY">Tự luận · AI chấm</option></select>
              <input value={question.topic} onChange={(e) => updateQuestion(index, { topic: e.target.value })} placeholder="Chủ đề: Ngữ pháp bài 5" />
              <label className="points-input"><input type="number" min="0.25" step="0.25" value={question.points} onChange={(e) => updateQuestion(index, { points: e.target.value })} /> điểm</label>
              {form.questions.length > 1 && <button type="button" className="icon-button danger" onClick={() => removeQuestion(index)}><Trash2 size={17} /></button>}
            </div>
            {question.sharedContext && <div className="shared-context-editor"><div className="shared-context-label"><strong>Đề chung / đoạn văn</strong><span>Hiển thị 1 lần trước nhóm câu</span></div><textarea rows="5" value={question.sharedContext} onChange={(e) => updateQuestion(index, { sharedContext: e.target.value })} placeholder="Đoạn văn, hội thoại hoặc dữ liệu dùng chung cho nhóm câu" /></div>}
            <textarea rows="2" value={question.prompt} onChange={(e) => updateQuestion(index, { prompt: e.target.value })} placeholder="Nội dung câu hỏi" required />
            {question.type === 'MULTIPLE_CHOICE' && <textarea rows="3" value={question.optionsText} onChange={(e) => updateQuestion(index, { optionsText: e.target.value })} placeholder={'Các lựa chọn, mỗi dòng 1 đáp án\n학교\n병원\n은행'} required />}
            <div className="answer-row"><input value={question.correctAnswer} onChange={(e) => updateQuestion(index, { correctAnswer: e.target.value })} placeholder={question.type === 'ESSAY' ? 'Đáp án tham khảo cho AI (khuyên có)' : 'Đáp án đúng · có thể dùng A||B để chấp nhận nhiều đáp án'} required={question.type !== 'ESSAY'} /><input value={question.explanation} onChange={(e) => updateQuestion(index, { explanation: e.target.value })} placeholder="Giải thích khi sai (tùy chọn)" /></div>
          </div>
        </div>)}
      </div>
      <div className="builder-actions"><label className="check-label"><input type="checkbox" checked={form.publishNow} onChange={(e) => setForm({ ...form, publishNow: e.target.checked })} /> Giao ngay cho toàn bộ học sinh</label><button className="btn primary"><Send size={17} /> {form.publishNow ? 'Tạo & giao bài' : 'Lưu bản nháp'}</button></div>
    </form>}
    <section className="panel"><div className="panel-title"><div><span>DANH SÁCH</span><h3>{selectedClass ? `Bài của lớp ${selectedClass.name}` : 'Bài của tất cả lớp'}</h3></div>{selectedClass && <span className="class-context-badge"><School size={14} /> {selectedClass.code}</span>}</div>
      {listLoading ? <Empty>Đang tải trang bài tập...</Empty> : assignments.length ? <div className="assignment-cards">{assignments.map((item) => <article className="assignment-card" key={item.id}>
        <div className={`assignment-type ${item.type.toLowerCase()}`}>{item.type === 'TEST' ? <ClipboardCheck /> : <ClipboardList />}</div>
        <div className="assignment-main"><div className="assignment-title-row"><strong>{item.title}</strong><span className={`status ${item.status.toLowerCase()}`}>{item.status === 'DRAFT' ? 'Bản nháp' : item.status === 'PUBLISHED' ? 'Đang mở' : 'Đã đóng'}</span></div><p className="assignment-class-name"><School size={14} /> Lớp: <strong>{item.className}</strong></p><div className="assignment-meta"><span><Clock3 size={15} /> {formatDate(item.due_at)}</span><span><CheckCircle2 size={15} /> {item.submittedCount || 0}/{item.studentCount || 0} đã nộp</span></div></div>
        <div className="assignment-actions">{item.status === 'DRAFT' && <button className="btn secondary small" onClick={() => publish(item.id)}><Send size={15} /> Giao bài</button>}<Link className="btn ghost small" to={`/assignments/${item.id}`}>Chi tiết</Link></div>
      </article>)}</div> : <Empty>Chưa có bài nào. Tạo bài đầu tiên nhé.</Empty>}
      <Pagination pagination={pagination} loading={listLoading} onPageChange={setPage} label="bài" />
    </section>
  </>;
}

function StudentAssignments({ assignments, message, filter, setFilter, pagination, setPage, loading }) {
  return <>
    <PageHeader eyebrow="HỌC SINH" title="Bài của tôi" subtitle="Bài mới từ giáo viên sẽ tự xuất hiện ở đây." />
    {message && <div className="notice">{message}</div>}
    <div className="segmented"><button className={filter === 'PENDING' ? 'active' : ''} onClick={() => setFilter('PENDING')}>Cần làm</button><button className={filter === 'DONE' ? 'active' : ''} onClick={() => setFilter('DONE')}>Đã nộp</button><button className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>Tất cả</button></div>
    <section className="panel">
      {loading ? <Empty>Đang tải trang bài tập...</Empty> : assignments.length ? <div className="student-assignment-grid">{assignments.map((item) => <Link className="student-assignment-card" to={`/assignments/${item.id}`} key={item.id}><div className="student-assignment-top"><span className={`type-pill ${item.type.toLowerCase()}`}>{item.type === 'TEST' ? 'Bài kiểm tra' : 'Bài tập'}</span>{item.submissionId ? <span className="score-pill">{Math.round(item.percentage)} điểm</span> : <ChevronDown size={18} />}</div><h3>{item.title}</h3><p>{item.className}</p><div className="student-assignment-bottom"><span><Clock3 size={15} /> {formatDate(item.due_at)}</span><strong>{item.submissionId ? 'Xem kết quả' : 'Làm bài →'}</strong></div></Link>)}</div> : <Empty>{filter === 'PENDING' ? 'Không còn bài đang chờ.' : 'Chưa có bài phù hợp.'}</Empty>}
      <Pagination pagination={pagination} loading={loading} onPageChange={setPage} label="bài" />
    </section>
  </>;
}
