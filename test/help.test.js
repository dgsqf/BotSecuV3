const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Permissions = require('../framework_utils/Permissions.js');
const { MODULES, commandHelp, getCommandEntries, getAccess, formatFields } = require('../framework_utils/HelpCatalog.js');
const { renderDashboard, executeDashboard } = require('../framework_utils/PersonnelDashboardSession.js');
const helpCommand = require('../commands/help/help.js');

const commandsPath = path.join(__dirname, '..', 'commands');
const loadedCommands = fs.readdirSync(commandsPath, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.flatMap((folder) => fs.readdirSync(path.join(commandsPath, folder.name))
		.filter((file) => file.endsWith('.js'))
		.map((file) => require(path.join(commandsPath, folder.name, file))))
	.filter((command) => command?.data?.name && typeof command.execute === 'function');

test('help catalog covers every registered command and subcommand', () => {
	assert.equal(MODULES.length, 6);
	assert.ok(MODULES.every((module) => module.emoji));
	assert.deepEqual(Object.keys(commandHelp).sort(), loadedCommands.filter((command) => command.data.name !== 'help').map((command) => command.data.name).sort());
	for (const command of loadedCommands.filter((item) => item.data.name !== 'help')) {
		const options = command.data.toJSON().options || [];
		const subcommands = options.filter((option) => option.type === 1);
		const entries = getCommandEntries(command);
		if (subcommands.length) {
			assert.deepEqual(entries.map((entry) => entry.key).sort(), subcommands.map((option) => option.name).sort(), command.data.name);
		}
		else {
			assert.ok(entries.length >= 1, command.data.name);
		}
	}
});

test('help command is registered and its home panel has Discord-compatible embeds and module buttons', async () => {
	assert.equal(helpCommand.data.name, 'help');
	let replyPayload;
	let onCollect;
	const message = {
		createMessageComponentCollector: () => ({ on: (event, callback) => { if (event === 'collect') onCollect = callback; } }),
		edit: async () => null,
	};
	const client = { commands: new Map(loadedCommands.map((command) => [command.data.name, command])) };
	await helpCommand.execute({
		client,
		user: { id: 'user-id' },
		reply: async (payload) => { replyPayload = payload; return message; },
	});
	assert.equal(replyPayload.embeds.length, 1);
	assert.ok(replyPayload.components.every((row) => row.components.length <= 5));
	assert.equal(replyPayload.components.reduce((count, row) => count + row.components.length, 0), MODULES.length);
	assert.ok(replyPayload.components.flatMap((row) => row.components).every((item) => item.toJSON().emoji));

	let updatedPayload;
	const component = (customId) => ({
		customId,
		client,
		member: { roles: { cache: new Set() } },
		user: { id: 'user-id' },
		update: async (payload) => { updatedPayload = payload; },
	});
	await onCollect(component('help:module:personnel'));
	assert.equal(updatedPayload.embeds[0].data.title, '👥 Personnel');
	const detailButton = updatedPayload.components.flatMap((row) => row.components)
		.find((item) => item.toJSON().custom_id.startsWith('help:detail:'));
	await onCollect(component(detailButton.toJSON().custom_id));
	assert.match(updatedPayload.embeds[0].data.description, /Vous ne pouvez pas la lancer actuellement/);
	assert.ok(updatedPayload.components[0].components.some((item) => item.toJSON().custom_id === 'help:home'));

	await onCollect(component('help:module:urgences'));
	const emergencyButton = updatedPayload.components.flatMap((row) => row.components)
		.find((item) => item.toJSON().custom_id.startsWith('help:detail:urgences:'));
	await onCollect(component(emergencyButton.toJSON().custom_id));
	const emergencyFields = updatedPayload.embeds[0].data.fields.map((item) => item.value).join('\n');
	assert.match(emergencyFields, /Lieu/);
	assert.match(emergencyFields, /Anomalies hors confinement/);
	assert.match(emergencyFields, /Groupe d'intérêt/);
	assert.match(emergencyFields, /Description courte de l’urgence/);
});

test('help exposes optional form fields and current role-based access', () => {
	const personnel = loadedCommands.find((command) => command.data.name === 'personnel');
	const characters = getCommandEntries(personnel).find((entry) => entry.key === 'characters');
	const hierarchy = getCommandEntries(personnel).find((entry) => entry.key === 'hierarchy');
	assert.equal(getAccess({ member: { roles: { cache: new Map() } } }, characters).allowed, false);
	assert.equal(getAccess({ member: { roles: { cache: new Set(Permissions.getRoleIds('personnel.admin')) } } }, characters).allowed, true);
	assert.equal(getAccess({ member: { roles: { cache: new Set(Permissions.getRoleIds('personnel.promotion')) } } }, hierarchy).allowed, true);
});

test('help catalog documents all dashboard actions and dynamic form details', () => {
	const personnel = loadedCommands.find((command) => command.data.name === 'personnel');
	const entries = getCommandEntries(personnel);
	assert.equal(personnel.data.toJSON().options.length, 0);
	assert.deepEqual(entries.map(({ key }) => key).sort(), ['activity', 'characters', 'hierarchy', 'sanctions']);
	assert.match(entries.find((entry) => entry.key === 'hierarchy').description, /vagues de promotions/);
	assert.match(entries.find((entry) => entry.key === 'sanctions').description, /révoquer/);
	const recruitment = getCommandEntries(loadedCommands.find((command) => command.data.name === 'recrutement'))[0];
	assert.match(formatFields(recruitment.fields), /2 questions sont sélectionnées au hasard parmi 7/);
	assert.match(formatFields(recruitment.fields), /3 questions sont sélectionnées au hasard parmi 7/);
});

test('personnel dashboard refuses unauthorized users and filters actions by role', async () => {
	const personnelCommand = loadedCommands.find((command) => command.data.name === 'personnel');
	assert.equal(personnelCommand.data.name, 'personnel');
	assert.deepEqual(getCommandEntries(personnelCommand).map(({ key }) => key).sort(), ['activity', 'characters', 'hierarchy', 'sanctions']);
	assert.deepEqual(loadedCommands.filter(({ data }) => ['activite', 'hierarchie', 'promotion', 'retrogradation', 'sanction'].includes(data.name)), []);
	assert.equal(personnelCommand.canExecute({ member: { roles: { cache: new Set() } } }), false);
	assert.equal(personnelCommand.canExecute({ member: { roles: { cache: new Set(Permissions.getRoleIds('personnel.dashboard')) } } }), true);

	let deniedPayload;
	await executeDashboard({
		client: { log: async () => null },
		member: { roles: { cache: new Set() } },
		user: { id: 'unauthorized', tag: 'unauthorized' },
		reply: async (payload) => { deniedPayload = payload; },
	});
	assert.equal(deniedPayload.embeds[0].data.title, 'Base de données indisponible');
	assert.equal(deniedPayload.components, undefined);

	const adminOnly = { member: { roles: { cache: new Set(['1523457212293451948']) } }, user: { tag: 'admin' } };
	const renderState = (interaction, view, hasOwnProfile = false) => ({ interaction, userTag: 'test', view, page: view, backPage: 'home', hasOwnProfile, activityType: 'points', activityPeriod: 'all', activityPage: 1, activityPages: 1, historyPage: 1, historyPages: 1, promotionIds: [], promotionLabels: [], scaleIndex: 0 });
	const adminOptions = renderDashboard(renderState(adminOnly, 'characters')).components.flatMap((row) => row.components).map((component) => component.data.custom_id);
	assert.ok(adminOptions.includes('personnel:create-profile'));
	assert.ok(adminOptions.includes('personnel:edit-profile'));
	assert.ok(!adminOptions.includes('personnel:sanction-add'));

	const staffOnly = { member: { roles: { cache: new Set(['1542567053708230759']) } }, user: { tag: 'staff' } };
	const staffOptions = renderDashboard(renderState(staffOnly, 'sanctions')).components.flatMap((row) => row.components).map((component) => component.data.custom_id);
	assert.ok(staffOptions.includes('personnel:sanction-add'));
	const staffCharacterOptions = renderDashboard(renderState(staffOnly, 'characters')).components.flatMap((row) => row.components).map((component) => component.data.custom_id);
	assert.ok(staffCharacterOptions.includes('personnel:select-profile'));
	assert.ok(!staffCharacterOptions.includes('personnel:create-profile'));
});

test('help evaluates event types and command-specific role requirements', () => {
	const eventCommand = loadedCommands.find((command) => command.data.name === 'evenement');
	const eventEntry = getCommandEntries(eventCommand)[0];
	const eventRole = Permissions.getRoleIds(`evenements.${eventEntry.key}`)[0];
	const eventMember = { permissions: { has: () => false }, roles: { cache: new Set([eventRole]) } };
	assert.equal(getAccess({ member: eventMember }, eventEntry).allowed, true);
	assert.equal(getAccess({ member: { permissions: { has: () => false }, roles: { cache: new Set() } } }, eventEntry).allowed, false);

	const commandMap = new Map(loadedCommands.map((command) => [command.data.name, command]));
	const roleInteraction = (roleId) => ({
		client: { commands: commandMap },
		member: { roles: { cache: new Set([roleId]) } },
	});
	for (const name of ['rapport-panel', 'recrutement-panel', 'urgence-panel']) {
		const command = loadedCommands.find((item) => item.data.name === name);
		const entry = getCommandEntries(command)[0];
		assert.equal(getAccess(roleInteraction('1542836944457703454'), entry).allowed, true, name);
		assert.equal(getAccess(roleInteraction('100000000000000001'), entry).allowed, false, name);
	}

	const report = loadedCommands.find((command) => command.data.name === 'rapport');
	const reportEntry = getCommandEntries(report)[0];
	assert.equal(getAccess(roleInteraction('1545770783387684924'), reportEntry).allowed, true);
	assert.equal(getAccess(roleInteraction('100000000000000001'), reportEntry).allowed, false);

	const emergency = loadedCommands.find((command) => command.data.name === 'urgence-panel');
	const emergencyEntry = getCommandEntries(emergency)[0];
	const emergencyAccess = roleInteraction(Permissions.getRoleIds('urgences.appeler')[0]);
	assert.equal(getAccess(emergencyAccess, emergencyEntry).allowed, false);
	assert.equal(emergencyEntry.additionalAccess[0].access(emergencyAccess).allowed, true);
});