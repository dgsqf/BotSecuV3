const test = require('node:test');
const assert = require('node:assert/strict');
const rapports = require('../commands/rapports/rapports.js');

test('parseServiceDurationHours accepts common service-duration formats', () => {
	assert.equal(rapports.parseServiceDurationHours('2h30'), 2.5);
	assert.equal(rapports.parseServiceDurationHours('1 h 30 min'), 1.5);
	assert.equal(rapports.parseServiceDurationHours('90 min'), 1.5);
	assert.equal(rapports.parseServiceDurationHours('2.5'), 2.5);
	assert.equal(rapports.parseServiceDurationHours('inconnu'), null);
});
