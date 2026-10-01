const { EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config.json');
const Form = require('./Form.js');
const { getLadder } = require('../data/hierarchy.js');

const ROLE_GROUPS = {
	staff: config.personnelStaffRoleIds || [],
	admin: config.personnelAdminRoleIds || [],
};
const isDiscordId = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
const normalizeRoleIds = (value) => (Array.isArray(value) ? value : [value])
	.filter(isDiscordId);
const getManualRoleDisplays = (guild, member) => Object.entries(config.personnelManualRoleGroups || [])
	.map(([group, roleIds]) => {
		const heldRoles = normalizeRoleIds(roleIds)
			.filter((roleId) => member?.roles?.cache?.has(roleId))
			.map((roleId) => guild?.roles?.cache?.get(roleId)?.name || `Rôle ${roleId}`);
		return heldRoles.length ? `**${group}** : ${heldRoles.join(', ')}` : null;
	})
	.filter(Boolean);

const getPersonnelRoleIds = (profile) => {
	if (!profile) return [];
	if (['DIRECTION', 'COMMISSION'].includes(profile.branch)) return [];
	const rankRoles = config.personnelRankRoleIds || {};
	return [...new Set([
		...normalizeRoleIds(config.personnelBranchRoleIds?.[profile.branch]),
		...(profile.division ? normalizeRoleIds(config.personnelDivisionRoleIds?.[profile.division]) : []),
		...normalizeRoleIds(rankRoles.branches?.[profile.branch]?.[profile.branchRankId]),
		...(profile.division ? normalizeRoleIds(rankRoles.divisions?.[profile.division]?.[profile.divisionRankId]) : []),
		...normalizeRoleIds(config.personnelIraRoleIds?.[String(profile.ira)]),
	])];
};

const syncPersonnelRoles = async (interaction, discordId, previousProfile, nextProfile) => {
	const previousRoleIds = new Set(getPersonnelRoleIds(previousProfile));
	const nextRoleIds = new Set(getPersonnelRoleIds(nextProfile));
	const protectedRoleIds = new Set([
		...normalizeRoleIds(config.personnelStaffRoleIds),
		...normalizeRoleIds(config.personnelAdminRoleIds),
		...Object.values(config.personnelManualRoleGroups || {}).flatMap(normalizeRoleIds),
	]);
	const rolesToRemove = [...previousRoleIds].filter((roleId) => !nextRoleIds.has(roleId) && !protectedRoleIds.has(roleId));
	const rolesToAdd = [...nextRoleIds].filter((roleId) => !previousRoleIds.has(roleId));
	if (!rolesToRemove.length && !rolesToAdd.length) return { ok: true };
	try {
		const member = await interaction.guild.members.fetch(discordId);
		if (rolesToRemove.length) await member.roles.remove(rolesToRemove);
		if (rolesToAdd.length) await member.roles.add(rolesToAdd);
		return { ok: true };
	}
	catch (error) {
		await interaction.client.log('PERSONNEL', 'ERROR', `Échec de synchronisation des rôles de <@${discordId}> (${error.stack || error}).`);
		return { ok: false, error };
	}
};

const hasPersonnelPermission = (interaction, group) => {
	const roleIds = ROLE_GROUPS[group] || [];
	const roles = interaction.member?.roles;
	return roleIds.some((roleId) => roles?.cache?.has(roleId) || (Array.isArray(roles) && roles.includes(roleId)));
};

const reply = async (interaction, embed, extra = {}) => {
	const payload = { embeds: [embed], flags: MessageFlags.Ephemeral, ...extra };
	if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
	return interaction.reply(payload);
};

const replyError = (interaction, message, title = 'Opération impossible') => reply(interaction,
	new EmbedBuilder().setColor(0xed4245).setTitle(title).setDescription(String(message).slice(0, 4000)));

const requirePermission = async (interaction, group) => {
	if (hasPersonnelPermission(interaction, group)) return true;
	await replyError(interaction, 'Vous ne possédez pas le rôle requis pour utiliser cette commande.', 'Accès refusé');
	return false;
};

const replyServiceError = async (interaction, error) => {
	if (error instanceof Error && error.message && !error.code?.startsWith('SQLITE_')) return replyError(interaction, error.message);
	await interaction.client.log('PERSONNEL', 'ERROR', `Erreur inattendue: ${error?.stack || error}`);
	const { createUserErrorEmbed } = require('./Logging.js');
	return reply(interaction, createUserErrorEmbed('cette commande'));
};

const rankChoices = (branch, division) => getLadder(branch, division)
	.map(({ id, label }) => ({ name: label, value: id }));

const addRankAutocomplete = async (interaction, branch, division = null) => {
	const query = interaction.options.getFocused().toLocaleLowerCase('fr');
	const choices = rankChoices(branch, division)
		.filter(({ name, value }) => `${name} ${value}`.toLocaleLowerCase('fr').includes(query))
		.slice(0, 25);
	await interaction.respond(choices);
};

const formatDuration = (minutes) => {
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours} h ${remainingMinutes.toString().padStart(2, '0')} min`;
};

const normalizeChoice = (choice) => {
	if (typeof choice === 'string') return { label: choice, value: choice };
	if (!choice || typeof choice !== 'object') return { label: String(choice), value: String(choice) };
	return {
		label: choice.label ?? choice.name ?? String(choice.value ?? choice.id ?? ''),
		value: String(choice.value ?? choice.id ?? choice.name ?? ''),
	};
};

const runPersonnelForm = async ({
	interaction,
	title,
	description,
	fields = [],
	color = 0x5865f2,
	ephemeral = true,
	followUp = false,
	onConfirm,
	onCancel,
	timeout = 15 * 60_000,
}) => {
	if (!Array.isArray(fields) || !fields.length) throw new TypeError('Au moins un champ est requis pour le formulaire de personnel.');
	const form = new Form({ title, description, color, timeout });
	for (const field of fields) {
		if (!field || !field.id || !field.label) continue;
		const commonOptions = { required: field.required !== false, ...field };
		delete commonOptions.id;
		delete commonOptions.label;
		switch (field.type) {
		case 'user':
			form.user(field.id, field.label, commonOptions);
			break;
		case 'users':
			form.users(field.id, field.label, commonOptions);
			break;
		case 'number':
			form.number(field.id, field.label, commonOptions);
			break;
		case 'date':
			form.date(field.id, field.label, commonOptions);
			break;
		case 'boolean':
			form.boolean(field.id, field.label, commonOptions);
			break;
		case 'choice': {
			const choices = Array.isArray(field.choices) ? field.choices.map(normalizeChoice) : [];
			form.choice(field.id, field.label, choices, commonOptions);
			break;
		}
		default:
			form.text(field.id, field.label, commonOptions);
		}
	}
	return form.send(interaction, { ephemeral, followUp, onConfirm, onCancel });
};

module.exports = {
	hasPersonnelPermission,
	requirePermission,
	reply,
	replyError,
	replyServiceError,
	rankChoices,
	addRankAutocomplete,
	formatDuration,
	isDiscordId,
	getPersonnelRoleIds,
	getManualRoleDisplays,
	syncPersonnelRoles,
	runPersonnelForm,
};