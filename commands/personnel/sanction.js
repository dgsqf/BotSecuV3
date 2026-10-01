const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	MessageFlags,
} = require('discord.js');
const config = require('../../config.json');
const Personnel = require('../../framework_utils/Personnel.js');
const {
	requirePermission,
	reply,
	replyError,
	replyServiceError,
	runPersonnelForm,
} = require('../../framework_utils/PersonnelDiscord.js');

const sanctionChoices = (config.sanctionTypes || []).slice(0, 25).map((type) => ({ name: type, value: type }));
const data = new SlashCommandBuilder()
	.setName('sanction')
	.setDescription('Gère les sanctions du personnel.')
	.addSubcommand((subcommand) => subcommand.setName('ajouter').setDescription('Ajoute une sanction à un membre.'))
	.addSubcommand((subcommand) => subcommand.setName('historique').setDescription('Consulte les sanctions d’un membre.'))
	.addSubcommand((subcommand) => subcommand.setName('revoquer').setDescription('Révoque une sanction active.'));

const sendHistory = async (interaction, user, includeRevoked) => {
	let page = 1;
	const build = async () => {
		const result = await Personnel.getSanctions(user.id, { includeRevoked, limit: 5, page });
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(`Sanctions de ${user.tag}`)
			.setFooter({ text: `Page ${page}/${result.totalPages}` });
		if (!result.rows.length) embed.setDescription('Aucune sanction à afficher.');
		for (const sanction of result.rows) {
			embed.addFields({
				name: `Dossier #${sanction.case_number} · ${sanction.type}${sanction.revoked_at ? ' · Révoquée' : ''}`,
				value: `Motif : ${sanction.reason}\nÉmise par <@${sanction.issuer_id}> · <t:${Math.floor(new Date(sanction.created_at).getTime() / 1000)}:f>${sanction.revoked_at ? `\nRévoquée par <@${sanction.revoked_by}> : ${sanction.revoke_reason}` : ''}`.slice(0, 1024),
			});
		}
		return { embed, result };
	};
	const { embed, result } = await build();
	const message = await interaction.reply({
		embeds: [embed],
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('sanction:previous').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(true),
			new ButtonBuilder().setCustomId('sanction:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(result.totalPages <= 1),
		)],
		flags: MessageFlags.Ephemeral,
		fetchReply: true,
	});
	const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
	collector.on('collect', async (component) => {
		if (component.user.id !== interaction.user.id) return component.reply({ content: 'Cet historique appartient à un autre utilisateur.', flags: MessageFlags.Ephemeral });
		page += component.customId === 'sanction:next' ? 1 : -1;
		const current = await build();
		await component.update({
			embeds: [current.embed],
			components: [new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('sanction:previous').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
				new ButtonBuilder().setCustomId('sanction:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(page >= current.result.totalPages),
			)],
		});
	});
	collector.on('end', () => message.edit({ components: [] }).catch(() => null));
};

module.exports = {
	cooldown: 3,
	data,
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (!await requirePermission(interaction, 'staff')) return;
		try {
			if (subcommand === 'ajouter') {
				return runPersonnelForm({
					interaction,
					title: 'Ajouter une sanction',
					description: 'Renseignez le membre, le type et le motif avant confirmation.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
						{ type: 'choice', id: 'type', label: 'Type de sanction', required: true, choices: sanctionChoices },
						{ type: 'text', id: 'raison', label: 'Motif de la sanction', required: true },
					],
					onConfirm: async (values) => {
						const sanction = await Personnel.addSanction(values.utilisateur, values.type, values.raison, interaction.user.id);
						return reply(interaction, new EmbedBuilder().setColor(0xed4245).setTitle(`Sanction créée · dossier #${sanction.case_number}`).setDescription(`Une sanction **${sanction.type}** a été enregistrée pour <@${values.utilisateur}>.\nMotif : ${sanction.reason}`));
					},
				});
			}
			if (subcommand === 'historique') {
				return runPersonnelForm({
					interaction,
					title: 'Historique des sanctions',
					description: 'Choisissez le membre et la visibilité souhaitée pour son historique.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: false },
						{ type: 'boolean', id: 'inclure-revoquees', label: 'Inclure les sanctions révoquées', required: false, default: false },
					],
					onConfirm: async (values) => {
						const user = values.utilisateur ? values.utilisateur : interaction.user.id;
						if (!await Personnel.getProfile(user)) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
						const member = await interaction.guild.members.fetch(user).catch(() => null);
						return await sendHistory(interaction, member ? member.user : { id: user, tag: user }, Boolean(values['inclure-revoquees']));
					},
				});
			}
			return runPersonnelForm({
				interaction,
				title: 'Révoquer une sanction',
				description: 'Renseignez le dossier et le motif de révocation.',
				fields: [
					{ type: 'number', id: 'dossier', label: 'Numéro du dossier', required: true, min: 1 },
					{ type: 'text', id: 'raison', label: 'Motif de révocation', required: true },
				],
				onConfirm: async (values) => {
					const sanction = await Personnel.revokeSanction(Number(values.dossier), interaction.user.id, values.raison);
					return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle(`Dossier #${sanction.case_number} révoqué`).setDescription(`La sanction de <@${sanction.discord_id}> a été révoquée.\nMotif : ${sanction.revoke_reason}`));
				},
			});
		}
		catch (error) {
			return replyServiceError(interaction, error);
		}
	},
};