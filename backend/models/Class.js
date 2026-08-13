const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Một "lớp học" do giáo viên tạo. Học sinh tham gia bằng join_code.
const Class = sequelize.define('Class', {
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
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  joinCode: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: true,
    field: 'join_code',
  },
}, {
  tableName: 'classes',
});

module.exports = Class;
