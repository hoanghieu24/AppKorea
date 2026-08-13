const { Sequelize } = require('sequelize');
require('dotenv').config();

const useSSL = process.env.DB_SSL === 'true';

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,

    dialect: 'mysql',
    logging: false,

    dialectOptions: useSSL
      ? {
          ssl: {
            rejectUnauthorized: false
          }
        }
      : {},

    define: {
      freezeTableName: true,
      timestamps: true,
      underscored: true,
    },

    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

module.exports = sequelize;
