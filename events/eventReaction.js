const { Events } = require('discord.js');
const EventsService = require('../framework_utils/Events.js');
const config = require('../config.json');

module.exports = {
	name: Events.MessageReactionAdd,
	async execute(reaction, user) {
		if (user.bot) return;
		if (reaction.partial) await reaction.fetch().catch(() => null);
		const message = reaction.message;
		if (message.channel?.parentId !== config.eventForumChannelId) return;
		if (reaction.emoji.name !== EventsService.PRESENT_EMOJI) return;
		const metadata = EventsService.decodeMetadata(message);
		if (!metadata) return;
		await EventsService.processEventMessage(message).catch((error) => reaction.client.log('EVENT', 'ERROR', `Erreur lors de la réaction Présent: ${error.stack || error}`));
	},
};