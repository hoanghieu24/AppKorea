const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ClassMember = sequelize.define('ClassMember', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  classId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'class_id',
  },
  studentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'student_id',
  },
}, {
  tableName: 'class_members',
  indexes: [
    { unique: true, fields: ['class_id', 'student_id'] },
  ],
});

module.exports = ClassMember;
