import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Layers3, Search, Sparkles, Volume2 } from 'lucide-react';
import { api } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

export default function VocabularyPage({ user }) {
  const [classes, setClasses] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [classId, setClassId] = useState('');
  const [lessonId, setLessonId] = useState('1');
  const [catalog, setCatalog] = useState([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPagination, setCatalogPagination] = useState(null);
  const [classWords, setClassWords] = useState([]);
  const [classPage, setClassPage] = useState(1);
  const [classPagination, setClassPagination] = useState(null);
  const [importedIds, setImportedIds] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('list');
  const [studentViewTab, setStudentViewTab] = useState('all');
  const [message, setMessage] = useState('');
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [classWordsLoading, setClassWordsLoading] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

  useEffect(() => {
    Promise.all([api('/classes'), api('/textbook/lessons')]).then(([a, b]) => {
      setClasses(a.classes); setLessons(b.lessons);
      if (a.classes[0] && (user.role !== 'TEACHER' || a.classes.length === 1)) setClassId(String(a.classes[0].id));
      if (b.lessons[0]) setLessonId(String(b.lessons[0].id));
    }).catch((err) => setMessage(err.message)).finally(() => setLessonsLoading(false));
  }, []);
  useEffect(() => { setCatalogPage(1); setSelected(new Set()); }, [lessonId]);
  useEffect(() => {
    if (!lessonId) return;
    setCatalogLoading(true);
    api(`/textbook/lessons/${lessonId}/vocabulary?page=${catalogPage}&pageSize=8`)
      .then((data) => { setCatalog(data.vocabulary); setCatalogPagination(data.pagination); setMessage(''); })
      .catch((err) => { setCatalog([]); setMessage(err.message); })
      .finally(() => setCatalogLoading(false));
  }, [lessonId, catalogPage]);
  const loadClassWords = async (page = classPage) => {
    if (!classId) { setClassWords([]); setClassPagination(null); setImportedIds([]); return; }
    setClassWordsLoading(true);
    try {
      const suffix = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
      const data = await api(`/classes/${classId}/vocabulary?page=${page}&pageSize=8${suffix}`);
      setClassWords(data.vocabulary); setClassPagination(data.pagination);
      if (user.role === 'TEACHER') setImportedIds((await api(`/classes/${classId}/vocabulary?idsOnly=1`)).ids || []);
    } catch (err) { setMessage(err.message); }
    finally { setClassWordsLoading(false); }
  };
  useEffect(() => { setClassPage(1); setSelected(new Set()); }, [classId, query]);
  useEffect(() => {
    const timer = window.setTimeout(() => loadClassWords(classPage), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [classId, classPage, query]);

  const imported = useMemo(() => new Set(importedIds.map(Number)), [importedIds]);
  const activeLesson = lessons.find((lesson) => String(lesson.id) === String(lessonId));
  const activeClass = classes.find((item) => String(item.id) === String(classId));
  const preserveScroll = (fn) => { const top = window.scrollY; fn(); window.requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' })); };
  const toggle = (id) => preserveScroll(() => setSelected((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; }));
  const selectAll = async () => {
    if (!lessonId) return;
    setSelectingAll(true);
    try {
      const data = await api(`/textbook/lessons/${lessonId}/vocabulary?all=1`);
      setSelected(new Set((data.vocabulary || []).filter((word) => !imported.has(Number(word.id))).map((word) => Number(word.id))));
    } catch (err) { setMessage(err.message); }
    finally { setSelectingAll(false); }
  };
  const importWords = async () => {
    if (!classId) return setMessage('Bạn chưa có lớp để giao bài học vào.');
    if (!selected.size) return setMessage('Chọn ít nhất một từ hoặc toàn bộ bài trước.');
    try {
      const data = await api(`/classes/${classId}/vocabulary/import`, { method: 'POST', body: JSON.stringify({ vocabularyIds: [...selected] }) });
      setMessage(data.message); setSelected(new Set()); setClassPage(1); await loadClassWords(1);
    } catch (err) { setMessage(err.message); }
  };

  return <>
    <PageHeader eyebrow={user.role === 'TEACHER' ? 'KHO HỌC LIỆU' : 'ÔN TẬP'} title={user.role === 'TEACHER' ? 'Tích hợp Từ vựng & Ngữ pháp từ sách' : 'Từ vựng & Ngữ pháp của lớp'} subtitle={user.role === 'TEACHER' ? 'Chọn bài → chọn từ vựng & ngữ pháp → giao cho lớp. Học sinh sẽ học đầy đủ cả từ vựng và ngữ pháp.' : 'Học theo danh sách từ vựng và cấu trúc ngữ pháp giáo viên đã giao cho lớp.'} />
    {message && <div className="notice">{message}</div>}
    <div className="vocab-toolbar">
      <label><span>{user.role === 'TEACHER' ? 'Lớp nhận học liệu' : 'Lớp'}</span><select value={classId} onChange={(e) => setClassId(e.target.value)}>{user.role === 'TEACHER' && classes.length > 1 && <option value="">-- Chọn đúng lớp cần giao --</option>}{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ''}</option>)}</select></label>
      {user.role === 'STUDENT' && <div className="segmented compact"><button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>Danh sách</button><button className={mode === 'flash' ? 'active' : ''} onClick={() => setMode('flash')}>Flashcard</button></div>}
    </div>
    {user.role === 'TEACHER' ? <TeacherCatalog lessons={lessons} lessonsLoading={lessonsLoading} catalogLoading={catalogLoading} classWordsLoading={classWordsLoading} selectingAll={selectingAll} lessonId={lessonId} setLessonId={setLessonId} activeLesson={activeLesson} activeClass={activeClass} catalog={catalog} catalogPagination={catalogPagination} setCatalogPage={setCatalogPage} selected={selected} setSelected={setSelected} imported={imported} toggle={toggle} selectAll={selectAll} importWords={importWords} classWords={classWords} classPagination={classPagination} setClassPage={setClassPage} classId={classId} /> : mode === 'flash' ? <><Flashcards words={classWords} /><Pagination pagination={classPagination} loading={classWordsLoading} onPageChange={setClassPage} label="từ" /></> : <StudentVocabulary words={classWords} query={query} setQuery={setQuery} pagination={classPagination} loading={classWordsLoading} setPage={setClassPage} tab={studentViewTab} setTab={setStudentViewTab} />}
  </>;
}

const VOCAB_LOADING_LINES = [
  'Đang tải danh mục từ vựng từ giáo trình... 📚',
  'Đang xử lý dữ liệu bài học...',
  'Đang đồng bộ từ vựng tiếng Hàn... 🇰🇷',
  'Đang chuẩn bị học liệu, vui lòng đợi trong giây lát...'
];

function VocabularyLoader({ compact = false, hint = 'Đang đồng bộ dữ liệu học liệu...' }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setLine((current) => (current + 1) % VOCAB_LOADING_LINES.length), 950);
    return () => window.clearInterval(timer);
  }, []);
  return <div className={`vocab-funny-loader ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
    <div className="vocab-loader-bubbles" aria-hidden="true"><span>한</span><span>국</span><span>어</span></div>
    <strong>{VOCAB_LOADING_LINES[line]}</strong>
    <small>{hint}</small>
  </div>;
}

function TeacherCatalog({ lessons, lessonsLoading, catalogLoading, classWordsLoading, selectingAll, lessonId, setLessonId, activeLesson, activeClass, catalog, catalogPagination, setCatalogPage, selected, setSelected, imported, toggle, selectAll, importWords, classWords, classPagination, setClassPage, classId }) {
  const assignedGrammar = useMemo(() => {
    const map = new Map();
    (classWords || []).forEach((w) => {
      if (Array.isArray(w.grammar)) {
        w.grammar.forEach((g) => {
          if (!map.has(g)) map.set(g, { name: g, lessonId: w.lessonId, lessonTitle: w.lessonTitle });
        });
      }
    });
    return Array.from(map.values());
  }, [classWords]);

  return <div className="two-col vocab-teacher-grid">
    <section className="panel catalog-panel">
      {!classId && <div className="notice warning">Chọn lớp nhận học liệu ở phía trên trước khi giao.</div>}
      <div className="catalog-controls"><label>Chọn bài trong sách<select value={lessonId} disabled={lessonsLoading || !lessons.length} onChange={(e) => setLessonId(e.target.value)}>{lessonsLoading && <option>Đang tải danh sách bài...</option>}{!lessonsLoading && !lessons.length && <option>Chưa có bài học</option>}{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>Bài {lesson.lessonNumber || lesson.id} · {lesson.title} — {lesson.topic}</option>)}</select></label><div className="catalog-bulk-actions"><button className="btn secondary small" disabled={catalogLoading || selectingAll || !activeLesson} onClick={selectAll}><Check size={15} /> {selectingAll ? 'Đang gom hết từ... 😤' : `Chọn tất cả ${activeLesson?.vocabularyCount || ''} từ`}</button><button className="btn ghost small" disabled={!selected.size} onClick={() => setSelected(new Set())}>Bỏ chọn</button></div></div>
      {activeLesson && <div className="lesson-info">
        <span>BÀI {activeLesson.lessonNumber || activeLesson.id} · {activeLesson.vocabularyCount} TỪ VỰNG</span>
        <h3>{activeLesson.title} · {activeLesson.topic}</h3>
        {activeLesson.grammar && activeLesson.grammar.length > 0 && <div className="lesson-grammar-box-preview">
          <div className="grammar-head-label"><Sparkles size={14} /> <strong>Ngữ pháp trọng tâm bài học:</strong></div>
          <div className="grammar-chips">{activeLesson.grammar.map((grammar) => <b key={grammar} className="grammar-chip"><BookOpen size={13} /> {grammar}</b>)}</div>
        </div>}
      </div>}
      <div className="catalog-list">{catalogLoading ? <VocabularyLoader hint="Đang mở kho từ vựng của bài này..." /> : catalog.length ? catalog.map((word) => { const isImported = imported.has(Number(word.id)); return <label className={`catalog-word ${isImported ? 'imported' : ''}`} key={word.id}><input type="checkbox" disabled={isImported} checked={isImported || selected.has(Number(word.id))} onChange={() => toggle(Number(word.id))} /><span className="fake-check">{isImported ? <Check size={14} /> : null}</span><div className="catalog-korean"><strong>{word.korean}</strong>{word.romanization && <small>{word.romanization}</small>}</div><p>{word.meaningVi}</p>{isImported && <em>Đã có</em>}</label>; }) : <Empty>Chưa có từ vựng cho bài này.</Empty>}</div>
      <Pagination pagination={catalogPagination} loading={catalogLoading} onPageChange={setCatalogPage} label="từ trong bài" />
      <div className="catalog-action"><span>Đã chọn <strong>{selected.size}</strong> mục{activeClass ? <> · giao cho <strong>{activeClass.name}</strong></> : ''}</span><button className="btn primary" disabled={!classId || !selected.size} onClick={importWords}><Layers3 size={17} /> {activeClass ? `Giao Từ vựng & Ngữ pháp vào ${activeClass.name}` : 'Chọn lớp trước'}</button></div>
    </section>
    <section className="panel class-vocab-panel">
      <div className="panel-title"><div><span>{activeClass ? `TRONG LỚP · ${activeClass.name}` : 'CHƯA CHỌN LỚP'}</span><h3>{classPagination?.total || 0} từ & {assignedGrammar.length} cấu trúc ngữ pháp</h3></div></div>
      {assignedGrammar.length > 0 && <div className="class-grammar-summary">
        <div className="class-grammar-title"><Sparkles size={15} /> <strong>Ngữ pháp đã giao ({assignedGrammar.length})</strong></div>
        <div className="grammar-chips-list">{assignedGrammar.map((g) => <span key={g.name} className="grammar-badge"><BookOpen size={12} /> <strong>{g.name}</strong> <small>(Bài {g.lessonId})</small></span>)}</div>
      </div>}
      {classWordsLoading ? <VocabularyLoader compact hint="Đang kiểm tra học liệu đã giao cho lớp..." /> : classWords.length ? <div className="mini-vocab-list">{classWords.map((word) => <div key={word.id}><strong>{word.korean}</strong><span>{word.meaningVi}</span><small>Bài {word.lessonId}</small></div>)}</div> : <Empty>{activeClass ? 'Chưa có bài nào. Chọn bài học bên trái rồi giao cho lớp.' : 'Chọn lớp ở phía trên để xem và giao học liệu.'}</Empty>}<Pagination pagination={classPagination} loading={classWordsLoading} onPageChange={setClassPage} label="từ đã giao" />
    </section>
  </div>;
}

function StudentVocabulary({ words, query, setQuery, pagination, loading, setPage, tab, setTab }) {
  const grouped = useMemo(() => words.reduce((map, word) => {
    const key = `Bài ${word.lessonId} · ${word.lessonTitle || ''}`;
    if (!map[key]) map[key] = { lessonId: word.lessonId, title: word.lessonTitle, topic: word.topic, grammar: word.grammar || [], words: [] };
    map[key].words.push(word);
    return map;
  }, {}), [words]);

  const speak = (text) => {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
      const audio = new Audio(url);
      audio.playbackRate = 0.85;
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => fallbackSpeak(cleanText));
      }
    } catch {
      fallbackSpeak(cleanText);
    }
  };

  const fallbackSpeak = (cleanText) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.82;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('ko'));
    const bestVoice = voices.find((v) => v.name.includes('Google') || v.name.includes('한국')) ||
      voices.find((v) => v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Sun-Hi') || v.name.includes('InJoon')) ||
      voices[0];
    if (bestVoice) utterance.voice = bestVoice;
    window.speechSynthesis.speak(utterance);
  };
  return <section className="panel">
    <div className="student-vocab-head">
      <div className="vocab-search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm từ vựng hoặc nghĩa tiếng Hàn..." /></div>
      <div className="segmented compact">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Tất cả</button>
        <button className={tab === 'vocab' ? 'active' : ''} onClick={() => setTab('vocab')}>Từ vựng</button>
        <button className={tab === 'grammar' ? 'active' : ''} onClick={() => setTab('grammar')}>Ngữ pháp</button>
      </div>
    </div>
    {loading ? <VocabularyLoader hint="Đang kéo từ vựng và ngữ pháp của lớp về..." /> : words.length ? Object.entries(grouped).map(([lessonKey, group]) => {
      const showGrammar = (tab === 'all' || tab === 'grammar') && group.grammar && group.grammar.length > 0;
      const showWords = (tab === 'all' || tab === 'vocab') && group.words.length > 0;
      if (!showGrammar && !showWords) return null;
      return <div className="vocab-group" key={lessonKey}>
        <div className="vocab-group-head"><h3>{lessonKey} {group.topic ? `(${group.topic})` : ''}</h3><span>{group.words.length} từ vựng · {group.grammar.length} ngữ pháp</span></div>
        {showGrammar && <div className="student-grammar-block">
          <div className="student-grammar-title"><Sparkles size={15} /> <strong>Ngữ pháp trọng tâm:</strong></div>
          <div className="student-grammar-cards">{group.grammar.map((g) => <div className="student-grammar-card" key={g}><BookOpen size={16} /> <div><strong>{g}</strong><p>Cấu trúc ngữ pháp trọng tâm - {group.title || lessonKey}</p></div></div>)}</div>
        </div>}
        {showWords && <div className="word-grid">{group.words.map((word) => <article className="word-card" key={word.id}><button className="speak-btn" onClick={() => speak(word.korean)} title="Nghe đọc"><Volume2 size={17} /></button><strong>{word.korean}</strong><em>{word.romanization}</em><p>{word.meaningVi}</p>{word.exampleKr && <small>{word.exampleKr}</small>}</article>)}</div>}
      </div>;
    }) : <Empty>Giáo viên chưa giao học liệu cho lớp này.</Empty>}
    <Pagination pagination={pagination} loading={loading} onPageChange={setPage} label="từ" />
  </section>;
}

function Flashcards({ words }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setIndex(0); setFlipped(false); }, [words.length]);
  if (!words.length) return <section className="panel"><Empty>Chưa có từ để ôn flashcard.</Empty></section>;
  const word = words[index % words.length];
  const next = (delta) => { setIndex((current) => (current + delta + words.length) % words.length); setFlipped(false); setMessage(''); };
  const record = async (correct) => {
    try { await api(`/practice/vocabulary/${word.id}/record`, { method: 'POST', body: JSON.stringify({ correct }), toast: false }); setMessage(correct ? 'Đã nhớ ✓' : 'Đã đưa vào phần cần ôn'); setTimeout(() => next(1), 350); }
    catch (err) { setMessage(err.message); }
  };
  return <section className="flash-study"><div className="flash-progress"><span>Flashcard {index + 1}/{words.length}</span><div><i style={{ width: `${((index + 1) / words.length) * 100}%` }} /></div></div><button className={`flash-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((value) => !value)}><span className="flash-label">{flipped ? 'NGHĨA & VÍ DỤ' : `BÀI ${word.lessonId}`}</span>{flipped ? <><h2>{word.meaningVi}</h2><p>{word.exampleKr}</p><small>{word.exampleVi}</small></> : <><strong>{word.korean}</strong><em>{word.romanization}</em><p>Chạm để lật thẻ</p></>}</button>{message && <div className="flash-message">{message}</div>}<div className="flash-actions"><button className="icon-button big" onClick={() => next(-1)}><ChevronLeft /></button><button className="btn weak" onClick={() => record(false)}>Cần ôn lại</button><button className="btn success" onClick={() => record(true)}>Đã nhớ</button><button className="icon-button big" onClick={() => next(1)}><ChevronRight /></button></div></section>;
}

