const test = require('node:test');
const assert = require('node:assert/strict');
const Form = require('../framework_utils/Form.js');

test('the form preview embed survives very long submitted values', () => {
	const form = new Form({ title: 'Formulaire de test', description: 'Description' })
		.section('Détails', 'Décrivez tout.', (sectionForm) => {
			sectionForm.text('detail1', 'Détaille un', { paragraph: true, required: true });
			sectionForm.text('detail2', 'Détaille deux', { paragraph: true, required: true });
			sectionForm.text('detail3', 'Détaille trois', { paragraph: true, required: true });
			sectionForm.text('detail4', 'Détaille quatre', { paragraph: true, required: true });
		});

	// Le pire cas : quatre saisies paragraphe remplies au maximum Discord (4000 caractères).
	const longText = 'x'.repeat(4000);
	const embed = form._embed(form._buildPages()[0], 0, 1, {
		detail1: longText,
		detail2: longText,
		detail3: longText,
		detail4: longText,
	});

	assert.ok(embed.data.description.length <= 4096);
	assert.match(embed.data.description, /tronqué/);
});

test('long display values are truncated with the total length recorded', () => {
	const form = new Form();
	const truncated = form._truncateDisplayValue('a'.repeat(4000));
	assert.ok(truncated.length < 600);
	assert.match(truncated, /4000 caractères au total/);
	assert.equal(form._truncateDisplayValue('court'), 'court');
});

test('reopening a field modal prefills the full stored response, not the truncated preview', () => {
	const form = new Form().text('detail', 'Détail', { paragraph: true, required: true });
	const fullAnswer = 'x'.repeat(4000);

	// La réponse complète, jusqu'à la limite Discord d'un champ, est restituée telle quelle.
	assert.equal(form._textInputPrefill(fullAnswer), fullAnswer);
	// La troncature à l'écran (aperçu) ne modifie pas la valeur stockée : le préremplissage reste complet.
	assert.notEqual(form._truncateDisplayValue(form._formatValue(fullAnswer)), fullAnswer);
	assert.equal(form._textInputPrefill(form._formatValue(fullAnswer)), fullAnswer);
	// Champ borné : le préremplissage respecte la limite définie (et n'excède jamais 4000).
	assert.equal(form._textInputPrefill('a'.repeat(300), 200).length, 200);
	assert.equal(form._textInputPrefill('a'.repeat(5000), 4000).length, 4000);
	assert.equal(form._textInputPrefill('réponse'), 'réponse');
});

test('numeric fields prefill within their 20-character bounded input', () => {
	const form = new Form().number('classe_d', 'Nombre de classe-D', { min: 0 });
	assert.equal(form._textInputPrefill('12', 20), '12');
	assert.equal(form._textInputPrefill('-1.5', 20), '-1.5');
	assert.equal(form._textInputPrefill('a'.repeat(25), 20).length, 20);
});

test('form definitions can bound text inputs with maxLength', () => {
	const form = new Form()
		.text('court', 'Champ court', { maxLength: 200 })
		.number('nombre', 'Un nombre', { min: 0, max: 10 })
		.text('illimite', 'Champ sans limite');

	assert.equal(form.fields[0].maxLength, 200);
	// Absence de maxLength : le comportement reste celui de Discord (4000 par défaut).
	assert.equal(form.fields[2].maxLength, undefined);
});
