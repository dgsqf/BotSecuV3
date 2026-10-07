const test = require('node:test');
const assert = require('node:assert/strict');
const Permissions = require('../framework_utils/Permissions.js');
const permissionCommand = require('../commands/permissions/permissions.js');
const Prompt = require('../framework_utils/Prompt.js');

test('permission registry exposes described namespaces and permissions', () => {
	const namespaces = Permissions.getNamespaces();
	assert.ok(namespaces.length > 0);
	for (const namespace of namespaces) {
		assert.ok(namespace.description);
		assert.ok(namespace.permissions.length > 0);
		for (const permission of namespace.permissions) {
			assert.match(permission.id, new RegExp(`^${namespace.name}\\.`));
			assert.ok(permission.description);
		}
	}
});

test('a permission accepts any configured role and denies members without one', () => {
	const permissionId = 'rapports.suivi';
	const [firstRole, secondRole] = Permissions.getRoleIds(permissionId);
	assert.ok(firstRole && secondRole);
	assert.equal(Permissions.hasPermission({ member: { roles: { cache: new Set([firstRole]) } } }, permissionId), true);
	assert.equal(Permissions.hasPermission({ member: { roles: { cache: new Set([secondRole]) } } }, permissionId), true);
	assert.equal(Permissions.hasPermission({ member: { roles: { cache: new Set(['100000000000000001']) } } }, permissionId), false);
});

test('personnel permissions are split by dashboard, dossier, activity, sanctions, administration, and promotion', () => {
	const permissions = Permissions.getNamespaces().find(({ name }) => name === 'personnel').permissions;
	assert.deepEqual(permissions.map(({ name }) => name).sort(), ['activite', 'admin', 'dashboard', 'dossier', 'promotion', 'sanctions']);
});

test('administrator bypass applies only to explicitly marked permissions', () => {
	const administrator = { member: { permissions: { has: (permission) => permission === 'Administrator' }, roles: { cache: new Set() } } };
	assert.equal(Permissions.hasPermission(administrator, 'evenements.panel'), true);
	assert.equal(Permissions.hasPermission(administrator, 'rapports.panel'), false);
	assert.equal(Permissions.isDiscordAdministrator(administrator), true);
});

test('the permissions command is restricted to Discord administrators', () => {
	assert.equal(permissionCommand.canExecute({ member: { permissions: { has: () => true } } }), true);
	assert.equal(permissionCommand.canExecute({ member: { permissions: { has: () => false } } }), false);
});

test('prompt buttons enforce their central permission before running callbacks', async () => {
	let collect;
	let callbackRan = false;
	let denial;
	const prompt = new Prompt({
		buttons: [{
			customId: 'report:create',
			permission: 'rapports.creer',
			callback: async () => { callbackRan = true; },
		}],
	});
	await prompt.attach({
		createMessageComponentCollector: () => ({
			on: (event, handler) => { if (event === 'collect') collect = handler; },
		}),
	});
	await collect({
		customId: 'report:create',
		client: {},
		user: { id: 'member-id' },
		member: { roles: { cache: new Set() } },
		replied: false,
		deferred: false,
		reply: async (payload) => { denial = payload; },
	});
	assert.equal(callbackRan, false);
	assert.equal(denial.embeds[0].data.title, 'Accès refusé');
});

test('unknown permission names fail explicitly', () => {
	assert.throws(() => Permissions.hasPermission({}, 'personnel.nonexistent'), /Permission inconnue/);
	assert.throws(() => Permissions.getPermission('personnel'), /Permission invalide/);
});
