const { Grammar } = require('../models');

// GET /api/grammar
async function listGrammar(req, res) {
  try {
    const grammar = await Grammar.findAll({ order: [['id', 'ASC']] });
    res.json({ grammar });
  } catch (err) {
    console.error('listGrammar error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải ngữ pháp.' });
  }
}

// POST /api/grammar
async function createGrammar(req, res) {
  try {
    const { title, body, lessonId } = req.body;
    if (!title) return res.status(400).json({ message: 'Vui lòng nhập tiêu đề ngữ pháp.' });

    const grammar = await Grammar.create({
      title, body, lessonId: lessonId || null, ownerId: req.user.id,
    });
    res.status(201).json({ grammar });
  } catch (err) {
    console.error('createGrammar error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi thêm ngữ pháp.' });
  }
}

// DELETE /api/grammar/:id
async function deleteGrammar(req, res) {
  try {
    const grammar = await Grammar.findByPk(req.params.id);
    if (!grammar) return res.status(404).json({ message: 'Không tìm thấy.' });
    if (grammar.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Bạn chỉ có thể xoá nội dung do mình thêm.' });
    }
    await grammar.destroy();
    res.json({ message: 'Đã xoá.' });
  } catch (err) {
    console.error('deleteGrammar error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

module.exports = { listGrammar, createGrammar, deleteGrammar };
