const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.json');
const { MODULES, commandHelp, getCommandEntries, getAccess, formatFields } = require('../framework_utils/HelpCatalog.js');
const helpCommand = require('../commands/help/help.js');

const commandsPath = path.join(__dirname, '..', 'commands');
const loadedCommands = fs.readdirSync(commandsPath, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.flatMap((folder) => fs.readdirSync(path.join(commandsPath, folder.name))
		.filter((file) => file.endsWith('.js'))
		.map((file) => require(path.join(commandsPath, folder.name, file))))
	.filter((command) => command?.data?.name && typeof command.execute === 'function');

test('help catalog covers every registered command and subcommand', () => {
	assert.equal(MODULES.length, 5);
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
	assert.equal(replyPayload.components[0].components.length, MODULES.length);
	assert.ok(replyPayload.components[0].components.every((item) => item.toJSON().emoji));

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
	const profile = getCommandEntries(personnel).find((entry) => entry.key === 'profil');
	const create = getCommandEntries(personnel).find((entry) => entry.key === 'creer');
	assert.equal(getAccess({}, profile).allowed, true);
	assert.equal(getAccess({ member: { roles: { cache: new Map() } } }, create).allowed, false);
	assert.match(formatFields(create.fields), /Prénom/);
	assert.match(formatFields(create.fields), /Division \(BG uniquement\).*facultatif/);
});

test('help catalog records slash option and dynamic form details', () => {
	const promotion = loadedCommands.find((command) => command.data.name === 'promotion');
	assert.equal(promotion.data.toJSON().options[0].options[0].name, 'note');
	const recruitment = getCommandEntries(loadedCommands.find((command) => command.data.name === 'recrutement'))[0];
	assert.match(formatFields(recruitment.fields), /2 questions sont sélectionnées au hasard parmi 7/);
	assert.match(formatFields(recruitment.fields), /3 questions sont sélectionnées au hasard parmi 7/);
});

test('help evaluates event types and command-specific role requirements', () => {
	const eventCommand = loadedCommands.find((command) => command.data.name === 'evenement');
	const eventEntry = getCommandEntries(eventCommand)[0];
	const eventRole = config.EventTypes[eventEntry.key].creationRoleIds[0];
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
	const emergencyAccess = roleInteraction(config.PermissionAppelSecuRoleId);
	assert.equal(getAccess(emergencyAccess, emergencyEntry).allowed, false);
	assert.equal(emergencyEntry.additionalAccess[0].access(emergencyAccess).allowed, true);
});