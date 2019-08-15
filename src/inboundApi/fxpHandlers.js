/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - james.bush@modusbox.com                             *
 *       Ramiro González Maciel - ramiro@modusbox.com                     *
 **************************************************************************/

'use strict';

const util = require('util');
const FxpInboundModel = require('@internal/model').fxpInboundModel;
const FxpBackendRequests = require('@internal/fxpRequests').FxpBackendRequests;

// Default factories
let fxpInboundModelFactory = (options) => new FxpInboundModel(options);
let fxpBackendRequestsFactory = (options) => new FxpBackendRequests(options);

// Factory setters
const setFxpInboundModelFactory = (f) => fxpInboundModelFactory = f;
const setFxpBackendRequestsFactory = (f) => fxpBackendRequestsFactory = f;
/**
 * Handles a GET /participants/{idType}/{idValue} request 
 */
const getParticipantsByTypeAndId = async (ctx) => {
    ctx.response.status = 501;
    ctx.response.body = '';
};


/**
 * Handles a GET /parties/{idType}/{idValue} request
 */
const getPartiesByTypeAndId = async (ctx) => {
    ctx.response.status = 501;
    ctx.response.body = '';
};


/**
 * Handles a POST /parties/{idType}/{idValue} request 
 */
const postPartiesByTypeAndId = (ctx) => {
    // creation of parties not supported by SDK
    ctx.response.status = 501;
    ctx.response.body = '';
};


/**
 * Handles a POST /quotes request
 */
const postQuotes = async (ctx) => {
    if (!ctx.fxpQuote) {
        ctx.response.status = 400;
        ctx.response.body = 'Can not handle non FXP quotes'; // FIXME Is this the correct format for the response?
        return;
    }

    // kick off an asyncronous operation to handle the request
    (async () => {
        try {
            // use the transfers model to execute asynchronous stages with the switch
            const model = fxpInboundModelFactory({
                cache: ctx.state.cache,
                logger: ctx.state.logger,
                ...ctx.state.conf
            });

            // use the model to handle the request
            const response = await model.fxQuoteRequest(ctx.request.headers, ctx.request.body);
            ctx.state.logger.log(`Inbound transfers model handled FX POST /quotes request and returned: ${util.inspect(response)}`);
            // log the result
            ctx.state.logger.push({ response }).log('Inbound transfers model handled POST /quotes request');
        }
        catch(err) {
            // nothing we can do if an error gets thrown back to us here apart from log it and continue
            ctx.state.logger.log(`Error handling POST /quotes: ${err.stack || util.inspect(err)}`);
            ctx.state.logger.push({ err }).log('Error handling POST /quotes');
        }
    })();

    // Note that we will have passed request validation, JWS etc... by this point
    // so it is safe to return 202
    ctx.response.status = 202;
    ctx.response.body = '';
};


/**
 * Handles a POST /transfers request
 */
const postTransfers = async (ctx) => {
    // kick off an asyncronous operation to handle the request
    (async () => {
        try {
            // use the transfers model to execute asynchronous stages with the switch
            const model = fxpInboundModelFactory({
                cache: ctx.state.cache,
                logger: ctx.state.logger,
                ...ctx.state.conf
            });

            const sourceFspId = ctx.request.headers['fspiop-source'];
            const destinationFspId = ctx.request.headers['fspiop-destination'];

            // use the model to handle the request
            const response = await model.prepareTransfer(ctx.request.body, sourceFspId, destinationFspId);

            // log the result
            ctx.state.logger.log(`Inbound transfers model handled POST /transfers request and returned: ${util.inspect(response)}`);
            ctx.state.logger.push({ response }).log('Inbound transfers model handled POST /transfers request');
        }
        catch(err) {
            // nothing we can do if an error gets thrown back to us here apart from log it and continue
            ctx.state.logger.log(`Error handling POST /transfers: ${err.stack || util.inspect(err)}`);
            ctx.state.logger.push({ err }).log('Error handling POST /transfers');
        }
    })();

    // Note that we will have passed request validation, JWS etc... by this point
    // so it is safe to return 202
    ctx.response.status = 202;
    ctx.response.body = '';
};


/**
 * Handles a PUT /participants/{idType}/{idValue} request
 */
const putParticipantsByTypeAndId = async (ctx) => {
    // SDK does not make participants requests so we should not expect any calls to this method
    ctx.response.status = 501;
    ctx.response.body = '';
};


/**
 * Handles a PUT /parties/{idType}/{IdValue}. This is a response to a GET /parties
 * request.
 */
const putPartiesByTypeAndId = async (ctx) => {
    ctx.response.status = 501;
    ctx.response.body = '';
};


/**
 * Handles a PUT /quotes/{ID}. This is a response to a POST /quotes request
 */
const putQuoteById = async (ctx) => {

    // If forwarding (usually while the SDK is working as a passthrough or Hub emulator while testing an integration)
    if (ctx.state.conf.forwardPutQuotesToBackend) {
        ctx.state.logger.log(`putQuoteById: forwardPutQuotesToBackend is true. Forwarding ${util.inspect(ctx.state.path.params.ID)}`);

        let fxpBackendRequests = fxpBackendRequestsFactory({
            logger: ctx.state.logger,
            backendEndpoint: ctx.state.conf.backendEndpoint,
            dfspId: ctx.state.conf.dfspId
        });
        
        let response = await fxpBackendRequests.postFxpQuoteResponse(ctx.state.path.params.ID, ctx.request.body.quoteResponse ? ctx.request.body.quoteResponse : ctx.request.body , 
            { ...ctx.request.headers, ...ctx.request.body.metadata });
        ctx.state.logger.log('Sent PUT /quotes to backend and got back: ', response);

    } else {
        // publish an event onto the cache for subscribers to action
        await ctx.state.cache.publish(`${ctx.state.path.params.ID}`, {
            type: 'quoteResponse',
            data: ctx.request.body,
            headers: ctx.request.headers
        });
    }

    ctx.response.status = 200;
};


/**
 * Handles a PUT /transfers/{ID}. This is a response to a POST /transfers request 
 */
const putTransfersById = async (ctx) => {
    // If forwarding (usually while the SDK is working as a passthrough or Hub emulator)
    if (ctx.state.conf.forwardPutTransfersToBackend) {
        let fxpBackendRequests = fxpBackendRequestsFactory({
            logger: ctx.state.logger,
            backendEndpoint: ctx.state.conf.backendEndpoint,
            dfspId: ctx.state.conf.dfspId
        });
        
        // FIXME validate implementation
        let response = await fxpBackendRequests.postFxpTransferResponse(ctx.state.path.params.ID, ctx.request.body, ctx.request.headers['fspiop-source'], ctx.request.headers['fspiop-destination']);
        console.log('Sent PUT /transfers to backend and got back: ', response);

    } else {
        // publish an event onto the cache for subscribers to action
        await ctx.state.cache.publish(`${ctx.state.path.params.ID}`, {
            type: 'transferFulfil',
            data: ctx.request.body,
            headers: ctx.request.headers
        });
    }

    ctx.response.status = 200;    
};


/**
 * Handles a PUT /parties/{Type}/{ID}/error request. This is an error response to a GET /parties/{Type}/{ID} request
 */
const putPartiesByTypeAndIdError = async(ctx) => {
    ctx.response.status = 501;
    ctx.response.body = '';
};


/**
 * Handles a PUT /quotes/{ID}/error request. This is an error response to a POST /quotes request 
 */
const putQuotesByIdError = async(ctx) => {
    // publish an event onto the cache for subscribers to action
    await ctx.state.cache.publish(`${ctx.state.path.params.ID}`, {
        type: 'quoteResponseError',
        data: ctx.request.body
    });

    ctx.response.status = 200;
    ctx.response.body = '';
};


/**
 * Handles a PUT /transfers/{ID}/error. This is an error response to a POST /transfers request 
 */
const putTransfersByIdError = async (ctx) => {
    // publish an event onto the cache for subscribers to action
    await ctx.state.cache.publish(`${ctx.state.path.params.ID}`, {
        type: 'transferError',
        data: ctx.request.body
    });

    ctx.response.status = 200;
    ctx.response.body = '';
};


const healthCheck = async(ctx) => {
    ctx.response.status = 200;
    ctx.response.body = '';
};


const map = {
    '/': {
        get: healthCheck
    },
    '/participants/{Type}/{ID}': {
        put: putParticipantsByTypeAndId,
        get: getParticipantsByTypeAndId
    },
    '/parties/{Type}/{ID}': {
        post: postPartiesByTypeAndId,
        get: getPartiesByTypeAndId,
        put: putPartiesByTypeAndId
    },
    '/parties/{Type}/{ID}/error': {
        put: putPartiesByTypeAndIdError
    },
    '/quotes': {
        post: postQuotes
    },
    '/quotes/{ID}': {
        put: putQuoteById
    },
    '/quotes/{ID}/error': {
        put: putQuotesByIdError
    },
    '/transfers': {
        post: postTransfers
    },
    '/transfers/{ID}': {
        put: putTransfersById
    },
    '/transfers/{ID}/error': {
        put: putTransfersByIdError
    }
};


module.exports = {
    map,
    setFxpInboundModelFactory,
    setFxpBackendRequestsFactory
};
