const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Bài tập giáo viên giao cho học sinh / cả lớp.
// questions lưu dạng JSON: [{ id, prompt, hint }]
const Assignment = sequelize.define('Assignment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  teacherId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'teacher_id',
  },
  classId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'class_id',
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  source: {
    type: DataTypes.ENUM('vocab', 'grammar', 'topik', 'manual'),
    allowNull: false,
    defaultValue: 'manual',
  },
  difficulty: {
    type: DataTypes.ENUM('easy', 'medium', 'hard'),
    allowNull: false,
    defaultValue: 'medium',
  },
  questions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
  },
  lessonId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'lesson_id',
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'due_date',
  },
}, {
  tableName: 'assignments',
});

module.exports = Assignment;
