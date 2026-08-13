const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Word = sequelize.define('Word', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  korean: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  roman: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  meaning: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  pos: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: '명사',
  },
  tip: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  example: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  exampleViet: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'example_viet',
  },
  lessonId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'lesson_id',
  },
  ownerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'owner_id',
  },
}, {
  tableName: 'words',
});

module.exports = Word;
