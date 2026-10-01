const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRoleList } = require('../scripts/list-roles.js');

test('formatRoleList prints every role name and ID in descending position order', () => {
	const output = formatRoleList([
		{ id: '100000000000000001', name: 'Sécurité', position: 2 },
		{ id: '100000000000000002', name: 'Administrateur', position: 8 },
		{ id: '100000000000000003', name: 'Rôle\navec retour', position: 1 },
	]);
	assert.equal(output, [
		'Rôles du serveur (3)',
		'Administrateur\t100000000000000002',
		'Sécurité\t100000000000000001',
		'Rôle avec retour\t100000000000000003',
	].join('\n'));
});

test('listRoles rejects missing credentials and invalid guild IDs before making requests', async () => {
	await assert.rejects(() => require('../scripts/list-roles.js').listRoles({ token: '', guildId: '100000000000000001' }), /DISCORD_BOT_TOKEN/);
	await assert.rejects(() => require('../scripts/list-roles.js').listRoles({ token: 'test-token', guildId: 'not-an-id' }), /GUILD_ID/);
});