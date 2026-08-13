const { Lesson } = require('../models');

// GET /api/lessons — kho bài học dùng chung (giống DEFAULT_WORDS/lessons gốc, cộng bài user/giáo viên tự thêm)
async function listLessons(req, res) {
  try {
    const lessons = await Lesson.findAll({ order: [['orderIndex', 'ASC'], ['id', 'ASC']] });
    res.json({ lessons });
  } catch (err) {
    console.error('listLessons error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải bài học.' });
  }
}

// POST /api/lessons
async function createLesson(req, res) {
  try {
    const { name, orderIndex } = req.body;
    if (!name) return res.status(400).json({ message: 'Vui lòng nhập tên bài học.' });

    const count = await Lesson.count();
    const lesson = await Lesson.create({
      name,
      orderIndex: orderIndex ?? count,
      ownerId: req.user.id,
    });
    res.status(201).json({ lesson });
  } catch (err) {
    console.error('createLesson error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tạo bài học.' });
  }
}

// DELETE /api/lessons/:id
async function deleteLesson(req, res) {
  try {
    const lesson = await Lesson.findByPk(req.params.id);
    if (!lesson) return res.status(404).json({ message: 'Không tìm thấy bài học.' });
    if (lesson.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Bạn chỉ có thể xoá bài học do mình tạo.' });
    }
    await lesson.destroy();
    res.json({ message: 'Đã xoá bài học.' });
  } catch (err) {
    console.error('deleteLesson error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

module.exports = { listLessons, createLesson, deleteLesson };
