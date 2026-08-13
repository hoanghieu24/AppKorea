const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PdfUpload = sequelize.define('PdfUpload', {
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
  filename: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  filePath: {
    type: DataTypes.STRING(500),
    allowNull: false,
    field: 'file_path',
  },
}, {
  tableName: 'pdf_uploads',
  updatedAt: false,
});

module.exports = PdfUpload;
