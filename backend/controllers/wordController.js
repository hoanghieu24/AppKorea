const { Word, Lesson, UserWordProgress } = require('../models');

// GET /api/words?lessonId=&q=  — kho từ vựng dùng chung
async function listWords(req, res) {
  try {
    const where = {};
    if (req.query.lessonId) where.lessonId = req.query.lessonId;

    const words = await Word.findAll({
      where,
      include: [{ model: Lesson, as: 'lesson', attributes: ['id', 'name'] }],
      order: [['id', 'ASC']],
    });

    // Gộp tiến độ học của user hiện tại (known / seenCount) cho từng từ
    const progressRows = await UserWordProgress.findAll({ where: { userId: req.user.id } });
    const progressMap = {};
    progressRows.forEach((p) => { progressMap[p.wordId] = p; });

    const result = words.map((w) => {
      const p = progressMap[w.id];
      return {
        ...w.toJSON(),
        progress: p ? { known: p.known, seenCount: p.seenCount, srsLevel: p.srsLevel } : null,
      };
    });

    res.json({ words: result });
  } catch (err) {
    console.error('listWords error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải từ vựng.' });
  }
}

// POST /api/words
async function createWord(req, res) {
  try {
    const { korean, roman, meaning, pos, tip, example, exampleViet, lessonId } = req.body;
    if (!korean || !meaning) {
      return res.status(400).json({ message: 'Vui lòng nhập từ tiếng Hàn và nghĩa tiếng Việt.' });
    }
    const word = await Word.create({
      korean, roman, meaning, pos, tip, example, exampleViet,
      lessonId: lessonId || null,
      ownerId: req.user.id,
    });
    res.status(201).json({ word });
  } catch (err) {
    console.error('createWord error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi thêm từ.' });
  }
}

// DELETE /api/words/:id
async function deleteWord(req, res) {
  try {
    const word = await Word.findByPk(req.params.id);
    if (!word) return res.status(404).json({ message: 'Không tìm thấy từ.' });
    if (word.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Bạn chỉ có thể xoá từ do mình thêm.' });
    }
    await word.destroy();
    res.json({ message: 'Đã xoá từ.' });
  } catch (err) {
    console.error('deleteWord error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

// PUT /api/words/:id/progress   body: { known, incrementSeen }
async function updateProgress(req, res) {
  try {
    const word = await Word.findByPk(req.params.id);
    if (!word) return res.status(404).json({ message: 'Không tìm thấy từ.' });

    const [progress] = await UserWordProgress.findOrCreate({
      where: { userId: req.user.id, wordId: word.id },
      defaults: { userId: req.user.id, wordId: word.id },
    });

    if (typeof req.body.known === 'boolean') progress.known = req.body.known;
    if (req.body.incrementSeen) progress.seenCount += 1;
    progress.lastReviewedAt = new Date();
    await progress.save();

    res.json({ progress });
  } catch (err) {
    console.error('updateProgress error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật tiến độ.' });
  }
}

module.exports = { listWords, createWord, deleteWord, updateProgress };
