/* eslint-disable no-inline-comments */
const {
	SlashCommandBuilder,
	MessageFlags,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	ButtonStyle,
	ChannelType,
} = require('discord.js');
const { time, TimestampStyles, userMention } = require('discord.js');
const Form = require('../../framework_utils/Form.js');
const Prompt = require('../../framework_utils/Prompt.js');
const { recruitmentCategoryId, recruitmentAcceptedRoleIds = [], recruitmentResultChannelId, rapportForumChannelId } = require('../../config.json');

const getUserReportThread = async (forumChannel, username) => {
	const normalizedUsername = username.toLowerCase();
	const cachedThread = forumChannel?.threads?.cache.find((thread) => thread.name?.toLowerCase() === normalizedUsername);
	if (cachedThread) return cachedThread;

	const fetchedThreads = await forumChannel.threads.fetch();
	const threadCollection = fetchedThreads?.threads ?? fetchedThreads ?? [];
	return threadCollection.find((thread) => thread.name?.toLowerCase() === normalizedUsername) ?? null;
};

const createRecruitmentPrompt = (data, meta, salon) => {
	const embedValue = (value, fallback = 'Non renseigné') => String(value ?? fallback).slice(0, 1024);
	const storedData = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? '').slice(0, 300)]));
	const safeTimestamp = (() => {
		const rawTimestamp = meta?.timestamp;
		const date = rawTimestamp instanceof Date ? rawTimestamp : new Date(rawTimestamp ?? Date.now());
		return Number.isNaN(date.getTime()) ? new Date() : date;
	})();
	const fields = [{ name: '', value: '\u200b' }];
	const pushSection = (label, entries) => {
		if (!entries.length) return;
		if (fields.length > 0) {
			fields.push({ name: '────────────────────', value: '\u200b' });
		}
		fields.push({ name: `▸ ${label}`, value: '\u200b' });
		fields.push(...entries);
	};
	const metaFields = [
		{ name: 'Nom d\'utilisateur', value: embedValue(meta.username), inline: true },
		{ name: 'ID utilisateur', value: userMention(meta.user_id), inline: true },
		{ name: 'Timestamp', value: time(safeTimestamp, TimestampStyles.FullDateShortTime) },
	];
	pushSection('Informations sur le candidat', metaFields);
	const generalFields = [];
	if (data.general_0) {
		generalFields.push({ name: 'Que savez-vous du département de la sécurité de la fondation SCP?', value: embedValue(data.general_0) });
	}
	if (data.general_1) {
		generalFields.push({ name: 'Que représente Site - Lethe pour vous?', value: embedValue(data.general_1) });
	}
	if (data.general_2) {
		generalFields.push({ name: 'Depuis quand êtes vous sur SCP Roleplay?', value: embedValue(data.general_2) });
	}
	if (data.general_3) {
		generalFields.push({ name: 'Quelles expérience avez-vous déjà eu dans la sécurité (pas forcement sur SCP) ?', value: embedValue(data.general_3) });
	}
	if (data.general_4) {
		generalFields.push({ name: 'Quelle est votre objectif en rejoignant la sécurité', value: embedValue(data.general_4) });
	}
	if (data.general_5) {
		generalFields.push({ name: 'Depuis quand faite-vous du roleplay (pas forcement SCP) ?', value: embedValue(data.general_5) });
	}
	if (data.general_6) {
		generalFields.push({ name: 'Qu\'est-ce qui vous a donné envie de rejoindre le département de la sécurité?', value: embedValue(data.general_6) });
	}
	pushSection('Général', generalFields);

	const quizzFields = [];
	if (data.quizz_0) {
		quizzFields.push({ name: 'Dans la liste suivante quelle division de la sécurité n\'existe pas ?', value: embedValue(data.quizz_0) });
	}
	if (data.quizz_1) {
		quizzFields.push({ name: 'Dans la liste suivante quelle SCP n\'est pas sur site-lethe ?', value: embedValue(data.quizz_1) });
	}
	if (data.quizz_2) {
		quizzFields.push({ name: 'Dans la liste suivante quelle SCP est de classe Safe ?', value: embedValue(data.quizz_2) });
	}
	if (data.quizz_3) {
		quizzFields.push({ name: 'Dans la liste suivante quelle SCP est de classe Euclid ?', value: embedValue(data.quizz_3) });
	}
	if (data.quizz_4) {
		quizzFields.push({ name: 'Dans la liste suivante quelle SCP est de classe Keter ?', value: embedValue(data.quizz_4) });
	}
	if (data.quizz_5) {
		quizzFields.push({ name: 'Quelle classe de SCP est utilisé pour les anomalies les plus compliqué à confiner ?', value: embedValue(data.quizz_5) });
	}
	if (data.quizz_6) {
		quizzFields.push({ name: 'Quelle classe de SCP est utilisé pour les anomalies les plus facile à confiner ?', value: embedValue(data.quizz_6) });
	}
	pushSection('Questions à choix multiples', quizzFields);


	return new Prompt({
		title: 'Une nouvelle candidature a été soumise !',
		description: 'Lisez chaque réponse attentivement avant de prendre une décision. Vous pouvez accepter ou refuser la candidature en utilisant les boutons ci-dessous.',
		fields: fields,
		color: 0x0099ff,
		metadata: { type: 'recruitment', data: storedData, meta },
		buttons: [
			{
				customId: 'recruitment:accept',
				label: 'Accepter',
				style: ButtonStyle.Success,
				callback: async (buttonInteraction) => {
					await buttonInteraction.deferUpdate();
					const notified = false;
					try {
						const candidat = await buttonInteraction.guild.members.fetch(meta.user_id);
						const roleIds = Array.isArray(recruitmentAcceptedRoleIds)
							? recruitmentAcceptedRoleIds.filter(Boolean)
							: [recruitmentAcceptedRoleIds].filter(Boolean);
						if (roleIds.length) await candidat.roles.add(roleIds);
						const acceptanceEmbed = new EmbedBuilder()
							.setColor(0x57f287)
							.setTitle('Candidature acceptée')
							.setDescription('Félicitations, votre candidature pour rejoindre le département de la sécurité a été acceptée.\nVous devez désormais entrer en contact avec le département des Ressources Humaines pour finaliser votre intégration dans le Département de la Sécurité du Site-Lethe.')
							.setTimestamp();
						await candidat.send({ embeds: [acceptanceEmbed] });
						resultChannel = await buttonInteraction.guild.channels.fetch(recruitmentResultChannelId);
						resultEmbed = new EmbedBuilder()
							.setColor(0x57f287)
							.setTitle('Candidature acceptée')
							.setDescription(`La candidature de ${userMention(meta.user_id)} a été acceptée.`)
							.setFooter({ text: `Accepté par ${buttonInteraction.user.tag}`, iconURL: buttonInteraction.user.displayAvatarURL() })
							.setTimestamp();
						if (resultChannel?.isTextBased()) {

							await resultChannel.send({
								embeds: [resultEmbed],
							});
						}
						const Rapportchannel = await buttonInteraction.guild.channels.fetch(rapportForumChannelId);
						try {
							const existingThread = await getUserReportThread(Rapportchannel, meta.username);
							if (existingThread) {
								console.log(`[RECRUTEMENT : ${new Date().toLocaleString()}] Thread du rapport déjà existant pour ${meta.username} (${meta.user_id})`);
							}
							else {
								const embed = new EmbedBuilder()
									.setColor(0x2F3136)
									.setAuthor({ name: '[C.S.A - CUSTODIAN-IV]' })
									.setDescription(`Ouverture du dossier rapport de \`${meta.username}\`\n`)
									.addFields(
										{ name: 'Nom d\'utilisateur', value: embedValue(meta.username), inline: true },
										{ name: 'ID utilisateur', value: userMention(meta.user_id), inline: true },
										{ name: 'Crée le : ', value: time(safeTimestamp, TimestampStyles.FullDateShortTime) },
									)
									.setTimestamp();
								await Rapportchannel.threads.create({
									name: meta.username,
									message: { embeds: [embed] },
								});
								console.log(`[RECRUTEMENT : ${new Date().toLocaleString()}] Thread du rapport créé pour ${meta.username} (${meta.user_id})`);
							}
						}
						catch (error) {
							console.error(`[RECRUTEMENT : ${new Date().toLocaleString()}] Impossible de créer le thread du rapport: ${error}`);
						}
					}
					catch (error) {
						console.error(`[RECRUTEMENT : ${new Date().toLocaleString()}] Erreur lors de l'acceptation de la candidature: ${error}`);
					}

					if (!notified) {
						try {
							await buttonInteraction.followUp({
								content: 'Le candidat n\'a pas pu être notifié par MP (membre introuvable ou MPs fermés).',
								flags: MessageFlags.Ephemeral,
							});
						}
						catch { /* le salon est peut-être déjà en cours de suppression */ }
					}

					try {
						await salon.delete('Candidature acceptée');
					}
					catch (error) {
						console.error(`[RECRUTEMENT : ${new Date().toLocaleString()}] Impossible de supprimer le salon de candidature: ${error}`);
					}
				},
			},
			{
				customId: 'recruitment:reject',
				label: 'Refuser',
				style: ButtonStyle.Danger,
				callback: async (buttonInteraction) => {
					const rejectionModalId = `recruitment-rejection-${meta.user_id}-${Date.now()}`;
					const modal = new ModalBuilder().setCustomId(rejectionModalId).setTitle('Motif du refus');
					const reasonInput = new TextInputBuilder()
						.setCustomId('reason').setLabel('Motif du refus').setStyle(TextInputStyle.Paragraph)
						.setRequired(true).setMinLength(1).setMaxLength(1000);
					modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
					await buttonInteraction.showModal(modal);

					let modalSubmit;
					try {
						modalSubmit = await buttonInteraction.awaitModalSubmit({
							time: 5 * 60_000,
							filter: (modalInteraction) => modalInteraction.customId === rejectionModalId
								&& modalInteraction.user.id === buttonInteraction.user.id,
						});
					}
					catch (error) {
						console.error(`[RECRUTEMENT : ${new Date().toLocaleString()}] Le motif du refus n'a pas été soumis à temps: ${error}`);
						return;
					}

					const reason = modalSubmit.fields.getTextInputValue('reason').trim();
					await modalSubmit.deferUpdate();
					let notified = false;
					try {
						const candidat = await buttonInteraction.guild.members.fetch(meta.user_id);
						const rejectionEmbed = new EmbedBuilder()
							.setColor(0xed4245).setTitle('Candidature refusée')
							.setDescription('Votre candidature pour rejoindre le département de la sécurité n’a pas été retenue.')
							.addFields({ name: 'Motif du refus', value: reason }).setTimestamp();
						await candidat.send({ embeds: [rejectionEmbed] });
						salonResultat = await buttonInteraction.guild.channels.fetch(recruitmentResultChannelId);
						resultEmbed = new EmbedBuilder()
							.setColor(0xed4245)
							.setTitle('Candidature refusée')
							.setDescription(`La candidature de ${userMention(meta.user_id)} a été refusée.`)
							.setFooter({ text: `Refusé par ${buttonInteraction.user.tag}`, iconURL: buttonInteraction.user.displayAvatarURL() })
							.setTimestamp();
						if (salonResultat?.isTextBased()) {
							await salonResultat.send({
								embeds: [resultEmbed],
							});
						}
						notified = true;
					}
					catch (error) {
						console.error(`[RECRUTEMENT : ${new Date().toLocaleString()}] Impossible d’envoyer le refus au candidat: ${error}`);
					}

					if (!notified) {
						try {
							await modalSubmit.followUp({
								content: 'Le candidat n\'a pas pu être notifié par MP (membre introuvable ou MPs fermés).',
								flags: MessageFlags.Ephemeral,
							});
						}
						catch { /* le salon est peut-être déjà en cours de suppression */ }
					}

					try {
						await salon.delete('Candidature refusée');
					}
					catch (error) {
						console.error(`[RECRUTEMENT : ${new Date().toLocaleString()}] Impossible de supprimer le salon de candidature: ${error}`);
					}
				},
			},
		],
	});
};

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder().setName('recrutement').setDescription('Ouvre le formulaire de recrutement pour le département de la sécurité.'),
	async restore(client) {
		let restored = 0;
		for (const guild of client.guilds.cache.values()) {
			const channels = guild.channels.cache.filter((channel) => channel.parentId === recruitmentCategoryId
                && channel.isTextBased());
			for (const channel of channels.values()) {
				const messages = await channel.messages.fetch({ limit: 100 });
				for (const message of messages.values()) {
					const metadata = Prompt.readMetadata(message);
					if (metadata?.type !== 'recruitment' || !metadata.data || !metadata.meta) continue;
					const prompt = createRecruitmentPrompt(metadata.data, metadata.meta, channel);
					const messageButtonIds = message.components
						.flatMap((row) => row.components)
						.map((component) => component.customId)
						.filter(Boolean);
					prompt.buttons.forEach((button, index) => {
						if (messageButtonIds[index]) button.customId = messageButtonIds[index];
					});
					await prompt.attach(message);
					restored += 1;
				}
			}
		}
		console.log(`[RECRUTEMENT : ${new Date().toLocaleString()}] ${restored} prompt(s) de recrutement restauré(s).`);
	},
	async execute(interaction) {
		const formulaire = new Form({
			title: 'Formulaire de recrutement',
			description: 'Veuillez remplir le formulaire ci-dessous pour postuler au département de la sécurité.',
		})
			.section('Général', 'Ces questions ne comportent pas de "mauvaises" réponses, elles servent simplement à mieux vous connaitre ', (form) => {
				form.questions('general',
					['Que savez-vous du département de la sécurité de la fondation SCP ? :',
						'Que représente Site - Lethe pour vous ? :',
						'Depuis quand êtes vous sur SCP Roleplay ? :',
						'Quelles expérience avez-vous déjà eu dans la sécurité (pas forcement sur SCP) ?',
						'Quelle est votre objectif en rejoignant la sécurité ? :',
						'Depuis quand faite-vous du roleplay (pas forcement SCP) ? :',
						'Qu \'est-ce qui vous a donné envie de rejoindre le département de la sécurité ? :',
					], { count: 2 });
			})

			.section('Question à choix multiples', 'Les prochaines questions sont des questions de connaissance sur la Fondation SCP et les anomalies, Un trop grand nombre de mauvaises réponse pourrait causer un refus. Néanmoins, vous ne devez pas : \n - Utiliser de l\'intelligence artificielle ou tout autre outil pour répondre aux questions. \n - Demander de l\'aide à d\'autres personnes pour répondre aux questions. \n - Chercher les réponses sur internet.', (form) => {
				form.qcm('quizz', [
					{ question: 'Dans la liste suivante quelle division de la sécurité n\'existe pas ? :', choices: ['Unité de Lutte contre les dangers Biologiques', 'Unité de Protection Rapprochée', 'Unité de Renseignements Centrale'] },
					{ question: 'Dans la liste suivante quelle SCP n\'est pas sur site-lethe ?:	', choices: ['SCP-426', 'SCP-096', 'SCP-999'] },
					{ question: 'Dans la liste suivante quelle SCP est de classe Safe ? :', choices: ['SCP-173', 'SCP-999', 'SCP-096'] },
					{ question: 'Dans la liste suivante quelle SCP est de classe Euclid ? :', choices: ['SCP-106', 'SCP-131', 'SCP-008'] },
					{ question: 'Dans la liste suivante quelle SCP est de classe Keter ? :', choices: ['SCP-1025', 'SCP-076', 'SCP-049'] },
					{ question: 'Quelle classe de SCP est utilisé pour les anomalies les plus compliqué à confiner ? :', choices: ['Safe', 'Euclid', 'Keter'] },
					{ question: 'Quelle classe de SCP est utilisé pour les anomalies les plus facile à confiner ? :', choices: ['Safe', 'Euclid', 'Keter'] },
				], { count: 3 });
			});
		await formulaire.send(interaction, {
			ephemeral: true,
			onConfirm: async (data, meta) => {
				const salon = await interaction.guild.channels.create({
					name: `candidature-${meta.username}`,
					type: ChannelType.GuildText,
					parent: recruitmentCategoryId,
					permissionOverwrites: [
						{
							id: interaction.guild.roles.everyone.id,
							deny: ['ViewChannel'],
						},
						{
							id: meta.user_id,
							allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
						},
					],
				});

				const prompt = createRecruitmentPrompt(data, meta, salon);
				await prompt.send(salon);
				console.log(`[Recrutement : ${new Date().toLocaleString()}] Nouvelle candidature soumise par ${meta.username} (${meta.user_id})`);
				const responseEmbed = new EmbedBuilder()
					.setColor(0x0099ff)
					.setTitle('Candidature soumise')
					.setDescription('Merci d\'avoir soumis votre candidature ! \n\nVeuillez patienter pendant que notre équipe examine votre candidature. Vous recevrez une notification lorsque votre candidature aura été traitée.')
					.setTimestamp();
				const response = {
					embeds: [responseEmbed],
					flags: MessageFlags.Ephemeral,
				};

				if (interaction.deferred || interaction.replied) {
					await interaction.followUp(response);
				}
				else {
					await interaction.reply(response);
				}
			},
		});
	},
};