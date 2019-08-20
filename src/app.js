/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - james.bush@modusbox.com                             *
 **************************************************************************/

'use strict';
require('dotenv').config();

const Koa = require('koa');
const koaBody = require('koa-body');
const util = require('util');
const coBody = require('co-body');
const https = require('https');
const http = require('http');
const yaml = require('yamljs');

const randomPhrase = require('@internal/randomphrase');
const Validate = require('@internal/validate');


const router = require('@internal/router');
const { setConfig, getConfig } = require('./config.js');
const { Logger, Transports } = require('@internal/log');

const Cache = require('@internal/cache');

const Jws = require('@modusbox/mojaloop-sdk-standard-components').Jws;
const Errors = require('@modusbox/mojaloop-sdk-standard-components').Errors;

/**
 * Returns a new logger to be used for the outbound flow
 */
async function createOutboundLogger() {
    const space = Number(process.env.LOG_INDENT);
    const outboundTransports = await Promise.all([Transports.consoleDir()]);
    const outboundLogger = new Logger({ context: { app: 'mojaloop-sdk-outbound-api' }, space, transports: outboundTransports });
    return outboundLogger;
}

/**
 * Returns a new logger to be used for the inbound flow
 */
async function createInboundLogger() {
    const space = Number(process.env.LOG_INDENT);
    const inboundTransports = await Promise.all([Transports.consoleDir()]);
    const inboundLogger = new Logger({ context: { app: 'mojaloop-sdk-inbound-api' }, space, transports: inboundTransports });
    return inboundLogger;
}

/**
 * Loads config from process.env, parses it and returns a conf object
 */
async function loadConf() {
    await setConfig(process.env);
    const conf = getConfig();
    console.log(`Config loaded: ${util.inspect(conf, { depth: 10 })}`);
    return conf;
}

/**
 * A middleware that logs raw to console as a last resort
 * @param {Object} ctx Koa ctx
 * @param {function} next Koa next function
 */
async function failSafe(ctx, next) {
    try {
        await next();
    } catch (err) {
        // TODO: return a 500 here if the response has not already been sent?
        console.log(`Error caught in catchall: ${err.stack || util.inspect(err, { depth: 10 })}`);
    }
}

/**
 * Creates a Koa API implementing the Outbound API
 * 
 * @param {Object} conf Config object. See config.js
 * @param {Log} outboundLogger Logger
 * @param {Map(string->{string:function(ctx)})} outboundHandlersMap maps path -> method to Koa handler function
 */
async function createOutboundApi(conf, outboundLogger, outboundHandlersMap) {
    const space = Number(process.env.LOG_INDENT);
    const outboundCacheTransports = await Promise.all([Transports.consoleDir()]);
    const outboundCacheLogger = new Logger({ context: { app: 'mojaloop-sdk-outboundCache' }, space, transports: outboundCacheTransports });
    const outboundCacheConfig = {
        ...conf.cacheConfig,
        logger: outboundCacheLogger
    };
    const outboundCache = new Cache(outboundCacheConfig);
    await outboundCache.connect();
    const outboundApi = new Koa();
    const outboundApiSpec = yaml.load('./outboundApi/api.yaml');
    outboundApi.use(failSafe);
    // outbound always expects application/json
    outboundApi.use(koaBody());
    outboundApi.use(async (ctx, next) => {
        ctx.state.cache = outboundCache;
        ctx.state.conf = conf;
        ctx.state.logger = outboundLogger.push({
        request: {
            id: randomPhrase(),
            path: ctx.path,
            method: ctx.method
        }
        });
        ctx.state.logger.log('Request received');
        try {
            await next();
        }
        catch (err) {
            ctx.state.logger.push(err).log('Error');
        }
        ctx.state.logger.log('Request processed');
    });
    // Add validation for each outbound request
    const outboundValidator = new Validate();
    await outboundValidator.initialise(outboundApiSpec);
    outboundApi.use(async (ctx, next) => {
        ctx.state.logger.log('Validating request');
        try {
            ctx.state.path = outboundValidator.validateRequest(ctx, ctx.state.logger);
            ctx.state.logger.log('Request passed validation');
            await next();
        }
        catch (err) {
            ctx.state.logger.push({ err }).log('Request failed validation.');
            ctx.response.status = 400;
            ctx.response.body = {
                message: err.message,
                statusCode: 400
            };
        }
    });
    outboundApi.use(router(outboundHandlersMap));
    return outboundApi;
}

/**
 * Returns a list of middlewares to be used in a Koa API implementing the Inbound API ( Mojaloop API )
 * 
 * @param {Object} conf Config object. See config.js
 * @param {Log} outboundLogger Logger
 * @param {Map(string->{string:function(ctx)})} inboundHandlersMap maps path -> method to Koa handler function
 * @returns {Array} list of KOA middlewares
 */
async function createInboundApiMiddlewares(conf, inboundLogger, inboundHandlersMap) {

    let middlewares = [];

    const space = Number(process.env.LOG_INDENT);

    // A middleware that logs raw to console as a last resort
    middlewares.push(failSafe);

    // tag each incoming request with a unique identifier
    middlewares.push(async (ctx, next) => {
        ctx.request.id = randomPhrase();
        await next();
    });

    // Deal with mojaloop API content type headers...
    // treat as JSON
    middlewares.push(async (ctx, next) => {
        const validHeaders = new Set([
            'application/vnd.interoperability.parties+json;version=1.0',
            'application/vnd.interoperability.participants+json;version=1.0',
            'application/vnd.interoperability.quotes+json;version=1.0',
            'application/vnd.interoperability.transfers+json;version=1.0',
            'application/json'
        ]);
        if (validHeaders.has(ctx.request.headers['content-type'])) {
            try {
                ctx.request.body = await coBody.json(ctx.req);
            }
            catch (err) {
                // error parsing body
                inboundLogger.push({ err }).log('Error parsing body');
                ctx.response.status = 400;
                ctx.response.body = new Errors.MojaloopFSPIOPError(err, err.message, null, Errors.MojaloopApiErrorCodes.MALFORMED_SYNTAX).toApiErrorObject();
                return;
            }
        }
        await next();
    });

    // JWS validation for incoming requests
    const jwsValidator = new Jws.validator({
        logger: inboundLogger,
        validationKeys: conf.jwsVerificationKeys
    });
    middlewares.push(async (ctx, next) => {
        if (conf.validateInboundJws) {
            try {
                if (ctx.request.method !== 'GET') {
                    jwsValidator.validate(ctx.request, inboundLogger);
                }
            }
            catch (err) {
                inboundLogger.push({ err }).log('Inbound request failed JWS validation');
                ctx.response.status = 400;
                ctx.response.body = new Errors.MojaloopFSPIOPError(err, err.message, null, Errors.MojaloopApiErrorCodes.INVALID_SIGNATURE).toApiErrorObject();
                return;
            }
        }
        await next();
    });

    // Add a cache, conf and log context for each request, log the receipt and handling thereof
    const inboundCacheTransports = await Promise.all([Transports.consoleDir()]);
    const inboundCacheLogger = new Logger({ context: { app: 'mojaloop-sdk-inboundCache' }, space, transports: inboundCacheTransports });
    const inboundCacheConfig = {
        ...conf.cacheConfig,
        logger: inboundCacheLogger
    };
    const inboundCache = new Cache(inboundCacheConfig);
    await inboundCache.connect();

    middlewares.push(async (ctx, next) => {
        ctx.state.cache = inboundCache;
        ctx.state.conf = conf;
        ctx.state.logger = inboundLogger.push({
        request: {
            id: ctx.request.id,
            path: ctx.path,
            method: ctx.method
        }
        });
        ctx.state.logger.push({ body: ctx.request.body }).log('Request received');
        try {
            await next();
        }
        catch (err) {
            ctx.state.logger.push(err).log('Error');
        }
        ctx.state.logger.log('Request processed');
    });

    // Add validation for each inbound request
    const inboundValidator = new Validate();
    const inboundApiSpec = yaml.load('./inboundApi/api.yaml');
    await inboundValidator.initialise(inboundApiSpec);
    middlewares.push(async (ctx, next) => {
        ctx.state.logger.log('Validating request');
        try {
            ctx.state.path = inboundValidator.validateRequest(ctx, ctx.state.logger);
            ctx.state.logger.log('Request passed validation');
            await next();
        }
        catch (err) {
            ctx.state.logger.push({ err }).log('Request failed validation.');
            // send a mojaloop spec error response
            ctx.response.status = err.httpStatusCode || 400;
            if (err instanceof Errors.MojaloopFSPIOPError) {
                // this is a specific mojaloop spec error
                ctx.response.body = err.toApiErrorObject();
                return;
            }
            //generic mojaloop spec validation error
            ctx.response.body = {
                errorInformation: {
                    errorCode: '3100',
                    errorDescription: `${err.dataPath ? err.dataPath + ' ' : ''}${err.message}`
                }
            };
        }
    });

    // Handle requests
    middlewares.push(router(inboundHandlersMap));

    middlewares.push(async (ctx, next) => {
        // Override Koa's default behaviour of returning the status code as text in the body. If we
        // haven't defined the body, we want it empty. Note that if setting this to null, Koa appears
        // to override the status code with a 204. This is correct behaviour in the sense that the
        // status code correctly corresponds to the content (none) but unfortunately the Mojaloop API
        // does not respect this convention and requires a 200.
        if (ctx.response.body === undefined) {
            ctx.response.body = '';
        }
        return await next();
    });
    return middlewares;
}

/**
 * Creates a server for the inbound API and a server for the outbound API, using the parameters specified in the conf object ( ports etc )
 * 
 * @param {Object} conf Config. See ./config.js
 * @param {Koa} inboundApi Inbound Koa API
 * @param {Log} inboundLogger logger to be used in the inbound flow
 * @param {Koa} outboundApi Outbound Koa API
 * @param {Log} outboundLogger logger to be used in the outbound flow
 */
function createApiServers(conf, inboundApi, inboundLogger, outboundApi, outboundLogger) {
    let inboundServer;
    let outboundServer;
    // If config specifies TLS, start an HTTPS server; otherwise HTTP
    const inboundPort = conf.inboundPort;
    const outboundPort = conf.outboundPort;

    if (conf.tls.mutualTLS.enabled) {
        const inboundHttpsOpts = {
            ...conf.tls.inboundCreds,
            requestCert: true,
            rejectUnauthorized: true // no effect if requestCert is not true
        };
        inboundServer = https.createServer(inboundHttpsOpts, inboundApi.callback()).listen(inboundPort);
    }
    else {
        inboundServer = http.createServer(inboundApi.callback()).listen(inboundPort);
    }
    inboundLogger.log(`Serving inbound API on port ${inboundPort}`);
    outboundServer = http.createServer(outboundApi.callback()).listen(outboundPort);
    outboundLogger.log(`Serving outbound API on port ${outboundPort}`);
    // handle SIGTERM to exit gracefully
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received. Shutting down APIs...');
        await Promise.all([(() => {
            return new Promise(resolve => {
                inboundServer.close(() => {
                    console.log('inbound SIGTERM shut down complete');
                    return resolve();
                });
            });
        })(), (() => {
            return new Promise(resolve => {
                outboundServer.close(() => {
                    console.log('outbound SIGTERM shut down compete');
                    return resolve();
                });
            });
        })()]);
        process.exit(0);
    });
}

module.exports = {
    createOutboundLogger,
    createInboundLogger,
    loadConf,
    createOutboundApi,
    createInboundApiMiddlewares,
    createApiServers
}
