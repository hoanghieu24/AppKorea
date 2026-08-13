const {
  Assignment, AssignmentTarget, Submission, ClassMember, User, Word, Lesson,
} = require('../models');
const { callGeminiJSON } = require('../utils/geminiService');

const SOURCE_LABEL = { vocab: 'Từ vựng đã học', grammar: 'Cấu trúc ngữ pháp', topik: 'Đề thi TOPIK', manual: 'Tự soạn' };
const DIFF_LABEL = { easy: 'dễ, chỉ dùng từ cơ bản', medium: 'trung bình', hard: 'khó, nâng cao' };

// Sinh câu hỏi bằng AI, tái sử dụng cùng 1 prompt/format JSON như bản gốc
async function generateQuestionsWithAI({ source, difficulty, count, lessonId }) {
  const where = lessonId ? { lessonId } : {};
  const words = await Word.findAll({ where, limit: 15, order: [['id', 'DESC']] });
  const vocabHint = words.map((w) => `${w.korean}(${w.meaning})`).join(', ');

  const prompt = `Bạn là giáo viên tiếng Hàn chuẩn bị Bài Tập Về Nhà (BTVN) cho học viên Việt Nam.
Nguồn đề bài: ${SOURCE_LABEL[source] || 'Từ vựng đã học'}
Mức độ: ${DIFF_LABEL[difficulty] || 'trung bình'}
Từ vựng tham khảo: ${vocabHint || 'tiếng Hàn cơ bản'}

Yêu cầu: Tạo đúng ${count} câu bài tập thực hành (dịch câu Việt -> Hàn, dịch Hàn -> Việt, điền đuôi câu/tiểu từ).
Cho mỗi câu hỏi, tạo gợi ý ngắn (hint).

Trả lời CHÍNH XÁC định dạng JSON, không thêm văn bản khác:
{
  "title": "Tên bài tập ngắn gọn",
  "questions": [
    {"id": 1, "prompt": "Câu hỏi / Đề bài", "hint": "Gợi ý"}
  ]
}`;

  const data = await callGeminiJSON(prompt, { temperature: 0.7, maxOutputTokens: 2500 });
  return {
    title: data.title || 'Bài Tập Về Nhà AI',
    questions: (data.questions || []).map((q, i) => ({ id: q.id ?? i + 1, prompt: q.prompt, hint: q.hint || '' })),
  };
}

// POST /api/assignments  (teacher)
async function createAssignment(req, res) {
  try {
    const {
      title, description, classId, studentIds, source, difficulty,
      count, useAI, questions: manualQuestions, lessonId, dueDate,
    } = req.body;

    if (!classId && (!studentIds || !studentIds.length)) {
      return res.status(400).json({ message: 'Vui lòng chọn lớp hoặc học sinh để giao bài.' });
    }

    let finalTitle = title;
    let finalQuestions = manualQuestions;

    if (useAI) {
      const generated = await generateQuestionsWithAI({
        source: source || 'vocab',
        difficulty: difficulty || 'medium',
        count: parseInt(count, 10) || 8,
        lessonId: lessonId || null,
      });
      finalTitle = title || generated.title;
      finalQuestions = generated.questions;
    }

    if (!finalTitle || !finalQuestions || !finalQuestions.length) {
      return res.status(400).json({ message: 'Bài tập cần có tiêu đề và ít nhất 1 câu hỏi.' });
    }

    const assignment = await Assignment.create({
      teacherId: req.user.id,
      classId: classId || null,
      title: finalTitle,
      description: description || null,
      source: source || 'manual',
      difficulty: difficulty || 'medium',
      questions: finalQuestions,
      lessonId: lessonId || null,
      dueDate: dueDate || null,
    });

    // Gộp danh sách học sinh được giao: từ lớp + từ danh sách chọn riêng
    const targetIds = new Set((studentIds || []).map(Number));
    if (classId) {
      const members = await ClassMember.findAll({ where: { classId } });
      members.forEach((m) => targetIds.add(m.studentId));
    }
    if (!targetIds.size) {
      return res.status(400).json({ message: 'Không có học sinh nào để giao bài (lớp trống?).' });
    }

    const targetRows = [...targetIds].map((studentId) => ({ assignmentId: assignment.id, studentId }));
    await AssignmentTarget.bulkCreate(targetRows);
    await Submission.bulkCreate(
      [...targetIds].map((studentId) => ({ assignmentId: assignment.id, studentId, status: 'pending', answers: {} }))
    );

    res.status(201).json({ assignment, assignedCount: targetIds.size });
  } catch (err) {
    console.error('createAssignment error:', err);
    if (err.code === 'NO_API_KEY') return res.status(503).json({ message: err.message });
    res.status(500).json({ message: 'Lỗi máy chủ khi tạo bài tập: ' + err.message });
  }
}

// GET /api/assignments  (teacher: bài mình giao | student: bài được giao)
async function listAssignments(req, res) {
  try {
    if (req.user.role === 'teacher') {
      const assignments = await Assignment.findAll({
        where: { teacherId: req.user.id },
        include: [
          { model: Submission, as: 'submissions', attributes: ['id', 'status', 'studentId'] },
        ],
        order: [['createdAt', 'DESC']],
      });
      const withCounts = assignments.map((a) => {
        const subs = a.submissions || [];
        return {
          ...a.toJSON(),
          stats: {
            total: subs.length,
            submitted: subs.filter((s) => s.status !== 'pending').length,
            graded: subs.filter((s) => s.status === 'graded').length,
          },
        };
      });
      return res.json({ assignments: withCounts });
    }

    // student: những assignment có 1 target là mình
    const targets = await AssignmentTarget.findAll({
      where: { studentId: req.user.id },
      include: [{ model: Assignment, include: [{ model: User, as: 'teacher', attributes: ['id', 'name'] }] }],
      order: [['id', 'DESC']],
    });
    const submissions = await Submission.findAll({ where: { studentId: req.user.id } });
    const subByAssignment = {};
    submissions.forEach((s) => { subByAssignment[s.assignmentId] = s; });

    const assignments = targets.map((t) => ({
      ...t.Assignment.toJSON(),
      mySubmission: subByAssignment[t.Assignment.id] || null,
    }));
    res.json({ assignments });
  } catch (err) {
    console.error('listAssignments error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải danh sách bài tập.' });
  }
}

// GET /api/assignments/:id
async function getAssignment(req, res) {
  try {
    const assignment = await Assignment.findByPk(req.params.id, {
      include: [{ model: User, as: 'teacher', attributes: ['id', 'name'] }],
    });
    if (!assignment) return res.status(404).json({ message: 'Không tìm thấy bài tập.' });

    if (req.user.role === 'teacher') {
      if (assignment.teacherId !== req.user.id) return res.status(403).json({ message: 'Không có quyền xem bài này.' });
      const submissions = await Submission.findAll({
        where: { assignmentId: assignment.id },
        include: [{ model: User, as: 'student', attributes: ['id', 'name', 'email'] }],
      });
      return res.json({ assignment, submissions });
    }

    // student
    const target = await AssignmentTarget.findOne({ where: { assignmentId: assignment.id, studentId: req.user.id } });
    if (!target) return res.status(403).json({ message: 'Bài tập này không được giao cho bạn.' });
    const mySubmission = await Submission.findOne({ where: { assignmentId: assignment.id, studentId: req.user.id } });
    res.json({ assignment, mySubmission });
  } catch (err) {
    console.error('getAssignment error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

// DELETE /api/assignments/:id  (teacher)
async function deleteAssignment(req, res) {
  try {
    const assignment = await Assignment.findByPk(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Không tìm thấy bài tập.' });
    if (assignment.teacherId !== req.user.id) return res.status(403).json({ message: 'Không có quyền.' });
    await assignment.destroy();
    res.json({ message: 'Đã xoá bài tập.' });
  } catch (err) {
    console.error('deleteAssignment error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

module.exports = { createAssignment, listAssignments, getAssignment, deleteAssignment };
