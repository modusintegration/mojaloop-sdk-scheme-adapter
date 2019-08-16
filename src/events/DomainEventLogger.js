'use strict';
const uuid = require('uuid');
const DomainEventTypes = require('./DomainEventTypes');

class DomainEventLogger {

    constructor(eventsPersistence) {
        this.eventsPersistence = eventsPersistence;
    }

    setEventsPersistence ( eventsPersistence ) {
        this.eventsPersistence = eventsPersistence;
    }

    async logDomainEvent(eventType, transactionId, payload = {}, timestamp = new Date()) {
        if (!eventType) {
            throw new Error('eventType can\'t be null');
        }
        if (!DomainEventTypes[eventType]) {
            throw new Error('unrecognized eventType');
        }
        if (!transactionId) {
            throw new Error('transactionId can\'t be null');
        }
        let domainEvent = { // FIXME make own class
            eventId: uuid.v4(),
            eventType,
            transactionId,
            timestamp,
            payload
        };
        return this.eventsPersistence.save(domainEvent);
    }
}

module.exports = {
    DomainEventLogger
};