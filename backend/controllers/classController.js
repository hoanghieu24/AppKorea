const { Class, ClassMember, User } = require('../models');
const { generateJoinCode } = require('../utils/generateCode');

// POST /api/classes  (teacher)
async function createClass(req, res) {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: 'Vui lòng nhập tên lớp.' });

    let joinCode;
    // đảm bảo mã không trùng
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateJoinCode();
      const exists = await Class.findOne({ where: { joinCode: candidate } });
      if (!exists) { joinCode = candidate; break; }
    }
    if (!joinCode) return res.status(500).json({ message: 'Không tạo được mã lớp, thử lại.' });

    const cls = await Class.create({
      teacherId: req.user.id,
      name,
      description: description || null,
      joinCode,
    });

    res.status(201).json({ class: cls });
  } catch (err) {
    console.error('createClass error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tạo lớp.' });
  }
}

// GET /api/classes  (teacher: lớp mình dạy | student: lớp mình tham gia)
async function listClasses(req, res) {
  try {
    if (req.user.role === 'teacher') {
      const classes = await Class.findAll({
        where: { teacherId: req.user.id },
        include: [{ model: User, as: 'students', attributes: ['id', 'name', 'email'], through: { attributes: [] } }],
        order: [['createdAt', 'DESC']],
      });
      return res.json({ classes });
    }

    // student
    const classes = await Class.findAll({
      include: [
        { model: User, as: 'students', attributes: ['id'], through: { attributes: [] }, where: { id: req.user.id } },
        { model: User, as: 'teacher', attributes: ['id', 'name', 'email'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json({ classes });
  } catch (err) {
    console.error('listClasses error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải danh sách lớp.' });
  }
}

// GET /api/classes/:id  (chi tiết 1 lớp + roster)
async function getClass(req, res) {
  try {
    const cls = await Class.findByPk(req.params.id, {
      include: [
        { model: User, as: 'students', attributes: ['id', 'name', 'email'], through: { attributes: [] } },
        { model: User, as: 'teacher', attributes: ['id', 'name', 'email'] },
      ],
    });
    if (!cls) return res.status(404).json({ message: 'Không tìm thấy lớp.' });

    const isTeacherOwner = req.user.role === 'teacher' && cls.teacherId === req.user.id;
    const isMember = req.user.role === 'student' && cls.students.some((s) => s.id === req.user.id);
    if (!isTeacherOwner && !isMember) {
      return res.status(403).json({ message: 'Bạn không có quyền xem lớp này.' });
    }

    res.json({ class: cls });
  } catch (err) {
    console.error('getClass error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

// POST /api/classes/join  (student)  body: { joinCode }
async function joinClass(req, res) {
  try {
    const { joinCode } = req.body;
    if (!joinCode) return res.status(400).json({ message: 'Vui lòng nhập mã lớp.' });

    const cls = await Class.findOne({ where: { joinCode: joinCode.toUpperCase().trim() } });
    if (!cls) return res.status(404).json({ message: 'Mã lớp không đúng hoặc không tồn tại.' });

    const existing = await ClassMember.findOne({ where: { classId: cls.id, studentId: req.user.id } });
    if (existing) return res.status(409).json({ message: 'Bạn đã tham gia lớp này rồi.' });

    await ClassMember.create({ classId: cls.id, studentId: req.user.id });
    res.status(201).json({ message: `Đã tham gia lớp "${cls.name}"`, class: cls });
  } catch (err) {
    console.error('joinClass error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tham gia lớp.' });
  }
}

// DELETE /api/classes/:id/students/:studentId  (teacher xoá học sinh khỏi lớp)
async function removeStudent(req, res) {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) return res.status(404).json({ message: 'Không tìm thấy lớp.' });
    if (cls.teacherId !== req.user.id) return res.status(403).json({ message: 'Không có quyền.' });

    await ClassMember.destroy({ where: { classId: cls.id, studentId: req.params.studentId } });
    res.json({ message: 'Đã xoá học sinh khỏi lớp.' });
  } catch (err) {
    console.error('removeStudent error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

module.exports = { createClass, listClasses, getClass, joinClass, removeStudent };
