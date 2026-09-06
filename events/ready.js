const { Events } = require('discord.js');
const recrutement = require('../commands/recrutement/recrutement.js');
const { startJob } = require('../framework_utils/CronStatus.js');


module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		try {
			await recrutement.restore(client);
		}
		catch (error) {
			console.error('Erreur lors de la restauration des prompts:', error);
		}
		startJob(client);
	},

};