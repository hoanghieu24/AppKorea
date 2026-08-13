const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DictionarySavedWord = sequelize.define('DictionarySavedWord', {
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
  korean: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
}, {
  tableName: 'dictionary_saved_words',
  updatedAt: false,
  indexes: [{ unique: true, fields: ['user_id', 'korean'] }],
});

module.exports = DictionarySavedWord;
