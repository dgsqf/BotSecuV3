const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
} = require('discord.js');
const { MODULES, commandHelp, getCommandEntries, getAccess, formatFields } = require('../../framework_utils/HelpCatalog.js');

const COLOR = 0x3498db;
const TIMEOUT = 15 * 60_000;

const button = (customId, label, style = ButtonStyle.Secondary, emoji = null) => {
	const builder = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
	if (emoji) builder.setEmoji(emoji);
	return builder;
};

const moduleCommands = (client, moduleId) => [...client.commands.values()]
	.filter((command) => commandHelp[command.data.name]?.module === moduleId)
	.sort((left, right) => left.data.name.localeCompare(right.data.name, 'fr'));

const buildHome = () => ({
	embeds: [new EmbedBuilder()
		.setColor(COLOR)
		.setTitle('Aide du bot')
		.setDescription('Choisissez un module pour parcourir ses commandes et leurs fiches détaillées.')
		.addFields(MODULES.map((module) => ({ name: `${module.emoji} ${module.label}`, value: module.description, inline: true })))],
	components: [new ActionRowBuilder().addComponents(MODULES.map((module) => button(`help:module:${module.id}`, module.label, ButtonStyle.Primary, module.emoji)))],
});

const buildModule = (client, module) => {
	const commands = moduleCommands(client, module.id);
	const entries = commands.flatMap((command) => getCommandEntries(command).map((entry) => ({ command, entry })));
	const description = commands.map((command) => {
		const metadata = commandHelp[command.data.name];
		const labels = getCommandEntries(command).map((entry) => `  • ${entry.label} : ${entry.description}`);
		return `### /${command.data.name}\n${metadata.description}\n${labels.join('\n')}`;
	}).join('\n\n') || 'Aucune commande n’est actuellement déclarée dans ce module.';
	const rows = [];
	for (let index = 0; index < entries.length; index += 4) {
		rows.push(new ActionRowBuilder().addComponents(
			entries.slice(index, index + 4).map(({ entry }, offset) =>
				button(`help:detail:${module.id}:${index + offset}`, `En savoir plus : ${entry.label}`.slice(0, 80)),
			),
		));
	}
	const navigationButton = button('help:home', 'Modules', ButtonStyle.Primary);
	if (rows.length && rows.length < 5) rows.push(new ActionRowBuilder().addComponents(navigationButton));
	else if (rows.length) rows[rows.length - 1].addComponents(navigationButton);
	else rows.push(new ActionRowBuilder().addComponents(navigationButton));
	return {
		entries,
		embed: new EmbedBuilder().setColor(COLOR).setTitle(`${module.emoji} ${module.label}`).setDescription(description.slice(0, 4096)),
		components: rows,
	};
};

const getSlashOptions = (command, key) => {
	const options = command.data.toJSON().options || [];
	const subcommand = options.find((option) => option.name === key && option.type === 1);
	const source = subcommand?.options || (!options.some((option) => option.type === 1) ? options : []);
	if (!source.length) return 'Aucun argument slash.';
	return source.map((option) => `• **${option.name}** (${option.type === 3 ? 'texte' : option.type === 4 || option.type === 10 ? 'nombre' : option.type === 5 ? 'oui/non' : option.type === 6 ? 'membre' : option.type === 7 ? 'salon' : option.type === 8 ? 'rôle' : option.type === 9 ? 'mentionnable' : 'option'})${option.required ? ', requis' : ', facultatif'}${option.description ? ` — ${option.description}` : ''}`).join('\n');
};

const splitEmbedField = (name, text, limit = 1000) => {
	const chunks = [];
	let current = '';
	for (const line of String(text).split('\n')) {
		let remaining = line;
		while (remaining.length > limit) {
			if (current) chunks.push(current);
			chunks.push(remaining.slice(0, limit));
			remaining = remaining.slice(limit);
			current = '';
		}
		if (current && current.length + remaining.length + 1 > limit) {
			chunks.push(current);
			current = remaining;
		}
		else {
			current = current ? `${current}\n${remaining}` : remaining;
		}
	}
	if (current) chunks.push(current);
	return chunks.map((value, index) => ({ name: index ? `${name} (suite ${index + 1})` : name, value }));
};

const buildDetail = (module, { command, entry }, interaction) => {
	const access = getAccess(interaction, entry);
	const slashOptions = getSlashOptions(command, entry.key);
	const permissionText = `**Accès actuel :** ${access.allowed ? '✅ Vous pouvez lancer cette commande.' : '⛔ Vous ne pouvez pas la lancer actuellement.'}\n**Condition :** ${access.requirement}`;
	const embed = new EmbedBuilder()
		.setColor(access.allowed ? 0x57f287 : 0xed4245)
		.setTitle(entry.label)
		.setDescription(`${entry.description}\n\n${permissionText}`)
		.addFields(
			{ name: 'Options slash', value: slashOptions.slice(0, 1024) },
			...splitEmbedField('Formulaire', formatFields(entry.fields)),
		)
		.setFooter({ text: `Module ${module.label} · accès calculé pour votre compte dans ce serveur` });
	for (const permission of entry.additionalAccess || []) {
		const result = permission.access(interaction);
		embed.addFields({
			name: permission.label,
			value: `**Accès actuel :** ${result.allowed ? '✅ Vous pouvez utiliser cette fonction.' : '⛔ Vous ne pouvez pas utiliser cette fonction actuellement.'}\n**Condition :** ${result.requirement}`,
		});
	}
	return embed;
};

module.exports = {
	data: new SlashCommandBuilder().setName('help').setDescription('Affiche les modules, commandes, permissions et formulaires du bot.'),
	async execute(interaction) {
		let currentModule = null;
		let currentPage = null;
		const renderHome = () => {
			currentModule = null;
			currentPage = buildHome();
			return currentPage;
		};
		const message = await interaction.reply({ ...renderHome(), flags: MessageFlags.Ephemeral, fetchReply: true });
		const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: TIMEOUT });
		collector.on('collect', async (component) => {
			if (component.user.id !== interaction.user.id) {
				await component.reply({ content: 'Cette aide appartient à un autre utilisateur.', flags: MessageFlags.Ephemeral });
				return;
			}
			if (component.customId === 'help:home') {
				await component.update(renderHome());
				return;
			}
			const [, action, value, indexText] = component.customId.split(':');
			if (action === 'module') {
				const module = MODULES.find((item) => item.id === value);
				if (!module) return component.deferUpdate();
				currentModule = module;
				currentPage = buildModule(interaction.client, module);
				await component.update({ embeds: [currentPage.embed], components: currentPage.components });
				return;
			}
			if (action === 'detail' && currentModule && currentPage) {
				const detailIndex = Number(value === currentModule.id ? indexText : NaN);
				const selected = currentPage.entries[detailIndex];
				if (!selected) return component.deferUpdate();
				await component.update({
					embeds: [buildDetail(currentModule, selected, component)],
					components: [new ActionRowBuilder().addComponents(
						button(`help:module:${currentModule.id}`, 'Retour au module', ButtonStyle.Primary, currentModule.emoji),
						button('help:home', 'Modules'),
					)],
				});
			}
		});
		collector.on('end', () => message.edit({ components: [] }).catch(() => null));
	},
};