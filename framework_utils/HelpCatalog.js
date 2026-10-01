const config = require('../config.json');
const { hasPersonnelPermission } = require('./PersonnelDiscord.js');
const Events = require('./Events.js');

const MODULES = [
	{ id: 'evenements', label: 'Événements', emoji: '📅', description: 'Création et publication des événements de sécurité.' },
	{ id: 'personnel', label: 'Personnel', emoji: '👥', description: 'Profils, hiérarchie, activité, promotions et sanctions du personnel.' },
	{ id: 'rapports', label: 'Rapports', emoji: '📝', description: 'Soumission des rapports et publication de leur panneau.' },
	{ id: 'recrutement', label: 'Recrutement', emoji: '📋', description: 'Candidatures au département de la sécurité et panneau associé.' },
	{ id: 'urgences', label: 'Urgences', emoji: '🚨', description: 'Publication du panneau et transmission des appels d’urgence.' },
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
const personnelAccess = (group) => (interaction) => ({
	allowed: hasPersonnelPermission(interaction, group),
	requirement: group === 'staff'
		? 'Posséder un rôle configuré dans personnelStaffRoleIds.'
		: 'Posséder un rôle configuré dans personnelAdminRoleIds.',
});

const staff = personnelAccess('staff');
const admin = personnelAccess('admin');
const rapportRoleId = '1545770783387684924';
const panelRoleId = '1542836944457703454';

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
				const roles = type.creationRoleIds?.length ? type.creationRoleIds : config.eventCreationRoleIds || [];
				return {
					allowed: available,
					requirement: `Administrateur Discord ou un rôle de création configuré pour ce type${roles.length ? ` (ID : ${roles.join(', ')})` : ' (aucun rôle de création configuré)'}.`,
				};
			},
			fields: (type.fields || []).map((item) => field(item.label, item.type, item.required !== false, item.choices ? `Choix : ${item.choices.map((choice) => typeof choice === 'string' ? choice : choice.label).join(', ')}` : '')),
		})),
	},
	'evenement-panel': {
		module: 'evenements',
		description: 'Publie le panneau qui permet d’ouvrir le sélecteur de types d’événements.',
		entries: [{ key: 'main', label: '/evenement-panel', description: 'Envoie le panneau dans le salon configuré pour les événements.', access: commandAccess('evenement-panel', 'Posséder la permission Administrateur Discord.') }],
	},
	'activite': {
		module: 'personnel',
		description: 'Consulte l’activité d’un membre ou un classement; les sous-commandes de correction permettent d’ajouter ou de retirer des points ou des heures.',
		entries: [
			...['points-ajouter', 'points-retirer', 'heures-ajouter', 'heures-retirer'].map((key) => ({ key, label: `/activite ${key}`, description: `${key.endsWith('ajouter') ? 'Ajoute' : 'Retire'} manuellement des ${key.startsWith('heures') ? 'heures' : 'points'} d’activité après confirmation.`, access: staff, fields: [field('Membre concerné', 'membre'), field('Montant', 'nombre', true, 'Valeur minimale : 0,01.'), field('Raison')] })),
			{ key: 'voir', label: '/activite voir', description: 'Affiche les points et les heures du membre choisi; sans sélection, affiche votre propre activité.', access: openAccess(), fields: [field('Membre concerné', 'membre', false)] },
			{ key: 'top', label: '/activite top', description: 'Affiche un classement d’activité selon le type et la période choisis.', access: openAccess(), fields: [field('Type d’activité', 'choix', true, 'Points ou heures.'), field('Période', 'choix', true, 'Depuis le début, 7 derniers jours ou 30 derniers jours.')] },
		],
	},
	'hierarchie': {
		module: 'personnel', description: 'Affiche les échelles de rangs et, pour les rangs limités, leur effectif courant.',
		entries: [{ key: 'main', label: '/hierarchie', description: 'Parcourt les branches et divisions pour afficher leurs rangs du plus bas au plus élevé.', access: openAccess() }],
	},
	'personnel': {
		module: 'personnel', description: 'Consulte ou administre les profils du personnel : création, informations, affectations, rang et suppression.',
		entries: [
			{ key: 'creer', label: '/personnel creer', description: 'Crée un profil avec branche, division éventuelle et rang de départ.', access: admin, fields: [field('Membre concerné', 'membre'), field('Prénom'), field('Nom'), field('Branche', 'choix'), field('Division (BG uniquement)', 'choix', false), field('Rang de branche ou division', 'texte', false, 'ID facultatif; choix de rang complété par autocomplétion slash.')] },
			{ key: 'profil', label: '/personnel profil', description: 'Affiche le profil, les rangs, l’activité, les sanctions actives et les fonctions manuelles du membre choisi; sans sélection, affiche votre profil.', access: openAccess(), fields: [field('Membre concerné', 'membre', false)] },
			{ key: 'modifier', label: '/personnel modifier', description: 'Met à jour les informations ou le statut du profil; les champs laissés vides sont ignorés.', access: admin, fields: [field('Membre concerné', 'membre'), field('Nouveau prénom', 'texte', false), field('Nouveau nom', 'texte', false), field('Statut du profil', 'choix', false, 'Actif ou inactif.')] },
			{ key: 'division', label: '/personnel division', description: 'Affecte le membre à une division BG ou lui retire sa division, puis synchronise les rôles configurés.', access: admin, fields: [field('Membre concerné', 'membre'), field('Division', 'choix', true, 'ULB, URR, UPR, UMS ou aucune.'), field('Rang de division', 'texte', false, 'ID facultatif; rangs proposés par autocomplétion slash.')] },
			{ key: 'branche', label: '/personnel branche', description: 'Change la branche du membre et définit son rang de départ; la division peut être précisée pour la BG.', access: admin, fields: [field('Membre concerné', 'membre'), field('Nouvelle branche', 'choix'), field('Division (BG uniquement)', 'choix', false), field('Rang de départ', 'texte', false, 'ID facultatif; rangs proposés par autocomplétion slash.')] },
			{ key: 'rang', label: '/personnel rang', description: 'Définit un rang choisi dans l’échelle correspondant au profil du membre.', access: admin, fields: [field('Membre concerné', 'membre'), field('Nouveau rang', 'choix', true, 'Les choix dépendent de l’échelle du profil.')] },
			{ key: 'supprimer', label: '/personnel supprimer', description: 'Après confirmation, supprime le profil ainsi que ses données d’activité et ses sanctions.', access: admin, fields: [field('Membre concerné', 'membre')] },
		],
	},
	'promotion': {
		module: 'personnel', description: 'Prépare une vague de promotions, présente un aperçu des changements possibles, puis applique les promotions confirmées et publie un récapitulatif.',
		entries: [{ key: 'vague', label: '/promotion vague', description: 'Sélectionne jusqu’à 25 membres via un sélecteur, permet de consulter l’aperçu, puis demande confirmation avant application.', access: staff, fields: [field('Membres', 'sélecteur de membres', true, 'Sélection interactive, jusqu’à 25 personnes.'), field('Note', 'option slash', false, 'Texte facultatif, 500 caractères maximum.')] }],
	},
	'retrogradation': {
		module: 'personnel', description: 'Rétrograde un membre d’un rang dans son échelle, synchronise ses rôles et enregistre le motif dans les logs.',
		entries: [{ key: 'main', label: '/retrogradation', description: 'Demande le membre concerné et le motif avant d’appliquer la rétrogradation.', access: staff, fields: [field('Membre concerné', 'membre'), field('Motif de la rétrogradation')] }],
	},
	'sanction': {
		module: 'personnel', description: 'Enregistre une sanction, consulte l’historique avec pagination ou révoque une sanction active.',
		entries: [
			{ key: 'ajouter', label: '/sanction ajouter', description: 'Ajoute une sanction du type sélectionné au dossier du membre.', access: staff, fields: [field('Membre concerné', 'membre'), field('Type de sanction', 'choix', true, `Choix configurés : ${(config.sanctionTypes || []).join(', ') || 'aucun'}.`), field('Motif de la sanction')] },
			{ key: 'historique', label: '/sanction historique', description: 'Affiche l’historique du membre par pages; l’inclusion des sanctions révoquées est facultative. Sans membre choisi, consulte votre historique.', access: staff, fields: [field('Membre concerné', 'membre', false), field('Inclure les sanctions révoquées', 'oui/non', false)] },
			{ key: 'revoquer', label: '/sanction revoquer', description: 'Révoque la sanction active correspondant au numéro de dossier après saisie du motif.', access: staff, fields: [field('Numéro du dossier', 'nombre', true, 'Valeur minimale : 1.'), field('Motif de révocation')] },
		],
	},
	'rapport': {
		module: 'rapports', description: 'Ouvre un formulaire de choix du type de rapport, puis le formulaire correspondant. Le rapport envoyé est publié dans le forum configuré.',
		entries: [
			{ key: 'incident', label: '/rapport · Incident', description: 'Soumet un rapport d’incident avec sa date, son lieu, le personnel présent et le détail des faits.', access: commandAccess('rapport', `Posséder le rôle Sécurité requis par la commande (ID : ${rapportRoleId}).`), fields: [field('Type de rapport', 'choix', true, 'Incident.'), field('Date de l’incident', 'date'), field('Lieu', 'texte'), field('Personnel notable présent lors de l’incident', 'texte long'), field('Détail complet de l’incident', 'texte long')] },
			{ key: 'prise-service', label: '/rapport · Prise de service', description: 'Soumet un rapport de prise de service avec les personnes présentes, sa durée et ses observations facultatives.', access: commandAccess('rapport', `Posséder le rôle Sécurité requis par la commande (ID : ${rapportRoleId}).`), fields: [field('Type de rapport', 'choix', true, 'Prise de service.'), field('Date de la prise de service', 'date'), field('Personnel présent lors de la prise de service', 'texte long'), field('Incident éventuel', 'texte long', false), field('Durée de la prise de service', 'texte'), field('Activités suspectes', 'texte long', false)] },
			{ key: 'experience', label: '/rapport · Expérience', description: 'Soumet un rapport d’expérience avec l’anomalie, les personnes présentes, les effectifs et les observations.', access: commandAccess('rapport', `Posséder le rôle Sécurité requis par la commande (ID : ${rapportRoleId}).`), fields: [field('Type de rapport', 'choix', true, 'Expérience.'), field('Anomalie', 'texte'), field('Membre du personnel scientifique présent', 'texte'), field('Nombre de Classe-D', 'nombre'), field('Membre du personnel de sécurité présent', 'texte'), field('Date de l’expérience', 'date'), field('Observations', 'texte long')] },
			{ key: 'personnel', label: '/rapport · Personnel', description: 'Soumet un rapport concernant un membre du personnel avec l’article concerné et les détails de l’incident.', access: commandAccess('rapport', `Posséder le rôle Sécurité requis par la commande (ID : ${rapportRoleId}).`), fields: [field('Type de rapport', 'choix', true, 'Concernant le personnel.'), field('Agent concerné', 'membre'), field('Article du règlement enfreint', 'texte long'), field('Détails de l’incident', 'texte long')] },
		],
	},
	'rapport-panel': {
		module: 'rapports', description: 'Publie le panneau qui ouvre le formulaire de création de rapports.',
		entries: [{ key: 'main', label: '/rapport-panel', description: 'Envoie le panneau dans le salon configuré pour les rapports.', access: commandAccess('rapport-panel', `Posséder le rôle requis pour publier le panneau de rapports (ID : ${panelRoleId}).`) }],
	},
	'recrutement': {
		module: 'recrutement', description: 'Ouvre le formulaire de candidature. Les réponses sont transmises à l’équipe dans un salon de candidature dédié.',
		entries: [{ key: 'main', label: '/recrutement', description: 'Demande des réponses générales et des connaissances sur la Fondation SCP.', access: openAccess(), fields: [field('Questions générales', 'texte', true, '2 questions sont sélectionnées au hasard parmi 7.'), field('Questions à choix multiples', 'QCM', true, '3 questions sont sélectionnées au hasard parmi 7; chaque question propose 3 réponses.')] }],
	},
	'recrutement-panel': {
		module: 'recrutement', description: 'Publie le panneau permettant aux utilisateurs d’ouvrir le formulaire de recrutement.',
		entries: [{ key: 'main', label: '/recrutement-panel', description: 'Envoie le panneau dans le salon de recrutement configuré.', access: commandAccess('recrutement-panel', `Posséder le rôle IRA - 8 : Direction (ID : ${panelRoleId}).`) }],
	},
	'urgence-panel': {
		module: 'urgences', description: 'Publie le panneau d’appels d’urgence. Le panneau requiert un rôle pour être publié; son utilisation vérifie séparément le rôle configuré pour les appels. Les champs dépendent du type choisi.',
		entries: [{
			key: 'main', label: '/urgence-panel', description: 'Envoie le panneau configuré. Les boutons proposent les types d’urgence et « Autre ».',
			access: commandAccess('urgence-panel', `Posséder le rôle requis pour publier le panneau d’urgence (ID : ${panelRoleId}).`),
			additionalAccess: [{ label: 'Utiliser les boutons d’appel', access: commandMethodAccess('urgence-panel', 'canUseCalls', `Posséder le rôle configuré PermissionAppelSecuRoleId (ID : ${config.PermissionAppelSecuRoleId || 'non configuré'}).`) }],
			fields: [
				field('Lieu', 'texte', true, 'Demandé pour chaque appel.'),
				...Object.entries(config.UrgenceTypes || {}).map(([, type]) => field(`Formulaire « ${type.label} »`, 'modal', true, type.fields?.length ? `Champs supplémentaires facultatifs : ${type.fields.map((item) => item.label).join(', ')}.` : 'Aucun champ supplémentaire configuré.')),
				field('Divisions concernées (Autre)', 'sélection multiple', true, 'Sélectionnez au moins une division avant de poursuivre.'),
				field('Description courte de l’urgence « Autre »', 'texte long', true, 'Demandée après la sélection d’au moins une division; maximum 1 000 caractères.'),
			],
		}],
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