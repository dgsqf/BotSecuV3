const { Events } = require('discord.js');
const recrutement = require('../commands/recrutement/recrutement.js');
const recrutementPanel = require('../commands/recrutement/recrutement-panel.js');
const { startJob } = require('../framework_utils/CronStatus.js');
const {
	statusChannelId,
} = require('../config.json');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		const statusChannel = await client.channels.fetch(statusChannelId).catch((error) => {
			client.log('READY', 'ERROR', `Impossible de récupérer le canal de statut ${statusChannelId}: ${error.stack || error}`);
			return null;
		});
		if (statusChannel && statusChannel.isTextBased()) {
			const messages = await statusChannel.messages.fetch({ limit: 50 }).catch((error) => {
				client.log('READY', 'ERROR', `Erreur lors de la récupération des messages de statut: ${error.stack || error}`);
				return null;
			});
			client.statusMessage = messages?.find((message) =>
				message.author.id === client.user.id &&
					message.embeds.some((embed) => embed.title === 'Statut du C.S.A'),
			);
			if (client.statusMessage) {
				await client.statusMessage.edit({
					embeds: [{
						title: 'Statut du C.S.A',
						description: '🟢 C.S.A Démarré',
						color: 0x00ff00,
						timestamp: new Date().toISOString(),
					}],
				});
			}
			else if (!client.statusMessage) {
				client.statusMessage = await statusChannel.send({
					embeds: [{
						title: 'Statut du C.S.A',
						description: '🟢 C.S.A Démarré',
						color: 0x00ff00,
						timestamp: new Date().toISOString(),
					}],
				});
			}
		}
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