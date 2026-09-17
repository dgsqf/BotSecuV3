const {
	SlashCommandBuilder,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	ComponentType,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const {
	salonUrgencePanelChannelId,
	PermissionAppelSecuRoleId,
	UrgenceDivisions,
	UrgenceTypes,
} = require('../../config.json');

const OTHER_TYPE_ID = 'autre';
const OTHER_BUTTON_ID = 'urgence:autre';
const REQUIRED_PANEL_ROLE_ID = '1542836944457703454';

const getEmergencyFields = (type) => [
	{ id: 'lieu', label: 'Lieu', placeholder: 'Indiquez le lieu de l urgence', required: true },
	...(type.fields || []).map((field) => ({ ...field, required: false })),
];

const buildModal = (customId, title, fields) => {
	const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
	modal.addComponents(fields.slice(0, 5).map((field) => new ActionRowBuilder().addComponents(
		new TextInputBuilder()
			.setCustomId(field.id)
			.setLabel(field.label.slice(0, 45))
			.setStyle(field.style || TextInputStyle.Short)
			.setPlaceholder((field.placeholder || '').slice(0, 100))
			.setMaxLength(field.maxLength || 4000)
			.setRequired(field.required),
	)));
	return modal;
};

const readModalValues = (modalInteraction, fields) => Object.fromEntries(
	fields.map((field) => [field.id, modalInteraction.fields.getTextInputValue(field.id)]),
);

const getDivisionRoleIds = (division) => {
	const roleIds = division.roleIds ?? division.roleId ?? [];
	return (Array.isArray(roleIds) ? roleIds : [roleIds]).filter(Boolean);
};

const sendEmergency = async (interaction, typeLabel, divisions, values) => {
	const embed = new EmbedBuilder()
		.setColor(0xFF0000)
		.setTitle(`🚨 Appel d'urgence — ${typeLabel}`)
		.addFields(
			{ name: 'Lieu', value: values.lieu },
			...Object.entries(values)
				.filter(([key, value]) => key !== 'lieu' && value)
				.map(([key, value]) => ({ name: key, value })),
			{ name: 'Utilisateur émetteur de l’appel', value: `${interaction.user} (${interaction.user.tag})` },
		)
		.setTimestamp();

	const sentDivisions = [];
	for (const divisionId of divisions) {
		const division = UrgenceDivisions[divisionId];
		if (!division?.channelId) {
			await interaction.client.log('URGENCE', 'ERROR', `Division d'urgence mal configurée: ${divisionId}`);
			continue;
		}
		const channel = await interaction.guild.channels.fetch(division.channelId).catch((error) => {
			interaction.client.log('URGENCE', 'ERROR', `Impossible de récupérer le salon de ${divisionId}: ${error.stack || error}`);
			return null;
		});
		if (!channel?.isTextBased()) continue;
		const roleIds = getDivisionRoleIds(division);
		const roleMention = roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
		await channel.send({
			content: roleMention || undefined,
			embeds: [embed],
			allowedMentions: { roles: roleIds },
		});
		sentDivisions.push(divisionId);
	}

	if (!sentDivisions.length) throw new Error('Aucune division d’urgence correctement configurée.');
};

const replySuccess = (interaction) => interaction.reply({
	embeds: [new EmbedBuilder()
		.setColor(0x00FF00)
		.setTitle('🚨・Appel d’urgence transmis')
		.setDescription('Votre appel d’urgence a été transmis aux divisions concernées.')],
	flags: MessageFlags.Ephemeral,
});

const handleModal = async (buttonInteraction, typeId, divisions = null) => {
	const type = UrgenceTypes[typeId];
	const fields = type ? getEmergencyFields(type) : [
		{ id: 'lieu', label: 'Lieu', placeholder: 'Indiquez le lieu de l urgence', required: true },
		{
			id: 'description',
			label: 'Description courte de l urgence',
			placeholder: 'Décrivez brièvement la situation',
			style: TextInputStyle.Paragraph,
			maxLength: 1000,
			required: true,
		},
	];
	const modalId = `urgence:modal:${typeId}:${buttonInteraction.user.id}:${Date.now()}`;
	await buttonInteraction.showModal(buildModal(modalId, type?.label || 'Autre urgence', fields));

	try {
		const modalInteraction = await buttonInteraction.awaitModalSubmit({
			filter: (submittedInteraction) =>
				submittedInteraction.customId === modalId && submittedInteraction.user.id === buttonInteraction.user.id,
			time: 300000,
		});
		const values = readModalValues(modalInteraction, fields);
		await sendEmergency(modalInteraction, type?.label || 'Autre urgence', divisions || type.divisions, values);
		await replySuccess(modalInteraction);
	}
	catch (error) {
		if (error?.code === 'InteractionCollectorError') return;
		await buttonInteraction.client.log('URGENCE', 'ERROR', `Erreur lors du traitement de l'appel d'urgence: ${error.stack || error}`);
	}
};

const createOtherSelector = async (buttonInteraction) => {
	const divisions = Object.keys(UrgenceDivisions);
	const selected = new Set();
	const selectorId = `${buttonInteraction.user.id}:${Date.now()}`;
	const buildComponents = () => {
		const rows = [];
		for (let index = 0; index < divisions.length; index += 5) {
			rows.push(new ActionRowBuilder().addComponents(divisions.slice(index, index + 5).map((divisionId) => new ButtonBuilder()
				.setCustomId(`urgence:autre:division:${selectorId}:${divisionId}`)
				.setLabel(divisionId)
				.setStyle(selected.has(divisionId) ? ButtonStyle.Success : ButtonStyle.Secondary))));
		}
		rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
			.setCustomId(`urgence:autre:valider:${selectorId}`)
			.setLabel('Valider les divisions')
			.setStyle(ButtonStyle.Primary)));
		return rows;
	};
	const autre_embed = new EmbedBuilder()
		.setColor(0xFF0000)
		.setTitle('Sélection des divisions')
		.setDescription('Sélectionnez les divisions à contacter pour votre appel d’urgence. Vous pouvez sélectionner plusieurs divisions.');
	await buttonInteraction.reply({
		embeds: [autre_embed],
		components: buildComponents(),
		flags: MessageFlags.Ephemeral,
	});
	const message = await buttonInteraction.fetchReply();
	const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
	collector.on('collect', async (interaction) => {
		if (interaction.user.id !== buttonInteraction.user.id) return;
		if (interaction.customId.includes(':division:')) {
			const divisionId = interaction.customId.split(':').pop();
			if (selected.has(divisionId)) selected.delete(divisionId);
			else selected.add(divisionId);
			await interaction.update({ components: buildComponents() });
			return;
		}
		if (!selected.size) {
			await interaction.reply({ content: 'Sélectionnez au moins une division.', flags: MessageFlags.Ephemeral });
			return;
		}
		collector.stop('submitted');
		await handleModal(interaction, OTHER_TYPE_ID, [...selected]);
	});
};

const hasPermission = (interaction) => interaction.member.roles.cache.has(PermissionAppelSecuRoleId);

const createUrgencePanel = () => new Prompt({
	title: '🚨・Appel d\'urgence',
	description: 'Vous êtes en situation d\'urgence ? Cliquez sur le bouton correspondant à votre situation.',
	color: 0xFF0000,
	metadata: { type: 'urgence-panel' },
	buttons: [
		...Object.entries(UrgenceTypes).map(([typeId, type]) => ({
			customId: `urgence:${typeId}`,
			label: type.label,
			style: ButtonStyle.Primary,
			cooldown: 600,
			callback: async (buttonInteraction) => {
				if (!hasPermission(buttonInteraction)) return buttonInteraction.reply({ content: 'Vous n’avez pas la permission d’utiliser cette fonction.', flags: MessageFlags.Ephemeral });
				await handleModal(buttonInteraction, typeId);
			},
		})),
		{
			customId: OTHER_BUTTON_ID,
			label: 'Autre',
			style: ButtonStyle.Secondary,
			cooldown: 600,
			callback: async (buttonInteraction) => {
				if (!hasPermission(buttonInteraction)) return buttonInteraction.reply({ content: 'Vous n’avez pas la permission d’utiliser cette fonction.', flags: MessageFlags.Ephemeral });
				await createOtherSelector(buttonInteraction);
			},
		},
	],
})
	.addField('**Prise d\'otage**', 'Si vous êtes témoin d’une prise d’otage, cliquez sur le bouton « Prise d’otage » pour appeler l\'Équipe d\'Intervention Tactique (EIT)')
	.addField('**Incident biologique**', 'Si vous êtes témoin d’un incident biologique, cliquez sur le bouton « Incident biologique » pour appeler l\'Unité de Lutte contre les dangers Biologique (ULB)')
	.addField('**Brèche de confinement**', 'Si vous êtes témoin d’une brèche de confinement, cliquez sur le bouton « Brèche de confinement » pour appeler l\'Unité de Réponse et de Reconfinement (URR)')
	.addField('**Émeute de Classe-D**', 'Si vous êtes témoin d’une émeute de Classe-D, cliquez sur le bouton « Émeute de Classe-D » pour appeler l\'Équipe d\'Intervention Tactique (EIT) et la Branche Générale (BG)')
	.addField('**RAID hostile**', 'Si vous êtes témoin d’un RAID hostile, cliquez sur le bouton « RAID hostile » pour appeler l\'Équipe d\'Intervention Tactique (EIT) et la Branche Générale (BG)')
	.addField('**Appel Medecin de Combat**', 'Si vous êtes témoin d’une situation nécessitant l’intervention d’un Médecin de Combat, cliquez sur le bouton « Appel Medecin de Combat » pour appeler l\'Unité Médicale de Sécurité (UMS)')
	.addField('**Demande de Protection**', 'Si vous avez besoin de protection rapprochée, cliquez sur le bouton « Demande de Protection » pour appeler l\'Équipe de Protection Rapprochée (EPR)')
	.addField('**Autre**', 'Si votre situation d’urgence n’est pas listée, cliquez sur le bouton « Autre » pour sélectionner les divisions à contacter et fournir une description de la situation.')
	.addField('**Remarque**', '**Veuillez noter que l’utilisation abusive de cette fonction peut entraîner des sanctions. Utilisez-la uniquement en cas d’urgence réelle.**')
    ;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('urgence-panel')
		.setDescription('Affiche le panneau d’appel d’urgence.'),

	async execute(interaction) {
		if (!interaction.member.roles.cache.has(REQUIRED_PANEL_ROLE_ID)) {
			return interaction.reply({
				embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('Accès refusé').setDescription('Vous devez posséder le rôle requis pour utiliser cette commande.')],
				flags: MessageFlags.Ephemeral,
			});
		}
		await createUrgencePanel().send(await interaction.client.channels.fetch(salonUrgencePanelChannelId));
		await interaction.reply({
			embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('Panneau d’appel d’urgence envoyé')],
			flags: MessageFlags.Ephemeral,
		});
	},

	async restore(client) {
		if (!salonUrgencePanelChannelId) return;
		for (const guild of client.guilds.cache.values()) {
			const channel = await guild.channels.fetch(salonUrgencePanelChannelId).catch((error) => {
				client.log('URGENCE PANEL', 'ERROR', `Impossible de restaurer le panel d'urgence: ${error.stack || error}`);
				return null;
			});
			if (!channel?.isTextBased()) continue;
			const messages = await channel.messages.fetch({ limit: 100 });
			for (const message of messages.values()) {
				if (Prompt.readMetadata(message)?.type !== 'urgence-panel') continue;
				await createUrgencePanel().attach(message);
			}
		}
	},
};
