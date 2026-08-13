const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Notebook = sequelize.define('Notebook', {
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
  tabName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'tab_name',
  },
  content: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
  },
  orderIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'order_index',
  },
}, {
  tableName: 'notebooks',
});

module.exports = Notebook;
