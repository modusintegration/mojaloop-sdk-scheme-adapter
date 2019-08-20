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

(async function() {
    const conf = await loadConf();

    const space = Number(process.env.LOG_INDENT);

    const inboundLogger = await createInboundLogger(space);

    const inboundApi = await createInboundApi(space, conf, inboundLogger);

    const outboundLogger = await createOutboundLogger(space);

    const outboundApi = await createOutboundApi(space, conf, outboundLogger);

    createApiServers(conf, inboundApi, inboundLogger, outboundApi, outboundLogger);
})().catch(err => {
    console.error(err);
    process.exit(1);
});

