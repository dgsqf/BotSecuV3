const { Events, EmbedBuilder } = require('discord.js');
const {
	rapportSuiviChannelId,
	rapportSuiviRoleIds = [],
	rapportLuEmoji = '👀',
	rapportPromotionEmoji = '✅',
} = require('../config.json');

const REPORT_COLORS = {
	default: 0x5865f2,
	read: 0xf39c12,
	promotion: 0x57f287,
};

const normalizeEmoji = (emoji) => String(emoji ?? '').replace(/^<a?:[^:]+:(\d+)>$/, '$1');
const isConfiguredEmoji = (reaction, configuredEmoji) => {
	const configured = normalizeEmoji(configuredEmoji);
	return reaction.emoji.name === configured || reaction.emoji.id === configured || reaction.emoji.identifier === configured;
};

const hasOfficerRole = (member) => rapportSuiviRoleIds.some((roleId) => member?.roles.cache.has(roleId));
const getNotificationMetadata = (message) => {
	const footer = message.embeds?.[0]?.footer?.text || '';
	if (!footer.startsWith('rapport:')) return null;
	const [, threadId, reportMessageId, reportType] = footer.split(':');
	if (!threadId || !reportMessageId) return null;
	return { threadId, reportMessageId, reportType };
};

const getOriginalMessage = async (notification, metadata) => {
	const thread = await notification.guild.channels.fetch(metadata.threadId);
	return thread.messages.fetch(metadata.reportMessageId);
};

const addOriginalReaction = async (notification, metadata, emoji) => {
	const reportMessage = await getOriginalMessage(notification, metadata);
	await reportMessage.react(emoji);
};

const updateOriginalColor = async (notification, metadata, color) => {
	const reportMessage = await getOriginalMessage(notification, metadata);
	const embed = EmbedBuilder.from(reportMessage.embeds[0]).setColor(color);
	await reportMessage.edit({ embeds: [embed] });
};

const updateNotification = async (notification, color, status = null) => {
	const embed = EmbedBuilder.from(notification.embeds[0]);
	const fields = embed.data.fields?.filter((field) => field.name !== 'Statut') ?? [];
	embed.setColor(color);
	if (status) fields.push(status);
	embed.setFields(...fields);
	await notification.edit({ embeds: [embed] });
};

const markAsRead = async (notification, user, metadata) => {
	await updateNotification(notification, REPORT_COLORS.read, {
		name: 'Statut',
		value: `Lu par <@${user.id}> le <t:${Math.floor(Date.now() / 1000)}:F>`,
	});
	await updateOriginalColor(notification, metadata, REPORT_COLORS.read);
	await addOriginalReaction(notification, metadata, rapportLuEmoji);
};

const hasHumanReaction = async (reaction) => {
	const users = await reaction.users.fetch();
	return users.some((user) => !user.bot);
};

const clearReadStatus = async (reaction, notification, metadata) => {
	if (await hasHumanReaction(reaction)) return;
	await updateNotification(notification, REPORT_COLORS.default);
	const reportMessage = await getOriginalMessage(notification, metadata);
	await reportMessage.edit({ embeds: [EmbedBuilder.from(reportMessage.embeds[0]).setColor(REPORT_COLORS.default)] });
	const originalReaction = reportMessage.reactions.cache.find((item) => isConfiguredEmoji(item, rapportLuEmoji));
	if (originalReaction) await originalReaction.users.remove(notification.client.user.id).catch(() => null);
};

const ensureNotificationReactions = async (message) => {
	if (!getNotificationMetadata(message)) return;
	if (!message.reactions.cache.some((reaction) => isConfiguredEmoji(reaction, rapportLuEmoji))) await message.react(rapportLuEmoji);
	if (!message.reactions.cache.some((reaction) => isConfiguredEmoji(reaction, rapportPromotionEmoji))) await message.react(rapportPromotionEmoji);
};

module.exports = {
	name: Events.MessageReactionAdd,
	async execute(reaction, user) {
		if (user.bot || reaction.message.channel.id !== rapportSuiviChannelId) return;
		if (reaction.partial) await reaction.fetch();
		const notification = reaction.message;
		const metadata = getNotificationMetadata(notification);
		const member = await notification.guild.members.fetch(user.id).catch(() => null);
		if (!metadata || !hasOfficerRole(member)) return;

		try {
			if (isConfiguredEmoji(reaction, rapportLuEmoji)) return markAsRead(notification, user, metadata);
			if (isConfiguredEmoji(reaction, rapportPromotionEmoji)) {
				const reportMessage = await getOriginalMessage(notification, metadata);
				await reportMessage.edit({ embeds: [EmbedBuilder.from(reportMessage.embeds[0]).setColor(REPORT_COLORS.promotion)] });
				await reportMessage.react(rapportPromotionEmoji);
				await notification.delete();
			}
		}
		catch (error) {
			await reaction.client.log('RAPPORT', 'ERROR', `Erreur lors du traitement d'une réaction de rapport: ${error.stack || error}`);
		}
	},
	async handleRemove(reaction, user) {
		if (user.bot || reaction.message.channel.id !== rapportSuiviChannelId) return;
		if (reaction.partial) await reaction.fetch();
		if (!isConfiguredEmoji(reaction, rapportLuEmoji)) return;
		const notification = reaction.message;
		const metadata = getNotificationMetadata(notification);
		const member = await notification.guild.members.fetch(user.id).catch(() => null);
		if (!metadata || !hasOfficerRole(member)) return;

		try {
			await clearReadStatus(reaction, notification, metadata);
		}
		catch (error) {
			await reaction.client.log('RAPPORT', 'ERROR', `Erreur lors du retrait de la réaction de lecture: ${error.stack || error}`);
		}
	},
	ensureNotificationReactions,
	async restore(client) {
		if (!rapportSuiviChannelId) return;
		for (const guild of client.guilds.cache.values()) {
			const channel = await guild.channels.fetch(rapportSuiviChannelId).catch(() => null);
			if (!channel?.isTextBased()) continue;
			const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
			if (!messages) continue;
			for (const message of messages.values()) {
				await ensureNotificationReactions(message);
			}
		}
	},
};
