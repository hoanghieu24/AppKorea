import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from './db.js';

export const TEXTBOOK_SOURCE = 'Tiếng Hàn Tổng Hợp Dành Cho Người Việt Nam – Sơ cấp 1';

const textbook = JSON.parse(
  await readFile(fileURLToPath(new URL('../data/textbook-socap1.json', import.meta.url)), 'utf8'),
);

let ensurePromise;

function lessonDto(lesson) {
  return {
    id: lesson.id,
    lessonNumber: lesson.id,
    title: lesson.title,
    topic: lesson.topic,
    grammar: lesson.grammar || [],
    sourceName: TEXTBOOK_SOURCE,
    vocabularyCount: lesson.vocab?.length || 0,
  };
}

export function getTextbookLessons() {
  return textbook.map(lessonDto);
}

export function getTextbookLesson(lessonId) {
  return textbook.find((lesson) => Number(lesson.id) === Number(lessonId)) || null;
}

export async function seedTextbookCatalog() {
  await withTransaction(async (connection) => {
    for (const lesson of textbook) {
      await connection.execute(
        `INSERT INTO textbook_lessons (id, title, topic, grammar, source_name) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), topic = VALUES(topic), grammar = VALUES(grammar), source_name = VALUES(source_name)`,
        [lesson.id, lesson.title, lesson.topic, JSON.stringify(lesson.grammar || []), TEXTBOOK_SOURCE],
      );

      for (const word of lesson.vocab || []) {
        await connection.execute(
          `INSERT INTO vocabulary (lesson_id, korean, romanization, meaning_vi, example_kr, example_vi)
           VALUES (?, ?, ?, ?, NULL, NULL)
           ON DUPLICATE KEY UPDATE romanization = VALUES(romanization), meaning_vi = VALUES(meaning_vi)`,
          [lesson.id, word.kr, word.rom || null, word.vn],
        );
      }
    }
  });
}

export async function ensureTextbookCatalog() {
  if (!ensurePromise) {
    ensurePromise = seedTextbookCatalog().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

export async function getTextbookVocabulary(lessonId) {
  const lesson = getTextbookLesson(lessonId);
  if (!lesson) return null;

  await ensureTextbookCatalog();
  const rows = await query(
    `SELECT id, lesson_id lessonId, korean, romanization, meaning_vi meaningVi,
     part_of_speech partOfSpeech, example_kr exampleKr, example_vi exampleVi
     FROM vocabulary WHERE lesson_id = ? ORDER BY id`,
    [lesson.id],
  );

  // Chỉ trả các mục thuộc catalog hiện tại. Nhờ vậy dữ liệu của giáo trình cũ
  // vẫn được giữ trong DB nhưng không bị trộn vào dropdown của sách Sơ cấp 1.
  const rowsByKorean = new Map(rows.map((row) => [row.korean, row]));
  return (lesson.vocab || []).map((word) => rowsByKorean.get(word.kr)).filter(Boolean);
}

export const textbookStats = Object.freeze({
  lessonCount: textbook.length,
  vocabularyCount: textbook.reduce((total, lesson) => total + (lesson.vocab?.length || 0), 0),
});
