const { Events } = require('discord.js');
const reportReaction = require('./messageReactionAdd.js');

module.exports = {
	name: Events.MessageReactionRemove,
	execute: reportReaction.handleRemove,
};
