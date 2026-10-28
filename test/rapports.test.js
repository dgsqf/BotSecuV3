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

test('validateServiceDuration accepts valid formats and explains the expected format', () => {
	// Acceptés (mêmes formats que parseServiceDurationHours).
	for (const value of ['2h30', '1 H 30', '90 min', '2,5', '1:45', '2 h']) {
		assert.equal(rapports.validateServiceDuration(value), null, value);
	}
	// Refusés.
	for (const value of ['inconnu', '', null, '  ']) {
		assert.ok(rapports.validateServiceDuration(value), value);
	}
	// Le message d'erreur explique le format attendu.
	const error = rapports.validateServiceDuration('abc');
	assert.match(error, /reconnue/);
	assert.match(error, /Format/);
	assert.match(error, /2 h 30/);
});
