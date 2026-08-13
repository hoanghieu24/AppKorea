const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Bài làm của học sinh cho 1 assignment, kèm kết quả chấm của AI và/hoặc giáo viên.
// answers: { [questionId]: "câu trả lời" }
// aiResult: { grade, scorePct, feedback, results: [{questionNum,status,correctAnswer,explanation}] }
const Submission = sequelize.define('Submission', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  assignmentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'assignment_id',
  },
  studentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'student_id',
  },
  answers: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
  },
  status: {
    type: DataTypes.ENUM('pending', 'submitted', 'graded'),
    allowNull: false,
    defaultValue: 'pending',
  },
  aiResult: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'ai_result',
  },
  teacherScore: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'teacher_score',
  },
  teacherFeedback: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'teacher_feedback',
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'submitted_at',
  },
  gradedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'graded_at',
  },
}, {
  tableName: 'submissions',
  indexes: [
    { unique: true, fields: ['assignment_id', 'student_id'] },
  ],
});

module.exports = Submission;
