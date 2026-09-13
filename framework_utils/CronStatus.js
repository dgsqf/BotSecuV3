const { CronJob } = require('cron');
const { PresenceUpdateStatus } = require('discord.js');
const StatusList = [
	'Attend les ordres de la Direction',
	'Surveille le Site-Lethe',
	'Veille sur la sécurité du serveur',
	'Prêt à répondre aux incidents',
	'En mission de sécurité',
	'Initialisation des protocoles',
	'Vérification des identités',
	'Fermeture du terminal',
	'Tous les systèmes fonctionnels',
	'Analyse des données en cours',
	'Synchronisation des modules',
	'Connexion au serveur établie',
	'Vérification des paramètres',
	'Chargement des protocoles',
	'Synchronisation des données',
	'Analyse du système en cours',
	'Vérification de l\'intégrité',
	'Modules opérationnels',
	'Sécurisation du terminal',
	'Accès aux données autorisé',
	'Mise à jour des systèmes',
	'Protocoles de sécurité actifs',
	'Connexion sécurisée',
	'Préparation du système',
	'Initialisation terminée',
	'Système prêt',
	'Surveillance active',
	'Traitement des données..',
	'Aucun dysfonctionnement détecté',
	'Statut : OPÉRATIONNEL',
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

