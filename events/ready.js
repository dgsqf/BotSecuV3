const { Events } = require('discord.js');
const recrutement = require('../commands/recrutement/recrutement.js');
const recrutementPanel = require('../commands/recrutement/recrutement-panel.js');
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
			await client.log('READY', 'ERROR', `Erreur lors de la restauration des prompts: ${error.stack || error}`);
		}
		try {
			await recrutementPanel.restore(client);
		}
		catch (error) {
			await client.log('READY', 'ERROR', `Erreur lors de la restauration du panel de recrutement: ${error.stack || error}`);
		}
		startJob(client);
	},

};