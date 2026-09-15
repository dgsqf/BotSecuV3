const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	LabelBuilder,
	TextInputBuilder,
	TextInputStyle,
	UserSelectMenuBuilder,
	RoleSelectMenuBuilder,
	StringSelectMenuBuilder,
	MessageFlags,
} = require('discord.js');

const { createUserErrorEmbed } = require('./Logging.js');
const FIELDS_PER_PAGE = 4;
const MAX_SELECT_VALUES = 25;
const BUTTONS_PER_ROW = 5;

const DATE_SUBFIELDS = [
	{ key: 'day', label: 'Jour', min: 1, max: 31 },
	{ key: 'month', label: 'Mois', min: 1, max: 12 },
	{ key: 'year', label: 'Année', min: 1970, max: 2100 },
	{ key: 'hour', label: 'Heure', min: 0, max: 23 },
	{ key: 'minute', label: 'Minute', min: 0, max: 59 },
];

/**
 * Formulaire interactif Discord.js v14.
 *
 * Exemple :
 * const form = new Form({ title: 'Profil', description: 'Complétez le formulaire' })
 *   .text('bio', 'Biographie', { required: true })
 *   .user('ami', 'Votre ami')
 *   .choice('couleur', 'Couleur', ['Rouge', 'Bleu'])
 *   .questions('quiz', 'Questions rapides', ['Capital de la France ?', 'Plus grand océan ?', '2 + 2 = ?'], { count: 2 })
 *
 * Exemple avec QCM :
 * const form = new Form({ title: 'Quiz', description: 'Répondez au quiz' })
 *   .qcm('exam', [
 *     { question: 'Capital de la France ?', choices: ['Paris', 'Lyon', 'Marseille'] },
 *     { question: 'Plus grand océan ?', choices: ['Atlantique', 'Pacifique', 'Indien'] },
 *     { question: '2 + 2 = ?', choices: ['3', '4', '5'] }
 *   ], { count: 2 })
 *
 * Exemple avec sections :
 * const form = new Form({ title: 'Profil', description: 'Complétez le formulaire' })
 *   .section('Informations personnelles', (form) => {
 *     form.text('nom', 'Nom', { required: true })
 *         .text('prenom', 'Prénom', { required: true });
 *   })
 *   .section('Préférences', (form) => {
 *     form.choice('couleur', 'Couleur', ['Rouge', 'Bleu'])
 *         .user('ami', 'Votre ami');
 *   })
 *
 * await form.send(interaction, { onConfirm: (data, meta) => {} });
 */
class Form {
	constructor({ title = 'Formulaire', description = '', color = 0x5865f2, timeout = 15 * 60_000 } = {}) {
		this.title = title;
		this.description = description;
		this.color = color;
		this.timeout = timeout;
		this.fields = [];
		this.sections = [];
		this._activeSection = null;
	}

	section(label, description, callback) {
		if (!label || typeof label !== 'string') throw new TypeError('Une section doit avoir un label.');
		const section = { label, description, fields: [] };
		this.sections.push(section);
		const previousSection = this._activeSection;
		this._activeSection = section;
		try {
			if (typeof callback === 'function') callback.call(this, this);
		}
		finally {
			this._activeSection = previousSection;
		}
		return this;
	}

	add(type, id, label, options = {}) {
		if (!id || !label) throw new TypeError('Un champ doit avoir un id et un label.');
		const field = { type, id, label, ...options };
		if (this._activeSection) {
			field.section = this._activeSection.label;
			this._activeSection.fields.push(field);
		}
		this.fields.push(field);
		return this;
	}

	text(id, label, options = {}) { return this.add('text', id, label, options); }
	number(id, label, options = {}) { return this.add('number', id, label, options); }
	date(id, label, options = {}) { return this.add('date', id, label, options); }
	user(id, label, options = {}) { return this.add('user', id, label, options); }
	users(id, label, options = {}) { return this.add('users', id, label, options); }
	role(id, label, options = {}) { return this.add('role', id, label, options); }
	roles(id, label, options = {}) { return this.add('roles', id, label, options); }
	choice(id, label, choices, options = {}) { return this.add('choice', id, label, { ...options, choices }); }
	questions(id, questions, options = {}) {
		if (!Array.isArray(questions) || !questions.length) return this;
		const count = Math.min(options.count ?? options.max ?? 1, questions.length);
		const selected = [];
		while (selected.length < count) {
			const randomIndex = Math.floor(Math.random() * questions.length);
			if (selected.some((item) => item.index === randomIndex)) continue;
			selected.push({ index: randomIndex, question: questions[randomIndex] });
		}
		selected.forEach(({ index, question }) => {
			const text = typeof question === 'string' ? question : (question.question ?? question.label ?? question.prompt ?? `Question ${index + 1}`);
			this.add('question', `${id}_${index}`, text, { ...options });
		});
		return this;
	}
	qcm(id, qcms, options = {}) {
		if (!Array.isArray(qcms) || !qcms.length) return this;
		const count = Math.min(options.count ?? options.max ?? 1, qcms.length);
		const selected = [];
		while (selected.length < count) {
			const randomIndex = Math.floor(Math.random() * qcms.length);
			if (selected.some((item) => item.index === randomIndex)) continue;
			selected.push({ index: randomIndex, qcm: qcms[randomIndex] });
		}
		selected.forEach(({ index, qcm }) => {
			const question = typeof qcm === 'string' ? { question: qcm, choices: [] } : qcm;
			const label = question.question ?? question.label ?? question.prompt ?? `QCM ${index + 1}`;
			const choices = question.choices ?? question.answers ?? question.options ?? [];
			if (!Array.isArray(choices) || choices.length === 0) {
				throw new TypeError(`Le QCM « ${label} » doit contenir au moins un choix.`);
			}
			this.add('qcm', `${id}_${index}`, label, {
				...options,
				choices: choices.map((choice) => typeof choice === 'string' ? { label: choice, value: choice } : choice),
			});
		});
		return this;
	}
	qcms(id, qcms, options = {}) { return this.qcm(id, qcms, options); }

	_id(prefix, id) { return `form:${prefix}:${id}`; }

	/** Découpe les champs en pages d'au plus FIELDS_PER_PAGE champs, en gardant les sections et leur pagination interne. */
	_buildPages() {
		const groups = [];
		if (this.sections.length) {
			for (const section of this.sections) {
				const fields = section.fields.length ? section.fields : this.fields.filter((field) => field.section === section.label);
				if (fields.length) groups.push({ label: section.label, fields });
			}
			const unsectioned = this.fields.filter((field) => !field.section);
			if (unsectioned.length) groups.push({ label: null, fields: unsectioned });
		}
		else {
			groups.push({ label: null, fields: this.fields });
		}

		const pages = [];
		for (const group of groups) {
			let page = [];
			for (const field of group.fields) {
				if (page.length >= FIELDS_PER_PAGE) {
					pages.push({ section: group.label, fields: page });
					page = [];
				}
				page.push(field);
			}
			if (page.length || !pages.length) pages.push({ section: group.label, fields: page });
		}
		return pages;
	}

	_formatValue(value) {
		if (value == null || value === '') return ' ';
		if (typeof value === 'object') {
			if (value.day != null || value.month != null || value.year != null || value.hour != null || value.minute != null) {
				const day = value.day ?? '--';
				const month = value.month ?? '--';
				const year = value.year ?? '--';
				const hour = value.hour ?? '--';
				const minute = value.minute ?? '--';
				return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
			}
			return JSON.stringify(value).slice(0, 120);
		}
		return String(value);
	}

	_truncateLabel(label, maxLength = 80) {
		const text = String(label ?? '').replace(/\s+/g, ' ').trim();
		if (!text) return '';
		if (text.length <= maxLength) return text;
		return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
	}

	_embed(page, index, total, values = {}) {
		const currentFields = page?.fields || [];
		const fieldsSummary = currentFields.map((field) => {
			const currentValue = values[field.id];
			const displayValue = this._formatValue(currentValue);
			return `### ${field.label}\n${displayValue}`;
		}).join('\n\n');

		const sectionLine = page?.section ? (() => {
			const sectionIndex = this.sections.findIndex((s) => s.label === page.section);
			if (sectionIndex === -1) return `## ${page.section}`;
			const section = this.sections[sectionIndex];
			return `## ${sectionIndex + 1}/${this.sections.length} - ${section.label}\n${section.description || ''}`;
		})() : null;
		const description = [this.description || '\u200b', sectionLine, fieldsSummary || '\u200b'].filter(Boolean).join('\n\n');

		return new EmbedBuilder().setColor(this.color).setTitle(this.title)
			.setDescription(description)
			.setFooter({ text: total > 1 ? `Page ${index + 1}/${total}` : 'Formulaire' });
	}

	_components(page, index, total) {
		const rows = [];
		const fieldButtons = [];
		for (const field of page.fields) {
			const customId = this._id(field.type, field.id);
			let component;
			if (field.type === 'text' || field.type === 'number' || field.type === 'date' || field.type === 'question') {
				component = new ButtonBuilder()
					.setCustomId(customId)
					.setLabel(this._truncateLabel(field.label, 80))
					.setStyle(ButtonStyle.Secondary);
				fieldButtons.push(component);
				continue;
			}
			if (field.type === 'user' || field.type === 'users') {
				component = new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(this._truncateLabel(field.label, 100))
					.setMinValues(field.required === false ? 0 : 1)
					.setMaxValues(field.type === 'user' ? 1 : Math.min(field.max || MAX_SELECT_VALUES, MAX_SELECT_VALUES));
			}
			else if (field.type === 'role' || field.type === 'roles') {
				component = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(this._truncateLabel(field.label, 100))
					.setMinValues(field.required === false ? 0 : 1)
					.setMaxValues(field.type === 'role' ? 1 : Math.min(field.max || MAX_SELECT_VALUES, MAX_SELECT_VALUES));
			}
			else if (field.type === 'choice' || field.type === 'qcm') {
				const choices = (field.choices || field.answers || field.options || []).slice(0, MAX_SELECT_VALUES).map((item) => typeof item === 'string'
					? { label: item, value: item } : item);
				const maxValues = field.multiple ? Math.min(field.max ?? choices.length, choices.length || 1, MAX_SELECT_VALUES) : 1;
				component = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(this._truncateLabel(field.label, 100))
					.addOptions(choices).setMinValues(field.required === false ? 0 : (field.min ?? 1))
					.setMaxValues(maxValues);
			}
			if (component) rows.push(new ActionRowBuilder().addComponents(component));
		}
		for (let i = 0; i < fieldButtons.length; i += BUTTONS_PER_ROW) {
			rows.push(new ActionRowBuilder().addComponents(fieldButtons.slice(i, i + BUTTONS_PER_ROW)));
		}
		const navigation = new ActionRowBuilder();
		if (index > 0) navigation.addComponents(new ButtonBuilder().setCustomId(this._id('page', String(index - 1))).setLabel('Précédent').setStyle(ButtonStyle.Secondary));
		if (index < total - 1) navigation.addComponents(new ButtonBuilder().setCustomId(this._id('page', String(index + 1))).setLabel('Suivant').setStyle(ButtonStyle.Primary));
		else navigation.addComponents(new ButtonBuilder().setCustomId(this._id('confirm', 'submit')).setLabel('Confirmer').setStyle(ButtonStyle.Success));
		navigation.addComponents(new ButtonBuilder().setCustomId(this._id('cancel', 'cancel')).setLabel('Annuler').setStyle(ButtonStyle.Danger));
		rows.push(navigation);
		return rows;
	}

	/** Renvoie un message d'erreur si la valeur est hors bornes, sinon null. */
	_rangeError(value, min, max, label) {
		if (min != null && value < min) return `Le champ « ${label} » doit être >= ${min}.`;
		if (max != null && value > max) return `Le champ « ${label} » doit être <= ${max}.`;
		return null;
	}

	async send(target, { onConfirm, onCancel, ephemeral = false } = {}) {
		const pages = this._buildPages();
		const state = { values: {}, owner: target.user || target.author, startedAt: Date.now(), page: 0 };
		const buildPayload = ({ includeFlags = true } = {}) => ({
			embeds: [this._embed(pages[state.page], state.page, pages.length, state.values)],
			components: this._components(pages[state.page], state.page, pages.length),
			...(includeFlags && ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
		});

		let message;
		let collector;
		const updateCurrentMessage = async (nextPayload) => {
			try {
				if (target.isMessage?.()) {
					if (!message || !message.editable) return false;
					await message.edit(nextPayload);
				}
				else {
					await target.editReply(nextPayload);
				}
				return true;
			}
			catch (error) {
				if (error?.code !== 10008 && error?.status !== 404) throw error;
				return false;
			}
		};

		const bindCollector = () => {
			if (!message) return;
			if (collector) collector.stop('rebind');
			collector = message.createMessageComponentCollector({
				time: this.timeout,
				filter: (i) => i.user.id === state.owner.id,
			});

			collector.on('collect', async (i) => {
				try {
					const [, action, value] = i.customId.split(':');
					const field = this.fields.find((f) => this._id(f.type, f.id) === i.customId);

					if (action === 'page') {
						state.page = Number(value);
						await updateCurrentMessage(buildPayload());
						return i.deferUpdate();
					}

					if (action === 'cancel') {
						collector.stop('cancel');
						 const cancelled_embed = new EmbedBuilder()
							.setColor(0xFF0000)
							.setTitle('Formulaire annulé')
							.setDescription('Vous avez annulé le formulaire.');
						await updateCurrentMessage({ embeds: [cancelled_embed], components: [] });
						await i.deferUpdate();
						return onCancel?.(this._metadata(state));
					}

					if (action === 'confirm') {
						const missing = this.fields.find((f) => f.required !== false && (state.values[f.id] == null || String(state.values[f.id]).trim().length === 0));
						if (missing) {
							return i.reply({
								embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('Champ requis').setDescription(`Le champ « ${missing.label} » est requis.`)],
								flags: MessageFlags.Ephemeral,
							});
						}
						collector.stop('confirm');
						 const confirm_embed = new EmbedBuilder()
							.setColor(0x00FF00)
							.setTitle('Formulaire envoyé')
							.setDescription('Votre formulaire a été envoyé avec succès.');
						await updateCurrentMessage({ embeds: [confirm_embed], components: [] });
						await i.deferUpdate();
						try {
							await message.delete();
						}
						catch (error) {
							if (error?.code !== 10008 && error?.status !== 404) throw error;
						}
						return onConfirm?.(state.values, this._metadata(state));

					}

					if (!field) return;

					if (field.type === 'text' || field.type === 'number' || field.type === 'question') {
						const modal = new ModalBuilder().setCustomId(i.customId).setTitle(field.label.slice(0, 45));
						const textInput = new TextInputBuilder()
							.setCustomId('value')
							.setPlaceholder(field.label)
							.setStyle(field.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
							.setRequired(field.required !== false);
						const label = new LabelBuilder();
						label.setLabel('Répondez à la question :');
						label.setDescription(field.label);
						label.setTextInputComponent(textInput);
						const currentTextValue = String(state.values[field.id] ?? '');
						if (currentTextValue.length > 0) textInput.setValue(currentTextValue.slice(0, 4000));
						if (field.type === 'number') {
							textInput.setPlaceholder(`Nombre${field.min != null ? ` >= ${field.min}` : ''}${field.max != null ? ` <= ${field.max}` : ''}`);
							textInput.setMinLength(1);
							textInput.setMaxLength(20);
						}
						modal.addComponents(label);
						await i.showModal(modal);

						const modalSubmit = await i.awaitModalSubmit({
							time: this.timeout,
							filter: (modalInteraction) => modalInteraction.customId === i.customId && modalInteraction.user.id === state.owner.id,
						});

						const rawValue = modalSubmit.fields.getTextInputValue('value');
						if (field.type === 'number') {
							const numericValue = Number(rawValue);
							if (!Number.isFinite(numericValue)) {
								return modalSubmit.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Valeur invalide').setDescription(`Le champ « ${field.label} » doit être un nombre valide.`)], flags: MessageFlags.Ephemeral });
							}
							const rangeError = this._rangeError(numericValue, field.min, field.max, field.label);
							if (rangeError) return modalSubmit.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Valeur hors limites').setDescription(rangeError)], flags: MessageFlags.Ephemeral });
							state.values[field.id] = numericValue;
						}
						else {
							state.values[field.id] = rawValue;
						}
						await modalSubmit.deferUpdate();
						await updateCurrentMessage(buildPayload({ includeFlags: false }));
						return;
					}

					if (field.type === 'date') {
						const modal = new ModalBuilder().setCustomId(i.customId).setTitle(field.label.slice(0, 45));
						for (const config of DATE_SUBFIELDS) {
							const input = new TextInputBuilder()
								.setCustomId(config.key)
								.setLabel(config.label)
								.setStyle(TextInputStyle.Short)
								.setRequired(true)
								.setPlaceholder(`${config.label} (${config.min}..${config.max})`);
							const currentDateValue = String((state.values[field.id]?.[config.key]) ?? '');
							if (currentDateValue.length > 0) input.setValue(currentDateValue);
							modal.addComponents(new ActionRowBuilder().addComponents(input));
						}
						await i.showModal(modal);

						const modalSubmit = await i.awaitModalSubmit({
							time: this.timeout,
							filter: (modalInteraction) => modalInteraction.customId === i.customId && modalInteraction.user.id === state.owner.id,
						});

						const dateValues = {};
						for (const config of DATE_SUBFIELDS) {
							const rawInput = modalSubmit.fields.getTextInputValue(config.key).trim();
							if (!rawInput) {
								return modalSubmit.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('Champ requis').setDescription(`Le champ « ${config.label} » est requis.`)], flags: MessageFlags.Ephemeral });
							}
							const numericValue = Number(rawInput);
							if (!Number.isInteger(numericValue)) {
								return modalSubmit.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Valeur invalide').setDescription(`Le champ « ${config.label} » doit être un nombre entier.`)], flags: MessageFlags.Ephemeral });
							}
							const rangeError = this._rangeError(numericValue, config.min, config.max, config.label);
							if (rangeError) return modalSubmit.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Valeur hors limites').setDescription(rangeError)], flags: MessageFlags.Ephemeral });
							dateValues[config.key] = numericValue;
						}

						state.values[field.id] = dateValues;
						await modalSubmit.deferUpdate();
						await updateCurrentMessage(buildPayload({ includeFlags: false }));
						return;
					}

					// Champs de type select (user, users, role, roles, choice)
					state.values[field.id] = field.type.endsWith('s') || field.multiple ? i.values : i.values[0];
					await updateCurrentMessage(buildPayload({ includeFlags: false }));
					return i.deferUpdate();
				}
				catch (error) {
					await i.client.log('FORM', 'ERROR', `Erreur dans le formulaire: ${error.stack || error}`);
					const response = { embeds: [createUserErrorEmbed('le traitement du formulaire')], flags: MessageFlags.Ephemeral };
					if (i.replied || i.deferred) await i.followUp(response);
					else await i.reply(response);
				}
			});
		};

		try {
			if (target.isMessage?.()) {
				message = await target.channel.send(buildPayload({ includeFlags: true }));
			}
			else if (target.deferred || target.replied) {
				await target.editReply(buildPayload({ includeFlags: true }));
				message = await target.fetchReply();
			}
			else {
				await target.reply(buildPayload({ includeFlags: true }));
				message = await target.fetchReply();
			}
		}
		catch (error) {
			const isStaleInteractionError = error?.code === 10062 || error?.code === 40060;
			if (isStaleInteractionError) {
				await target.client.log('FORM', 'WARN', 'Interaction Discord périmée, formulaire ignoré.');
				return { message: null, state, collector: null };
			}
			throw error;
		}

		bindCollector();
		return { message, state, collector };
	}

	_metadata(state) { return { user_id: state.owner.id, username: state.owner.username, timestamp: new Date().toISOString() }; }
}

module.exports = Form;