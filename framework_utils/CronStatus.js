const { CronJob } = require('cron');
const { PresenceUpdateStatus } = require('discord.js');
const StatusList = [
	'Attend les ordres de la Direction',
	'Surveille le Site-Lethe',
	'Veille sur la sécurité du serveur',
	'Prêt à répondre aux incidents',
	'En mission de sécurité',
];

module.exports = {
	startJob: function(client) {
		const updatePresence = (context) => {
			try {
				client.user.setPresence({ activities: [{ name: StatusList[Math.floor(Math.random() * StatusList.length)], type: 4 }], status: PresenceUpdateStatus.Online });
			}
			catch (error) {
				return client.log('CRON STATUS', 'ERROR', `Impossible de définir le statut (${context}): ${error.stack || error}`);
			}
			return null;
		};

		const job = new CronJob(
			'*/10 * * * *',
			function() {
				client.log('CRON STATUS', 'INFO', 'Mise à jour du statut du bot.', sendEmbed = false);
				updatePresence('la mise à jour périodique');
			},
			null,
			false,
		);
		updatePresence('la définition initiale');
		job.start();
	},
};

