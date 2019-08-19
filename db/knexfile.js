
const envResult = require('dotenv').config();
const path = require('path');

const CLIENT = 'mysql';
const HOST = process.env.DATABASE_HOST || 'localhost';
const PORT = process.env.DATABASE_PORT || 3306;
const USER = process.env.DATABASE_USER || 'fxp';
const PASSWORD = process.env.DATABASE_PASSWORD || 'fxp';
const DATABASE = process.env.DATABASE_SCHEMA || 'fxp';

const knexDev = {
  client: CLIENT,
  connection: {
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DATABASE
  },
  pool: {
    min: 2,
    max: 10
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: path.join(__dirname, '/migrations')
  },
  seeds: {
    directory: path.join(__dirname, '/seeds')
  }
};

module.exports = {
  development: knexDev,
  DATABASE: DATABASE
};
