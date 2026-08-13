const { Submission, Assignment, AssignmentTarget } = require('../models');
const { callGeminiJSON } = require('../utils/geminiService');
const { addXP, touchStreak } = require('../utils/statsHelper');

// Chấm bài bằng AI, tái sử dụng đúng format JSON như bản gốc (grade, scorePct, feedback, results[])
async function gradeWithAI(questions, answers) {
  const qaPair = questions.map((q, i) => ({
    questionNum: i + 1,
    prompt: q.prompt,
    userAnswer: answers[q.id] ?? answers[i] ?? '(Chưa làm)',
  }));

  const prompt = `Bạn là giáo viên tiếng Hàn chuyên nghiệp đang chấm Bài Tập Về Nhà (BTVN) cho học sinh Việt Nam.
Danh sách các câu hỏi và bài làm của học sinh:
${JSON.stringify(qaPair, null, 2)}

Yêu cầu chấm điểm:
1. Đánh giá từng câu: "correct" (Đúng), "imperfect" (Đúng ý nhưng sai nhỏ/chưa tự nhiên), hoặc "wrong" (Sai).
2. Cung cấp đáp án chuẩn ("correctAnswer") bằng tiếng Hàn hoặc tiếng Việt.
3. Giải thích chi tiết ("explanation") tại sao đúng/sai, phân tích lỗi ngữ pháp, từ vựng hoặc tiểu từ.
4. Cho tổng điểm tổng quát (VD "8.5 / 10") và nhận xét chung ("feedback") khích lệ người học.

Trả lời CHÍNH XÁC định dạng JSON (không thêm văn bản ngoài JSON):
{
  "grade": "8.5 / 10",
  "scorePct": 85,
  "feedback": "Nhận xét tổng quan...",
  "results": [
    {"questionNum": 1, "status": "correct", "correctAnswer": "...", "explanation": "..."}
  ]
}`;

  return callGeminiJSON(prompt, { temperature: 0.3, maxOutputTokens: 3000 });
}

// POST /api/assignments/:id/submit  (student)  body: { answers: {questionId: answer} }
async function submitAssignment(req, res) {
  try {
    const assignment = await Assignment.findByPk(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Không tìm thấy bài tập.' });

    const target = await AssignmentTarget.findOne({ where: { assignmentId: assignment.id, studentId: req.user.id } });
    if (!target) return res.status(403).json({ message: 'Bài tập này không được giao cho bạn.' });

    const { answers } = req.body;
    if (!answers || !Object.keys(answers).length) {
      return res.status(400).json({ message: 'Vui lòng trả lời ít nhất 1 câu trước khi nộp bài.' });
    }

    let submission = await Submission.findOne({ where: { assignmentId: assignment.id, studentId: req.user.id } });
    if (!submission) {
      submission = await Submission.create({ assignmentId: assignment.id, studentId: req.user.id, answers: {} });
    }
    if (submission.status === 'graded') {
      return res.status(409).json({ message: 'Bài này đã được chấm, không thể nộp lại.' });
    }

    submission.answers = answers;
    submission.status = 'submitted';
    submission.submittedAt = new Date();
    await submission.save();

    // Chấm điểm tự động bằng AI (giống hành vi bản gốc)
    try {
      const aiResult = await gradeWithAI(assignment.questions, answers);
      submission.aiResult = aiResult;
      submission.status = 'graded';
      submission.gradedAt = new Date();
      await submission.save();

      await addXP(req.user.id, 25);
      await touchStreak(req.user.id);
    } catch (aiErr) {
      console.error('AI grading failed (submission saved, ungraded):', aiErr.message);
      // Bài vẫn được lưu ở trạng thái "submitted" — giáo viên có thể chấm tay hoặc thử lại AI sau.
    }

    res.json({ submission });
  } catch (err) {
    console.error('submitAssignment error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi nộp bài.' });
  }
}

// POST /api/submissions/:id/regrade  (teacher, chấm lại bằng AI nếu lần đầu lỗi)
async function regradeWithAI(req, res) {
  try {
    const submission = await Submission.findByPk(req.params.id, { include: [{ model: Assignment }] });
    if (!submission) return res.status(404).json({ message: 'Không tìm thấy bài nộp.' });
    if (submission.Assignment.teacherId !== req.user.id) return res.status(403).json({ message: 'Không có quyền.' });

    const aiResult = await gradeWithAI(submission.Assignment.questions, submission.answers);
    submission.aiResult = aiResult;
    submission.status = 'graded';
    submission.gradedAt = new Date();
    await submission.save();
    res.json({ submission });
  } catch (err) {
    console.error('regradeWithAI error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi chấm lại: ' + err.message });
  }
}

// PUT /api/submissions/:id/grade  (teacher override)  body: { teacherScore, teacherFeedback }
async function teacherGrade(req, res) {
  try {
    const submission = await Submission.findByPk(req.params.id, { include: [{ model: Assignment }] });
    if (!submission) return res.status(404).json({ message: 'Không tìm thấy bài nộp.' });
    if (submission.Assignment.teacherId !== req.user.id) return res.status(403).json({ message: 'Không có quyền.' });

    const wasAlreadyGraded = submission.status === 'graded';
    const { teacherScore, teacherFeedback } = req.body;
    submission.teacherScore = teacherScore ?? submission.teacherScore;
    submission.teacherFeedback = teacherFeedback ?? submission.teacherFeedback;
    submission.status = 'graded';
    if (!submission.gradedAt) submission.gradedAt = new Date();
    await submission.save();

    // Chỉ cộng XP lần đầu bài được chấm xong (tránh cộng trùng khi giáo viên sửa điểm nhiều lần)
    if (!wasAlreadyGraded) {
      await addXP(submission.studentId, 25);
      await touchStreak(submission.studentId);
    }

    res.json({ submission });
  } catch (err) {
    console.error('teacherGrade error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

module.exports = { submitAssignment, regradeWithAI, teacherGrade };
