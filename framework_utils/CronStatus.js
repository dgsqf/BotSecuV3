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
		const job = new CronJob(
			'*/10 * * * *',
			function() {
				console.log(`[CronJob : ${new Date().toLocaleString()}] Mise à jour du statut du bot`);
				client.user.setPresence({ activities: [{ name: StatusList[Math.floor(Math.random() * StatusList.length)], type: 4 }], status: PresenceUpdateStatus.Online });
			},
			null,
			false,
		);
		client.user.setPresence({ activities: [{ name: StatusList[Math.floor(Math.random() * StatusList.length)], type: 4 }], status: PresenceUpdateStatus.Online });
		job.start();
	},
};

