const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Theo dõi tiến độ học từng từ vựng của từng user (thay cho localStorage cũ)
const UserWordProgress = sequelize.define('UserWordProgress', {
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
  wordId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'word_id',
  },
  seenCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'seen_count',
  },
  known: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  srsLevel: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'srs_level',
  },
  lastReviewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_reviewed_at',
  },
}, {
  tableName: 'user_word_progress',
  indexes: [
    { unique: true, fields: ['user_id', 'word_id'] },
  ],
});

module.exports = UserWordProgress;
