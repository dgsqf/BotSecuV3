const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	UserSelectMenuBuilder,
	StringSelectMenuBuilder,
	MessageFlags,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const Personnel = require('../../framework_utils/Personnel.js');
const config = require('../../config.json');
const {
	requirePermission,
	replyError,
	replyServiceError,
	syncPersonnelRoles,
} = require('../../framework_utils/PersonnelDiscord.js');

const buildPicker = (selectedIds, preview = null) => {
	const rows = [new ActionRowBuilder().addComponents(
		new UserSelectMenuBuilder()
			.setCustomId('promotion:users')
			.setPlaceholder('Choisir ou ajouter des membres')
			.setMinValues(1)
			.setMaxValues(25),
	)];
	if (preview?.length && selectedIds.length) {
		rows.push(new ActionRowBuilder().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId('promotion:remove')
				.setPlaceholder('Retirer un ou plusieurs membres')
				.setMinValues(1)
				.setMaxValues(selectedIds.length)
				.addOptions(preview.map(({ discordId, label }) => ({ label: label.slice(0, 100), value: discordId }))),
		));
	}
	rows.push(new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId('promotion:preview').setLabel(preview ? 'Actualiser l’aperçu' : 'Afficher l’aperçu').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId('promotion:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
		...(preview?.length ? [new ButtonBuilder().setCustomId('promotion:confirm').setLabel('Confirmer').setStyle(ButtonStyle.Success)] : []),
	));
	return rows;
};

const buildPreview = async (selectedIds) => {
	const entries = [];
	const rankCountsByScale = new Map();
	const reservedSlots = new Map();
	for (const discordId of selectedIds) {
		const profile = await Personnel.getProfile(discordId);
		let result = await Personnel.previewPromotion(discordId);
		if (profile && result.ok) {
			const rankId = profile.division ? result.to.divisionRankId : result.to.branchRankId;
			const limit = Personnel.getRankLimit(profile.branch, profile.division, rankId);
			if (limit != null) {
				const scaleKey = `${profile.branch}:${profile.division || ''}`;
				if (!rankCountsByScale.has(scaleKey)) rankCountsByScale.set(scaleKey, await Personnel.getRankCounts(profile.branch, profile.division));
				const slotKey = `${scaleKey}:${rankId}`;
				const occupancy = (rankCountsByScale.get(scaleKey)[rankId] || 0) + (reservedSlots.get(slotKey) || 0);
				if (occupancy >= limit) result = { ok: false, reason: `Le rang « ${result.to.label} » est complet (${occupancy}/${limit} membres actifs).` };
				else reservedSlots.set(slotKey, (reservedSlots.get(slotKey) || 0) + 1);
			}
		}
		entries.push({
			discordId,
			label: profile ? `${profile.firstName} ${profile.lastName} (${discordId})` : discordId,
			profile,
			result,
		});
	}
	const lines = entries.map(({ label, result }) => result.ok
		? `• ${label} : **${result.from.label} → ${result.to.label}**${result.iraChanged ? ` (IRA ${result.from.ira} → ${result.to.ira})` : ''}`
		: `• ${label} : échec prévu, ${result.reason}`);
	return {
		entries,
		embed: new EmbedBuilder()
			.setColor(entries.some(({ result }) => !result.ok) ? 0xfee75c : 0x5865f2)
			.setTitle('Aperçu de la vague de promotions')
			.setDescription(lines.join('\n').slice(0, 4000) || 'Sélectionnez au moins un membre.')
			.setFooter({ text: `${selectedIds.length} membre(s) sélectionné(s)` }),
	};
};

const publishResults = async (interaction, result, note) => {
	for (const change of result.succès) {
		await syncPersonnelRoles(interaction, change.discordId, {
			branch: change.branch,
			branchRankId: change.from.branchRankId,
			division: change.division,
			divisionRankId: change.from.divisionRankId,
		}, {
			branch: change.branch,
			branchRankId: change.to.branchRankId,
			division: change.division,
			divisionRankId: change.to.divisionRankId,
		});
	}
	const channel = await interaction.client.channels.fetch(config.promotionChannelId).catch((error) => {
		interaction.client.log('PROMOTION', 'ERROR', `Impossible de récupérer le salon de promotion : ${error.stack || error}`);
		return null;
	});
	if (!channel?.isTextBased()) throw new Error('Le salon public des promotions est absent ou invalide.');
	const lines = [
		...result.succès.map(({ discordId, from, to, iraChanged }) => `• <@${discordId}> : **${from.label} → ${to.label}**${iraChanged ? ` (IRA ${from.ira} → ${to.ira})` : ''}`),
		...result.échecs.map(({ discordId, reason }) => `• <@${discordId}> : non promu (${reason})`),
	];
	const embed = new EmbedBuilder()
		.setColor(result.échecs.length ? 0xfee75c : 0x57f287)
		.setTitle('Vague de promotions')
		.setDescription(`${lines.join('\n').slice(0, 4000) || 'Aucun changement.'}${note ? `\n\n**Note :** ${note.slice(0, 500)}` : ''}`)
		.setFooter({ text: `Vague appliquée par ${interaction.user.tag}` })
		.setTimestamp();
	await channel.send({ embeds: [embed], allowedMentions: { parse: [], users: result.succès.map(({ discordId }) => discordId) } });
	if (config.promotionDirectMessages) {
		for (const change of result.succès) {
			const user = await interaction.client.users.fetch(change.discordId).catch(() => null);
			await user?.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Promotion').setDescription(`Vous passez de **${change.from.label}** à **${change.to.label}**.`)] }).catch((error) => interaction.client.log('PROMOTION', 'WARN', `MP de promotion impossible pour <@${change.discordId}> (${error.code || 'erreur inconnue'}).`));
		}
	}
};

const isDiscordId = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);

module.exports = {
	cooldown: 30,
	data: new SlashCommandBuilder()
		.setName('promotion')
		.setDescription('Gère les promotions du personnel.')
		.addSubcommand((subcommand) => subcommand.setName('vague').setDescription('Prépare et applique une vague de promotions.')
			.addStringOption((option) => option.setName('note').setDescription('Note facultative de la vague').setMaxLength(500))),
	async execute(interaction) {
		if (!await requirePermission(interaction, 'staff')) return;
		if (!isDiscordId(config.promotionChannelId)) return replyError(interaction, 'Remplacez la valeur promotionChannelId dans config.json par l’ID du salon public des promotions.', 'Configuration incomplète');
		const note = interaction.options.getString('note') || '';
		const selectedIds = [];
		try {
			await interaction.reply({
				embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Préparer une vague').setDescription('Sélectionnez jusqu’à 25 membres, puis demandez l’aperçu.')],
				components: buildPicker(selectedIds),
				flags: MessageFlags.Ephemeral,
			});
			const message = await interaction.fetchReply();
			const collector = message.createMessageComponentCollector({ time: 15 * 60_000 });
			let currentPreview = null;
			collector.on('collect', async (component) => {
				if (component.user.id !== interaction.user.id) {
					await component.reply({ content: 'Cette préparation de vague appartient à un autre utilisateur.', flags: MessageFlags.Ephemeral });
					return;
				}
				if (component.customId === 'promotion:users') {
					for (const user of component.users.values()) if (!user.bot && !selectedIds.includes(user.id) && selectedIds.length < 25) selectedIds.push(user.id);
					currentPreview = null;
					await component.update({
						embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Préparer une vague').setDescription(`${selectedIds.length} membre(s) sélectionné(s). Vous pouvez en ajouter, puis demander l’aperçu.`)],
						components: buildPicker(selectedIds),
					});
					return;
				}
				if (component.customId === 'promotion:cancel') {
					collector.stop('cancelled');
					await component.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('Vague annulée')], components: [] });
					await interaction.editReply({ components: [] }).catch(() => null);
					return;
				}
				if (component.customId === 'promotion:remove') {
					const removed = new Set(component.values);
					for (let index = selectedIds.length - 1; index >= 0; index--) if (removed.has(selectedIds[index])) selectedIds.splice(index, 1);
					currentPreview = selectedIds.length ? await buildPreview(selectedIds) : null;
					await component.update({
						embeds: [currentPreview?.embed || new EmbedBuilder().setColor(0x5865f2).setTitle('Préparer une vague').setDescription('Sélectionnez au moins un membre.')],
						components: buildPicker(selectedIds, currentPreview?.entries),
					});
					return;
				}
				if (component.customId === 'promotion:preview') {
					if (!selectedIds.length) return component.reply({ content: 'Sélectionnez au moins un membre.', flags: MessageFlags.Ephemeral });
					currentPreview = await buildPreview(selectedIds);
					await component.update({ embeds: [currentPreview.embed], components: buildPicker(selectedIds, currentPreview.entries) });
					return;
				}
				if (component.customId === 'promotion:confirm') {
					if (!currentPreview || currentPreview.awaitingConfirmation) return component.deferUpdate();
					currentPreview.awaitingConfirmation = true;
					const promotableIds = currentPreview.entries.filter(({ result }) => result.ok).map(({ discordId }) => discordId);
					if (!promotableIds.length) return component.reply({ content: 'Aucun membre de la sélection ne peut être promu.', flags: MessageFlags.Ephemeral });
					const prompt = new Prompt({
						title: 'Confirmer la vague',
						description: `Confirmer la promotion de ${promotableIds.length} membre(s) ? Un récapitulatif sera publié dans le salon configuré.`,
						color: 0xfee75c,
						buttons: [
							{ label: 'Confirmer', style: ButtonStyle.Success, callback: async (confirmation) => {
								if (currentPreview.confirmed) return confirmation.deferUpdate();
								currentPreview.confirmed = true;
								collector.stop('confirmed');
								await confirmation.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('Vague en cours')], components: [] });
								const result = await Personnel.applyPromotions(interaction.client, interaction.user.id, promotableIds.map((discordId) => ({ discordId })), note);
								result.échecs.push(...currentPreview.entries
									.filter(({ result: previewResult }) => !previewResult.ok)
									.map(({ discordId, result: previewResult }) => ({ discordId, reason: previewResult.reason })));
								try {
									await publishResults(interaction, result, note);
									await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Vague terminée').setDescription(`${result.succès.length} promotion(s) appliquée(s), ${result.échecs.length} échec(s). Le récapitulatif a été publié.`)], components: [] });
								}
								catch (error) {
									await interaction.client.log('PROMOTION', 'ERROR', `Vague appliquée mais publication impossible : ${error.stack || error}`);
									await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Publication impossible').setDescription('Les changements en base sont appliqués, mais le récapitulatif public n’a pas pu être envoyé. Contactez un administrateur.')], flags: MessageFlags.Ephemeral });
								}
							} },
							{ label: 'Annuler', style: ButtonStyle.Secondary, callback: async (confirmation) => {
								if (currentPreview.confirmed) return confirmation.deferUpdate();
								currentPreview.confirmed = true;
								collector.stop('cancelled');
								await confirmation.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('Vague annulée')], components: [] });
								await interaction.editReply({ components: [] }).catch(() => null);
							} },
						],
					});
					const confirmation = await prompt.send(component, { flags: MessageFlags.Ephemeral, time: 120_000 });
					confirmation.collector.on('end', () => {
						if (!currentPreview.confirmed) currentPreview.awaitingConfirmation = false;
					});
				}
			});
			collector.on('end', async (_collected, reason) => {
				if (reason === 'time') await interaction.editReply({ components: [] }).catch(() => null);
			});
		}
		catch (error) {
			return replyServiceError(interaction, error);
		}
	},
};