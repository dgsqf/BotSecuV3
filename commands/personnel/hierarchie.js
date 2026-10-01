const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	MessageFlags,
} = require('discord.js');
const { getLadder } = require('../../data/hierarchy.js');
const Personnel = require('../../framework_utils/Personnel.js');

const branches = [
	{ label: 'EIT', branch: 'EIT' },
	{ label: 'Branche générale', branch: 'BG' },
	{ label: 'ULB', branch: 'BG', division: 'ULB' },
	{ label: 'URR', branch: 'BG', division: 'URR' },
	{ label: 'UPR', branch: 'BG', division: 'UPR' },
	{ label: 'UMS', branch: 'BG', division: 'UMS' },
	{ label: 'Commandement', branch: 'COMMANDEMENT' },
	{ label: 'Direction', branch: 'DIRECTION' },
	{ label: 'Commission de sûreté', branch: 'COMMISSION' },
];

const buildComponents = (page) => [new ActionRowBuilder().addComponents(
	new ButtonBuilder()
		.setCustomId('hierarchie:previous')
		.setLabel('Précédente')
		.setStyle(ButtonStyle.Secondary)
		.setDisabled(page === 0),
	new ButtonBuilder()
		.setCustomId('hierarchie:next')
		.setLabel('Suivante')
		.setStyle(ButtonStyle.Primary)
		.setDisabled(page === branches.length - 1),
)];

const buildEmbed = async (page) => {
	const current = branches[page];
	const ladder = getLadder(current.branch, current.division);
	const counts = await Personnel.getRankCounts(current.branch, current.division || null);
	return new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(`Hiérarchie · ${current.label}`)
		.setDescription(ladder.map((rank, index) => {
			const ira = rank.ira == null ? 'Sans IRA' : `IRA ${rank.ira}`;
			const limit = Personnel.getRankLimit(current.branch, current.division || null, rank.id);
			const occupancy = limit == null ? '' : ` · Effectif : ${counts[rank.id] || 0}/${limit}`;
			return `${index + 1}. ${rank.label} · ${ira}${occupancy}`;
		}).join('\n'))
		.setFooter({ text: `Branche ${page + 1}/${branches.length} · Rangs du plus bas au plus élevé` });
};

module.exports = {
	cooldown: 3,
	data: new SlashCommandBuilder().setName('hierarchie').setDescription('Affiche les échelles de rangs de la sécurité.'),
	async execute(interaction) {
		let page = 0;
		await interaction.reply({ embeds: [await buildEmbed(page)], components: buildComponents(page), flags: MessageFlags.Ephemeral });
		const message = await interaction.fetchReply();
		const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 5 * 60_000 });
		collector.on('collect', async (component) => {
			if (component.user.id !== interaction.user.id) {
				return component.reply({ content: 'Cette navigation appartient à un autre utilisateur.', flags: MessageFlags.Ephemeral });
			}
			page += component.customId === 'hierarchie:next' ? 1 : -1;
			page = Math.max(0, Math.min(page, branches.length - 1));
			await component.update({ embeds: [await buildEmbed(page)], components: buildComponents(page) });
		});
		collector.on('end', () => message.edit({ components: [] }).catch(() => null));
	},
};