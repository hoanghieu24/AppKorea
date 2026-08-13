const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ExamHistory = sequelize.define('ExamHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
  },
  examType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'exam_type',
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'exam_history',
  updatedAt: false,
});

module.exports = ExamHistory;
