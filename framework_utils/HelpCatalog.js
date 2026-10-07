const config = require('../config.json');
const Permissions = require('./Permissions.js');
const Events = require('./Events.js');

const MODULES = [
	{ id: 'evenements', label: 'Événements', emoji: '📅', description: 'Création et publication des événements de sécurité.' },
	{ id: 'personnel', label: 'Personnel', emoji: '👥', description: 'Profils, hiérarchie, activité, promotions et sanctions du personnel.' },
	{ id: 'rapports', label: 'Rapports', emoji: '📝', description: 'Soumission des rapports et publication de leur panneau.' },
	{ id: 'recrutement', label: 'Recrutement', emoji: '📋', description: 'Candidatures au département de la sécurité et panneau associé.' },
	{ id: 'urgences', label: 'Urgences', emoji: '🚨', description: 'Publication du panneau et transmission des appels d’urgence.' },
	{ id: 'administration', label: 'Administration', emoji: '🛡️', description: 'Configuration des rôles autorisés par permission.' },
];

const field = (label, type = 'texte', required = true, detail = '') => ({ label, type, required, detail });
const openAccess = () => ({ allowed: true, requirement: 'Aucun rôle ou permission Discord n’est vérifié par cette commande.' });
const commandAccess = (commandName, requirement) => (interaction) => {
	const check = interaction.client?.commands?.get(commandName)?.canExecute;
	return { allowed: typeof check === 'function' && check(interaction), requirement };
};
const commandMethodAccess = (commandName, methodName, requirement) => (interaction) => {
	const check = interaction.client?.commands?.get(commandName)?.[methodName];
	return { allowed: typeof check === 'function' && check(interaction), requirement };
};
const promotion = (interaction) => ({
	allowed: Permissions.hasPermission(interaction, 'personnel.promotion'),
	requirement: 'Posséder un rôle autorisé par personnel.promotion.',
});
const personnelPermissionAccess = (permissionId) => (interaction) => ({
	allowed: Permissions.hasPermission(interaction, permissionId),
	requirement: `Posséder un rôle autorisé par ${permissionId}.`,
});

const commandHelp = {
	'evenement': {
		module: 'evenements',
		description: 'Ouvre le choix des types d’événements auxquels votre membre a accès. Chaque type ouvre un formulaire configuré avec sa date, son lieu et ses champs propres; l’événement publié est créé dans le forum configuré.',
		entries: Object.entries(config.EventTypes || {}).map(([typeId, type]) => ({
			key: typeId,
			label: `/evenement · ${type.label}`,
			description: `Création d’un événement de type « ${type.label} ». Le formulaire contient les champs configurés pour ce type.`,
			access: (interaction) => {
				const available = Events.getAvailableTypes(interaction).some(([availableId]) => availableId === typeId);
				const roles = Permissions.getRoleIds(`evenements.${typeId}`);
				return {
					allowed: available,
					requirement: `Posséder un rôle autorisé par evenements.${typeId}${roles.length ? ` (${roles.length} rôle(s) configuré(s))` : ''}, ou être administrateur Discord.`,
				};
			},
			fields: (type.fields || []).map((item) => field(item.label, item.type, item.required !== false, item.choices ? `Choix : ${item.choices.map((choice) => typeof choice === 'string' ? choice : choice.label).join(', ')}` : '')),
		})),
	},
	'evenement-panel': {
		module: 'evenements',
		description: 'Publie le panneau qui permet d’ouvrir le sélecteur de types d’événements.',
		entries: [{ key: 'main', label: '/evenement-panel', description: 'Envoie le panneau dans le salon configuré pour les événements.', access: commandAccess('evenement-panel', 'Posséder un rôle autorisé par evenements.panel ou être administrateur Discord.') }],
	},
	'personnel': {
		module: 'personnel', description: 'Dashboard privé organisé en quatre vues, avec navigation dans un message unique et une aide détaillée sur chaque écran.',
		entries: [
			{ key: 'characters', label: '👥 Personnages', description: 'Consulter son propre dossier; personnel.dossier autorise la consultation des autres personnages et personnel.admin leur création, modification ou suppression.', access: personnelPermissionAccess('personnel.dossier') },
			{ key: 'activity', label: '📈 Activité', description: 'Voir les classements et consulter son activité; personnel.activite autorise les corrections motivées de points et d’heures.', access: personnelPermissionAccess('personnel.activite') },
			{ key: 'sanctions', label: '⚖️ Sanctions', description: 'Consulter ses propres dossiers; personnel.dossier autorise la consultation des autres membres et personnel.sanctions permet d’ajouter ou révoquer une sanction.', access: personnelPermissionAccess('personnel.sanctions') },
			{ key: 'hierarchy', label: '🏛️ Hiérarchie', description: 'Parcourir les rangs et effectifs; les rôles autorisés peuvent lancer des vagues de promotions ou rétrograder un membre.', access: promotion },
		],
	},
	'rapport': {
		module: 'rapports', description: 'Ouvre un formulaire de choix du type de rapport, puis le formulaire correspondant. Le rapport envoyé est publié dans le forum configuré.',
		entries: [
			{ key: 'incident', label: '/rapport · Incident', description: 'Soumet un rapport d’incident avec sa date, son lieu, le personnel présent et le détail des faits.', access: commandAccess('rapport', 'Posséder un rôle autorisé par rapports.creer.'), fields: [field('Type de rapport', 'choix', true, 'Incident.'), field('Date de l’incident', 'date'), field('Lieu', 'texte'), field('Personnel notable présent lors de l’incident', 'texte long'), field('Détail complet de l’incident', 'texte long')] },
			{ key: 'prise-service', label: '/rapport · Prise de service', description: 'Soumet un rapport de prise de service avec les personnes présentes, sa durée et ses observations facultatives.', access: commandAccess('rapport', 'Posséder un rôle autorisé par rapports.creer.'), fields: [field('Type de rapport', 'choix', true, 'Prise de service.'), field('Date de la prise de service', 'date'), field('Personnel présent lors de la prise de service', 'texte long'), field('Incident éventuel', 'texte long', false), field('Durée de la prise de service', 'texte'), field('Activités suspectes', 'texte long', false)] },
			{ key: 'experience', label: '/rapport · Expérience', description: 'Soumet un rapport d’expérience avec l’anomalie, les personnes présentes, les effectifs et les observations.', access: commandAccess('rapport', 'Posséder un rôle autorisé par rapports.creer.'), fields: [field('Type de rapport', 'choix', true, 'Expérience.'), field('Anomalie', 'texte'), field('Membre du personnel scientifique présent', 'texte'), field('Nombre de Classe-D', 'nombre'), field('Membre du personnel de sécurité présent', 'texte'), field('Date de l’expérience', 'date'), field('Observations', 'texte long')] },
			{ key: 'personnel', label: '/rapport · Personnel', description: 'Soumet un rapport concernant un membre du personnel avec l’article concerné et les détails de l’incident.', access: commandAccess('rapport', 'Posséder un rôle autorisé par rapports.creer.'), fields: [field('Type de rapport', 'choix', true, 'Concernant le personnel.'), field('Agent concerné', 'membre'), field('Article du règlement enfreint', 'texte long'), field('Détails de l’incident', 'texte long')] },
		],
	},
	'rapport-panel': {
		module: 'rapports', description: 'Publie le panneau qui ouvre le formulaire de création de rapports.',
		entries: [{ key: 'main', label: '/rapport-panel', description: 'Envoie le panneau dans le salon configuré pour les rapports.', access: commandAccess('rapport-panel', 'Posséder un rôle autorisé par rapports.panel.') }],
	},
	'rapport-recapitulatif': {
		module: 'rapports',
		description: 'Génère un fichier Markdown contenant les rapports publiés pendant la période sélectionnée, triés par date et type.',
		entries: [{ key: 'main', label: '/rapport-recapitulatif', description: 'Choisissez les 7 derniers jours, le dernier mois ou la dernière année. Les rapports complets sont classés par date et type puis joints en fichier Markdown.', access: commandAccess('rapport-recapitulatif', 'Posséder un rôle autorisé par rapports.recapitulatif.') }],
	},
	'recrutement': {
		module: 'recrutement', description: 'Ouvre le formulaire de candidature. Les réponses sont transmises à l’équipe dans un salon de candidature dédié.',
		entries: [{ key: 'main', label: '/recrutement', description: 'Demande des réponses générales et des connaissances sur la Fondation SCP.', access: openAccess(), fields: [field('Questions générales', 'texte', true, '2 questions sont sélectionnées au hasard parmi 7.'), field('Questions à choix multiples', 'QCM', true, '3 questions sont sélectionnées au hasard parmi 7; chaque question propose 3 réponses.')] }],
	},
	'recrutement-panel': {
		module: 'recrutement', description: 'Publie le panneau permettant aux utilisateurs d’ouvrir le formulaire de recrutement.',
		entries: [{ key: 'main', label: '/recrutement-panel', description: 'Envoie le panneau dans le salon de recrutement configuré.', access: commandAccess('recrutement-panel', 'Posséder un rôle autorisé par recrutement.panel.') }],
	},
	'urgence-panel': {
		module: 'urgences', description: 'Publie le panneau d’appels d’urgence. Le panneau requiert un rôle pour être publié; son utilisation vérifie séparément le rôle configuré pour les appels. Les champs dépendent du type choisi.',
		entries: [{
			key: 'main', label: '/urgence-panel', description: 'Envoie le panneau configuré. Les boutons proposent les types d’urgence et « Autre ».',
			access: commandAccess('urgence-panel', 'Posséder un rôle autorisé par urgences.panel.'),
			additionalAccess: [{ label: 'Utiliser les boutons d’appel', access: commandMethodAccess('urgence-panel', 'canUseCalls', 'Posséder un rôle autorisé par urgences.appeler.') }],
			fields: [
				field('Lieu', 'texte', true, 'Demandé pour chaque appel.'),
				...Object.entries(config.UrgenceTypes || {}).map(([, type]) => field(`Formulaire « ${type.label} »`, 'modal', true, type.fields?.length ? `Champs supplémentaires facultatifs : ${type.fields.map((item) => item.label).join(', ')}.` : 'Aucun champ supplémentaire configuré.')),
				field('Divisions concernées (Autre)', 'sélection multiple', true, 'Sélectionnez au moins une division avant de poursuivre.'),
				field('Description courte de l’urgence « Autre »', 'texte long', true, 'Demandée après la sélection d’au moins une division; maximum 1 000 caractères.'),
			],
		}],
	},
	'permissions': {
		module: 'administration',
		description: 'Configure les rôles associés aux permissions centralisées du bot.',
		entries: [{ key: 'main', label: '/permissions', description: 'Parcourt les namespaces, les permissions et sélectionne plusieurs rôles autorisés.', access: (interaction) => ({ allowed: Permissions.isDiscordAdministrator(interaction), requirement: 'Posséder la permission Administrateur Discord.' }) }],
	},
};

const getCommandEntries = (command) => {
	const metadata = commandHelp[command.data.name];
	if (!metadata) return [];
	const subcommands = command.data.toJSON().options || [];
	if (subcommands.length && subcommands.every((option) => option.type === 1)) {
		return metadata.entries.filter((entry) => subcommands.some((option) => option.name === entry.key));
	}
	return metadata.entries;
};

const getAccess = (interaction, entry) => {
	if (typeof entry.access === 'function') return entry.access(interaction);
	return entry.access || openAccess();
};

const formatFields = (fields = []) => fields.length
	? fields.map((item) => `• **${item.label}** (${item.type}${item.required ? ', requis' : ', facultatif'})${item.detail ? ` — ${item.detail}` : ''}`).join('\n')
	: 'Aucun champ de formulaire ou argument supplémentaire n’est défini.';

module.exports = { MODULES, commandHelp, getCommandEntries, getAccess, formatFields };