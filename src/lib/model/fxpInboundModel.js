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
const FxpBackendRequests = require('@internal/fxpRequests').FxpBackendRequests;
const HTTPResponseError = require('@internal/requests').HTTPResponseError;
const MojaloopRequests = require('@modusbox/mojaloop-sdk-standard-components').MojaloopRequests;
const Ilp = require('@modusbox/mojaloop-sdk-standard-components').Ilp;
const Errors = require('@modusbox/mojaloop-sdk-standard-components').Errors;

// const DomainEventLogger = require('../../events/DomainEventLogger');
const DomainEventTypes = require('../../events/DomainEventTypes');

const FSPIOP_SourceHeader = 'FSPIOP-Source'.toLowerCase();
const FSPIOP_DestinationHeader = 'FSPIOP-Destination'.toLowerCase();

const ASYNC_TIMEOUT_MILLS = 30000;


/**
 *  Models the operations required for performing inbound FXP quotes and transfers
 * 
 */
class FxpInboundModel {
    constructor(config) {
        this.config = config;
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

        this.fxpBackendRequests = new FxpBackendRequests({
            logger: this.logger,
            backendEndpoint: config.backendEndpoint,
            dfspId: config.dfspId
        });

        this.checkIlp = config.checkIlp;

        this.ilp = new Ilp({
            secret: config.ilpSecret
        });
    }

    setDomainEventLogger(domainEventLogger) {
        this.domainEventLogger = domainEventLogger;
    }
    
    /**
     * Creates and returns a MojaloopRequests client that can be used to send requests from sourceDfspId to destinationDfspId.
     * The new MojaloopRequests has the same logger, tls and jwsSign config than this.
     * Once MBXFXP-12 is done, this will sign the requests with a different private key for each DFSP
     * @param {String} sourceDfspId Originator DFSP id
     * @param {String} destinationDfspId Destination DFSP id
     */
    createMojaloopRequestsClient (sourceDfspId, destinationDfspId) {
        let peerEndpoint = this.getEndpointForDFSP(destinationDfspId);
        return new MojaloopRequests({
            logger: this.logger,
            peerEndpoint: peerEndpoint,
            dfspId: sourceDfspId,
            tls: this.config.tls,
            jwsSign: this.config.jwsSign,
            jwsSigningKey: this.config.jwsSigningKey // FIXME MBXFXP-12 we need to use ONE PRIVATE KEY PER FX DFSP
        });
    }

    /**
     * Handles a FXP Quote, triggering the creation of the "second stage" quote and setting listeners for its resolution.
     * See https://modusbox.atlassian.net/wiki/spaces/mbxFXP/pages/400949590/FXP+P2P+transfer
     * 
     * @param {Object} originalQuoteRequestHeaders Headers from the POST /quotes operation
     * @param {QuotesPostRequest} originalQuoteRequest Quote request. See 6.5.2.2 on the Mojaloop API
     */
    async fxQuoteRequest(originalQuoteRequestHeaders, originalQuoteRequest) {
        try {
            const originalQuoteId = originalQuoteRequest.quoteId;
            const originalQuoteSourceFspId = originalQuoteRequestHeaders[FSPIOP_SourceHeader];
            const originalQuoteDestinationFspId = originalQuoteRequestHeaders[FSPIOP_DestinationHeader];

            // make a call to the backend to ask for a new quote
            this.logger.log('[Quotes 19] FXP QUOTE Sending request to backend');
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_QUOTE_A_RECEIVED, originalQuoteRequest.transactionId, originalQuoteRequest);
            let secondStageComposedQuote;
            try {
                secondStageComposedQuote = await this.fxpBackendRequests.postFxpQuotes(originalQuoteRequest, originalQuoteRequestHeaders);
                if(!secondStageComposedQuote) {
                    throw new Error('null response to quote request from FXP backend');
                }
            } catch (error) {
                // make an error callback to the source fsp
                this.logger.log(`Error while expecting response from FXP backend. Making error callback to ${originalQuoteSourceFspId}`);
                const err = new Errors.MojaloopFSPIOPError(error, error.message, originalQuoteSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
                // FIXME wrap in a trycatch and log
                return await this.mojaloopRequests.putQuotesError(originalQuoteId, err.toApiErrorObject(), originalQuoteSourceFspId);
            }

            this.logger.log(`[Quotes 22] FXP QUOTE Got response from backend: ${JSON.stringify(secondStageComposedQuote, null, 2)}`);
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_QUOTE_B_CREATED, originalQuoteRequest.transactionId, secondStageComposedQuote);

            // Now that we got a response, send the quote to the destination DFSP
            const secondStageQuoteSourceFsp = secondStageComposedQuote.metadata.sourceFSP;
            const secondStageQuoteDestinationFsp = secondStageComposedQuote.metadata.destinationFSP;

            // set up listener to PUT /quotes/{transferId} for the second stage quote ( which is step 28B)
            await this.createSecondStageQuoteResponseListener(secondStageComposedQuote.quote, originalQuoteSourceFspId, originalQuoteDestinationFspId, originalQuoteRequest, secondStageQuoteSourceFsp, secondStageQuoteDestinationFsp);

            // forward the quote to the destination FSP
            this.logger.log(`[Quotes 23] FXP QUOTE Sending second stage quote to destination DFSP: ${secondStageQuoteDestinationFsp}`);

            let sendSecondStageQuoteResult= this.sendSecondStageQuoteToDestination(secondStageQuoteDestinationFsp, secondStageQuoteSourceFsp, secondStageComposedQuote);
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_QUOTE_B_SENT, originalQuoteRequest.transactionId, secondStageComposedQuote);
            return sendSecondStageQuoteResult;

        }
        catch(err) {
            this.logger.log(`Error in quoteRequest: ${err.stack || util.inspect(err)}`);
            const mojaloopError = await this._handleError(err);
            this.logger.log(`Sending error response : ${util.inspect(mojaloopError)}`);
            // FIXME wrap in a trycatch and log
            return await this.mojaloopRequests.putQuotesError(originalQuoteRequest.quoteId, mojaloopError, '?');
        }
    }

    sendSecondStageQuoteToDestination(secondStageQuoteDestinationFsp, secondStageQuoteSourceFsp, secondStageComposedQuote) {
        const fxpMojaloopRequests = this.createMojaloopRequestsClient(secondStageQuoteSourceFsp, secondStageQuoteDestinationFsp);
        return fxpMojaloopRequests.postQuotes(secondStageComposedQuote.quote, secondStageQuoteDestinationFsp);
    }

    /**
     * Creates a listener for the /quotes callback on secondStageQuoteId
     * 
     * @param {QuotesPostRequest} secondStageQuote quote "B", created from MZ2 DFSP to the PayeeDFSP
     * @param {String} originalQuoteSourceFspId 
     * @param {String} originalQuoteDestinationFspId 
     * @param {QuotesPostRequest} originalQuoteRequest quote "A". Received from hub, from PayerDFSP to MZ1 DFSP
     * @param {String} secondStageQuoteSourceFsp 
     * @param {String} secondStageQuoteDestinationFsp 
     */
    async createSecondStageQuoteResponseListener(secondStageQuote, originalQuoteSourceFspId, originalQuoteDestinationFspId, originalQuoteRequest, secondStageQuoteSourceFsp, secondStageQuoteDestinationFsp) {
        const secondStageQuoteId = secondStageQuote.quoteId;
        this.subscriber = await this.cache.getClient();
        this.subscriber.subscribe(secondStageQuoteId);
        const fxpQuoteResponseHandler = async (cn, msg) => {
            return this.handleSecondStageQuoteResponse(cn, msg, secondStageQuote, originalQuoteSourceFspId, originalQuoteDestinationFspId, originalQuoteRequest, secondStageQuoteSourceFsp, secondStageQuoteDestinationFsp);
        };
        this.subscriber.on('message', fxpQuoteResponseHandler);
    }

    /**
     * Handles the /quotes callback on the second stage quote
     * 
     * @param {Object} cn callback notification
     * @param {Object} msg message
     * @param {QuotesPostRequest} secondStageQuote quote "B", created from MZ2 DFSP to the PayeeDFSP
     * @param {String} originalQuoteSourceFspId 
     * @param {String} originalQuoteDestinationFspId 
     * @param {QuotesPostRequest} originalQuoteRequest 
     * @param {String} secondStageQuoteSourceFsp 
     * @param {String} secondStageQuoteDestinationFsp 
     */
    async handleSecondStageQuoteResponse(cn, msg, secondStageQuote, originalQuoteSourceFspId, originalQuoteDestinationFspId, originalQuoteRequest, secondStageQuoteSourceFsp, secondStageQuoteDestinationFsp) {
        const secondStageQuoteId = secondStageQuote.quoteId;
        this.logger.log(`FXP QUOTE quoteResponseHandler received cn ${util.inspect(cn)} and msg: ${util.inspect(msg)}`);
        let message = JSON.parse(msg);
        if (message.type === 'quoteResponseError') {
            // this is an error response to our POST /quotes request
            // make an error callback to the source fsp
            this.logger.log(`Error on response to fxpQuote. Making error callback to ${originalQuoteSourceFspId}`);
            const err = new Errors.MojaloopFSPIOPError(null, message.data, originalQuoteSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
            // FIXME wrap in a trycatch and log
            return await this.mojaloopRequests.putQuotesError(originalQuoteRequest.quoteId, err.toApiErrorObject(), originalQuoteSourceFspId);
        }
        if (message.type !== 'quoteResponse') {
            // ignore any message on this subscription that is not a quote response
            this.logger.log(`Ignoring cache notification for transfer ${secondStageQuoteId}. Type is not quoteResponse: ${util.inspect(message)}`);
            return;
        }
        const secondStageQuoteResponse = message.data;
        const secondStageQuoteResponseHeaders = message.headers;

        // cancel the timeout handler
        // clearTimeout(timeout); // FIXME implement timeouts

        // clean quoteId from response if there. A previous version of the SDK returns it as part of a quote response but it's not part of it per the Mojaloop spec ( FIXME find proper reference )
        delete secondStageQuoteResponse['quoteId'];
        this.logger.log(`[Quotes 28B] Received response to second stage quote: ${util.inspect(secondStageQuoteResponse)} with headers: ${util.inspect(secondStageQuoteResponseHeaders)}`);
        this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_QUOTE_B_RESPONSE_RECEIVED, originalQuoteRequest.transactionId, secondStageQuoteResponse);
        // stop listening for payee resolution messages
        this.subscriber.unsubscribe(secondStageQuoteId, () => {
            this.logger.log('FxpQuote request subscriber unsubscribed');
        });
        // Now send the quote to the FXP
        this.logger.log('[Quotes 29] FXP QUOTE : SENDING QUOTE RESPONSE TO BACKEND and asking for response to original quote');
        // forward secondStageQuoteResponse to backend; don't change any headers
        let composedResponseToOriginalQuote;
        try {
            composedResponseToOriginalQuote = await this.fxpBackendRequests.postFxpQuoteResponse(secondStageQuoteId, secondStageQuoteResponse, secondStageQuoteResponseHeaders);
            if (!composedResponseToOriginalQuote) {
                throw new Error('Null response from fxp to secondStageQuoteResponse');
            }
            // validate composedResponseToOriginalQuote
            //
        }
        catch (error) {
            this.logger.log(`Error from fxp to secondStageQuoteResponse. Making error callback to ${originalQuoteSourceFspId}`);
            const err = new Errors.MojaloopFSPIOPError(error, error.message, originalQuoteSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
            // FIXME wrap in a trycatch and log
            return await this.mojaloopRequests.putQuotesError(originalQuoteRequest.quoteId, err.toApiErrorObject(), originalQuoteSourceFspId);
        }
        const sourceFspId = composedResponseToOriginalQuote.metadata.sourceFSP;
        const destinationFspId = composedResponseToOriginalQuote.metadata.destinationFSP;
        this.logger.log(`[Quotes 30] FXP QUOTE : creating quote response IlpPacket, condition and fulfilment on ${util.inspect(composedResponseToOriginalQuote)}`);

        const responseToOriginalQuote = composedResponseToOriginalQuote.quoteResponse;

        // Now we create the ilp packet and condition
        // CODE taken from quoteRequest
        if(!responseToOriginalQuote.expiration) {
            const expiration = new Date().getTime() + (this.expirySeconds * 1000); // FIXME Which timeout do we set here?
            responseToOriginalQuote.expiration = new Date(expiration).toISOString();
        }

        // create our ILP packet and condition and tag them on to our internal quote response 
        const { fulfilment, ilpPacket, condition } = this.ilp.getQuoteResponseIlp(secondStageQuote, responseToOriginalQuote);

        responseToOriginalQuote.ilpPacket = ilpPacket;
        responseToOriginalQuote.condition = condition; 

        // now store the fulfilment and the quote data against the quoteId in our cache
        // as we are going to use this on the transfer processing
        // FIXME Maybe use transaction_ as the prefix? instead of quote_
        await this.cache.set(`quote_${originalQuoteRequest.transactionId}`, {
            originalQuoteSourceFspId,
            originalQuoteDestinationFspId,
            secondStageQuoteSourceFsp,
            secondStageQuoteDestinationFsp,
            originalQuoteRequest,
            responseToOriginalQuote,
            secondStageQuote,
            secondStageQuoteResponse,
            mojaloopResponse: responseToOriginalQuote, // FIXME This alias is not needed in fxpModel?
            fulfilment,
            fxpQuote: true
        });

        this.logger.log(`[Quotes 31, 32] FXP QUOTE : SENDING RESPONSE TO ORIGINAL QUOTE TO DFSP1 ${util.inspect(composedResponseToOriginalQuote)}`);
        // make a callback to the source fsp with the quote response
        this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_QUOTE_A_RESPONSE_CREATED, originalQuoteRequest.transactionId, composedResponseToOriginalQuote);

        const fxpMojaloopRequests = this.createMojaloopRequestsClient(sourceFspId, destinationFspId);

        // Mojaloop requests picks the quoteId from metadata
        let originalQuoteId = composedResponseToOriginalQuote.metadata.quoteId;

        // FIXME wrap in a trycatch
        const putResponse = await fxpMojaloopRequests.putQuotes(originalQuoteId, responseToOriginalQuote, destinationFspId);
        this.logger.log(`Response from original dfspid to PUT /quotes/{originalQuoteId}: ${util.inspect(putResponse)}`);
        this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_QUOTE_A_RESPONSE_SENT, originalQuoteRequest.transactionId, composedResponseToOriginalQuote);
    }

    /**
     * Validates  an incoming transfer prepare request and makes a callback to the originator with
     * the result
     * 
     * If the quote is an "fxpQuote", handle it differently forwarding it to fxpTransfer 
     */
    async prepareTransfer(prepareRequest, sourceFspId, destinationFspId) {
        try {
            // retrieve our quote data
            const quote = await this.cache.get(`quote_${prepareRequest.transferId}`);

            if (!quote) {
                throw new Error(`Can't process transfer: quote with id ${prepareRequest.transferId} not found`);
            }
            // check incoming ILP matches our persisted values
            if(this.checkIlp && (prepareRequest.condition !== quote.mojaloopResponse.condition)) {
                throw new Error(`ILP condition in transfer prepare for ${prepareRequest.transferId} does not match quote`);
            } 

            if (quote.fxpQuote) {
                return this.fxpTransfer(prepareRequest, sourceFspId, destinationFspId, quote);
            }

            throw new Error(`Can't process transfer with id ${prepareRequest.transferId} for a non-fxp quote`);
        }
        catch(err) {
            this.logger.log(`Error in prepareTransfer: ${err.stack || util.inspect(err)}`);
            const mojaloopError = await this._handleError(err);
            this.logger.log(`Sending error response to ${sourceFspId}: ${util.inspect(mojaloopError)}`);
            return await this.mojaloopRequests.putTransfersError(prepareRequest.transferId, mojaloopError, sourceFspId);
        }
    }

    /**
     * Process a transfer belonging to a FXP quote
     * 
     * @param {TransfersPostRequest} prepareRequest transfer request related to originalQuoteRequest.transactionId
     * @param {String} prepareRequestSourceFspId 
     * @param {String} destinationFspId 
     * @param {Object} quoteData put in the cache as the last step in handleSecondStageQuoteResponse
     */
    async fxpTransfer(prepareRequest, prepareRequestSourceFspId, destinationFspId, quoteData) {
        this.logger.log(`[Transfers 03 A] FXP : received transfer ${util.inspect(prepareRequest)} from ${util.inspect(prepareRequestSourceFspId)} to ${util.inspect(destinationFspId)}`);
        this.logger.log('[Transfers 04 A] FXP : Forwarding to FXP');
        this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_A_RECEIVED, prepareRequest.transferId, prepareRequest);

        let composedSecondStageTransfer = await this.getFxpTransferFromBackend(prepareRequest, prepareRequestSourceFspId);
        let secondStageTransfer = composedSecondStageTransfer.transfer; // FIXME if null there was an error. OR, rethrow ex from getFxpTransferFromBackend ( better )

        // FIXME check timeout is less that the one in prepareRequest
        
        // Set the secondStageTransfer properties
        secondStageTransfer.ilpPacket = quoteData.secondStageQuoteResponse.ilpPacket;
        secondStageTransfer.condition = quoteData.secondStageQuoteResponse.condition;
        // FIXME assert that the value we received from the backend is the same as:
        secondStageTransfer.transferId = quoteData.secondStageQuote.transactionId;
        this.logger.log(`[Transfers 06] FXP : received second stage transfer from backend: ${util.inspect(secondStageTransfer)}`);
        this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_B_CREATED, prepareRequest.transferId, secondStageTransfer);

        // Set up a listener before forwarding the secondStageTransfer
        await this.createFxpTransferResponseListener(prepareRequest, prepareRequestSourceFspId, quoteData, composedSecondStageTransfer);

        // forward it to destination fsp
        this.logger.log('[Transfers 07 B] FXP : Sending transfer to Payee DFSP');
        await this.forwardFxpTransferToDestination(composedSecondStageTransfer);
        this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_B_SENT, prepareRequest.transferId, secondStageTransfer);
    }

    /**
     * Calls the backend with a prepareRequest ( from PayerFSP to MZ1 FSP ) and returns a new transfer request from MX2 FSP to Payee FSP
     * @param {TransfersPostRequest } prepareRequest original transfer request
     * @param {String} prepareRequestSourceFspId FIXME we're only passing this to send an error notification to the originator FSP. Should (re-)throw and exception and let the caller handle it
     */
    async getFxpTransferFromBackend(prepareRequest, prepareRequestSourceFspId) {

        let composedTransferRequestResponse;
        try {
            composedTransferRequestResponse = await this.fxpBackendRequests.postFxpTransfers(prepareRequest);
            if(!composedTransferRequestResponse) {
                throw new Error('null response to transfer request from FXP backend');
            }
        } catch (error) {
            // make an error callback to the source fsp
            this.logger.log(`Error while expecting response from FXP backend. Making error callback to ${prepareRequestSourceFspId}`);
            const err = new Errors.MojaloopFSPIOPError(error, error.message, prepareRequestSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
            // FIXME wrap in a trycatch and log
            await this.mojaloopRequests.putTransfersError(prepareRequest.transferId, err.toApiErrorObject(), prepareRequestSourceFspId);
            throw error;
        }

        return composedTransferRequestResponse;
    }

    /**
     * Sends the second stage transfer to the Payee DFSP
     * @param {ComposedTransferRequest} composedTransferRequest 
     */
    async forwardFxpTransferToDestination(composedTransferRequest) {

        // Now that we got a response, send the quote to the destination DFSP
        const sourceFspId = composedTransferRequest.metadata.sourceFSP;
        const destinationFspId = composedTransferRequest.metadata.destinationFSP;

        const fxpMojaloopRequests = this.createMojaloopRequestsClient(sourceFspId, destinationFspId);

        return fxpMojaloopRequests.postTransfers(composedTransferRequest.transfer, destinationFspId);
    }


    /**
     * Creates a listener to handle the second stage transfer callback
     * 
     * @param {TransfersPostRequest} prepareRequest 
     * @param {String} prepareRequestSourceFspId 
     * @param {Object} quoteData 
     * @param {ComposedTransferRequest} composedSecondStageTransfer second stage composed transfer
     */
    async createFxpTransferResponseListener(prepareRequest, prepareRequestSourceFspId, quoteData, composedSecondStageTransfer) {
        let secondStageTransferId = composedSecondStageTransfer.transfer.transferId;
        // listen on secondStageTransferId = quoteData.secondStageQuote.transactionId;
        this.subscriber = await this.cache.getClient();
        this.subscriber.subscribe(secondStageTransferId);

        const secondStageTransferResponseHandler = async (cn, msg) => {
            this.logger.log('secondStageTransferResponseHandler received cn and msg: ', cn, msg);
            let message = JSON.parse(msg);
            if (message.type === 'transferError') {
                // this is an error response to our POST /transfers request
                // make an error callback to the source fsp
                this.logger.log(`Error on response to fxpTransfer. Making error callback to ${prepareRequestSourceFspId}`);
                // FIXME Maybe this should this go back as an error to DFSP2 since it handled this transfer *AND* also to the originator FSP?
                const err = new Errors.MojaloopFSPIOPError(null, message.data, prepareRequestSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
                // FIXME wrap in a trycatch and log
                return await this.mojaloopRequests.putTransfersError(prepareRequest.transferId, err.toApiErrorObject(), prepareRequestSourceFspId);
            }
            if (message.type !== 'transferFulfil') {
                // ignore any message on this subscription that is not a quote response
                this.logger.log(`Ignoring cache notification for transfer ${secondStageTransferId}. Type is not quoteResponse: ${util.inspect(message)}`);
                return;
            }

            // cancel the timeout handler
            // clearTimeout(timeout); // FIXME implement timeouts

            this.subscriber.unsubscribe(secondStageTransferId, () => {
                this.logger.log('fxpTransfer notification subscriber unsubscribed');
            });

            const secondStageTransferResponse = message.data;
            const secondStageTransferResponseHeaders = message.headers;
            
            const sourceFspId = secondStageTransferResponseHeaders[FSPIOP_SourceHeader];
            const destinationFspId = secondStageTransferResponseHeaders[FSPIOP_DestinationHeader];

            if (sourceFspId === quoteData.secondStageQuoteDestinationFsp && destinationFspId === quoteData.secondStageQuoteSourceFsp) {
                // 14B
                this.logger.log(`[Transfers 14B] FXP : received second stage transfer callback: ${util.inspect(secondStageTransferResponse)}`);
                this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_B_FULFILMENT_RECEIVED, prepareRequest.transferId, secondStageTransferResponse);
            } else {
                console.error(`Coudln't find a match for sourceFspId: ${sourceFspId} destinationFspId: ${destinationFspId}`);
                return;
            }

            // We got a response to the secondStageTransferRequest
            // secondStageTransferResponseHeaders.'fspiop-source' = DFSP2
            // secondStageTransferResponseHeaders.'fspiop-destination'= 'DFSP-XOF'
            // body:
            // '{
            //     "completedTimestamp":"2019-07-19T20:06:12.287Z",
            //     "transferState":"COMMITTED",
            //     "fulfilment":"AEHj7oqLNuVEL8W1xsxSpVFdncgqbiza_a-hNHS657o"
            //  }',
 
            this.logger.log('[Transfers 15 B] FXP : forward onto FXP');
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_B_PAYEE_TRANSFER_COMMITTED, prepareRequest.transferId, secondStageTransferResponse);

            // ( FXP on receiving will perform 16[B] Commit payee transfer).
            await this.forwardFulfilmentToBackend(secondStageTransferResponse, prepareRequestSourceFspId, secondStageTransferId);
            // FIXME check operation succeeded, forward error it it didn't and DON'T log a succesful commit
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_B_PAYEE_TRANSFER_COMMITTED_ACK, prepareRequest.transferId, secondStageTransferResponse);


            this.logger.log(`[Transfers 19 A] FXP : generate fulfilment for the original transfer ${util.inspect(prepareRequest)}`);

            // Set the fulfilment to be the same we created when making the response to the originalQuote
            let transferFulfilment = {
                completedTimestamp: (new Date()).toISOString(),
                transferState: 'COMMITTED',
                fulfilment: quoteData.fulfilment
            };

            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_A_FULFILMENT_CREATED, prepareRequest.transferId, transferFulfilment);

            this.logger.log(`[Transfers 20 A] FXP : respond with fulfilment: ${util.inspect(transferFulfilment)}`);

            // Send the fulfilment back to the originator DFSP
            // Before doing that, we need to set up a listener for the commit notification on this original transfer "A"
            await this.createOriginalTransferResponseListener(prepareRequest, prepareRequestSourceFspId, quoteData);

            let sendFulfimentToOriginatorFspResponse = await this.sendFulfimentToOriginatorFsp(prepareRequest.transferId, transferFulfilment,
                quoteData.originalQuoteDestinationFspId, quoteData.originalQuoteSourceFspId);
            this.logger.log(`[Transfers 20 A] FXP : 'sendFulfimentToOriginatorFsp response: ${util.inspect(sendFulfimentToOriginatorFspResponse)}`);
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_A_FULFILMENT_SENT, prepareRequest.transferId, transferFulfilment);
            // FIXME catch error and log. retry?
        };
        this.subscriber.on('message', secondStageTransferResponseHandler);
    }

    /**
     * Sends a transfer response to the backend.
     * 
     * @param {TransactionsIDPutResponse} transferResponse Response to a transfer. See Mojaloop API 6.7.3.1
     * @param {String} prepareRequestSourceFspId Only used to forward errors to. FIXME Will be refactored when the error handling is redone
     * @param {UUID} transferId transferResponse transferId
     * 
     * @returns null if no error
     */
    async forwardFulfilmentToBackend(transferResponse, prepareRequestSourceFspId, transferId) {
        try {
            let fulfilmentResponse = await this.fxpBackendRequests.postFxpTransferResponse(transferId, transferResponse);
            if(fulfilmentResponse != null) {
                throw new Error(`Unexpected non empty response to transfer request from FXP backend: ${util.inspect(fulfilmentResponse)}`);
            }
            this.logger.log('FXP forwardFulfilmentToBackend got OK response from backend');
            return fulfilmentResponse;
        } catch (error) {
            // make an error callback to the source fsp
            this.logger.log(`Error while expecting response from FXP backend. Making error callback to ${prepareRequestSourceFspId}`);
            const err = new Errors.MojaloopFSPIOPError(error, error.message, prepareRequestSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
            // FIXME wrap in a trycatch and log
            return await this.mojaloopRequests.putTransfersError(transferId, err.toApiErrorObject(), prepareRequestSourceFspId);
        }
    }

    /**
     * Creates a listener to handle the original callback
     * 
     * @param {TransfersPostRequest} prepareRequest 
     * @param {String} prepareRequestSourceFspId 
     * @param {Object} quoteData 
     */
    async createOriginalTransferResponseListener(prepareRequest, prepareRequestSourceFspId, quoteData) {
        // listen on prepareRequest.transferId = quoteData.originalQuoteRequest.transactionId;
        this.subscriber = await this.cache.getClient();
        this.subscriber.subscribe(prepareRequest.transferId);

        const originalTransferResponseHandler = async (cn, msg) => {
            this.logger.log('originalTransferResponseHandler received cn and msg: ', cn, msg);
            let message = JSON.parse(msg);
            if (message.type === 'transferError') {
                // this is an error response to our POST /transfers request
                // make an error callback to the source fsp
                this.logger.log(`Error on response to originalTransfer. Making error callback to ${prepareRequestSourceFspId}`);
                const err = new Errors.MojaloopFSPIOPError(null, message.data, prepareRequestSourceFspId, Errors.MojaloopApiErrorCodes.PAYEE_ERROR);
                // FIXME wrap in a trycatch and log
                return await this.mojaloopRequests.putTransfersError(prepareRequest.transferId, err.toApiErrorObject(), prepareRequestSourceFspId);
            }
            if (message.type !== 'transferFulfil') {
                // ignore any message on this subscription that is not a quote response
                this.logger.log(`Ignoring cache notification for transfer ${prepareRequest.transferId}. Type is not quoteResponse: ${util.inspect(message)}`);
                return;
            }

            // cancel the timeout handler
            // clearTimeout(timeout); // FIXME implement timeouts

            this.subscriber.unsubscribe(prepareRequest.transferId, () => {
                this.logger.log('prepareRequest transfer notification subscriber unsubscribed');
            });

            const originalTransferResponse = message.data;
            const originalTransferResponseHeaders = message.headers;
            
            const sourceFspId = originalTransferResponseHeaders[FSPIOP_SourceHeader];
            const destinationFspId = originalTransferResponseHeaders[FSPIOP_DestinationHeader];

            if (sourceFspId === quoteData.originalQuoteDestinationFspId && destinationFspId === quoteData.originalQuoteSourceFspId) {
                // 22
                this.logger.log(`[Transfers 22] FXP : received original transfer callback: ${util.inspect(originalTransferResponse)}`);
            } else {
                console.error(`Coudln't find a match for sourceFspId: ${sourceFspId} destinationFspId: ${destinationFspId}`); // FIXME  not clear. Same on 14B
                return;
            }

            // We got a response to the originalTransferRequest
            // originalTransferResponseHeaders.'fspiop-source' = DFSP1
            // originalTransferResponseHeaders.'fspiop-destination'= 'DFSP-EUR'
            // body:
            // '{
            //     "completedTimestamp":"2019-07-19T20:06:12.287Z",
            //     "transferState":"COMMITTED",
            //     "fulfilment":"AEHj7oqLNuVEL8W1xsxSpVFdncgqbiza_a-hNHS657o"
            //  }',
            this.logger.log('[Transfers 23] FXP : Log fulfilment has been commited and forward to FXP');
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_A_PAYER_TRANSFER_COMMITTED, prepareRequest.transferId, originalTransferResponse);

            await this.forwardFulfilmentToBackend(originalTransferResponse, prepareRequestSourceFspId, prepareRequest.transferId);
            this.domainEventLogger.logDomainEvent(DomainEventTypes.FX_TRANSFER_A_PAYER_TRANSFER_COMMITTED_ACK, prepareRequest.transferId, originalTransferResponse);

            // we're done. Check the response, and forward errors if any
            
            this.logger.log('[Transfers ] FXP : DONE');
        };
        this.subscriber.on('message', originalTransferResponseHandler);
    }

    /**
     * 20A Respond with fulfillment
     * PUT /transfers/{originalId} to the hub
     *
     * @param {UUID} transferId 
     * @param {Object} transferFulfilment 
     */
    async sendFulfimentToOriginatorFsp(transferId, transferFulfilment, sourceFspId, destinationFspId) {
        const fxpMojaloopRequests = this.createMojaloopRequestsClient(sourceFspId, destinationFspId);

        return fxpMojaloopRequests.putTransfers(transferId, transferFulfilment, destinationFspId);
    }

    async _handleError(err) {
        if(err instanceof HTTPResponseError ) {
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
        // Changed to return so we can return an answer to the original sender
        throw err;
        // return err;
    }

    /**
     * Returns the dfsp endpoint
     * 
     * @param {String} dfsp DFSP id.
     */
    getEndpointForDFSP(dfsp) {
        let peerEndpoint = this.config.peerEndpoint; // default
        const configEndpoint = this.config.getDfspEndpoint(dfsp);
        if (configEndpoint) {
            peerEndpoint = configEndpoint.endpoint;
        }
        return peerEndpoint;
    }
}


module.exports = FxpInboundModel;
