const Constants = require('../constants/Constants');
const path = require('path');


// FIXME: externalize as variables
const DB_RETRIES = 10;
const DB_CONNECTION_RETRY_WAIT_MILLISECONDS = 5000;


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
    migrations: {
        tableName: 'knex_migrations',
        directory: path.join(__dirname, '/migrations')
    },  
    asyncStackTraces: true
};

const defaultKnex = require('knex')(knexOptions);

exports.setKnex = (knexOptions) => {
    exports.knex = require('knex')(knexOptions);
};

const doKnexMigrations = async () => {
    console.log('Migrating');
    await exports.knex.migrate.latest();
    console.log('Migration done');
};

exports.knex = defaultKnex;

// design your application to attempt to re-establish a connection to the database after a failure
// https://docs.docker.com/compose/startup-order/
let dbRetries = 1;
exports.runKnexMigration = async () => {

    try {
        await doKnexMigrations();
        console.log(`success connected to DB... retry: ${dbRetries}`);      
    } catch (e) {
        console.log(`attempting retry: ${dbRetries}`);
        dbRetries++;
        if (dbRetries === DB_RETRIES) {
            console.error('could not get connection to DB after retries', e);
            process.exit(1);
        } else {
            setTimeout(exports.runKnexMigration, DB_CONNECTION_RETRY_WAIT_MILLISECONDS);
        }
    }
};

