import { hashPassword } from '../src/auth.js';
import { query, withTransaction } from '../src/db.js';
import { seedTextbookCatalog, textbookStats } from '../src/textbook.js';

async function upsertUser(email, fullName, role, password) {
  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role), active = 1`,
    [email, passwordHash, fullName, role],
  );
  const rows = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0].id;
}

console.log(`Đang nạp ${textbookStats.lessonCount} bài học và ${textbookStats.vocabularyCount} mục từ vựng...`);
await seedTextbookCatalog();

console.log('Đang tạo dữ liệu demo...');
const adminId = await upsertUser('admin@hanquoc.local', 'Admin HanQuoc', 'ADMIN', 'Admin@123');
const teacherId = await upsertUser('teacher@hanquoc.local', 'Cô Hana', 'TEACHER', 'Teacher@123');
const studentId = await upsertUser('student@hanquoc.local', 'Nguyễn Minh Anh', 'STUDENT', 'Student@123');
const student2Id = await upsertUser('student2@hanquoc.local', 'Trần Gia Huy', 'STUDENT', 'Student@123');

await query(
  `INSERT INTO classes (name, code, description, created_by) VALUES ('Sơ cấp 1 - K01', 'K01', 'Lớp demo để test đủ luồng', ?)
   ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
  [adminId],
);
const classes = await query("SELECT id FROM classes WHERE code = 'K01' LIMIT 1");
const classId = classes[0].id;
await query('INSERT IGNORE INTO class_teachers (class_id, teacher_id) VALUES (?, ?)', [classId, teacherId]);
await query('INSERT IGNORE INTO class_students (class_id, student_id) VALUES (?, ?), (?, ?)', [classId, studentId, classId, student2Id]);

await query(
  `INSERT IGNORE INTO class_vocabulary (class_id, vocabulary_id, added_by)
   SELECT ?, v.id, ? FROM vocabulary v WHERE v.lesson_id IN (1, 2)`,
  [classId, teacherId],
);

const existing = await query("SELECT id FROM assignments WHERE class_id = ? AND title = 'Ôn tập Bài 1' LIMIT 1", [classId]);
if (!existing[0]) {
  await withTransaction(async (connection) => {
    const [assignment] = await connection.execute(
      `INSERT INTO assignments (class_id, teacher_id, type, title, instructions, status, due_at, published_at)
       VALUES (?, ?, 'HOMEWORK', 'Ôn tập Bài 1', 'Làm 3 câu ngắn. Hệ thống chấm ngay sau khi nộp.', 'PUBLISHED', DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())`,
      [classId, teacherId],
    );
    const questions = [
      ['MULTIPLE_CHOICE', '학생 nghĩa là gì?', ['Giáo viên', 'Học sinh / Sinh viên', 'Bác sĩ', 'Bạn bè'], 'Học sinh / Sinh viên', 'Từ vựng · Bài 1', 1],
      ['SHORT_TEXT', 'Viết từ tiếng Hàn có nghĩa “giáo viên”.', null, '선생님', 'Từ vựng · Bài 1', 1],
      ['ESSAY', 'Viết một câu ngắn để giới thiệu: “Tôi là học sinh.”', null, '저는 학생이에요.||저는 학생입니다.', 'Ngữ pháp · N이에요/예요', 2],
    ];
    for (let index = 0; index < questions.length; index += 1) {
      const [type, prompt, options, correct, topic, points] = questions[index];
      await connection.execute(
        `INSERT INTO questions (assignment_id, type, prompt, options, correct_answer, topic, points, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [assignment.insertId, type, prompt, options ? JSON.stringify(options) : null, correct, topic, points, index + 1],
      );
    }
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       SELECT student_id, 'NEW_ASSIGNMENT', 'Bài tập mới', 'Ôn tập Bài 1', 'ASSIGNMENT', ? FROM class_students WHERE class_id = ?`,
      [assignment.insertId, classId],
    );
  });
}

console.log('Seed hoàn tất.');
console.log('Demo: admin@hanquoc.local / Admin@123');
console.log('Demo: teacher@hanquoc.local / Teacher@123');
console.log('Demo: student@hanquoc.local / Student@123');
