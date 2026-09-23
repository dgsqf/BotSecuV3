const {
	ActionRowBuilder,
	EmbedBuilder,
	StringSelectMenuBuilder,
} = require('discord.js');
const zlib = require('node:zlib');
const Form = require('./Form.js');
const config = require('../config.json');

const EVENT_FOOTER_PREFIX = 'event:v1:';
const PRESENT_EMOJI = '✅';
const STATE_LABELS = {
	upcoming: 'A venir',
	imminent: 'Imminent',
	running: 'En cours',
	archived: 'Archivé',
};
const processingEvents = new Set();
const notificationStates = new Map();
let restoreInProgress = false;

const getTypes = () => config.EventTypes || {};
const getTags = () => config.eventTags || {};
const getType = (typeId) => getTypes()[typeId] || null;

const hasEventPermission = (interaction, type) => {
	if (interaction.member?.permissions?.has?.('Administrator')) return true;
	const roleIds = type.creationRoleIds?.length ? type.creationRoleIds : config.eventCreationRoleIds || [];
	if (!roleIds.length) return false;
	return roleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
};

const getAvailableTypes = (interaction) => Object.entries(getTypes())
	.filter(([, type]) => hasEventPermission(interaction, type));

const dateToTimestamp = (value) => {
	if (!value || !Number.isInteger(value.year) || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return null;
	const hours = Number(value.hour);
	const minutes = Number(value.minute);
	const naiveUtc = Date.UTC(value.year, value.month - 1, value.day, hours, minutes);
	const calendarCheck = new Date(naiveUtc);
	if (calendarCheck.getUTCFullYear() !== value.year || calendarCheck.getUTCMonth() !== value.month - 1 || calendarCheck.getUTCDate() !== value.day || calendarCheck.getUTCHours() !== hours || calendarCheck.getUTCMinutes() !== minutes) return null;
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: config.eventTimezone || 'Europe/Paris',
		year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
	});
	const parts = Object.fromEntries(formatter.formatToParts(new Date(naiveUtc)).map((part) => [part.type, part.value]));
	const displayedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
	const offset = displayedUtc - naiveUtc;
	return new Date(naiveUtc - offset);
};

const encodeMetadata = (metadata) => `${EVENT_FOOTER_PREFIX}${zlib.deflateRawSync(Buffer.from(JSON.stringify(metadata))).toString('base64url')}`;
const decodeMetadata = (message) => {
	const footer = message.embeds?.[0]?.footer?.text || '';
	if (!footer.startsWith(EVENT_FOOTER_PREFIX)) return null;
	try {
		return JSON.parse(zlib.inflateRawSync(Buffer.from(footer.slice(EVENT_FOOTER_PREFIX.length), 'base64url')).toString('utf8'));
	}
	catch {
		return null;
	}
};

const getConfiguredTagIds = (typeId, values, state) => {
	const tags = getTags();
	const ids = [tags[typeId], tags[state]];
	if (typeId === 'test-anomalie') {
		if (values.besoinULB) ids.push(tags.ULB);
		if (values.besoinURR) ids.push(tags.URR);
	}
	if (typeId === 'escorte-vip') ids.push(tags.APR);
	if (values.division && values.division !== 'Toute la sécurité') ids.push(tags[values.division]);
	return [...new Set(ids.filter(Boolean))];
};

const getParticipants = async (message) => {
	const reaction = message.reactions.cache.find((item) => item.emoji.name === PRESENT_EMOJI);
	if (!reaction) return [];
	const users = await reaction.users.fetch().catch(() => null);
	return users ? [...users.values()].filter((user) => !user.bot) : [];
};

const buildForm = (typeId) => {
	const type = getType(typeId);
	if (!type) return null;
	const form = new Form({ title: `Créer un évènement : ${type.label}`, description: 'Complétez les informations demandées.', color: 0x3498db });
	const addField = (sectionForm, field) => {
		const options = { ...field };
		delete options.type;
		delete options.id;
		delete options.label;
		delete options.choices;
		delete options.section;
		if (field.type === 'choice') sectionForm.choice(field.id, field.label, field.choices, options);
		else if (typeof sectionForm[field.type] === 'function') sectionForm[field.type](field.id, field.label, options);
	};
	const sections = type.sections || [];
	if (!sections.length) {
		for (const field of type.fields || []) addField(form, field);
		return form;
	}
	for (const section of sections) {
		form.section(section.label, section.description || '', (sectionForm) => {
			for (const field of type.fields || []) if (field.section === section.id) addField(sectionForm, field);
		});
	}
	for (const field of type.fields || []) if (!field.section) addField(form, field);
	return form;
};

const formatValue = (value) => {
	if (value == null || value === '') return 'Non renseigné';
	if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
	if (typeof value === 'object' && value.year) {
		return `${String(value.day).padStart(2, '0')}/${String(value.month).padStart(2, '0')}/${value.year} à ${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
	}
	return String(value);
};

const buildEmbed = (metadata, type, values) => {
	const embed = new EmbedBuilder()
		.setColor(0x3498db)
		.setTitle(`${type.label} - ${values.lieu || 'Lieu à préciser'}`)
		.setDescription(`Organisé par <@${metadata.hostId}>\n\n**Statut :** ${STATE_LABELS[metadata.state]}`)
		.setTimestamp(new Date(metadata.startAt));
	for (const field of type.fields || []) {
		const value = field.id === 'date'
			? `<t:${Math.floor(new Date(metadata.startAt).getTime() / 1000)}:F>`
			: formatValue(values[field.id]);
		embed.addFields({ name: field.label, value, inline: field.id !== 'date' && (field.type !== 'text' || !field.paragraph) });
	}
	embed.setFooter({ text: encodeMetadata(metadata) });
	return embed;
};

const publishEvent = async (interaction, typeId, values) => {
	const type = getType(typeId);
	const startAt = dateToTimestamp(values.date);
	if (!type || !startAt || startAt.getTime() <= Date.now()) throw new Error('La date de l’évènement doit être valide et future.');
	const forum = await interaction.guild.channels.fetch(config.eventForumChannelId);
	if (!forum?.threads?.create) throw new Error('Le forum des évènements est absent ou mal configuré.');
	const metadata = { id: null, typeId, hostId: interaction.user.id, startAt: startAt.toISOString(), state: 'upcoming', reminderSent: false, startSent: false, values };
	const thread = await forum.threads.create({
		name: `${type.label} - ${values.lieu || 'Evènement'}`.slice(0, 100),
		appliedTags: getConfiguredTagIds(typeId, values, metadata.state),
		message: { embeds: [buildEmbed(metadata, type, values)] },
	});
	metadata.id = thread.id;
	const message = await thread.fetchStarterMessage();
	await message.edit({ embeds: [buildEmbed(metadata, type, values)] });
	await message.react(PRESENT_EMOJI);
	return { thread, message, metadata };
};

const updateEvent = async (thread, message, metadata, state) => {
	const type = getType(metadata.typeId);
	if (!type) return null;
	metadata.state = state;
	await thread.setAppliedTags(getConfiguredTagIds(metadata.typeId, metadata.values, state)).catch(() => null);
	await message.edit({ embeds: [buildEmbed(metadata, type, metadata.values)] });
	return metadata;
};

const notifyEvent = async (metadata, message, kind) => {
	const users = await getParticipants(message);
	const participantIds = users
		.map((user) => user.id)
		.filter((userId) => userId !== metadata.hostId);
	const ids = new Set([metadata.hostId, ...participantIds]);
	const typeLabel = getType(metadata.typeId)?.label || 'prévu';
	const isReminder = kind === 'reminder';
	const embed = new EmbedBuilder()
		.setColor(isReminder ? 0xfee75c : 0x57f287)
		.setTitle(isReminder ? 'Évènement imminent' : 'Évènement en cours')
		.setDescription(isReminder
			? `L’évènement **${typeLabel}** commence dans 10 minutes.`
			: `L’évènement **${typeLabel}** commence maintenant.`)
		.addFields({
			name: isReminder ? 'Vous êtes attendu (dans 10 minutes) :' : 'Vous êtes attendu maintenant :',
			value: metadata.values?.lieu || 'Lieu non renseigné',
		})
		.addFields({ name: 'Date', value: `<t:${Math.floor(new Date(metadata.startAt).getTime() / 1000)}:F>` })
		.setFooter({ text: 'Notification du système d’évènements' });
	await Promise.all([...ids].map(async (userId) => {
		const user = await message.client.users.fetch(userId).catch(() => null);
		await user?.send({ embeds: [embed] }).catch(() => null);
	}));
};

const processEventMessage = async (message) => {
	const metadata = decodeMetadata(message);
	if (!metadata?.startAt || metadata.state === 'archived') return false;
	if (processingEvents.has(message.id)) return false;
	processingEvents.add(message.id);
	try {
		const notificationState = notificationStates.get(message.id) || {
			reminderSent: Boolean(metadata.reminderSent),
			startSent: Boolean(metadata.startSent),
		};
		notificationStates.set(message.id, notificationState);
		const startAt = new Date(metadata.startAt).getTime();
		if (!Number.isFinite(startAt)) return false;
		const now = Date.now();
		const thread = message.channel;
		if (now >= startAt + 60 * 60_000) {
			await updateEvent(thread, message, metadata, 'archived');
			return true;
		}
		if (now >= startAt) {
			if (metadata.state !== 'running' && metadata.state !== 'archived' && !notificationState.startSent) {
				notificationState.startSent = true;
				metadata.startSent = true;
				await updateEvent(thread, message, metadata, 'running');
				await notifyEvent(metadata, message, 'start');
			}
			return true;
		}
		if (now >= startAt - 10 * 60_000) {
			if (metadata.state === 'upcoming' && !notificationState.reminderSent) {
				notificationState.reminderSent = true;
				metadata.reminderSent = true;
				await updateEvent(thread, message, metadata, 'imminent');
				await notifyEvent(metadata, message, 'reminder');
			}
		}
		return true;
	}
	finally {
		processingEvents.delete(message.id);
	}
};

const restoreAndProcess = async (client) => {
	if (!config.eventForumChannelId) return;
	if (restoreInProgress) return;
	restoreInProgress = true;
	try {
		for (const guild of client.guilds.cache.values()) {
			const forum = await guild.channels.fetch(config.eventForumChannelId).catch(() => null);
			if (!forum?.threads) continue;
			const collections = [await forum.threads.fetchActive().catch(() => null), await forum.threads.fetchArchived({ limit: 100 }).catch(() => null)];
			const threads = new Map();
			for (const collection of collections) for (const thread of collection?.threads?.values() || []) threads.set(thread.id, thread);
			for (const thread of threads.values()) {
				const message = await thread.fetchStarterMessage().catch(() => null);
				if (message) await processEventMessage(message).catch((error) => client.log('EVENT', 'ERROR', `Erreur de suivi de ${thread.id}: ${error.stack || error}`));
			}
		}
	}
	finally {
		restoreInProgress = false;
	}
};

const buildTypeSelector = (entries) => new ActionRowBuilder().addComponents(
	new StringSelectMenuBuilder().setCustomId('event:type').setPlaceholder('Choisissez un type d’évènement').addOptions(entries.map(([value, type]) => ({ label: type.label, value }))),
);

module.exports = {
	EVENT_FOOTER_PREFIX,
	PRESENT_EMOJI,
	STATE_LABELS,
	getType,
	getAvailableTypes,
	buildForm,
	buildEmbed,
	buildTypeSelector,
	decodeMetadata,
	encodeMetadata,
	getConfiguredTagIds,
	dateToTimestamp,
	publishEvent,
	processEventMessage,
	restoreAndProcess,
};