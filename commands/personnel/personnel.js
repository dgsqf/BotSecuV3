const {
	SlashCommandBuilder,
	EmbedBuilder,
	MessageFlags,
	ButtonStyle,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const Personnel = require('../../framework_utils/Personnel.js');
const {
	requirePermission,
	reply,
	replyError,
	replyServiceError,
	addRankAutocomplete,
	formatDuration,
	getManualRoleDisplays,
	syncPersonnelRoles,
	runPersonnelForm,
} = require('../../framework_utils/PersonnelDiscord.js');
const { getLadder, getRank } = require('../../data/hierarchy.js');

const BRANCHES = [
	{ name: 'Équipe d’intervention tactique (EIT)', value: 'EIT' },
	{ name: 'Branche générale (BG)', value: 'BG' },
	{ name: 'Commandement', value: 'COMMANDEMENT' },
	{ name: 'Direction', value: 'DIRECTION' },
	{ name: 'Commission de sûreté', value: 'COMMISSION' },
];
const DIVISIONS = [
	{ name: 'ULB', value: 'ULB' },
	{ name: 'URR', value: 'URR' },
	{ name: 'UPR', value: 'UPR' },
	{ name: 'UMS', value: 'UMS' },
];
const STATUSES = [
	{ name: 'Actif', value: 'active' },
	{ name: 'Inactif', value: 'inactive' },
];

const branchLabel = (branch) => BRANCHES.find((entry) => entry.value === branch)?.name || branch;
const rankLabel = (rankId) => getRank(rankId)?.label || rankId || 'Non renseigné';

const sendProfile = async (interaction, discordId) => {
	const profile = await Personnel.getProfile(discordId);
	if (!profile) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
	const branchRank = rankLabel(profile.branchRankId);
	const divisionRank = profile.division ? rankLabel(profile.divisionRankId) : null;
	const sanctions = await Personnel.getActiveSanctionCount(discordId);
	const member = await interaction.guild.members.fetch(discordId).catch(() => null);
	const manualRoleDisplays = getManualRoleDisplays(interaction.guild, member);
	const embed = new EmbedBuilder()
		.setColor(profile.status === 'active' ? 0x57f287 : 0xfee75c)
		.setTitle(`Profil de ${profile.firstName} ${profile.lastName}`)
		.setDescription(`<@${profile.discordId}>`)
		.addFields(
			{ name: 'Branche', value: `${branchLabel(profile.branch)}\n${branchRank}`, inline: true },
			{ name: 'Division', value: profile.division ? `${profile.division}\n${divisionRank}` : 'Aucune', inline: true },
			{ name: 'IRA', value: String(profile.ira), inline: true },
			{ name: 'Activité', value: `${profile.activityPoints} points\n${formatDuration(profile.activityMinutes)}`, inline: true },
			{ name: 'Sanctions actives', value: String(sanctions), inline: true },
			{ name: 'Statut', value: profile.status === 'active' ? 'Actif' : 'Inactif', inline: true },
			{ name: 'Fonctions manuelles', value: manualRoleDisplays.join('\n') || 'Aucune', inline: false },
		)
		.setTimestamp(new Date(profile.updatedAt));
	return reply(interaction, embed);
};

const data = new SlashCommandBuilder()
	.setName('personnel')
	.setDescription('Gère les profils du personnel de sécurité.')
	.addSubcommand((subcommand) => subcommand.setName('creer').setDescription('Crée le profil d’un membre.'))
	.addSubcommand((subcommand) => subcommand.setName('profil').setDescription('Affiche un profil de personnel.'))
	.addSubcommand((subcommand) => subcommand.setName('modifier').setDescription('Modifie les informations d’un profil.'))
	.addSubcommand((subcommand) => subcommand.setName('division').setDescription('Affecte ou retire un membre d’une division BG.'))
	.addSubcommand((subcommand) => subcommand.setName('branche').setDescription('Change la branche et définit un nouveau rang de départ.'))
	.addSubcommand((subcommand) => subcommand.setName('supprimer').setDescription('Supprime le profil et ses données associées.'))
	.addSubcommand((subcommand) => subcommand.setName('rang').setDescription('Définit manuellement le rang d’un membre.'));

module.exports = {
	cooldown: 3,
	data,
	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'creer') {
			const branch = interaction.options.getString('branche');
			const division = branch === 'BG' ? interaction.options.getString('division') : null;
			return addRankAutocomplete(interaction, branch, division);
		}
		if (subcommand === 'division') return addRankAutocomplete(interaction, 'BG', interaction.options.getString('division'));
		if (subcommand === 'branche') {
			const branch = interaction.options.getString('branche');
			const division = branch === 'BG' ? interaction.options.getString('division') : null;
			return addRankAutocomplete(interaction, branch, division);
		}
		if (subcommand === 'rang') {
			const profile = await Personnel.getProfile(interaction.options.getUser('utilisateur')?.id || '');
			return addRankAutocomplete(interaction, profile?.branch, profile?.division);
		}
		return interaction.respond([]);
	},
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const permissionGroup = subcommand === 'profil' ? null : 'admin';
		if (permissionGroup && !await requirePermission(interaction, permissionGroup)) return;
		try {
			if (subcommand === 'creer') {
				return runPersonnelForm({
					interaction,
					title: 'Créer un profil',
					description: 'Complétez les informations du membre puis confirmez la création.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
						{ type: 'text', id: 'prenom', label: 'Prénom', required: true },
						{ type: 'text', id: 'nom', label: 'Nom', required: true },
						{ type: 'choice', id: 'branche', label: 'Branche', required: true, choices: BRANCHES.map(({ name, value }) => ({ label: name, value })) },
						{ type: 'choice', id: 'division', label: 'Division (BG uniquement)', required: false, choices: [...DIVISIONS.map(({ name, value }) => ({ label: name, value })), { label: 'Aucune', value: 'aucune' }] },
						{ type: 'text', id: 'rang', label: 'Rang de branche ou division (ID, optionnel)', required: false },
					],
					onConfirm: async (values) => {
						const userId = values.utilisateur;
						const profile = await Personnel.createProfile({
							discordId: userId,
							firstName: values.prenom,
							lastName: values.nom,
							branch: values.branche,
							division: values.division === 'aucune' ? null : values.division,
							rankId: values.rang || undefined,
						});
						const roleSync = await syncPersonnelRoles(interaction, profile.discordId, null, profile);
						if (!roleSync.ok) await interaction.client.log('PERSONNEL', 'WARN', `Profil créé pour <@${profile.discordId}>, mais ses rôles n’ont pas pu être synchronisés.`);
						return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle('Profil créé').setDescription(`Le profil de <@${profile.discordId}> a été créé au rang **${rankLabel(profile.divisionRankId || profile.branchRankId)}** (IRA ${profile.ira}).`));
					},
				});
			}
			if (subcommand === 'profil') {
				return runPersonnelForm({
					interaction,
					title: 'Consulter un profil',
					description: 'Choisissez le membre dont vous souhaitez afficher le profil.',
					fields: [{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: false }],
					onConfirm: async (values) => sendProfile(interaction, values.utilisateur || interaction.user.id),
				});
			}
			if (subcommand === 'modifier') {
				return runPersonnelForm({
					interaction,
					title: 'Modifier un profil',
					description: 'Renseignez les éléments à mettre à jour. Les champs vides seront ignorés.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
						{ type: 'text', id: 'prenom', label: 'Nouveau prénom', required: false },
						{ type: 'text', id: 'nom', label: 'Nouveau nom', required: false },
						{ type: 'choice', id: 'statut', label: 'Statut du profil', required: false, choices: STATUSES.map(({ name, value }) => ({ label: name, value })) },
					],
					onConfirm: async (values) => {
						const user = await interaction.guild.members.fetch(values.utilisateur).catch(() => null);
						const profile = await Personnel.updateInfo(values.utilisateur, {
							firstName: values.prenom || undefined,
							lastName: values.nom || undefined,
							status: values.statut || undefined,
						});
						return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle('Profil modifié').setDescription(`Les informations de <@${profile.discordId}> ont été mises à jour.${user ? ` (${user.user.tag})` : ''}`));
					},
				});
			}
			if (subcommand === 'division') {
				return runPersonnelForm({
					interaction,
					title: 'Affecter une division',
					description: 'Sélectionnez le membre et la division à appliquer, puis confirmez.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
						{ type: 'choice', id: 'division', label: 'Division', required: true, choices: [...DIVISIONS.map(({ name, value }) => ({ label: name, value })), { label: 'Aucune', value: 'aucune' }] },
						{ type: 'text', id: 'rang', label: 'Rang de division (ID, optionnel)', required: false },
					],
					onConfirm: async (values) => {
						const user = await interaction.guild.members.fetch(values.utilisateur).catch(() => null);
						const previousProfile = await Personnel.getProfile(values.utilisateur);
						const division = values.division === 'aucune' ? null : values.division;
						const profile = await Personnel.setDivision(values.utilisateur, division, values.rang || undefined);
						await syncPersonnelRoles(interaction, values.utilisateur, previousProfile, profile);
						return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle('Division mise à jour').setDescription(`${user ? user : `<@${values.utilisateur}>`} : ${profile.division ? `${profile.division}, rang ${rankLabel(profile.divisionRankId)}` : 'aucune division'}; rang BG ${rankLabel(profile.branchRankId)}; IRA ${profile.ira}.`));
					},
				});
			}
			if (subcommand === 'branche') {
				return runPersonnelForm({
					interaction,
					title: 'Changer de branche',
					description: 'Choisissez la nouvelle branche et le rang associé avant validation.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
						{ type: 'choice', id: 'branche', label: 'Nouvelle branche', required: true, choices: BRANCHES.map(({ name, value }) => ({ label: name, value })) },
						{ type: 'choice', id: 'division', label: 'Division (BG uniquement)', required: false, choices: [...DIVISIONS.map(({ name, value }) => ({ label: name, value })), { label: 'Aucune', value: 'aucune' }] },
						{ type: 'text', id: 'rang', label: 'Rang de départ (ID, optionnel)', required: false },
					],
					onConfirm: async (values) => {
						const user = await interaction.guild.members.fetch(values.utilisateur).catch(() => null);
						const previousProfile = await Personnel.getProfile(values.utilisateur);
						const profile = await Personnel.setBranch(values.utilisateur, values.branche, values.division === 'aucune' ? null : values.division || null, values.rang || null);
						await syncPersonnelRoles(interaction, values.utilisateur, previousProfile, profile);
						return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle('Branche modifiée').setDescription(`${user ? user : `<@${values.utilisateur}>`} : **${branchLabel(profile.branch)}**${profile.division ? ` · ${profile.division}` : ''}, rang **${rankLabel(profile.divisionRankId || profile.branchRankId)}** (IRA ${profile.ira}).`));
					},
				});
			}
			if (subcommand === 'rang') {
				return runPersonnelForm({
					interaction,
					title: 'Définir un rang',
					description: 'Choisissez le membre concerné. Le menu de rang sera adapté à son échelle.',
					fields: [{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true }],
					onConfirm: async (values) => {
						const discordId = values.utilisateur;
						const selectedProfile = await Personnel.getProfile(discordId);
						if (!selectedProfile) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
						const choices = getLadder(selectedProfile.branch, selectedProfile.division)
							.map(({ id, label }) => ({ label, value: id }));
						if (!choices.length) return replyError(interaction, 'Aucune échelle de rang n’est configurée pour ce membre.');
						return runPersonnelForm({
							interaction,
							followUp: true,
							title: 'Choisir un nouveau rang',
							description: `Sélectionnez un rang de l’échelle ${selectedProfile.division || selectedProfile.branch}, puis confirmez.`,
							fields: [{ type: 'choice', id: 'rang', label: 'Nouveau rang', required: true, choices }],
							onConfirm: async (rankValues) => {
								const previousProfile = await Personnel.getProfile(discordId);
								if (!previousProfile) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
								const validRank = getLadder(previousProfile.branch, previousProfile.division)
									.some((rank) => rank.id === rankValues.rang);
								if (!validRank) return replyError(interaction, 'L’échelle du membre a changé. Relancez la commande pour choisir un rang valide.');
								const user = await interaction.guild.members.fetch(discordId).catch(() => null);
								const profile = await Personnel.setRank(discordId, rankValues.rang);
								await syncPersonnelRoles(interaction, discordId, previousProfile, profile);
								return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle('Rang modifié').setDescription(`${user ? user : `<@${discordId}>`} est maintenant **${rankLabel(profile.divisionRankId || profile.branchRankId)}** (IRA ${profile.ira}).`));
							},
						});
					},
				});
			}
			if (subcommand === 'supprimer') {
				return runPersonnelForm({
					interaction,
					title: 'Supprimer un profil',
					description: 'Sélectionnez le membre à supprimer, puis confirmez la suppression.',
					fields: [{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true }],
					onConfirm: async (values) => {
						const user = await interaction.guild.members.fetch(values.utilisateur).catch(() => null);
						const profile = await Personnel.getProfile(values.utilisateur);
						if (!profile) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
						const prompt = new Prompt({
							title: 'Confirmer la suppression',
							description: `Supprimer le profil de ${profile.firstName} ${profile.lastName} (${user ? user.user.tag : `<@${values.utilisateur}>`}) ? Ses activités et sanctions seront également supprimées.`,
							color: 0xed4245,
							buttons: [
								{ label: 'Supprimer', style: ButtonStyle.Danger, callback: async (buttonInteraction) => {
									await Personnel.deleteProfile(values.utilisateur);
									await syncPersonnelRoles(buttonInteraction, values.utilisateur, profile, null);
									await buttonInteraction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Profil supprimé').setDescription(`Le profil de ${user ? user.user.tag : `<@${values.utilisateur}>`} et ses données associées ont été supprimés.`)], components: [] });
								} },
								{ label: 'Annuler', style: ButtonStyle.Secondary, callback: async (buttonInteraction) => {
									await buttonInteraction.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('Suppression annulée')], components: [] });
								} },
							],
						});
						await prompt.send(interaction, { flags: MessageFlags.Ephemeral, time: 120_000 });
						return;
					},
				});
			}
		}
		catch (error) {
			return replyServiceError(interaction, error);
		}
	},
};