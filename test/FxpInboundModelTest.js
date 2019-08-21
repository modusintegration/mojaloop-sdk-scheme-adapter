const assert = require('chai').assert;
const sinon = require('sinon');
const FxpInboundModel = require('@internal/model').fxpInboundModel;
require('dotenv').config();
const { setConfig, getConfig } = require('../src/config.js');
const { describe, it, beforeEach } = require('mocha');

describe('FxpInboundModel', () => {

    const originalRequest = {
        id: 'abcde1234', // randomPhrase();
        fxpQuote: true,
        'headers': {
            'accept': 'application/vnd.interoperability.quotes+json;version=1',
            'date': 'Fri, 05 Jul 2019 03:27:09 GMT',
            'fspiop-source': 'DFSP1',
            'fspiop-destination': 'DFSP EUR',
            'fspiop-signature': '{"signature":"dNm_D0VM8cLz73_OG8dxR9kVyWp1-f8BXrC87D1M09S9YxOluYQ59E6MFDMix6N8Iymv-YaFe3DJl1MfajhcrmL6wKjEi5sxXz-oGQFbDC76hwWK-741sVCtmIZN3mW55WmqFDBzEVXTRQtusPnK9czBtEFUt5qppPAijdruttVwY0vI1mS9lOr_S8MHokNTSlHsGkHykuMB9wroD1cCQoi-BXbQliWEY49jbXcQNWNpTPs49hPmstiaLTNBZRXd-n4zudETaqn9mfyklob-vC30UZK1C87Nbt6a_Qnm3S2_fGzW6sp8JdU92HTai_NwsFqZZnqOXghZp90VNgjnKw","protectedHeader":"eyJhbGciOiJSUzI1NiIsIkZTUElPUC1VUkkiOiIvcXVvdGVzIiwiRlNQSU9QLUhUVFAtTWV0aG9kIjoiUE9TVCIsIkZTUElPUC1Tb3VyY2UiOiJERlNQMSIsIkZTUElPUC1EZXN0aW5hdGlvbiI6IkRGU1AyIiwiRGF0ZSI6IkZyaSwgMDUgSnVsIDIwMTkgMDM6Mjc6MDkgR01UIn0"}',
            'fspiop-http-method': 'POST',
            'fspiop-uri': '/quotes',
            'fspiop-sourcecurrency': 'EUR',
            'fspiop-destinationcurrency': 'XOF',
            'content-type': 'application/json',
            'authorization': 'Bearer b3d74594-fa41-3581-acf6-4909aaec8134'
        },
        'body': {
            'quoteId': '7c23e80c-d078-4077-8263-2c047876fcf6',
            'transactionId': '85feac2f-39b2-491b-817e-4a03203d4f14',
            'payee': {
                'partyIdInfo': {
                    'partyIdType': 'MSISDN',
                    'partyIdentifier': '123456789',
                    'fspId': 'DFSP2'
                }
            },
            'payer': {
                'personalInfo': {
                    'complexName': {
                        'firstName': 'Mats',
                        'lastName': 'Hagman'
                    },
                    'dateOfBirth': '1983-10-25'
                },
                'partyIdInfo': {
                    'partyIdType': 'MSISDN',
                    'partyIdentifier': '987654321',
                    'fspId': 'DFSP1'
                }
            },
            'amountType': 'RECEIVE',
            'amount': {
                'amount': '100000',
                'currency': 'XOF'
            },
            'transactionType': {
                'scenario': 'TRANSFER',
                'initiator': 'PAYER',
                'initiatorType': 'CONSUMER'
            },
            'note': 'From Mats',
            'expiration': '2017-11-15T22:17:28.985-01:00',
            'extensionList': {
                'extension': [
                    {
                        'key': 'KYCPayerTier',
                        'value': '1'
                    },
                    {
                        'key': 'KYCNationality',
                        'value': 'CI'
                    },
                    {
                        'key': 'KYCOccupation',
                        'value': 'Engineer'
                    },
                    {
                        'key': 'KYCEmployerName',
                        'value': 'Example Corp'
                    },
                    {
                        'key': 'KYCContactPhone',
                        'value': '1122334455'
                    },
                    {
                        'key': 'KYCGender',
                        'value': 'm'
                    },
                    {
                        'key': 'KYCEmailAddress',
                        'value': 'user@mail.com'
                    },
                    {
                        'key': 'KYCBirthCountry',
                        'value': 'CI'
                    },
                    {
                        'key': 'KYCPayerAddress1',
                        'value': 'Immeuble Le Quartz Boulevard Valéry Giscard d’Estaing Marcory'
                    },
                    {
                        'key': 'KYCPayerAddress2',
                        'value': '11 BP 202 Abidjan 11'
                    },
                    {
                        'key': 'KYCPayerAddressCity',
                        'value': 'Abidjan'
                    },
                    {
                        'key': 'KYCPayerAddressCode',
                        'value': 'NE1 3TQ'
                    },
                    {
                        'key': 'KYCPayerIDType',
                        'value': 'PASSPORT'
                    },
                    {
                        'key': 'KYCPayerIDValue',
                        'value': '770423742'
                    },
                    {
                        'key': 'KYCPayerTransferReason',
                        'value': 'Bill payment'
                    }
                ]
            }
        }    
    };

    let secondStageComposedQuote = {
        metadata: {
            sourceFSP: 'DFSP-XOF',
            destinationFSP: 'DFSP2'
        },
        quote: {
            'quoteId': '22222222-d078-4077-8263-2c047876fcf6',
            'transactionId': '22222222-39b2-491b-817e-4a03203d4f14',
            'payee': {
                'partyIdInfo': {
                    'partyIdType': 'MSISDN',
                    'partyIdentifier': '123456789',
                    'fspId': 'DFSP2'
                }
            },
            'payer': {
                'personalInfo': {
                    'complexName': {
                        'firstName': 'Mats',
                        'lastName': 'Hagman'
                    },
                    'dateOfBirth': '1983-10-25'
                },
                'partyIdInfo': {
                    'partyIdType': 'MSISDN',
                    'partyIdentifier': '987654321',
                    'fspId': 'DFSP1'
                }
            },
            'amountType': 'RECEIVE',
            'amount': {
                'amount': '100000',
                'currency': 'XOF'
            },
            'transactionType': {
                'scenario': 'TRANSFER',
                'initiator': 'PAYER',
                'initiatorType': 'CONSUMER'
            },
            'note': 'From Mats',
            'expiration': '2017-11-15T22:17:28.985-01:00',
            'extensionList': {
                'extension': [{
                    'key': 'KYCPayerTier', 'value': '1'
                }, {
                    'key': 'KYCNationality', 'value': 'CI'
                }, {
                    'key': 'KYCOccupation', 'value': 'Engineer'
                }, {
                    'key': 'KYCEmployerName', 'value': 'Example Corp'
                }, {
                    'key': 'KYCContactPhone', 'value': '1122334455'
                }, {
                    'key': 'KYCGender', 'value': 'm'
                }, {
                    'key': 'KYCEmailAddress', 'value': 'user@mail.com'
                }, {
                    'key': 'KYCBirthCountry', 'value': 'CI'
                }, {
                    'key': 'KYCPayerAddress1', 'value': 'Immeuble Le Quartz Boulevard Valéry Giscard d’Estaing Marcory'
                }, {
                    'key': 'KYCPayerAddress2', 'value': '11 BP 202 Abidjan 11'
                }, {
                    'key': 'KYCPayerAddressCity', 'value': 'Abidjan'
                }, {
                    'key': 'KYCPayerAddressCode', 'value': 'NE1 3TQ'
                }, {
                    'key': 'KYCPayerIDType', 'value': 'PASSPORT'
                }, {
                    'key': 'KYCPayerIDValue', 'value': '770423742'
                }, {
                    'key': 'KYCPayerTransferReason', 'value': 'Bill payment'
                }, {
                    'key': 'parentTransferId', 'value': '85feac2f-39b2-491b-817e-4a03203d4f14'
                }]
            }
        }
    };

    let conf = null;
    let ctx = null;
    let nullClient = {
        subscribe: () => {},
        on: () => {}
    };

    beforeEach('creating config', async () => {
        await setConfig(process.env);
        conf = getConfig();
        console.log('Current config:', conf);

        ctx = {
            state: {
                cache: {
                    getClient: () => nullClient
                },
                conf: conf,
                logger: {
                    log: console.log,
                    push: () => {return this;}
                }
            }
        };
        
    });

    it('fxQuoteRequest should get a second stage quote from the server and send it to the payee DFSP', async () => {

        ctx.request = originalRequest;

        const fxpInboundModel = new FxpInboundModel({
            cache: ctx.state.cache,
            logger: ctx.state.logger,
            ...ctx.state.conf
        });

        // it should forward the request as it comes
        let postFxpQuotesMock = sinon.mock(fxpInboundModel.fxpBackendRequests).expects('postFxpQuotes').withExactArgs(ctx.request.body, ctx.request.headers).returns(secondStageComposedQuote);
        // subscribe to listen to the second stage quote response id
        let subscribeMock = sinon.mock(nullClient).expects('subscribe').withExactArgs(secondStageComposedQuote.quote.quoteId).returns(null);
        // and send the second quote to DFSP2
        // FIXME Hackish mock. We should intercept the call to createMojaloopRequestsClient().postQuotes
        fxpInboundModel.sendSecondStageQuoteToDestination = () => true;

        // use the model to handle the request
        const response = await fxpInboundModel.fxQuoteRequest(ctx.request.headers, ctx.request.body);
        assert.isTrue(response);
        postFxpQuotesMock.verify();
        subscribeMock.verify();
    });

});
