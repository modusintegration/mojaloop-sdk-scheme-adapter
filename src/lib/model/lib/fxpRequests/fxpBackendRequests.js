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
const request = require('request-promise-native');

const http = require('http');

const common = require('../requests/common');
const buildUrl = common.buildUrl;
const throwOrJson = common.throwOrJson;

const defaultFXPBackendHeaders = {
    accept: 'application/json',
    // Mojaloop uses specific types like
    // application/vnd.interoperability.quotes+json;version=1.0 and application/vnd.interoperability.transfers+json;version=1.0
    // but the backend expects application/json
    'content-type': 'application/json',
};

/**
 * A class for making requests to DFSP backend API
 * 
 * / FIXME Move the specific FXP methods to another class, so this one can be pulled from the original sdk project
 */
class FxpBackendRequests {
    constructor(config) {
        this.config = config;
        this.logger = config.logger;

        // FSPID of THIS DFSP
        this.dfspId = config.dfspId;

        this.agent = http.globalAgent;
        this.transportScheme = 'http';

        // Switch or peer DFSP endpoint
        this.backendEndpoint = `${this.transportScheme}://${config.backendEndpoint}`;
    }


    /**
     * Executes a POST /quotes request for the specified quote request
     *
     * @returns {object} - JSON response body if one was received
     */
    async postQuotes(quoteRequest, headers) {
        // FIXME I think this is not ever called
        throw new Error('IT WAS CALLED');
        const newHeaders = {
            accept: headers.accept,
            'content-type': headers['content-type'],
            date: headers.date,
            'fspiop-source': headers['fspiop-source'],
            'fspiop-destination': headers['fspiop-destination'],
            'fspiop-signature': headers['fspiop-signature'],
            'fspiop-http-method': headers['fspiop-http-method'],
            'fspiop-uri': headers['fspiop-uri'],
            'fspiop-sourcecurrency': headers['fspiop-sourcecurrency'],
            'fspiop-destinationcurrency': headers['fspiop-destinationcurrency'],
            authorization: headers.authorization
        };

        return this._post('quotes', quoteRequest, newHeaders, true);
    }

    /**
     * 
     * @param {quote} quoteRequest 
     * @param {http-headers} headers 
     */
    async postFxpQuotes(quoteRequest, headers) {
        const composedFXPQuote = {
            quote: quoteRequest,
            metadata:{
                destinationFSP: headers['fspiop-destination'],
                destinationCurrency: headers['fspiop-destinationcurrency'],
                sourceFSP: headers['fspiop-source'],
                sourceCurrency: headers['fspiop-sourcecurrency']
            }
        };

        return this._post('fxpquotes', composedFXPQuote, defaultFXPBackendHeaders);
    }

    /**
     * Executes a POST /fxpquotes/{id}/responses request for the specified quote request
     * 
     * @param {string} quoteId 
     * @param {body} quoteRequest 
     * @param {headers} headers 
     *
     * @returns {object} - JSON response body if one was received
     */
    async postFxpQuoteResponse(quoteId, quoteRequest, headers) {

        const composedQuoteResponse = {
            quoteResponse: quoteRequest,
            metadata:{
                destinationFSP: headers['fspiop-destination'],
                sourceFSP: headers['fspiop-source'],
            }
        };
        
        console.log('postQuote sending headers: ', headers, ' quoteRequest: ', composedQuoteResponse);
        return this._post(`fxpquotes/${quoteId}/responses`, composedQuoteResponse, defaultFXPBackendHeaders);
    }
    
    
    /**
     * 
     * @param {prepareRequest} transfer prepare request
     */
    async postFxpTransfers(prepareRequest) {
        return this._post('fxptransfers', prepareRequest);
    }

    /**
     * 
     * @param {fulfilment} fxpTransferResponse fxpTransferResponse
     * @param {transferId} transferId transferId
     * @param {String} sourceFSP
     * @param {String} destinationFSP
     */
    async postFxpTransferResponse(transferId, fxpTransferResponse) {
        return this._post(`fxptransfers/${transferId}/responses`, fxpTransferResponse);
    }
    
    // FIXME The following functions are copied from backendRequests. They should be moved to the shared package, and the properties that are accessed via this ( like this.logger )
    // sent as parameters

    /**
     * Utility function for building outgoing request headers as required by the mojaloop api spec
     *
     * @returns {object} - headers object for use in requests to mojaloop api endpoints
     */
    _buildHeaders () {
        let headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Date': new Date().toUTCString()
        };

        return headers;
    }

    async _get(url) {
        const reqOpts = {
            method: 'GET',
            uri: buildUrl(this.backendEndpoint, url),
            headers: this._buildHeaders(),
            agent: this.agent,
            resolveWithFullResponse: true,
            simple: false
        };

        // Note we do not JWS sign requests with no body i.e. GET requests

        try {
            this.logger.log(`Executing HTTP GET: ${util.inspect(reqOpts)}`);
            return await request(reqOpts).then(throwOrJson);
        }
        catch (e) {
            this.logger.log('Error attempting GET. URL:', url, 'Opts:', reqOpts, 'Error:', e);
            throw e;
        }
    }


    async _put(url, body, headers, returnHeaders) {
        const reqOpts = {
            method: 'PUT',
            uri: buildUrl(this.backendEndpoint, url),
            headers: headers ? headers : this._buildHeaders(),
            body: JSON.stringify(body),
            resolveWithFullResponse: true,
            simple: false,
        };

        try {
            this.logger.log(`Executing HTTP PUT: ${util.inspect(reqOpts)}`);
            const response = await request(reqOpts);
            const responseBody = await throwOrJson(response);
            return returnHeaders ? { headers: response.headers, body: responseBody } : responseBody;
        }
        catch (e) {
            this.logger.log('Error attempting PUT. URL:', url, 'Opts:', reqOpts, 'Body:', body, 'Error:', e);
            throw e;
        }
    }


    async _post(url, body, headers, returnHeaders) {
        const reqOpts = {
            method: 'POST',
            uri: buildUrl(this.backendEndpoint, url),
            headers: headers ? headers : this._buildHeaders(),
            body: JSON.stringify(body),
            resolveWithFullResponse: true,
            simple: false,
        };

        try {
            this.logger.log(`Executing HTTP POST: ${util.inspect(reqOpts)}`);
            const response = await request(reqOpts);
            const responseBody = await throwOrJson(response);
            return returnHeaders ? { headers: response.headers, body: responseBody } : responseBody;
        }
        catch (e) {
            this.logger.log('Error attempting POST. URL:', url, 'Opts:', reqOpts, 'Body:', body, 'Error:', e);
            throw e;
        }
    }
}

module.exports = {
    FxpBackendRequests: FxpBackendRequests,
    HTTPResponseError: common.HTTPResponseError
};
