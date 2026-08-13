const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const UserStats = sequelize.define('UserStats', {
  userId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    field: 'user_id',
  },
  xp: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  streak: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  lastActiveDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'last_active_date',
  },
  totalAnswered: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_answered',
  },
  totalCorrect: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_correct',
  },
  quizzesCompleted: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'quizzes_completed',
  },
  aiMessages: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'ai_messages',
  },
}, {
  tableName: 'user_stats',
  timestamps: false,
});

module.exports = UserStats;
