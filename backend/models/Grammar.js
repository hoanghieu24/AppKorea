const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Grammar = sequelize.define('Grammar', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  title: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: true,
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
  tableName: 'grammar_points',
});

module.exports = Grammar;
