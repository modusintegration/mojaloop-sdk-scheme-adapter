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

const {
    createOutboundLogger,
    createInboundLogger,
    loadConf,
    createOutboundApi,
    createInboundApi,
    createApiServers
} = require('./app');
const inboundHandlers = require('./inboundApi/handlers.js');
const outboundHandlers = require('./outboundApi/handlers.js');

(async function() {
    const conf = await loadConf();

    const inboundLogger = await createInboundLogger();

    let inboundHandlersMap = inboundHandlers.map;
    const inboundApi = await createInboundApi(conf, inboundLogger, inboundHandlersMap);

    const outboundLogger = await createOutboundLogger();

    let outboundHandlersMap = outboundHandlers.map;
    const outboundApi = await createOutboundApi(conf, outboundLogger, outboundHandlersMap);

    createApiServers(conf, inboundApi, inboundLogger, outboundApi, outboundLogger);
})().catch(err => {
    console.error(err);
    process.exit(1);
});

