const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	LabelBuilder,
	ModalBuilder,
	MessageFlags,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
	UserSelectMenuBuilder,
} = require('discord.js');
const Personnel = require('./Personnel.js');
const config = require('../config.json');
const { getLadder, getRank } = require('../data/hierarchy.js');
const {
	hasPersonnelPermission,
	replyError,
	formatDuration,
	syncPersonnelRoles,
	getPersonnelNickname,
} = require('./PersonnelDiscord.js');

const COLORS = { home: 0x247ba0, characters: 0x23856d, activity: 0xd08722, sanctions: 0xc34c58, hierarchy: 0x5276a5, error: 0xc0392b };
const BRANCHES = [
	{ label: 'Équipe d’intervention tactique (EIT)', value: 'EIT' },
	{ label: 'Branche générale (BG)', value: 'BG' },
	{ label: 'Commandement', value: 'COMMANDEMENT' },
	{ label: 'Direction', value: 'DIRECTION' },
	{ label: 'Commission de sûreté', value: 'COMMISSION' },
];
const DIVISIONS = ['ULB', 'URR', 'UPR', 'UMS'];
const SANCTION_TYPES = (config.sanctionTypes || []).slice(0, 25).map((value) => ({ label: value, value }));
const SECURITY_ROLE_ID = config.UrgenceDivisions?.brancheGen?.roleId;
const DIRECTORY_PAGE_SIZE = 10;
const SCALES = [
	{ label: 'EIT', branch: 'EIT' },
	{ label: 'Branche générale', branch: 'BG' },
	...DIVISIONS.map((division) => ({ label: division, branch: 'BG', division })),
	{ label: 'Commandement', branch: 'COMMANDEMENT' },
	{ label: 'Direction', branch: 'DIRECTION' },
	{ label: 'Commission de sûreté', branch: 'COMMISSION' },
];
const isAdmin = (interaction) => hasPersonnelPermission(interaction, 'admin');
const canViewDossiers = (interaction) => hasPersonnelPermission(interaction, 'dossier');
const canManageActivity = (interaction) => hasPersonnelPermission(interaction, 'activite');
const canManageSanctions = (interaction) => hasPersonnelPermission(interaction, 'sanctions');
const canPromote = (interaction) => hasPersonnelPermission(interaction, 'promotion');
const MODAL_ACTIONS = new Set([
	'create-identity', 'edit-identity',
	'activity-add-points', 'activity-remove-points', 'activity-add-hours', 'activity-remove-hours',
	'sanction-add-confirm', 'sanction-revoke-open', 'promotion-note', 'demotion-reason',
]);
const rankLabel = (rankId) => getRank(rankId)?.label || rankId || 'Non renseigné';
const branchLabel = (branch) => BRANCHES.find(({ value }) => value === branch)?.label || branch;
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) =>
	new ButtonBuilder().setCustomId(`personnel:${id}`).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...components) => new ActionRowBuilder().addComponents(components);
const viewOptions = [
	{ label: 'Personnages', value: 'characters', description: 'Consulter son dossier ou gérer les personnages autorisés.' },
	{ label: 'Activité', value: 'activity', description: 'Voir les classements et corriger les points/heures selon son rôle.' },
	{ label: 'Sanctions', value: 'sanctions', description: 'Consulter ses dossiers ou gérer les sanctions autorisées.' },
	{ label: 'Hiérarchie', value: 'hierarchy', description: 'Parcourir les rangs, promouvoir par vague ou rétrograder.' },
];
const HELP = {
	characters: 'Chaque membre peut ouvrir son propre dossier. Le personnel autorisé peut consulter ou lister les personnages et repérer les membres portant le rôle Sécurité sans profil enregistré. La création, la modification et la suppression restent réservées aux administrateurs du personnel.',
	activity: 'Le classement agrège les points ou les heures depuis le début, sur 7 jours ou sur 30 jours. Votre activité personnelle est consultable avec un profil. Le personnel autorisé peut ajouter ou retirer des points/heures; chaque correction exige un motif et est journalisée.',
	sanctions: 'Un membre peut consulter ses propres sanctions. Le personnel autorisé peut consulter le dossier d’un autre membre, ajouter une sanction avec un motif ou révoquer un dossier actif avec un motif de révocation. Les historiques sont paginés.',
	hierarchy: 'Les échelles affichent les rangs du plus bas au plus élevé, l’IRA et les limites d’effectif configurées. Une vague de promotions vérifie les rangs suivants et leurs places disponibles avant confirmation. La rétrogradation applique le rang immédiatement inférieur.',
};

const makeSelect = (id, placeholder, options, min = 1, max = 1) => new StringSelectMenuBuilder()
	.setCustomId(`personnel:${id}`).setPlaceholder(placeholder).setMinValues(min).setMaxValues(max).addOptions(options);
const memberSelect = (id, placeholder, max = 1) => new UserSelectMenuBuilder()
	.setCustomId(`personnel:${id}`).setPlaceholder(placeholder).setMinValues(1).setMaxValues(max);

const dashboardEmbed = (state, title, description, fields = [], color = COLORS[state.view] || COLORS.home) => {
	const embed = new EmbedBuilder().setColor(state.error ? COLORS.error : color).setTitle(title).setDescription(description);
	if (fields.length) embed.addFields(fields);
	if (state.notice) embed.addFields({ name: state.error ? '⚠️ Opération impossible' : 'Information', value: state.notice.slice(0, 1024) });
	embed.setFooter({ text: `Dashboard du personnel · ${state.userTag}` });
	return embed;
};

const navigationRows = (state, { back = true, home = true } = {}) => [row(
	button('help', '❔ Aide', ButtonStyle.Secondary),
	...(back && state.page !== 'home' ? [button('back', '⬅ Retour')] : []),
	...(home && state.page !== 'home' ? [button('home', '⌂ Menu des vues', ButtonStyle.Primary)] : []),
	...(state.page === 'home' ? [button('close', '✕ Fermer')] : []),
)];

const pageViewRow = (state) => row(makeSelect('view', 'Choisir une vue · chaque option est décrite', viewOptions.map((option) => ({ ...option, default: option.value === state.view }))));

const profileEmbed = async (interaction, discordId) => {
	const profile = await Personnel.getProfile(discordId);
	if (!profile) throw new Error('Aucun personnage n’existe pour ce membre.');
	const sanctions = await Personnel.getActiveSanctionCount(discordId);
	return new EmbedBuilder()
		.setColor(profile.status === 'active' ? 0x23856d : 0xd08722)
		.setTitle(`👤 ${profile.firstName} ${profile.lastName}`)
		.setDescription(`<@${discordId}> · ${profile.status === 'active' ? '🟢 Actif' : '🟡 Inactif'}`)
		.addFields(
			{ name: '🏷️ Branche', value: `${branchLabel(profile.branch)}\n${rankLabel(profile.branchRankId)}`, inline: true },
			{ name: '🛡️ Division', value: profile.division ? `${profile.division}\n${rankLabel(profile.divisionRankId)}` : 'Aucune', inline: true },
			{ name: '🎖️ IRA', value: String(profile.ira), inline: true },
			{ name: '📈 Activité', value: `${profile.activityPoints} points\n${formatDuration(profile.activityMinutes)}`, inline: true },
			{ name: '⚖️ Sanctions actives', value: String(sanctions), inline: true },
		);
};

const hierarchyEmbed = async (scaleIndex) => {
	const scale = SCALES[scaleIndex];
	const ranks = getLadder(scale.branch, scale.division);
	const counts = await Personnel.getRankCounts(scale.branch, scale.division || null);
	const lines = ranks.map((rank, index) => {
		const limit = Personnel.getRankLimit(scale.branch, scale.division || null, rank.id);
		const ira = rank.ira == null ? 'Sans IRA' : `IRA ${rank.ira}`;
		return `**${index + 1}. ${rank.label}** · ${ira}${limit == null ? '' : ` · Effectif ${counts[rank.id] || 0}/${limit}`}`;
	});
	return dashboardEmbed({ view: 'hierarchy', userTag: '' }, `🏛️ Hiérarchie · ${scale.label}`, lines.join('\n') || 'Aucun rang configuré.')
		.setFooter({ text: `Échelle ${scaleIndex + 1}/${SCALES.length} · Du rang le plus bas au plus élevé` });
};

const buildHistory = async (discordId, includeRevoked, page, userTag) => {
	const result = await Personnel.getSanctions(discordId, { includeRevoked, limit: 5, page });
	const embed = dashboardEmbed({ view: 'sanctions', userTag }, `⚖️ Sanctions · ${userTag}`, result.rows.length ? '\u200b' : 'Aucun dossier ne correspond à ces critères.')
		.setFooter({ text: `Page ${page}/${result.totalPages} · ${result.totalRows} dossier(s)` });
	for (const sanction of result.rows) {
		embed.addFields({
			name: `Dossier #${sanction.case_number} · ${sanction.type}${sanction.revoked_at ? ' · Révoquée' : ''}`,
			value: `**Motif :** ${sanction.reason}\nÉmise par <@${sanction.issuer_id}> · <t:${Math.floor(new Date(sanction.created_at).getTime() / 1000)}:f>${sanction.revoked_at ? `\nRévoquée par <@${sanction.revoked_by}> : ${sanction.revoke_reason}` : ''}`.slice(0, 1024),
		});
	}
	return { embed, result };
};

const previewPromotions = async (discordIds) => {
	const entries = [];
	const countsByScale = new Map();
	const reserved = new Map();
	for (const discordId of discordIds) {
		const profile = await Personnel.getProfile(discordId);
		let result = await Personnel.previewPromotion(discordId);
		if (profile && result.ok) {
			const targetRankId = profile.division ? result.to.divisionRankId : result.to.branchRankId;
			const limit = Personnel.getRankLimit(profile.branch, profile.division, targetRankId);
			if (limit != null) {
				const scale = `${profile.branch}:${profile.division || ''}`;
				if (!countsByScale.has(scale)) countsByScale.set(scale, await Personnel.getRankCounts(profile.branch, profile.division));
				const slot = `${scale}:${targetRankId}`;
				const occupancy = (countsByScale.get(scale)[targetRankId] || 0) + (reserved.get(slot) || 0);
				if (occupancy >= limit) result = { ok: false, reason: `Le rang « ${result.to.label} » est complet (${occupancy}/${limit}).` };
				else reserved.set(slot, (reserved.get(slot) || 0) + 1);
			}
		}
		entries.push({ discordId, profile, result, label: profile ? `${profile.firstName} ${profile.lastName}` : discordId });
	}
	const lines = entries.map(({ discordId, label, result }) => result.ok
		? `• <@${discordId}> · **${label}** : ${result.from.label} → **${result.to.label}**${result.iraChanged ? ` (IRA ${result.from.ira} → ${result.to.ira})` : ''}`
		: `• <@${discordId}> · **${label}** : non promu, ${result.reason}`);
	return { entries, embed: dashboardEmbed({ view: 'hierarchy', userTag: '' }, '✨ Aperçu de la vague', lines.join('\n').slice(0, 4000) || 'Aucun membre sélectionné.') };
};

const publishPromotions = async (interaction, result, note) => {
	for (const change of result.succès) {
		await syncPersonnelRoles(interaction, change.discordId,
			{ branch: change.branch, branchRankId: change.from.branchRankId, division: change.division, divisionRankId: change.from.divisionRankId },
			{ branch: change.branch, branchRankId: change.to.branchRankId, division: change.division, divisionRankId: change.to.divisionRankId });
	}
	const channel = await interaction.client.channels.fetch(config.promotionChannelId).catch(async (error) => {
		await interaction.client.log('PERSONNEL DASHBOARD', 'ERROR', `Récupération du salon de promotions ${config.promotionChannelId} impossible; auteur ${interaction.user.id}: ${error?.stack || error}`);
		return null;
	});
	if (!channel?.isTextBased()) throw new Error('Les promotions sont appliquées, mais le salon public de promotion est absent ou invalide.');
	const lines = [
		...result.succès.map(({ discordId, from, to, iraChanged }) => `• <@${discordId}> : **${from.label} → ${to.label}**${iraChanged ? ` (IRA ${from.ira} → ${to.ira})` : ''}`),
		...result.échecs.map(({ discordId, reason }) => `• <@${discordId}> : échec (${reason})`),
	];
	await channel.send({
		embeds: [new EmbedBuilder().setColor(result.échecs.length ? 0xd08722 : 0x23856d).setTitle('✨ Vague de promotions')
			.setDescription(`${lines.join('\n').slice(0, 4000) || 'Aucun changement.'}${note ? `\n\n**Note :** ${note.slice(0, 500)}` : ''}`)
			.setFooter({ text: `Appliquée par ${interaction.user.tag}` }).setTimestamp()],
		allowedMentions: { parse: [], users: result.succès.map(({ discordId }) => discordId) },
	});
	if (config.promotionDirectMessages) {
		for (const change of result.succès) {
			const user = await interaction.client.users.fetch(change.discordId).catch(async (error) => {
				await interaction.client.log('PERSONNEL DASHBOARD', 'WARN', `Récupération du membre ${change.discordId} pour le MP de promotion impossible: ${error?.stack || error}`);
				return null;
			});
			await user?.send({ embeds: [new EmbedBuilder().setColor(0x23856d).setTitle('🎉 Promotion').setDescription(`Vous passez de **${change.from.label}** à **${change.to.label}**.`)] }).catch(async (error) => {
				await interaction.client.log('PERSONNEL DASHBOARD', 'WARN', `MP de promotion impossible pour ${change.discordId}: ${error?.stack || error}`);
			});
		}
	}
};

const renderDashboard = (state) => {
	const components = [];
	if (state.page !== 'help') components.push(pageViewRow(state));
	let embed;
	const backRows = navigationRows(state);

	if (state.page === 'home') {
		embed = dashboardEmbed(state, '🧭 Dashboard du personnel', 'Sélectionnez une vue. Chaque option résume son contenu; **❔ Aide** détaille les règles d’accès et les opérations disponibles.');
		components.push(row(button('help', '❔ Aide'), button('close', '✕ Fermer')));
	}
	else if (state.page === 'help') {
		embed = dashboardEmbed(state, `❔ Aide · ${viewOptions.find(({ value }) => value === state.view)?.label || 'Dashboard'}`, HELP[state.helpView || state.view] || HELP[state.view]);
		components.push(row(button('help', '❔ Aide', ButtonStyle.Secondary, true), button('back', '⬅ Retour à la vue')));
	}
	else if (state.page === 'characters') {
		embed = dashboardEmbed(state, '👥 Personnages', 'Consultez votre dossier, recherchez un profil, ou listez les membres Sécurité qui ne sont pas encore recensés.');
		const actions = [];
		if (state.hasOwnProfile) actions.push(button('self-profile', '👤 Info personnel', ButtonStyle.Primary));
		if (canViewDossiers(state.interaction)) actions.push(button('select-profile', '🔎 Consulter un membre'));
		if (canViewDossiers(state.interaction)) actions.push(button('list-profiles', '📚 Tous les personnages'));
		if (canViewDossiers(state.interaction)) actions.push(button('list-security-unregistered', '🛡️ Sécurité sans profil'));
		if (isAdmin(state.interaction)) actions.push(button('nicknames-update', '🏷️ Mettre à jour les pseudos'));
		if (isAdmin(state.interaction)) actions.push(button('create-profile', '➕ Créer', ButtonStyle.Success), button('edit-profile', '✏️ Modifier', ButtonStyle.Primary));
		if (actions.length) components.push(row(...actions.slice(0, 5)));
		if (actions.length > 5) components.push(row(...actions.slice(5, 10)));
		components.push(...backRows);
	}
	else if (state.page === 'profile') {
		embed = state.profileEmbed ? new EmbedBuilder(state.profileEmbed.toJSON()) : dashboardEmbed(state, '👤 Personnage', 'Aucun dossier chargé.');
		if (state.notice) embed.addFields({ name: state.error ? '⚠️ Opération impossible' : '✅ Mise à jour', value: state.notice.slice(0, 1024) });
		const actions = [];
		if (isAdmin(state.interaction)) actions.push(button('edit-profile', '✏️ Modifier', ButtonStyle.Primary), button('delete-profile', '🗑️ Supprimer', ButtonStyle.Danger));
		if (actions.length) components.push(row(...actions));
		components.push(...backRows);
	}
	else if (state.page === 'select-profile') {
		embed = dashboardEmbed(state, '🔎 Consulter un personnage', 'Choisissez un membre pour afficher son dossier. Cette consultation est réservée au personnel autorisé.');
		components.push(row(memberSelect('profile-member', 'Membre à consulter')));
		components.push(...backRows);
	}
	else if (state.page === 'create-profile') {
		const draft = state.draft;
		embed = dashboardEmbed(state, '➕ Créer un personnage', 'Complétez les champs ci-dessous, puis confirmez la création.', [
			{ name: 'Membre', value: draft.discordId ? `<@${draft.discordId}>` : 'À sélectionner', inline: true },
			{ name: 'Identité', value: draft.firstName || draft.lastName ? `${draft.firstName || 'Prénom ?'} ${draft.lastName || 'Nom ?'}` : 'À renseigner', inline: true },
			{ name: 'Branche / division', value: draft.branch ? `${branchLabel(draft.branch)}${draft.division ? ` · ${draft.division}` : ''}` : 'À sélectionner', inline: true },
			{ name: 'Rang', value: draft.rankId ? rankLabel(draft.rankId) : 'Rang initial par défaut', inline: true },
		]);
		components.push(row(memberSelect('create-member', 'Choisir le membre')));
		components.push(row(button('create-identity', '🪪 Identité', ButtonStyle.Secondary, !draft.discordId), button('create-branch', '🏷️ Branche', ButtonStyle.Secondary, !draft.discordId), button('create-division', '🛡️ Division', ButtonStyle.Secondary, !draft.discordId || draft.branch !== 'BG'), button('create-rank', '🎖️ Rang', ButtonStyle.Secondary, !draft.branch)));
		components.push(row(button('create-confirm', '✅ Créer le personnage', ButtonStyle.Success, !draft.discordId || !draft.firstName || !draft.lastName || !draft.branch), button('create-cancel', 'Annuler')));
		components.push(...backRows);
	}
	else if (state.page === 'choice') {
		embed = dashboardEmbed(state, `🔽 ${state.choice?.title || 'Faire un choix'}`, 'Sélectionnez une option. Le dashboard se mettra à jour sans ouvrir un nouveau message.');
		if (state.choice?.options?.length) components.push(row(makeSelect('choice', state.choice.title, state.choice.options)));
		components.push(...backRows);
	}
	else if (state.page === 'edit-profile') {
		embed = state.profileEmbed || dashboardEmbed(state, '✏️ Modifier un personnage', 'Choisissez un membre à modifier.');
		components.push(row(memberSelect('edit-member', 'Choisir un personnage')));
		if (state.targetId) {
			components.push(row(button('edit-identity', '🪪 Identité'), button('edit-status', '🔄 Statut'), button('edit-branch', '🏷️ Branche'), button('edit-division', '🛡️ Division', ButtonStyle.Secondary, state.profile?.branch !== 'BG'), button('edit-rank', '🎖️ Rang')));
			components.push(row(button('edit-sanction', '⚖️ Ajouter une sanction'), button('delete-profile', '🗑️ Supprimer', ButtonStyle.Danger)));
		}
		components.push(...backRows);
	}
	else if (state.page === 'confirm-delete') {
		embed = dashboardEmbed(state, '⚠️ Supprimer le personnage ?', 'La suppression effacera aussi ses données d’activité et son historique de sanctions. Cette action est irréversible.', [{ name: 'Personnage', value: state.profile ? `${state.profile.firstName} ${state.profile.lastName} · <@${state.targetId}>` : `<@${state.targetId}>` }], COLORS.error);
		components.push(row(button('delete-confirm', '🗑️ Confirmer la suppression', ButtonStyle.Danger), button('back', 'Annuler')));
	}
	else if (state.page === 'profile-directory' || state.page === 'security-directory') {
		const isProfileDirectory = state.page === 'profile-directory';
		embed = state.directoryEmbed || dashboardEmbed(state,
			isProfileDirectory ? '📚 Tous les personnages' : '🛡️ Sécurité sans profil',
			'Aucune liste chargée.',
		);
		components.push(row(
			button('directory-prev', '◀ Précédent', ButtonStyle.Secondary, state.directoryPage <= 1),
			button('directory-next', 'Suivant ▶', ButtonStyle.Secondary, state.directoryPage >= state.directoryPages),
		));
		components.push(...backRows);
	}
	else if (state.page === 'activity') {
		embed = state.leaderboardEmbed || dashboardEmbed(state, '📈 Activité', 'Classement du personnel actif. Choisissez le type et la période; les corrections sont réservées au staff.');
		components.push(row(makeSelect('activity-type', 'Type de classement', [{ label: 'Points', value: 'points', default: state.activityType === 'points' }, { label: 'Heures', value: 'hours', default: state.activityType === 'hours' }])));
		components.push(row(makeSelect('activity-period', 'Période', [{ label: 'Depuis le début', value: 'all', default: state.activityPeriod === 'all' }, { label: '7 derniers jours', value: 'week', default: state.activityPeriod === 'week' }, { label: '30 derniers jours', value: 'month', default: state.activityPeriod === 'month' }])));
		components.push(row(button('activity-prev', '◀ Précédent', ButtonStyle.Secondary, state.activityPage <= 1), button('activity-next', 'Suivant ▶', ButtonStyle.Secondary, state.activityPage >= state.activityPages), ...(state.hasOwnProfile ? [button('activity-self', '👤 Mon activité')] : []), ...(canManageActivity(state.interaction) ? [button('activity-correct', '✏️ Corriger')] : [])));
		components.push(...backRows);
	}
	else if (state.page === 'activity-target') {
		embed = dashboardEmbed(state, '📈 Choisir un membre', 'Sélectionnez le membre dont l’activité sera corrigée. Une justification sera demandée.');
		components.push(row(memberSelect('activity-member', 'Membre à corriger')));
		components.push(...backRows);
	}
	else if (state.page === 'activity-edit') {
		embed = dashboardEmbed(state, '✏️ Corriger l’activité', `Choisissez le type de correction pour <@${state.targetId}>. Chaque opération est journalisée avec son motif.`);
		components.push(row(button('activity-add-points', '➕ Points', ButtonStyle.Success), button('activity-remove-points', '➖ Points', ButtonStyle.Danger), button('activity-add-hours', '➕ Heures', ButtonStyle.Success), button('activity-remove-hours', '➖ Heures', ButtonStyle.Danger)));
		components.push(...backRows);
	}
	else if (state.page === 'activity-self') {
		embed = state.activitySelfEmbed || dashboardEmbed(state, '📈 Mon activité', 'Aucune activité disponible.');
		components.push(...backRows);
	}
	else if (state.page === 'sanctions') {
		embed = dashboardEmbed(state, '⚖️ Sanctions', 'Consultez vos propres dossiers. La consultation d’autres membres et l’ajout/révocation sont réservés au personnel autorisé.');
		const actions = [];
		if (state.hasOwnProfile) actions.push(button('sanction-self', '👤 Mes sanctions', ButtonStyle.Primary));
		if (canViewDossiers(state.interaction)) actions.push(button('sanction-other', '🔎 Voir un membre'));
		if (canManageSanctions(state.interaction)) actions.push(button('sanction-add', '➕ Ajouter', ButtonStyle.Danger), button('sanction-revoke', '↩ Révoquer', ButtonStyle.Secondary));
		if (actions.length) components.push(row(...actions));
		components.push(...backRows);
	}
	else if (state.page === 'sanction-target') {
		embed = dashboardEmbed(state, '⚖️ Historique des sanctions', 'Sélectionnez le membre dont vous voulez consulter le dossier.');
		components.push(row(memberSelect('sanction-member', 'Choisir le membre')));
		components.push(...backRows);
	}
	else if (state.page === 'sanction-history') {
		embed = state.historyEmbed || dashboardEmbed(state, '⚖️ Historique des sanctions', 'Aucun historique chargé.');
		components.push(row(button('history-prev', '◀ Précédent', ButtonStyle.Secondary, state.historyPage <= 1), button('history-next', 'Suivant ▶', ButtonStyle.Secondary, state.historyPage >= state.historyPages), button('history-toggle', state.includeRevoked ? 'Masquer révoquées' : 'Inclure révoquées')));
		components.push(...backRows);
	}
	else if (state.page === 'sanction-add') {
		embed = dashboardEmbed(state, '➕ Ajouter une sanction', 'Choisissez un membre, un type et indiquez le motif avant confirmation.');
		if (!state.targetId) {components.push(row(memberSelect('sanction-add-member', 'Membre concerné')));}
		else {
			components.push(row(makeSelect('sanction-type', 'Type de sanction', SANCTION_TYPES)));
			if (state.sanctionType) components.push(row(button('sanction-add-confirm', '✍️ Saisir le motif et enregistrer', ButtonStyle.Danger)));
		}
		components.push(...backRows);
	}
	else if (state.page === 'sanction-revoke') {
		embed = dashboardEmbed(state, '↩ Révoquer une sanction', 'La révocation nécessite le numéro du dossier et un motif. Seuls les dossiers actifs peuvent être révoqués.');
		components.push(row(button('sanction-revoke-open', 'Saisir le dossier et le motif', ButtonStyle.Danger)));
		components.push(...backRows);
	}
	else if (state.page === 'hierarchy') {
		embed = state.hierarchyEmbed || dashboardEmbed(state, '🏛️ Hiérarchie', 'Choisissez une branche ou division pour parcourir ses rangs et effectifs.');
		components.push(row(makeSelect('hierarchy-scale', 'Choisir une échelle', SCALES.map((scale, index) => ({ label: scale.label, value: String(index), default: index === state.scaleIndex })))));
		if (canPromote(state.interaction)) components.push(row(button('promotion-open', '✨ Vague de promotions', ButtonStyle.Success), button('demotion-open', '↘ Rétrograder', ButtonStyle.Secondary)));
		components.push(...backRows);
	}
	else if (state.page === 'promotions') {
		embed = state.promotionEmbed || dashboardEmbed(state, '✨ Vague de promotions', `Sélectionnez jusqu’à 25 membres. ${state.promotionNote ? `Note : ${state.promotionNote}` : 'La note est facultative.'}`);
		components.push(row(memberSelect('promotion-members', 'Ajouter des membres à la vague', 25)));
		if (state.promotionIds.length) components.push(row(makeSelect('promotion-remove', 'Retirer des membres sélectionnés', state.promotionLabels.map(({ id, label }) => ({ label: label.slice(0, 100), value: id })), 1, Math.max(1, state.promotionLabels.length))));
		components.push(row(button('promotion-note', '📝 Note', ButtonStyle.Secondary), button('promotion-preview', '👁️ Aperçu', ButtonStyle.Primary, !state.promotionIds.length), button('promotion-cancel', 'Annuler'), ...(state.promotionPreview?.entries.some(({ result }) => result.ok) ? [button('promotion-review', 'Continuer', ButtonStyle.Success)] : [])));
		components.push(...backRows);
	}
	else if (state.page === 'promotion-confirm') {
		embed = state.promotionEmbed || dashboardEmbed(state, '✨ Confirmer la vague', 'Aucun aperçu disponible. Revenez à la préparation.');
		if (state.promotionNote) embed.addFields({ name: '📝 Note', value: state.promotionNote.slice(0, 1024) });
		embed.setDescription(`${embed.data.description || ''}\n\n⚠️ Seuls les membres marqués comme éligibles seront promus. Les profils seront revalidés au moment de l’application.`.slice(0, 4000));
		components.push(row(button('promotion-confirm', '✅ Appliquer la vague', ButtonStyle.Success), button('promotion-abort', 'Annuler la vague', ButtonStyle.Danger)));
		components.push(...backRows);
	}
	else if (state.page === 'demotion') {
		embed = dashboardEmbed(state, '↘ Rétrograder', state.targetId ? `Membre sélectionné : <@${state.targetId}>. La rétrogradation applique le rang immédiatement inférieur.` : 'Sélectionnez le membre à rétrograder.');
		if (!state.targetId) components.push(row(memberSelect('demotion-member', 'Membre à rétrograder')));
		else components.push(row(button('demotion-reason', '✍️ Motif et confirmation', ButtonStyle.Danger)));
		components.push(...backRows);
	}
	else {
		embed = dashboardEmbed(state, '✅ Opération terminée', state.notice || 'Votre demande a été traitée.');
		components.push(...backRows);
	}

	return { embeds: [embed], components };
};

const showModal = async (component, title, fields) => {
	const modal = new ModalBuilder().setCustomId(`personnel:modal:${component.id}`).setTitle(title.slice(0, 45));
	for (const field of fields) {
		const input = new TextInputBuilder().setCustomId(field.id).setStyle(field.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
			.setRequired(field.required !== false).setMaxLength(field.maxLength || (field.paragraph ? 1000 : 100));
		if (field.placeholder) input.setPlaceholder(field.placeholder);
		if (field.value) input.setValue(String(field.value).slice(0, field.maxLength || 100));
		const label = new LabelBuilder().setLabel(field.label).setTextInputComponent(input);
		modal.addComponents(label);
	}
	await component.showModal(modal);
	const submitted = await component.awaitModalSubmit({
		time: 3 * 60_000,
		filter: (entry) => entry.customId === modal.data.custom_id && entry.user.id === component.user.id,
	});
	const action = component.customId.replace('personnel:', '');
	const permissionByAction = {
		'create-identity': 'personnel.admin',
		'edit-identity': 'personnel.admin',
		'activity-add-points': 'personnel.activite',
		'activity-remove-points': 'personnel.activite',
		'activity-add-hours': 'personnel.activite',
		'activity-remove-hours': 'personnel.activite',
		'sanction-add-confirm': 'personnel.sanctions',
		'sanction-revoke-open': 'personnel.sanctions',
		'promotion-note': 'personnel.promotion',
		'demotion-reason': 'personnel.promotion',
	};
	const requiredPermission = permissionByAction[action];
	if (requiredPermission && !hasPersonnelPermission(submitted, requiredPermission.split('.')[1])) {
		await submitted.reply({ content: `Vous ne possédez plus la permission ${requiredPermission}.`, flags: MessageFlags.Ephemeral });
		return null;
	}
	const values = Object.fromEntries(fields.map((field) => [field.id, submitted.fields.getTextInputValue(field.id).trim()]));
	await submitted.deferUpdate();
	return values;
};

const currentProfile = async (state) => {
	const profile = await Personnel.getProfile(state.targetId);
	state.profile = profile;
	state.profileEmbed = profile ? await profileEmbed(state.interaction, state.targetId) : null;
};

const openHistory = async (state, discordId) => {
	if (!await Personnel.getProfile(discordId)) throw new Error('Aucun personnage n’existe pour ce membre.');
	state.targetId = discordId;
	state.backPage = 'sanctions';
	state.historyPage = 1;
	const member = await state.interaction.guild.members.fetch(discordId).catch(async (error) => {
		await logDashboardError(state.interaction, null, state, error, 'WARN');
		return null;
	});
	state.historyUserTag = member?.user.tag || discordId;
	const history = await buildHistory(discordId, state.includeRevoked, state.historyPage, state.historyUserTag);
	state.historyEmbed = history.embed;
	state.historyPages = history.result.totalPages;
	state.page = 'sanction-history';
};

const loadLeaderboard = async (state) => {
	const result = await Personnel.getLeaderboard({ type: state.activityType, period: state.activityPeriod, page: state.activityPage, limit: 10 });
	const lines = result.rows.map((entry, index) => {
		const position = (state.activityPage - 1) * result.limit + index + 1;
		const amount = state.activityType === 'points' ? `${entry.amount} points` : `${entry.amount.toFixed(2)} h`;
		return `**${position}.** <@${entry.discordId}> · ${amount}`;
	});
	const period = { all: 'Depuis le début', week: '7 derniers jours', month: '30 derniers jours' }[state.activityPeriod];
	state.activityPages = result.totalPages;
	state.leaderboardEmbed = dashboardEmbed(state, `📈 Classement · ${state.activityType === 'points' ? 'Points' : 'Heures'}`, lines.join('\n') || 'Aucun membre actif à afficher.')
		.setFooter({ text: `${period} · Page ${state.activityPage}/${result.totalPages}` });
};

const goToView = async (state, view) => {
	state.view = view;
	state.page = view;
	state.backPage = 'home';
	state.notice = '';
	if (view === 'activity') {
		state.activityPage = 1;
		await loadLeaderboard(state);
	}
	if (view === 'hierarchy') state.hierarchyEmbed = await hierarchyEmbed(state.scaleIndex);
};

// Toutes les vues et les erreurs rééditent la réponse éphémère d’origine.
const renderPage = (state) => (state.responseInteraction || state.interaction).editReply(renderDashboard(state));
const setNotice = (state, error) => {
	state.error = true;
	state.notice = error instanceof Error ? error.message : String(error);
};

const loadDirectory = async (state, page = 1) => {
	const isProfileDirectory = state.page === 'profile-directory';
	state.directoryPage = page;
	state.backPage = 'characters';
	if (isProfileDirectory) {
		const result = Personnel.getProfiles({ limit: DIRECTORY_PAGE_SIZE, page });
		const usernames = await Promise.all(result.rows.map(async (profile) => {
			try {
				const user = await state.interaction.client.users.fetch(profile.discordId);
				return user.username;
			}
			catch (error) {
				await logDashboardError(state.interaction, null, state, error, 'WARN');
				return 'Compte Discord introuvable';
			}
		}));
		const lines = result.rows.map((profile, index) => {
			const scale = profile.division ? `${profile.branch} · ${profile.division}` : profile.branch;
			const rank = rankLabel(profile.divisionRankId || profile.branchRankId);
			return `• **${usernames[index]}** (<@${profile.discordId}>) · ${profile.firstName} ${profile.lastName}\n  ${scale} · ${rank} · IRA ${profile.ira} · ${profile.status === 'active' ? 'Actif' : 'Inactif'}`;
		});
		state.directoryPages = result.totalPages;
		state.directoryEmbed = dashboardEmbed(state, '📚 Tous les personnages', lines.join('\n') || 'Aucun personnage enregistré.')
			.setFooter({ text: `${result.totalRows} personnage(s) · Page ${page}/${result.totalPages}` });
		return;
	}
	if (!SECURITY_ROLE_ID) throw new Error('Le rôle Sécurité n’est pas configuré dans config.json (UrgenceDivisions.brancheGen.roleId).');
	if (!state.interaction.guild.members.fetch) throw new Error('Impossible de lister les membres du serveur. Vérifiez l’intent privilégié Server Members Intent dans le portail Discord.');
	const members = await state.interaction.guild.members.fetch();
	const profiles = new Set(Personnel.getProfileDiscordIds());
	const unregistered = [...members.values()]
		.filter((member) => !member.user.bot && member.roles.cache.has(SECURITY_ROLE_ID) && !profiles.has(member.id))
		.sort((left, right) => left.displayName.localeCompare(right.displayName, 'fr'));
	state.directoryPages = Math.max(1, Math.ceil(unregistered.length / DIRECTORY_PAGE_SIZE));
	const start = (page - 1) * DIRECTORY_PAGE_SIZE;
	const lines = unregistered.slice(start, start + DIRECTORY_PAGE_SIZE).map((member) => `• <@${member.id}> · **${member.displayName}** · ${member.user.tag}`);
	state.directoryEmbed = dashboardEmbed(state, '🛡️ Sécurité sans profil', lines.join('\n') || 'Tous les membres portant le rôle Sécurité ont déjà un profil.')
		.setFooter({ text: `${unregistered.length} membre(s) non recensé(s) · Page ${page}/${state.directoryPages}` });
};

const logDashboardError = async (interaction, component, state, error, severity = 'ERROR') => {
	const context = `Action: ${component?.customId || 'inconnue'}; vue: ${state?.view || 'inconnue'}; page: ${state?.page || 'inconnue'}; utilisateur: ${interaction.user.id}; cible: ${state?.targetId || 'aucune'}; erreur: ${error?.stack || error}`;
	try {
		if (typeof interaction.client?.log === 'function') await interaction.client.log('PERSONNEL DASHBOARD', severity, context);
		else console.error(`[PERSONNEL DASHBOARD] ${context}`);
	}
	catch (logError) {
		console.error('[PERSONNEL DASHBOARD] Échec du journal applicatif:', logError, context);
	}
};

const executeDashboard = async (interaction) => {
	let ownProfileRecord = null;
	let profileLookupError = null;
	try {
		ownProfileRecord = await Personnel.getProfile(interaction.user.id);
	}
	catch (error) {
		profileLookupError = error;
		await logDashboardError(interaction, null, { view: 'home', page: 'home' }, error);
	}
	const hasOwnProfile = Boolean(ownProfileRecord);
	if (!hasPersonnelPermission(interaction, 'dashboard') && !hasOwnProfile) {
		if (profileLookupError) return replyError(interaction, 'Impossible de vérifier votre personnage pour le moment. Réessayez dans quelques instants.', 'Base de données indisponible');
		return replyError(interaction, 'Vous devez posséder un personnage enregistré ou un rôle autorisé par personnel.dashboard pour ouvrir le dashboard.', 'Accès refusé');
	}
	const state = {
		interaction,
		userTag: interaction.user.tag,
		hasOwnProfile,
		view: 'characters',
		page: 'characters',
		backPage: 'home',
		helpView: null,
		notice: '',
		targetId: null,
		profile: null,
		profileEmbed: null,
		activityType: 'points',
		activityPeriod: 'all',
		activityPage: 1,
		activityPages: 1,
		historyPage: 1,
		historyPages: 1,
		includeRevoked: false,
		activityAdjustment: null,
		draft: {},
		directoryPage: 1,
		directoryPages: 1,
		directoryEmbed: null,
		scaleIndex: 0,
		promotionIds: [],
		promotionLabels: [],
		promotionPreview: null,
		promotionNote: '',
	};
	await interaction.reply({ ...renderDashboard(state), flags: MessageFlags.Ephemeral });
	const message = await interaction.fetchReply();
	const collector = message.createMessageComponentCollector({ time: 30 * 60_000 });
	// Les permissions sont revérifiées au clic, même si le menu a été rendu auparavant.
	collector.on('collect', async (rawComponent) => {
		const component = new Proxy(rawComponent, {
			get(target, property) {
				if (property === 'update') {
					return (payload) => target.deferred || target.replied
						? interaction.editReply(payload)
						: target.update(payload);
				}
				const value = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		if (component.user.id !== interaction.user.id) {
			try {
				return await component.reply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('🔒 Dashboard privé').setDescription('Seule la personne qui a ouvert ce dashboard peut utiliser ses boutons.')], flags: MessageFlags.Ephemeral });
			}
			catch (error) {
				await logDashboardError(interaction, component, state, error);
				return;
			}
		}
		try {
			state.error = false;
			const id = component.customId.replace('personnel:', '');
			if (!MODAL_ACTIONS.has(id)) await component.deferUpdate();
			if (id === 'close') {
				collector.stop('closed');
				return component.update({
					embeds: [dashboardEmbed(state, '✅ Dashboard fermé', 'Vous pouvez le rouvrir avec `/personnel`.')],
					components: [],
				});
			}
			if (id === 'view') {
				await goToView(state, component.values[0]);
				return renderPage(state);
			}
			if (id === 'help') {
				state.helpView = state.view;
				state.backPage = state.page;
				state.page = 'help';
				return component.update(renderDashboard(state));
			}
			if (id === 'home') {
				state.page = 'home';
				state.notice = '';
				return component.update(renderDashboard(state));
			}
			if (id === 'back') {
				state.page = state.backPage || state.view;
				state.notice = '';
				return component.update(renderDashboard(state));
			}
			if (id === 'activity-type' || id === 'activity-period') {
				if (id === 'activity-type') state.activityType = component.values[0];
				else state.activityPeriod = component.values[0];
				state.activityPage = 1;
				await loadLeaderboard(state);
				return component.update(renderDashboard(state));
			}
			if (id === 'hierarchy-scale') {
				state.scaleIndex = Number(component.values[0]);
				state.hierarchyEmbed = await hierarchyEmbed(state.scaleIndex);
				return component.update(renderDashboard(state));
			}
			if (id === 'activity-prev' || id === 'activity-next') {
				state.activityPage += id === 'activity-next' ? 1 : -1;
				await loadLeaderboard(state);
				return component.update(renderDashboard(state));
			}
			if (id === 'history-prev' || id === 'history-next' || id === 'history-toggle') {
				if (state.targetId !== interaction.user.id && !canViewDossiers(component)) throw new Error('Cette consultation nécessite la permission personnel.dossier.');
				if (id === 'history-toggle') {
					state.includeRevoked = !state.includeRevoked;
					state.historyPage = 1;
				}
				else {state.historyPage += id === 'history-next' ? 1 : -1;}
				const history = await buildHistory(state.targetId, state.includeRevoked, state.historyPage, state.historyUserTag);
				state.historyEmbed = history.embed;
				state.historyPages = history.result.totalPages;
				return component.update(renderDashboard(state));
			}
			if (id === 'list-profiles' || id === 'list-security-unregistered') {
				if (!canViewDossiers(component)) throw new Error('Lister les personnages nécessite la permission personnel.dossier.');
				state.page = id === 'list-profiles' ? 'profile-directory' : 'security-directory';
				state.backPage = 'characters';
				await loadDirectory(state, 1);
				return component.update(renderDashboard(state));
			}
			if (id === 'directory-prev' || id === 'directory-next') {
				if (!canViewDossiers(component)) throw new Error('Lister les personnages nécessite toujours la permission personnel.dossier.');
				const page = state.directoryPage + (id === 'directory-next' ? 1 : -1);
				await loadDirectory(state, Math.max(1, Math.min(state.directoryPages, page)));
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-remove') {
				if (!canPromote(component)) throw new Error('La gestion d’une vague nécessite la permission personnel.promotion.');
				const removed = new Set(component.values);
				state.promotionIds = state.promotionIds.filter((userId) => !removed.has(userId));
				state.promotionLabels = state.promotionLabels.filter(({ id: userId }) => !removed.has(userId));
				state.promotionPreview = null;
				state.promotionEmbed = null;
				return component.update(renderDashboard(state));
			}
			if (id === 'create-member' || id === 'edit-member' || id === 'profile-member' || id === 'activity-member' || id === 'sanction-member' || id === 'sanction-add-member' || id === 'demotion-member') {
				if (id === 'create-member' && !isAdmin(component)) throw new Error('La création nécessite un rôle administrateur du personnel.');
				if (id === 'edit-member' && !isAdmin(component)) throw new Error('La modification nécessite un rôle administrateur du personnel.');
				if (id === 'profile-member' && !canViewDossiers(component)) throw new Error('La consultation du personnage d’un autre membre nécessite la permission personnel.dossier.');
				if (id === 'activity-member' && !canManageActivity(component)) throw new Error('La correction de l’activité nécessite la permission personnel.activite.');
				if (id === 'sanction-member' && !canViewDossiers(component)) throw new Error('La consultation des sanctions d’un autre membre nécessite la permission personnel.dossier.');
				if (id === 'sanction-add-member' && !canManageSanctions(component)) throw new Error('La gestion des sanctions nécessite la permission personnel.sanctions.');
				if (id === 'demotion-member' && !canPromote(component)) throw new Error('Cette sélection nécessite la permission personnel.promotion.');
				state.targetId = component.values[0];
				if (id === 'create-member') {state.draft.discordId = state.targetId;}
				else if (id === 'edit-member' || id === 'profile-member') {
					await currentProfile(state);
					state.page = id === 'edit-member' ? 'edit-profile' : 'profile';
					state.backPage = 'characters';
				}
				else if (id === 'activity-member') {
					state.page = 'activity-edit';
				}
				else if (id === 'sanction-member') {
					await openHistory(state, state.targetId);
				}
				else if (id === 'sanction-add-member') {
					state.page = 'sanction-add';
					state.sanctionType = null;
				}
				else if (id === 'demotion-member') {
					state.page = 'demotion';
				}
				state.notice = '';
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-members') {
				if (!canPromote(component)) throw new Error('La préparation d’une vague nécessite la permission personnel.promotion.');
				for (const user of component.users.values()) {
					if (!user.bot && state.promotionIds.length < 25 && !state.promotionIds.includes(user.id)) {
						state.promotionIds.push(user.id);
						state.promotionLabels.push({ id: user.id, label: user.username });
					}
				}
				state.promotionPreview = null;
				state.promotionEmbed = null;
				return component.update(renderDashboard(state));
			}
			if (id === 'sanction-type') {
				if (!canManageSanctions(component)) throw new Error('La gestion des sanctions nécessite la permission personnel.sanctions.');
				state.sanctionType = component.values[0];
				return component.update(renderDashboard(state));
			}
			if (id === 'create-identity' || id === 'edit-identity') {
				if (id === 'edit-identity' && !isAdmin(component)) throw new Error('La modification d’un personnage nécessite un rôle administrateur du personnel.');
				const values = await showModal(component, 'Identité du personnage', [
					{ id: 'prenom', label: 'Prénom', required: true, maxLength: 80, value: id === 'edit-identity' ? state.profile?.firstName : state.draft.firstName },
					{ id: 'nom', label: 'Nom', required: true, maxLength: 80, value: id === 'edit-identity' ? state.profile?.lastName : state.draft.lastName },
				]);
				if (!values) return;
				if (id === 'create-identity') {
					state.draft.firstName = values.prenom;
					state.draft.lastName = values.nom;
				}
				else {
					state.profile = await Personnel.updateInfo(state.targetId, { firstName: values.prenom, lastName: values.nom });
					await currentProfile(state);
				}
				state.notice = 'Identité mise à jour.';
				await renderPage(state);
				return;
			}
			if (['create-branch', 'create-division', 'create-rank'].includes(id)) {
				if (!isAdmin(component)) throw new Error('Cette action nécessite un rôle administrateur du personnel.');
				const choices = id === 'create-branch' ? BRANCHES : id === 'create-division'
					? [{ label: 'Aucune', value: 'aucune' }, ...DIVISIONS.map((value) => ({ label: value, value }))]
					: getLadder(state.draft.branch, state.draft.division).map(({ id: value, label }) => ({ label, value }));
				state.choice = { id, options: choices, title: id === 'create-branch' ? 'Choisir une branche' : id === 'create-division' ? 'Choisir une division' : 'Choisir un rang' };
				state.backPage = 'create-profile';
				state.page = 'choice';
				return component.update(renderDashboard(state));
			}
			if (id === 'create-confirm') {
				if (!isAdmin(component)) throw new Error('Cette action nécessite un rôle administrateur du personnel.');
				const profile = await Personnel.createProfile({ ...state.draft, rankId: state.draft.rankId || undefined });
				const sync = await syncPersonnelRoles(component, profile.discordId, null, profile);
				state.page = 'done';
				state.notice = `Profil de <@${profile.discordId}> créé au rang **${rankLabel(profile.divisionRankId || profile.branchRankId)}** (IRA ${profile.ira}).${sync.ok ? '' : ' Les rôles n’ont pas pu être synchronisés; vérifiez les permissions du bot.'}`;
				return component.update(renderDashboard(state));
			}
			if (id === 'create-cancel') {
				state.page = 'characters';
				state.draft = {};
				return component.update(renderDashboard(state));
			}
			if (id === 'choice') {
				const key = state.choice.id;
				const value = component.values[0];
				if (key.startsWith('create-') && !isAdmin(component)) throw new Error('La création nécessite toujours un rôle administrateur du personnel.');
				if (key.startsWith('edit-') && !isAdmin(component)) throw new Error('La modification nécessite toujours un rôle administrateur du personnel.');
				if (key.startsWith('create-')) {
					const property = key.slice('create-'.length);
					state.draft[property === 'branch' ? 'branch' : property === 'division' ? 'division' : 'rankId'] = value === 'aucune' ? null : value;
					if (property === 'branch') {
						state.draft.division = null;
						state.draft.rankId = null;
					}
					if (property === 'division') state.draft.rankId = null;
					state.page = 'create-profile';
				}
				else if (key === 'edit-status') {
					await Personnel.updateInfo(state.targetId, { status: value });
					await currentProfile(state);
					state.page = 'edit-profile';
					state.backPage = 'characters';
					state.notice = 'Statut du personnage mis à jour.';
				}
				else if (key === 'edit-branch') {
					const before = state.profile;
					const profile = await Personnel.setBranch(state.targetId, value, null);
					await syncPersonnelRoles(component, state.targetId, before, profile);
					await currentProfile(state);
					state.page = 'edit-profile';
					state.backPage = 'characters';
					state.notice = 'Branche mise à jour; le rang de départ correspondant a été appliqué.';
				}
				else if (key === 'edit-division') {
					if (value !== 'aucune') {
						state.pendingDivision = value;
						state.choice = { id: 'edit-division-rank', options: getLadder('BG', value).map(({ id: rankId, label }) => ({ label, value: rankId })), title: `Choisir le rang ${value}` };
						state.backPage = 'edit-profile';
						state.page = 'choice';
						return component.update(renderDashboard(state));
					}
					const before = state.profile;
					const profile = await Personnel.setDivision(state.targetId, null);
					await syncPersonnelRoles(component, state.targetId, before, profile);
					await currentProfile(state);
					state.page = 'edit-profile';
					state.backPage = 'characters';
					state.notice = 'Division mise à jour avec le rang de départ correspondant.';
				}
				else if (key === 'edit-division-rank') {
					const before = state.profile;
					const profile = await Personnel.setDivision(state.targetId, state.pendingDivision, value);
					await syncPersonnelRoles(component, state.targetId, before, profile);
					await currentProfile(state);
					state.page = 'edit-profile';
					state.backPage = 'characters';
					state.notice = `Division ${state.pendingDivision} et rang ${rankLabel(profile.divisionRankId)} mis à jour.`;
				}
				else if (key === 'edit-rank') {
					const before = state.profile;
					const profile = await Personnel.setRank(state.targetId, value);
					await syncPersonnelRoles(component, state.targetId, before, profile);
					await currentProfile(state);
					state.page = 'edit-profile';
					state.backPage = 'characters';
					state.notice = 'Rang mis à jour.';
				}
				else if (key === 'activity-type') {
					state.activityType = value;
					state.activityPage = 1;
					await loadLeaderboard(state);
				}
				else if (key === 'activity-period') {
					state.activityPeriod = value;
					state.activityPage = 1;
					await loadLeaderboard(state);
				}
				else if (key === 'scale') {
					state.scaleIndex = Number(value);
					state.hierarchyEmbed = await hierarchyEmbed(state.scaleIndex);
				}
				else if (key === 'sanction-type') {
					state.sanctionType = value;
					state.page = 'sanction-add';
				}
				return component.update(renderDashboard(state));
			}
			if (id === 'self-profile') {
				state.targetId = interaction.user.id;
				await currentProfile(state);
				state.backPage = 'characters';
				state.page = 'profile';
				return component.update(renderDashboard(state));
			}
			if (id === 'nicknames-update') {
				if (!isAdmin(component)) throw new Error('La mise à jour des pseudos nécessite un rôle administrateur du personnel.');
				const { rows } = Personnel.getProfiles({ limit: 25, page: 1 });
				let updated = 0;
				let failed = 0;
				const memberCache = new Map();
				const fetchMember = async (discordId) => {
					if (!memberCache.has(discordId)) {
						memberCache.set(discordId, await component.guild.members.fetch(discordId).catch(() => null));
					}
					return memberCache.get(discordId);
				};
				for (let page = 1; ; page += 1) {
					const result = page === 1 ? { rows } : Personnel.getProfiles({ limit: 25, page });
					if (!result.rows.length) break;
					for (const profile of result.rows) {
						const nickname = getPersonnelNickname(profile);
						if (!nickname) continue;
						const member = await fetchMember(profile.discordId);
						if (!member) { failed += 1; continue; }
						try {
							if (member.nickname !== nickname) {
								await member.setNickname(nickname, 'Mise à jour des pseudos du personnel');
							}
							updated += 1;
						}
						catch (error) {
							failed += 1;
							await interaction.client.log('PERSONNEL DASHBOARD', 'WARN', `Pseudo non mis à jour pour <@${profile.discordId}>: ${error?.stack || error}`);
						}
					}
					if (page >= result.totalPages) break;
				}
				state.page = 'done';
				state.notice = `Mise à jour des pseudos terminée : ${updated} pseudo(s) actualisé(s)${failed ? `, ${failed} échec(s) (voir les journaux)` : ''}.`;
				return component.update(renderDashboard(state));
			}
			if (id === 'select-profile') {
				if (!canViewDossiers(component)) throw new Error('La consultation du dossier d’un autre membre nécessite la permission personnel.dossier.');
				state.page = 'select-profile';
				state.backPage = 'characters';
				return component.update(renderDashboard(state));
			}
			if (id === 'create-profile') {
				if (!isAdmin(component)) throw new Error('La création nécessite un rôle administrateur du personnel.');
				state.draft = {};
				state.page = 'create-profile';
				state.backPage = 'characters';
				return component.update(renderDashboard(state));
			}
			if (id === 'edit-profile') {
				if (!isAdmin(component)) throw new Error('La modification nécessite un rôle administrateur du personnel.');
				if (state.page === 'profile' && state.targetId) {
					await currentProfile(state);
					state.page = 'edit-profile';
				}
				else {
					state.targetId = null;
					state.profileEmbed = null;
					state.page = 'edit-profile';
					state.backPage = 'characters';
				}
				return component.update(renderDashboard(state));
			}
			if (id === 'delete-profile') {
				if (!isAdmin(component)) throw new Error('La suppression nécessite un rôle administrateur du personnel.');
				if (!state.targetId) throw new Error('Choisissez d’abord un personnage à supprimer.');
				state.backPage = state.page;
				state.page = 'confirm-delete';
				return component.update(renderDashboard(state));
			}
			if (id === 'delete-confirm') {
				if (!isAdmin(component)) throw new Error('La suppression nécessite un rôle administrateur du personnel.');
				await Personnel.deleteProfile(state.targetId);
				state.page = 'done';
				state.notice = `Le personnage <@${state.targetId}> et ses données associées ont été supprimés. Ses rôles Discord ont été conservés pour un retrait manuel.`;
				return component.update(renderDashboard(state));
			}
			if (['edit-status', 'edit-branch', 'edit-division', 'edit-rank'].includes(id)) {
				if (!isAdmin(component)) throw new Error('La modification nécessite un rôle administrateur du personnel.');
				if (!state.targetId) throw new Error('Choisissez d’abord un personnage à modifier.');
				await currentProfile(state);
				const key = id.slice('edit-'.length);
				const options = key === 'status'
					? [{ label: 'Actif', value: 'active' }, { label: 'Inactif', value: 'inactive' }]
					: key === 'branch' ? BRANCHES
						: key === 'division' ? [{ label: 'Aucune', value: 'aucune' }, ...DIVISIONS.map((value) => ({ label: value, value }))]
							: getLadder(state.profile.branch, state.profile.division).map(({ id: value, label }) => ({ label, value }));
				state.choice = { id, options, title: `Choisir ${key === 'status' ? 'un statut' : key === 'branch' ? 'une branche' : key === 'division' ? 'une division' : 'un rang'}` };
				state.backPage = 'edit-profile';
				state.page = 'choice';
				return component.update(renderDashboard(state));
			}
			if (id === 'edit-sanction') {
				if (!canManageSanctions(component)) throw new Error('L’ajout d’une sanction nécessite la permission personnel.sanctions.');
				if (!state.targetId) throw new Error('Choisissez d’abord un personnage à sanctionner.');
				state.page = 'sanction-add';
				state.sanctionType = null;
				state.backPage = 'edit-profile';
				return component.update(renderDashboard(state));
			}
			if (id === 'profile') {
				if (state.targetId !== interaction.user.id && !canViewDossiers(component)) throw new Error('Vous ne pouvez consulter que votre propre personnage.');
				await currentProfile(state);
				state.page = 'profile';
				return component.update(renderDashboard(state));
			}
			if (id === 'activity-self') {
				const own = await Personnel.getProfile(interaction.user.id);
				if (!own) throw new Error('Aucun personnage n’est associé à votre compte.');
				state.activitySelfEmbed = dashboardEmbed(state, '📈 Mon activité', `**${own.firstName} ${own.lastName}**\n\n⭐ Points : **${own.activityPoints}**\n⏱️ Heures : **${formatDuration(own.activityMinutes)}**`);
				state.backPage = 'activity';
				state.page = 'activity-self';
				return component.update(renderDashboard(state));
			}
			if (id === 'activity-correct') {
				if (!canManageActivity(component)) throw new Error('La correction d’activité nécessite la permission personnel.activite.');
				state.page = 'activity-target';
				state.backPage = 'activity';
				return component.update(renderDashboard(state));
			}
			if (['activity-add-points', 'activity-remove-points', 'activity-add-hours', 'activity-remove-hours'].includes(id)) {
				if (!canManageActivity(component)) throw new Error('La correction d’activité nécessite la permission personnel.activite.');
				const mode = { type: id.includes('hours') ? 'hours' : 'points', removing: id.includes('remove'), title: id.includes('hours') ? 'Correction des heures' : 'Correction des points' };
				const values = await showModal(component, mode.title, [
					{ id: 'amount', label: mode.type === 'hours' ? 'Nombre d’heures' : 'Nombre de points', placeholder: 'Nombre strictement positif', maxLength: 20 },
					{ id: 'reason', label: 'Motif de la correction', required: true, maxLength: 500 },
				]);
				if (!values) return;
				const amount = Number(values.amount);
				if (!Number.isFinite(amount) || amount <= 0) throw new Error('Le montant doit être un nombre strictement positif.');
				const metadata = { source: 'dashboard personnel', reason: values.reason, actorId: interaction.user.id };
				const result = mode.removing
					? await Personnel.removeActivity(interaction.client, state.targetId, { type: mode.type, amount: -amount, ...metadata })
					: await (mode.type === 'hours' ? Personnel.addActivityHours(interaction.client, state.targetId, amount, metadata) : Personnel.addActivityPoints(interaction.client, state.targetId, amount, metadata));
				if (!result.ok) throw new Error('Aucun personnage n’existe pour ce membre.');
				state.page = 'activity';
				state.notice = `${mode.removing ? 'Retrait' : 'Ajout'} de ${mode.type === 'hours' ? `${Math.abs(result.amount) / 60} h` : `${Math.abs(result.amount)} point(s)`} effectué pour <@${state.targetId}>. Motif : ${values.reason}`;
				await loadLeaderboard(state);
				await renderPage(state);
				return;
			}
			if (id === 'sanction-self') {
				await openHistory(state, interaction.user.id);
				return component.update(renderDashboard(state));
			}
			if (id === 'sanction-other') {
				if (!canViewDossiers(component)) throw new Error('La consultation des sanctions d’un autre membre nécessite la permission personnel.dossier.');
				state.page = 'sanction-target';
				state.backPage = 'sanctions';
				return component.update(renderDashboard(state));
			}
			if (id === 'sanction-add') {
				if (!canManageSanctions(component)) throw new Error('L’ajout d’une sanction nécessite la permission personnel.sanctions.');
				if (!SANCTION_TYPES.length) throw new Error('Aucun type de sanction n’est configuré. Contactez un administrateur.');
				state.targetId = null;
				state.sanctionType = null;
				state.page = 'sanction-add';
				state.backPage = 'sanctions';
				return component.update(renderDashboard(state));
			}
			if (id === 'sanction-add-confirm') {
				if (!canManageSanctions(component)) throw new Error('L’ajout d’une sanction nécessite la permission personnel.sanctions.');
				const values = await showModal(component, 'Motif de sanction', [{ id: 'reason', label: 'Motif', required: true, maxLength: 1000, paragraph: true }]);
				if (!values) return;
				const sanction = await Personnel.addSanction(state.targetId, state.sanctionType, values.reason, interaction.user.id);
				state.page = 'done';
				state.notice = `Sanction **${sanction.type}** ajoutée à <@${state.targetId}> · dossier #${sanction.case_number}. Motif : ${sanction.reason}`;
				await renderPage(state);
				return;
			}
			if (id === 'sanction-revoke') {
				if (!canManageSanctions(component)) throw new Error('La révocation d’une sanction nécessite la permission personnel.sanctions.');
				state.page = 'sanction-revoke';
				state.backPage = 'sanctions';
				return component.update(renderDashboard(state));
			}
			if (id === 'sanction-revoke-open') {
				if (!canManageSanctions(component)) throw new Error('La révocation d’une sanction nécessite la permission personnel.sanctions.');
				const values = await showModal(component, 'Révoquer une sanction', [
					{ id: 'case', label: 'Numéro du dossier', maxLength: 10 },
					{ id: 'reason', label: 'Motif de révocation', maxLength: 1000, paragraph: true },
				]);
				if (!values) return;
				const caseNumber = Number(values.case);
				if (!Number.isInteger(caseNumber) || caseNumber < 1) throw new Error('Le numéro de dossier doit être un entier positif.');
				const sanction = await Personnel.revokeSanction(caseNumber, interaction.user.id, values.reason);
				state.page = 'done';
				state.notice = `Dossier #${sanction.case_number} révoqué pour <@${sanction.discord_id}>. Motif : ${sanction.revoke_reason}`;
				await renderPage(state);
				return;
			}
			if (id === 'promotion-open') {
				if (!canPromote(component)) throw new Error('La gestion des promotions nécessite la permission personnel.promotion.');
				if (!/^\d{17,20}$/.test(config.promotionChannelId || '')) throw new Error('Le salon public des promotions est absent ou invalide dans config.json.');
				state.promotionIds = [];
				state.promotionLabels = [];
				state.promotionPreview = null;
				state.promotionNote = '';
				state.promotionEmbed = null;
				state.page = 'promotions';
				state.backPage = 'hierarchy';
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-note') {
				const values = await showModal(component, 'Note de la vague', [{ id: 'note', label: 'Note facultative', required: false, maxLength: 500, paragraph: true }]);
				if (!values) return;
				state.promotionNote = values.note;
				await renderPage(state);
				return;
			}
			if (id === 'promotion-preview') {
				if (!state.promotionIds.length) throw new Error('Sélectionnez au moins un membre avant de demander un aperçu.');
				state.promotionPreview = await previewPromotions(state.promotionIds);
				state.promotionEmbed = state.promotionPreview.embed;
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-review') {
				if (!canPromote(component)) throw new Error('La gestion d’une vague nécessite la permission personnel.promotion.');
				if (!state.promotionPreview?.entries.some(({ result }) => result.ok)) throw new Error('Générez un aperçu contenant au moins une promotion possible.');
				state.page = 'promotion-confirm';
				state.backPage = 'promotions';
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-abort') {
				state.page = 'promotions';
				state.backPage = 'hierarchy';
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-cancel') {
				state.page = 'hierarchy';
				state.promotionPreview = null;
				return component.update(renderDashboard(state));
			}
			if (id === 'promotion-confirm') {
				if (!canPromote(component)) throw new Error('La gestion des promotions nécessite la permission personnel.promotion.');
				const candidates = state.promotionPreview?.entries.filter(({ result }) => result.ok).map(({ discordId }) => ({ discordId })) || [];
				if (!candidates.length) throw new Error('Aucun membre sélectionné ne peut être promu.');
				const result = await Personnel.applyPromotions(interaction.client, interaction.user.id, candidates, state.promotionNote);
				result.échecs.push(...state.promotionPreview.entries.filter(({ result: item }) => !item.ok).map(({ discordId, result: item }) => ({ discordId, reason: item.reason })));
				try {
					await publishPromotions(component, result, state.promotionNote);
					state.page = 'done';
					state.notice = `Vague terminée : ${result.succès.length} promotion(s), ${result.échecs.length} échec(s). Le récapitulatif a été publié.`;
				}
				catch (error) {
					state.page = 'done';
					state.notice = error.message;
				}
				await renderPage(state);
				return;
			}
			if (id === 'demotion-open') {
				if (!canPromote(component)) throw new Error('La rétrogradation nécessite la permission personnel.promotion.');
				state.targetId = null;
				state.page = 'demotion';
				state.backPage = 'hierarchy';
				return component.update(renderDashboard(state));
			}
			if (id === 'demotion-reason') {
				if (!canPromote(component)) throw new Error('La rétrogradation nécessite la permission personnel.promotion.');
				const values = await showModal(component, 'Motif de rétrogradation', [{ id: 'reason', label: 'Motif', maxLength: 1000, paragraph: true }]);
				if (!values) return;
				const before = await Personnel.getProfile(state.targetId);
				const result = await Personnel.demoteMember(state.targetId);
				await syncPersonnelRoles(component, state.targetId, before, result.profile);
				await interaction.client.log('PERSONNEL', 'INFO', `Rétrogradation de ${state.targetId} par ${interaction.user.id}: ${rankLabel(result.from)} -> ${rankLabel(result.to)}. Motif: ${values.reason}.`);
				state.page = 'done';
				state.notice = `<@${state.targetId}> rétrogradé de **${rankLabel(result.from)}** à **${rankLabel(result.to)}**.${result.iraChanged ? ` IRA ${before.ira} → ${result.profile.ira}.` : ''} Motif : ${values.reason}`;
				await renderPage(state);
				return;
			}
			if (id === 'activity') {
				await goToView(state, 'activity');
				return component.update(renderDashboard(state));
			}
			return;
		}
		catch (error) {
			await logDashboardError(interaction, component, state, error);
			if (component.deferred || component.replied) {
				setNotice(state, error);
				try {
					await renderPage(state);
				}
				catch (renderError) {
					await logDashboardError(interaction, component, state, renderError);
				}
			}
			else {
				setNotice(state, error);
				await component.update(renderDashboard(state)).catch(async () => {
					try {
						await interaction.editReply(renderDashboard(state));
					}
					catch (editError) {
						await logDashboardError(interaction, component, state, editError);
					}
				});
			}
		}
	});
	collector.on('end', async (_, reason) => {
		if (reason === 'time') {
			state.page = 'done';
			state.notice = 'Cette session a expiré. Rouvrez le dashboard avec `/personnel`.';
			try {
				await interaction.editReply(renderDashboard(state));
			}
			catch (error) {
				await logDashboardError(interaction, null, state, error);
			}
		}
	});
};

const canOpenDashboard = (interaction) => {
	if (hasPersonnelPermission(interaction, 'dashboard')) return true;
	if (!interaction?.user?.id) return false;
	try {
		return Personnel.hasProfile(interaction.user.id);
	}
	catch (error) {
		const context = `Vérification du profil impossible pour ${interaction.user.id}: ${error?.stack || error}`;
		if (typeof interaction.client?.log === 'function') {
			void interaction.client.log('PERSONNEL DASHBOARD', 'ERROR', context).catch((logError) => console.error(context, logError));
		}
		return false;
	}
};

module.exports = { executeDashboard, renderDashboard, canOpenDashboard, HELP };
