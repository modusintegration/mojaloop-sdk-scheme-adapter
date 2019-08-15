'use strict';
const uuid = require('uuid');
const DomainEvents = require('./DomainEvents');

class DomainEventLogger {

    constructor(eventsPersistence) {
        this.eventsPersistence = eventsPersistence;
    }

    setEventsPersistence ( eventsPersistence ) {
        this.eventsPersistence = eventsPersistence;
    }

    async logDomainEvent(eventType, transactionId, body = {}, timestamp = (new Date()).toISOString()) {
        if (!eventType) {
            throw new Error('eventType can\'t be null');
        }
        if (!DomainEvents[eventType]) {
            throw new Error('unrecognized eventType');
        }
        if (!transactionId) {
            throw new Error('transactionId can\'t be null');
        }
        let eventRecord = {
            eventId: uuid.v4(),
            eventType,
            transactionId,
            timestamp,
            body
        };
        return this.eventsPersistence.save(eventRecord);
    }
}

module.exports = {
    DomainEventLogger
};