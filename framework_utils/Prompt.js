const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	ComponentType,
} = require('discord.js');

/**
 * Creates an embed prompt with configurable buttons.
 *
 * Example:
 * new Prompt({
 *   title: 'Confirmation',
 *   description: 'Êtes-vous sûr?',
 *   color: 0x0099ff,
 *   buttons: [
 *     { label: 'Oui', callback: async (interaction) => { await interaction.reply('Confirmé!'); } },
 *     { label: 'Non', callback: async (interaction) => { await interaction.reply('Annulé!'); } }
 *   ]
 * })
 */
class Prompt {
	constructor({ title, description, color, fields = [], buttons = [], metadata = null } = {}) {
		const normalizeStyle = (style) => {
			if (typeof style === 'number') return style;
			const alias = String(style).toLowerCase();
			const map = {
				primary: ButtonStyle.Primary,
				secondary: ButtonStyle.Secondary,
				success: ButtonStyle.Success,
				danger: ButtonStyle.Danger,
				link: ButtonStyle.Link,
			};
			return map[alias] ?? ButtonStyle.Primary;
		};

		this.embed = new EmbedBuilder();
		if (title !== undefined) this.embed.setTitle(title);
		if (description !== undefined) this.embed.setDescription(description);
		if (color !== undefined) this.embed.setColor(color);
		if (fields.length) this.embed.addFields(fields);
		if (metadata) {
			const encodedMetadata = Buffer.from(JSON.stringify(metadata)).toString('base64url');
			this.embed.setFooter({ text: `prompt:v1:${encodedMetadata}`.slice(0, 2048) });
		}

		this.buttons = buttons.map((button, index) => ({
			...button,
			customId: button.customId || `prompt_${Date.now()}_${index}`,
			style: normalizeStyle(button.style),
		}));
	}

	buildComponents() {
		const rows = [];
		for (let i = 0; i < this.buttons.length; i += 5) {
			rows.push(new ActionRowBuilder().addComponents(
				this.buttons.slice(i, i + 5).map(({ callback, ...button }) =>
					new ButtonBuilder()
						.setCustomId(button.customId)
						.setLabel(button.label || 'Bouton')
						.setStyle(button.style)
						.setDisabled(Boolean(button.disabled)),
				),
			));
		}
		return rows;
	}

	buildPayload(options = {}) {
		return {
			...options,
			embeds: [this.embed],
			components: this.buildComponents(),
		};
	}

	addField(name, value, inline = false) {
		this.embed.addFields({ name, value, inline });
		return this;
	}

	addButton(button) {
		this.buttons.push({
			...button,
			customId: button.customId || `prompt_${Date.now()}_${this.buttons.length}`,
			style: normalizeStyle(button.style),
		});
		return this;
	}

	static readMetadata(message) {
		const footer = message.embeds?.[0]?.footer?.text || '';
		if (!footer.startsWith('prompt:v1:')) return null;
		try {
			return JSON.parse(Buffer.from(footer.slice('prompt:v1:'.length), 'base64url').toString('utf8'));
		}
		catch {
			return null;
		}
	}

	hasRequiredRole(button, interaction) {
		const normalizeRoles = (value) => {
			if (!value) return [];
			if (Array.isArray(value)) return value.flatMap((entry) => normalizeRoles(entry));
			return [value];
		};

		const requiredRoles = normalizeRoles(button.requiredRoles ?? button.requiredRole);

		if (!requiredRoles.length) return true;
		if (!interaction?.guild || !interaction.member) return false;

		return requiredRoles.some((roleId) => interaction.member.roles.cache.has(roleId));
	}

	async attach(message, options = {}) {
		if (!message || typeof message.createMessageComponentCollector !== 'function') {
			throw new TypeError('Prompt.attach() attend un message Discord valide.');
		}

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: options.time,
		});

		collector.on('collect', async (buttonInteraction) => {
			try {
				const button = this.buttons.find(({ customId }) => customId === buttonInteraction.customId);
				if (!button?.callback) {
					if (!buttonInteraction.replied && !buttonInteraction.deferred) await buttonInteraction.deferUpdate();
					return;
				}

				if (!this.hasRequiredRole(button, buttonInteraction)) {
					if (!buttonInteraction.replied && !buttonInteraction.deferred) {
						await buttonInteraction.reply({
							content: button.missingRoleMessage || 'Vous n’avez pas le rôle requis pour utiliser ce bouton.',
							flags: 64,
						});
					}
					return;
				}

				await button.callback(buttonInteraction, this);
			}
			catch (error) {
				console.error('Erreur dans le prompt:', error);
			}
		});

		return { message, collector };
	}

	async send(target, options = {}) {
		const payload = this.buildPayload({
			...options,
			fetchReply: true,
		});

		let message;
		const isInteraction = !!target && typeof target.reply === 'function' && typeof target.followUp === 'function';
		const isTextChannel = !!target && typeof target.send === 'function' && typeof target.reply !== 'function';

		if (isTextChannel) {
			message = await target.send(payload);
		}
		else if (isInteraction) {
			message = await target.reply(payload);
		}
		else if (target && typeof target.send === 'function') {
			message = await target.send(payload);
		}
		else {
			throw new TypeError('Prompt.send() attend une interaction Discord ou un channel Discord valide.');
		}

		return this.attach(message, options);
	}
}

module.exports = Prompt;
