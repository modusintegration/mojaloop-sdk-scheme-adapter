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


const util = require('util');
const BackendRequests = require('@internal/requests').BackendRequests;
const HTTPResponseError = require('@internal/requests').HTTPResponseError;
const MojaloopRequests = require('@modusintegration/mojaloop-sdk-standard-components').MojaloopRequests;
const Ilp = require('@modusintegration/mojaloop-sdk-standard-components').Ilp;
const Errors = require('@modusintegration/mojaloop-sdk-standard-components').Errors;
const shared = require('@internal/shared');

const ASYNC_TIMEOUT_MILLS = 30000;


/**
 *  Models the operations required for performing inbound transfers
 */
class InboundTransfersModel {
    constructor(config) {
        this.cache = config.cache;
        this.logger = config.logger;
        this.ASYNC_TIMEOUT_MILLS = config.asyncTimeoutMillis || ASYNC_TIMEOUT_MILLS;
        this.dfspId = config.dfspId;
        this.expirySeconds = config.expirySeconds;

        this.mojaloopRequests = new MojaloopRequests({
            logger: this.logger,
            peerEndpoint: config.peerEndpoint,
            dfspId: config.dfspId,
            tls: config.tls,
            jwsSign: config.jwsSign,
            jwsSigningKey: config.jwsSigningKey
        });

        this.backendRequests = new BackendRequests({
            logger: this.logger,
            backendEndpoint: config.backendEndpoint,
            dfspId: config.dfspId
        });

        this.checkIlp = config.checkIlp;

        this.ilp = new Ilp({
            secret: config.ilpSecret
        });
    }


    /**
     * Queries the backend API for the specified party and makes a callback to the originator with our dfspId if found
     */
    async getParticipantsByTypeAndId(idType, idValue, sourceFspId) {
        try {
            // make a call to the backend to resolve the party lookup
            const response = await this.backendRequests.getParties(idType, idValue);

            if(!response) {
                // make an error callback to the source fsp
                return `Party not found in backend. Making error callback to ${sourceFspId}`;
            }

            // make a callback to the source fsp with our dfspId indicating we own the party
            return this.mojaloopRequests.putParticipants(idType, idValue, { fspId: this.dfspId },
                sourceFspId);
        }
        catch(err) {
            this.logger.log(`Error in getParticipantsByTypeAndId: ${err.stack || util.inspect(err)}`);
            const mojaloopError = await this._handleError(err);
            this.logger.log(`Sending error response to ${sourceFspId}: ${util.inspect(mojaloopError)}`);
            return await this.mojaloopRequests.putParticipantsError(idType, idValue,
                mojaloopError, sourceFspId);
        }
    }


    /**
     * Queries the backend API for the specified party and makes a callback to the originator with the result
     */
    async getParties(idType, idValue, sourceFspId) {
        try {
            // make a call to the backend to resolve the party lookup
            const response = await this.backendRequests.getParties(idType, idValue);

            if(!response) {
                // make an error callback to the source fsp
                this.logger.log(`Party not found in backend. Making error callback to ${sourceFspId}`);
                const err = new Errors.MojaloopFSPIOPError(null, null, sourceFspId, Errors.MojaloopApiErrorCodes.ID_NOT_FOUND);
                return await this.mojaloopRequests.putPartiesError(idType, idValue,
                    err.toApiErrorObject(), sourceFspId);
            }

            // project our internal party representation into a mojaloop partyies request body
            const mlParty = {
                party: shared.internalPartyToMojaloopParty(response, this.dfspId)
            };

            // make a callback to the source fsp with the party info
            return this.mojaloopRequests.putParties(idType, idValue, mlParty, sourceFspId);
        }
        catch(err) {
            this.logger.log(`Error in getParties: ${err.stack || util.inspect(err)}`);
            const mojaloopError = await this._handleError(err);
            this.logger.log(`Sending error response to ${sourceFspId}: ${util.inspect(mojaloopError)}`);
            return await this.mojaloopRequests.putPartiesError(idType, idValue,
                mojaloopError, sourceFspId);
        }
    }


    /**
     * Asks the backend for a response to an incoming quote request and makes a callback to the originator with
     * the result
     */
    async quoteRequest(quoteRequest, sourceFspId) {
        try {
            const internalForm = shared.mojaloopQuoteRequestToInternal(quoteRequest);

            // make a call to the backend to ask for a quote response
            const response = await this.backendRequests.postQuoteRequests(internalForm);

            if(!response) {
                // make an error callback to the source fsp
                return `No quote response from backend. Making error callback to ${sourceFspId}`;
            }

            if(!response.expiration) {
                const expiration = new Date().getTime() + (this.expirySeconds * 1000);
                response.expiration = new Date(expiration).toISOString();
            }

            // project our internal quote reponse into mojaloop quote response form
            const mojaloopResponse = shared.internalQuoteResponseToMojaloop(response);

            // create our ILP packet and condition and tag them on to our internal quote response 
            const { fulfilment, ilpPacket, condition } = this.ilp.getQuoteResponseIlp(quoteRequest, mojaloopResponse);

            mojaloopResponse.ilpPacket = ilpPacket;
            mojaloopResponse.condition = condition; 

            // now store the fulfilment and the quote data against the quoteId in our cache
            await this.cache.set(`quote_${quoteRequest.transactionId}`, {
                request: quoteRequest,
                internalRequest: internalForm,
                response: response,
                mojaloopResponse: mojaloopResponse,
                fulfilment: fulfilment
            });

            // make a callback to the source fsp with the quote response
            return this.mojaloopRequests.putQuotes(mojaloopResponse, sourceFspId);
        }
        catch(err) {
            this.logger.log(`Error in quoteRequest: ${err.stack || util.inspect(err)}`);
            const mojaloopError = await this._handleError(err);
            this.logger.log(`Sending error response to ${sourceFspId}: ${util.inspect(mojaloopError)}`);
            return await this.mojaloopRequests.putQuotesError(quoteRequest.quoteId,
                mojaloopError, sourceFspId);
        }
    }


    /**
     * Validates  an incoming transfer prepare request and makes a callback to the originator with
     * the result
     */
    async prepareTransfer(prepareRequest, sourceFspId) {
        try {
            // retrieve our quote data
            const quote = await this.cache.get(`quote_${prepareRequest.transferId}`);

            // check incoming ILP matches our persisted values
            if(this.checkIlp && (prepareRequest.condition !== quote.mojaloopResponse.condition)) {
                throw new Error(`ILP condition in transfer prepare for ${prepareRequest.transferId} does not match quote`);
            } 

            // project the incoming transfer prepare into an internal transfer request
            const internalForm = shared.mojaloopPrepareToInternalTransfer(prepareRequest, quote);

            // make a call to the backend to inform it of the incoming transfer
            const response = await this.backendRequests.postTransfers(internalForm);

            if(!response) {
                // make an error callback to the source fsp
                return `No transfer response from backend. Making error callback to ${sourceFspId}`;
            }

            this.logger.log(`Transfer accepted by backend returning homeTransactionId: ${response.homeTransactionId} for mojaloop transferId: ${prepareRequest.transferId}`);

            // create a  mojaloop transfer fulfil response
            const mojaloopResponse = {
                completedTimestamp: new Date(),
                transferState: 'COMMITTED',
                fulfilment: quote.fulfilment
            };

            // make a callback to the source fsp with the transfer fulfilment
            return this.mojaloopRequests.putTransfers(prepareRequest.transferId, mojaloopResponse,
                sourceFspId);
        }
        catch(err) {
            this.logger.log(`Error in prepareTransfer: ${err.stack || util.inspect(err)}`);
            const mojaloopError = await this._handleError(err);
            this.logger.log(`Sending error response to ${sourceFspId}: ${util.inspect(mojaloopError)}`);
            return await this.mojaloopRequests.putTransfersError(prepareRequest.transferId,
                mojaloopError, sourceFspId);
        }
    }

    async _handleError(err) {
        if(err instanceof HTTPResponseError) {
            const e = err.getData();
            let mojaloopErrorCode = Errors.MojaloopApiErrorCodes.INTERNAL_SERVER_ERROR;

            if(e.res && e.res.body) {
                try {
                    const bodyObj = JSON.parse(e.res.body);
                    mojaloopErrorCode = Errors.MojaloopApiErrorCodeFromCode(`${bodyObj.statusCode}`);
                }
                catch(ex) {
                    // do nothing
                    this.logger.log(`Error parsing error message body as JSON: ${ex.stack || util.inspect(ex)}`);
                }
            }

            return new Errors.MojaloopFSPIOPError(err, null, null, mojaloopErrorCode).toApiErrorObject();
        }

        // rethrow some other type of error
        throw err;
    }
}


module.exports = InboundTransfersModel;