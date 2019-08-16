'use strict';
const BaseCrudModel = require('./models/BaseCrudModel');

class DomainEventDBPersistence {

    constructor() {
        this.persistenceModel = new BaseCrudModel('domain_events');
    }
    async save(domainEvent) {
        // console.log(eventRecord);
        let eventRecord = {
            eventId: domainEvent.eventId,
            eventType: domainEvent.eventType,
            transactionId: domainEvent.transactionId,
            timestamp: domainEvent.timestamp,
            payload: JSON.stringify(domainEvent.payload)
        };
        this.persistenceModel.create(eventRecord);
    }
}

module.exports = {
    DomainEventDBPersistence
};