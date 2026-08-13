const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Bài học (VD: "Bài 1", "Bài 2"...). ownerId = null nghĩa là bài học mặc định dùng chung.
const Lesson = sequelize.define('Lesson', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  orderIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'order_index',
  },
  ownerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'owner_id',
  },
  classId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'class_id',
  },
}, {
  tableName: 'lessons',
});

module.exports = Lesson;
