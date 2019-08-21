module.exports = {
    DATABASE: {
        DATABASE_HOST: process.env.DATABASE_HOST || 'localhost',
        DATABASE_PORT: process.env.DATABASE_PORT || 3306,
        DATABASE_USER: process.env.DATABASE_USER || 'fxp',
        DATABASE_PASSWORD: process.env.DATABASE_PASSWORD || 'fxp',
        DATABASE_SCHEMA: process.env.DATABASE_SCHEMA || 'fxp',
        RUN_MIGRATIONS: process.env.RUN_MIGRATIONS || false
    },
};
