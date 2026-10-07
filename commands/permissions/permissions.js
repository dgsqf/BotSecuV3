const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	RoleSelectMenuBuilder,
	SlashCommandBuilder,
} = require('discord.js');
const Permissions = require('../../framework_utils/Permissions.js');

const PAGE_SIZE = 10;
const TIMEOUT = 15 * 60_000;

const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) =>
	new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...components) => new ActionRowBuilder().addComponents(components);
const embed = (title, description) => new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description);
const getPageCount = (items) => Math.max(1, Math.ceil(items.length / PAGE_SIZE));
const getPageItems = (items, page) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

const renderNamespaces = (state) => {
	const namespaces = Permissions.getNamespaces();
	const pages = getPageCount(namespaces);
	const page = Math.min(state.namespacePage, pages - 1);
	state.namespacePage = page;
	const components = [];
	const buttons = getPageItems(namespaces, page).map((namespace) =>
		button(`permissions:open:${namespace.name}:${page}`, namespace.name, ButtonStyle.Primary));
	for (let index = 0; index < buttons.length; index += 5) components.push(row(...buttons.slice(index, index + 5)));
	if (pages > 1) {
		components.push(row(
			button(`permissions:namespaces:${page - 1}`, '◀ Précédent', ButtonStyle.Secondary, page === 0),
			button(`permissions:namespaces:${page + 1}`, 'Suivant ▶', ButtonStyle.Secondary, page >= pages - 1),
		));
	}
	const description = `Choisissez un namespace pour afficher ses permissions.\n\n${getPageItems(namespaces, page)
		.map((namespace) => `**${namespace.name}** — ${namespace.description}`)
		.join('\n\n')}`;
	return {
		embeds: [embed('Configuration des permissions', description.slice(0, 4000))],
		components,
	};
};

const renderPermissions = (state) => {
	const namespace = Permissions.getNamespaces().find(({ name }) => name === state.namespace);
	if (!namespace) throw new Error(`Namespace de permissions inconnu: ${state.namespace}`);
	const pages = getPageCount(namespace.permissions);
	const page = Math.min(state.permissionPage, pages - 1);
	state.permissionPage = page;
	const visible = getPageItems(namespace.permissions, page);
	const permissionButtons = visible.map((permission) =>
		button(`permissions:edit:${namespace.name}:${permission.name}:${page}`, permission.name, ButtonStyle.Primary));
	const components = [];
	for (let index = 0; index < permissionButtons.length; index += 5) components.push(row(...permissionButtons.slice(index, index + 5)));
	components.push(row(
		button(`permissions:namespaces:${state.namespacePage}`, '⬅ Namespaces'),
		button(`permissions:permissions:${page - 1}`, '◀', ButtonStyle.Secondary, page === 0),
		button(`permissions:permissions:${page + 1}`, '▶', ButtonStyle.Secondary, page >= pages - 1),
	));
	const description = `${namespace.description}\n\n${visible
		.map((permission) => `**${permission.name}** — ${permission.description}`)
		.join('\n\n')}`;
	return {
		embeds: [embed(`Permissions · ${namespace.name}`, description.slice(0, 4000))],
		components,
	};
};

const renderEditor = (state, guild) => {
	const permission = Permissions.getPermission(state.permissionId);
	const roles = state.draftRoleIds.map((roleId) => guild.roles.cache.get(roleId)?.name || `Rôle supprimé (${roleId})`);
	const roleSummary = roles.length ? roles.map((name) => `• ${name}`).join('\n') : 'Aucun rôle configuré : accès refusé.';
	const description = [
		permission.description,
		'',
		'**Rôles autorisés** (un seul suffit) :',
		roleSummary,
		'',
		`**Sélection en cours** : ${state.batchRoleIds.length ? state.batchRoleIds.map((id) => `<@&${id}>`).join(', ') : 'aucun rôle'}`,
		'Choisissez jusqu’à 25 rôles à la fois, puis ajoutez-les ou retirez-les de la liste.',
	].join('\n').slice(0, 4000);
	const roleSelect = new RoleSelectMenuBuilder()
		.setCustomId('permissions:roles')
		.setPlaceholder('Sélectionner jusqu’à 25 rôles')
		.setMinValues(1)
		.setMaxValues(25);
	return {
		embeds: [embed(`Modifier · ${state.permissionId}`, description)],
		components: [
			row(roleSelect),
			row(
				button('permissions:add', 'Ajouter la sélection', ButtonStyle.Success),
				button('permissions:remove', 'Retirer la sélection', ButtonStyle.Danger),
				button('permissions:save', 'Enregistrer', ButtonStyle.Primary),
				button('permissions:cancel', 'Annuler'),
				button('permissions:back', '⬅ Retour'),
			),
		],
	};
};

const isAdministrator = (interaction) => Permissions.isDiscordAdministrator(interaction);
const deny = (interaction) => interaction.reply({
	embeds: [embed('Accès refusé', 'Cette commande est réservée aux administrateurs du serveur Discord.')],
	flags: MessageFlags.Ephemeral,
});

module.exports = {
	data: new SlashCommandBuilder()
		.setName('permissions')
		.setDescription('Configure les rôles autorisés pour chaque fonction du bot.')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	canExecute: isAdministrator,
	async execute(interaction) {
		if (!isAdministrator(interaction)) return deny(interaction);
		const state = { namespacePage: 0, permissionPage: 0, namespace: null, permissionId: null, draftRoleIds: [], batchRoleIds: [] };
		await interaction.reply({ ...renderNamespaces(state), flags: MessageFlags.Ephemeral });
		const message = await interaction.fetchReply();
		const collector = message.createMessageComponentCollector({ time: TIMEOUT });
		collector.on('collect', async (component) => {
			try {
				if (component.user.id !== interaction.user.id || !isAdministrator(component)) {
					return component.reply({ content: 'Ce panneau est réservé à son administrateur d’origine.', flags: MessageFlags.Ephemeral });
				}
				const parts = component.customId.split(':');
				const action = parts[1];
				if (action === 'roles') {
					state.batchRoleIds = component.values;
					return component.update(renderEditor(state, interaction.guild));
				}
				if (action === 'namespaces') {
					state.namespacePage = Math.max(0, Number(parts[2]) || 0);
					return component.update(renderNamespaces(state));
				}
				if (action === 'open') {
					state.namespace = parts[2];
					state.namespacePage = Math.max(0, Number(parts[3]) || 0);
					state.permissionPage = 0;
					return component.update(renderPermissions(state));
				}
				if (action === 'permissions') {
					state.permissionPage = Math.max(0, Number(parts[2]) || 0);
					return component.update(renderPermissions(state));
				}
				if (action === 'edit') {
					state.permissionId = `${parts[2]}.${parts[3]}`;
					state.permissionPage = Math.max(0, Number(parts[4]) || 0);
					state.draftRoleIds = Permissions.getRoleIds(state.permissionId);
					state.batchRoleIds = [];
					return component.update(renderEditor(state, interaction.guild));
				}
				if (action === 'add') {
					state.draftRoleIds = [...new Set([...state.draftRoleIds, ...state.batchRoleIds])];
					state.batchRoleIds = [];
					return component.update(renderEditor(state, interaction.guild));
				}
				if (action === 'remove') {
					const selected = new Set(state.batchRoleIds);
					state.draftRoleIds = state.draftRoleIds.filter((roleId) => !selected.has(roleId));
					state.batchRoleIds = [];
					return component.update(renderEditor(state, interaction.guild));
				}
				if (action === 'save') {
					Permissions.setRoleIds(state.permissionId, state.draftRoleIds);
					return component.update(renderPermissions(state));
				}
				if (action === 'back') {
					state.batchRoleIds = [];
					return component.update(renderPermissions(state));
				}
				if (action === 'cancel') {
					state.permissionId = null;
					state.draftRoleIds = [];
					state.batchRoleIds = [];
					return component.update(renderNamespaces(state));
				}
				return component.deferUpdate();
			}
			catch (error) {
				await component.client.log('PERMISSIONS', 'ERROR', `Erreur de configuration (${component.customId}): ${error.stack || error}`);
				const response = { embeds: [embed('Opération impossible', 'La modification des permissions a échoué. Consultez les journaux du bot.')], flags: MessageFlags.Ephemeral };
				if (component.replied || component.deferred) await component.followUp(response);
				else await component.reply(response);
			}
		});
	},
};
