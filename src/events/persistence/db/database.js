const Constants = require('../constants/Constants');

let knexOptions = {
  client: 'mysql',
  version: '5.7',
  connection: {
    host: Constants.DATABASE.DATABASE_HOST,
    port: Constants.DATABASE.DATABASE_PORT,
    user: Constants.DATABASE.DATABASE_USER,
    password: Constants.DATABASE.DATABASE_PASSWORD,
    database: Constants.DATABASE.DATABASE_SCHEMA,
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
  },
  pool: {
    min: 0,
    max: 10,
  },
  asyncStackTraces: true
};

const defaultKnex = require('knex')(knexOptions);

exports.setKnex = (knexOptions) => {
  exports.knex = require('knex')(knexOptions);
};

exports.knex = defaultKnex;
