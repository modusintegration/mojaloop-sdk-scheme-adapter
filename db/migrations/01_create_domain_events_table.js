'use strict'

exports.up = async (knex, Promise) => {
  return await knex.schema.hasTable('domain_events').then(function(exists) {
    if (!exists) {
      return knex.schema.createTable('domain_events', (t) => {
        t.string('eventId', 36).primary().notNullable();
        t.string('eventType', 512).notNullable();
        t.string('transactionId', 36).notNullable();
        t.timestamp('timestamp', { precision: 6 }).defaultTo(knex.fn.now(6)).notNullable();
        t.json('payload');
      })
    }
  })
}

exports.down = function (knex, Promise) {
  return knex.schema.dropTableIfExists('event')
}