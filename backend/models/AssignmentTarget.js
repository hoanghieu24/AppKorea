const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Ai được giao bài này (mở rộng từ class hoặc gán riêng từng học sinh)
const AssignmentTarget = sequelize.define('AssignmentTarget', {
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
}, {
  tableName: 'assignment_targets',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['assignment_id', 'student_id'] },
  ],
});

module.exports = AssignmentTarget;
