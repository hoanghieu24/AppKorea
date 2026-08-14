import { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Clock3, FilePlus2,
  FileSpreadsheet, ImagePlus, ListPlus, LoaderCircle, Plus, School, Send, Trash2, Type,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

const freshQuestion = (patch = {}) => ({
  type: 'MULTIPLE_CHOICE', prompt: '', optionsText: '', correctAnswer: '', explanation: '', topic: 'Từ vựng', points: 1,
  ...patch,
});

const headerKey = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

const splitOptions = (value) => String(value || '').split(/\r?\n|\||;/).map((item) => item.trim()).filter(Boolean);
const normalizeType = (value, hasOptions, hasAnswer) => {
  const key = headerKey(value);
  if (['multiplechoice', 'tracnghiem', 'mcq'].includes(key)) return 'MULTIPLE_CHOICE';
  if (['shorttext', 'traloinho', 'dientu', 'short'].includes(key)) return 'SHORT_TEXT';
  if (['essay', 'tuluan'].includes(key)) return 'ESSAY';
  if (hasOptions) return 'MULTIPLE_CHOICE';
  if (hasAnswer) return 'SHORT_TEXT';
  return 'ESSAY';
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

function imageQuestionPrompt(ocrText, retry = false) {
  return `${retry ? 'LƯU Ý: LẦN TRƯỚC BẠN TRẢ SAI FORMAT. LẦN NÀY CHỈ ĐƯỢC TRẢ JSON THUẦN.\\n\\n' : ''}
Bạn đang nhập đề bài tiếng Hàn từ ảnh cho giáo viên.

NHIỆM VỤ:
- Đọc phần OCR bên dưới và tách TẤT CẢ câu hỏi/bài tập có thật trong nội dung.
- Giữ nguyên tiếng Hàn, tiếng Việt, số câu và ý nghĩa gốc tối đa có thể.
- KHÔNG tự bịa thêm câu hỏi.
- Nếu có các lựa chọn ①②③④, A/B/C/D hoặc danh sách đáp án thì đưa vào options.
- Nếu đáp án xuất hiện rõ trong ảnh thì điền correctAnswer; nếu không chắc thì để "".
- Nếu không chắc loại câu, dùng ESSAY để giáo viên sửa lại.
- Mỗi câu phải có prompt không rỗng.
- Tối đa 25 câu trong một lần trả lời.

CHỈ TRẢ JSON, KHÔNG markdown, KHÔNG giải thích ngoài JSON:
{"questions":[
  {
    "type":"MULTIPLE_CHOICE|SHORT_TEXT|ESSAY",
    "prompt":"nội dung câu hỏi",
    "options":["lựa chọn 1","lựa chọn 2"],
    "correctAnswer":"",
    "explanation":"",
    "topic":"Tổng hợp",
    "points":1
  }
]}

OCR:
${ocrText}`;
}

function importedQuestion(raw = {}) {
  const options = Array.isArray(raw.options) ? raw.options.map(String).filter(Boolean) : splitOptions(raw.optionsText ?? raw.options ?? raw.luaChon ?? raw.luachon);
  const answer = String(raw.correctAnswer ?? raw.answer ?? raw.dapAn ?? raw.dapan ?? '').trim();
  const prompt = String(raw.prompt ?? raw.question ?? raw.cauHoi ?? raw.cauhoi ?? raw.noiDung ?? raw.noidung ?? '').trim();
  const type = normalizeType(raw.type ?? raw.loai, options.length > 0, Boolean(answer));
  return freshQuestion({
    type,
    prompt,
    optionsText: options.join('\n'),
    correctAnswer: answer,
    explanation: String(raw.explanation ?? raw.giaiThich ?? raw.giaithich ?? '').trim(),
    topic: String(raw.topic ?? raw.chuDe ?? raw.chude ?? 'Tổng hợp').trim() || 'Tổng hợp',
    points: Number(raw.points ?? raw.diem ?? 1) || 1,
  });
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
  const [ocrProgress, setOcrProgress] = useState(0);
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
    setImporting('excel'); setMessage('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rows.length) throw new Error('File Excel không có dữ liệu.');

      const known = new Set(['cauhoi', 'question', 'prompt', 'noidung', 'loai', 'type', 'luachon', 'options', 'dapan', 'answer', 'giaithich', 'explanation', 'chude', 'topic', 'diem', 'points']);
      const firstKeys = rows[0].map(headerKey);
      const hasHeader = firstKeys.some((key) => known.has(key));
      let questions;
      if (hasHeader) {
        const indexOf = (...aliases) => firstKeys.findIndex((key) => aliases.includes(key));
        const idx = {
          prompt: indexOf('cauhoi', 'question', 'prompt', 'noidung'), type: indexOf('loai', 'type'),
          options: indexOf('luachon', 'options'), answer: indexOf('dapan', 'answer'), explanation: indexOf('giaithich', 'explanation'),
          topic: indexOf('chude', 'topic'), points: indexOf('diem', 'points'),
        };
        questions = rows.slice(1).map((row) => ({
          prompt: idx.prompt >= 0 ? row[idx.prompt] : row[0], type: idx.type >= 0 ? row[idx.type] : '',
          options: idx.options >= 0 ? row[idx.options] : '', answer: idx.answer >= 0 ? row[idx.answer] : '',
          explanation: idx.explanation >= 0 ? row[idx.explanation] : '', topic: idx.topic >= 0 ? row[idx.topic] : 'Tổng hợp',
          points: idx.points >= 0 ? row[idx.points] : 1,
        }));
      } else {
        questions = rows.map((row) => ({ prompt: row[0], answer: row[1] || '', options: row[2] || '', topic: row[3] || 'Tổng hợp' }));
      }
      appendQuestions(questions, `Excel “${file.name}”`);
    } catch (err) { setMessage(err.message || 'Không đọc được file Excel.'); }
    finally { setImporting(''); }
  };

  const downloadExcelTemplate = async () => {
    const XLSX = await import('xlsx');
    const rows = [
      { 'Câu hỏi': '저는 학생___ 입니다. Chọn đáp án đúng.', 'Loại': 'MULTIPLE_CHOICE', 'Lựa chọn': '은|는|이|가', 'Đáp án': '은', 'Giải thích': 'Dùng 은 sau phụ âm.', 'Chủ đề': 'Trợ từ', 'Điểm': 1 },
      { 'Câu hỏi': 'Dịch sang tiếng Hàn: Tôi là học sinh.', 'Loại': 'SHORT_TEXT', 'Lựa chọn': '', 'Đáp án': '저는 학생입니다.', 'Giải thích': '', 'Chủ đề': 'Bài 1', 'Điểm': 1 },
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
    setOcrProgress(1);
    setMessage(`Đang soi ${files.length} ảnh... AI đeo kính vào rồi 🤓`);

    try {
      const Tesseract = await import('tesseract.js');
      let currentFileIndex = 0;

      // Có cả tiếng Việt để OCR phần đề Việt + tiếng Hàn chính xác hơn.
      const worker = await Tesseract.createWorker(['kor', 'vie', 'eng'], 1, {
        logger: (info) => {
          if (info.status === 'recognizing text') {
            const overall = (currentFileIndex + Number(info.progress || 0)) / files.length;
            setOcrProgress(Math.max(1, Math.min(65, Math.round(overall * 65))));
          }
        },
      });

      const ocrPages = [];
      try {
        for (let i = 0; i < files.length; i += 1) {
          currentFileIndex = i;
          const result = await worker.recognize(files[i]);
          const text = String(result?.data?.text || '').trim();
          if (text.length >= 4) ocrPages.push({ fileName: files[i].name, text });
        }
      } finally {
        await worker.terminate();
      }

      if (!ocrPages.length) {
        throw new Error('Không đọc được chữ trong ảnh. Hãy dùng ảnh rõ, thẳng và đủ sáng.');
      }

      setMessage('OCR xong ✅ Gemini đang tách từng câu, đừng F5 nha 😆');

      const allQuestions = [];
      const failures = [];
      const workItems = [];

      // Không nhồi toàn bộ nhiều trang vào 1 request nữa:
      // mỗi ảnh/chunk xử lý riêng để tránh Gemini trả JSON bị cắt.
      for (let pageIndex = 0; pageIndex < ocrPages.length; pageIndex += 1) {
        const page = ocrPages[pageIndex];
        const chunks = splitOcrIntoChunks(page.text);
        chunks.forEach((chunk, chunkIndex) => {
          workItems.push({
            label: `${page.fileName}${chunks.length > 1 ? ` · phần ${chunkIndex + 1}` : ''}`,
            text: chunk,
          });
        });
      }

      for (let index = 0; index < workItems.length; index += 1) {
        const item = workItems[index];
        const progress = 65 + Math.round((index / Math.max(1, workItems.length)) * 33);
        setOcrProgress(Math.min(98, progress));
        setMessage(`Gemini đang đọc ${index + 1}/${workItems.length}: ${item.label} 🤖`);

        let questions = [];
        let lastRaw = '';

        for (let attempt = 0; attempt < 2 && !questions.length; attempt += 1) {
          try {
            const aiResult = await api('/learning/ai', {
              method: 'POST',
              toast: false,
              body: JSON.stringify({
                systemPrompt: 'Bạn là hệ thống trích xuất đề bài tiếng Hàn. Chỉ trả JSON hợp lệ đúng schema được yêu cầu.',
                prompt: imageQuestionPrompt(item.text, attempt > 0),
                temperature: 0,
                maxOutputTokens: 4096,
                // Lần 2 tắt jsonMode để xử lý trường hợp model/provider
                // trả cấu trúc lạ khi ép responseMimeType.
                jsonMode: attempt === 0,
              }),
            });

            lastRaw = aiResult?.text ?? aiResult ?? '';
            const parsed = extractJson(lastRaw);
            questions = aiQuestionList(parsed)
              .map((question) => typeof question === 'string' ? { prompt: question, type: 'ESSAY' } : question)
              .filter((question) => String(
                question?.prompt ??
                question?.question ??
                question?.cauHoi ??
                question?.cauhoi ??
                question?.noiDung ??
                question?.noidung ??
                ''
              ).trim().length >= 2);
          } catch (error) {
            console.warn(`Ảnh AI attempt ${attempt + 1} lỗi:`, error, lastRaw);
          }
        }

        if (questions.length) {
          allQuestions.push(...questions);
        } else {
          failures.push(item.label);
        }
      }

      if (!allQuestions.length) {
        throw new Error(
          'Gemini vẫn chưa tách được câu hỏi. OCR đã chạy xong nhưng AI trả sai định dạng; thử lại 1 ảnh/lần hoặc kiểm tra model Gemini trong Admin.'
        );
      }

      appendQuestions(allQuestions, `${files.length} ảnh AI quét`);
      setOcrProgress(100);

      if (failures.length) {
        setMessage(`Đã thêm ${allQuestions.length} câu ✅ Có ${failures.length} phần ảnh AI chưa đọc chắc nên đã bỏ qua: ${failures.join(', ')}.`);
      } else {
        setMessage(`Đã quét xong ${files.length} ảnh và thêm ${allQuestions.length} câu ✅ AI hôm nay làm việc được việc phết 😎`);
      }
    } catch (err) {
      console.error('Import ảnh bài tập lỗi:', err);
      setMessage(err?.message || 'Không quét được ảnh.');
    } finally {
      setImporting('');
      window.setTimeout(() => setOcrProgress(0), 700);
    }
  };

  const createAssignment = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      const payload = {
        classId: Number(form.classId), type: form.type, title: form.title, instructions: form.instructions,
        dueAt: form.dueAt || null, timeLimitMinutes: form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
        questions: form.questions.map((q) => ({
          type: q.type, prompt: q.prompt, correctAnswer: q.correctAnswer, explanation: q.explanation, topic: q.topic,
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
    ['excel', FileSpreadsheet, 'Thêm từ Excel', 'Đọc .xlsx/.xls và đưa vào danh sách'],
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
        {inputMode === 'excel' && <div className="question-source-action"><div><strong>Nhập từ Excel</strong><p>Hỗ trợ cột: Câu hỏi, Loại, Lựa chọn, Đáp án, Giải thích, Chủ đề, Điểm. Nếu file chỉ có một cột thì mỗi dòng sẽ thành một câu tự luận.</p></div><div className="source-buttons"><button type="button" className="btn ghost small" onClick={downloadExcelTemplate}><FileSpreadsheet size={16} /> Tải file mẫu</button><label className={`btn secondary small file-button ${importing === 'excel' ? 'disabled' : ''}`}>{importing === 'excel' ? <LoaderCircle className="spin" size={16} /> : <FileSpreadsheet size={16} />} Chọn Excel<input type="file" accept=".xlsx,.xls" onChange={importExcel} disabled={Boolean(importing)} /></label></div></div>}
        {inputMode === 'image' && <div className="question-source-action"><div><strong>Ảnh → OCR → AI tách câu</strong><p>Chụp thẳng, đủ sáng. Ảnh được OCR trên trình duyệt; phần chữ sau đó gửi tới AI hệ thống để tách câu. Không cần nhập API key ở máy giáo viên.</p>{importing === 'image' && <div className="ocr-progress"><i style={{ width: `${ocrProgress}%` }} /><span>{ocrProgress ? `${ocrProgress}%` : 'AI đang xử lý...'}</span></div>}</div><label className={`btn secondary small file-button ${importing ? 'disabled' : ''}`}>{importing === 'image' ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />} Chọn ảnh<input type="file" accept="image/*" multiple onChange={importImagesWithAI} disabled={Boolean(importing)} /></label></div>}
        {inputMode === 'bulk' && <div className="question-source-action bulk"><div><strong>Dán nhiều câu vào một ô</strong><p>Mỗi câu chỉ cần xuống dòng. Hệ thống thêm thành câu tự luận; sau đó có thể đổi từng câu sang trắc nghiệm/điền từ và thêm đáp án.</p></div><textarea rows="7" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={'Câu 1: Dịch câu sau sang tiếng Hàn...\nCâu 2: Viết 3 câu về cuối tuần...\nCâu 3: Hãy đặt câu với -고 싶다...'} /><button type="button" className="btn secondary small" onClick={addBulkQuestions} disabled={!bulkText.trim()}><ListPlus size={16} /> Thêm các dòng</button></div>}
      </div>

      <div className="question-builder-head"><div><strong>Câu hỏi đã thêm</strong><span>{form.questions.length} câu</span></div><button type="button" className="btn secondary small" onClick={() => setForm({ ...form, questions: [...form.questions, freshQuestion()] })}><Plus size={16} /> Thêm câu</button></div>
      <div className="question-builder-list">
        {form.questions.map((question, index) => <div className="question-edit" key={index}>
          <div className="question-number">{index + 1}</div>
          <div className="question-edit-main">
            <div className="question-meta-row">
              <select value={question.type} onChange={(e) => updateQuestion(index, { type: e.target.value })}><option value="MULTIPLE_CHOICE">Trắc nghiệm</option><option value="SHORT_TEXT">Điền / trả lời ngắn</option><option value="ESSAY">Tự luận · AI chấm</option></select>
              <input value={question.topic} onChange={(e) => updateQuestion(index, { topic: e.target.value })} placeholder="Chủ đề: Ngữ pháp bài 5" />
              <label className="points-input"><input type="number" min="0.25" step="0.25" value={question.points} onChange={(e) => updateQuestion(index, { points: e.target.value })} /> điểm</label>
              {form.questions.length > 1 && <button type="button" className="icon-button danger" onClick={() => removeQuestion(index)}><Trash2 size={17} /></button>}
            </div>
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
