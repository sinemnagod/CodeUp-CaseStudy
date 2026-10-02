/**
 * Tests the whole AI path from the command line, and prints the real reason
 * when it fails instead of the polite message the UI shows.
 *
 *   node scripts/check-ai.js
 *   AI_MODEL="qwen/qwen3.8-27b:free" node scripts/check-ai.js
 *
 * Checks, in order: the destination service binding, the destination itself,
 * and one real call to the model with the sample certificate.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODEL = process.env.AI_MODEL || 'google/gemma-4-31b-it:free';

function fail(message, hint) {
	console.error('\n  FAILED: ' + message);
	if (hint) { console.error('  ' + hint); }
	console.error('');
	process.exit(1);
}

(async () => {
	// --- 1. is the destination service bound locally? --------------------
	const envFile = path.join(ROOT, 'default-env.json');
	if (!fs.existsSync(envFile)) {
		fail('default-env.json is missing.', 'Run: node scripts/setup-env.js');
	}
	const services = JSON.parse(fs.readFileSync(envFile, 'utf8')).VCAP_SERVICES || {};
	if (!services.destination) {
		fail('The destination service is not bound.',
			'Save destination-key.json in the project root, then run node scripts/setup-env.js');
	}
	const credentials = services.destination[0].credentials;
	console.log('\n  destination service : bound');

	// --- 2. can we read the destination out of BTP? ----------------------
	const tokenResponse = await fetch(credentials.url + '/oauth/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: 'Basic ' + Buffer.from(credentials.clientid + ':' + credentials.clientsecret).toString('base64')
		},
		body: 'grant_type=client_credentials'
	}).then(r => r.json());

	if (!tokenResponse.access_token) {
		fail('Could not log in to the destination service.',
			'The service key in destination-key.json may be stale - create a new one.');
	}

	const found = await fetch(
		credentials.uri + '/destination-configuration/v1/subaccountDestinations/openrouter',
		{ headers: { Authorization: 'Bearer ' + tokenResponse.access_token } }
	);
	if (!found.ok) {
		fail('No destination called "openrouter" in this subaccount.',
			'Create it: Connectivity -> Destinations -> Create Destination.');
	}
	const destination = (await found.json()).destinationConfiguration;
	const apiKey = destination['URL.headers.Authorization'];

	console.log('  destination URL     : ' + destination.URL);
	console.log('  auth header         : ' + (apiKey ? 'present (' + apiKey.length + ' chars)' : 'MISSING'));
	if (!apiKey) {
		fail('The destination has no URL.headers.Authorization property.',
			'Add it with the value: Bearer sk-or-v1-...');
	}

	// --- 3. one real call ------------------------------------------------
	console.log('  model               : ' + MODEL + '\n  calling the model...');

	const response = await fetch(destination.URL.replace(/\/$/, '') + '/api/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			temperature: 0,
			messages: [{ role: 'user', content: 'Reply with exactly: {"ok":true}' }]
		})
	});

	const body = await response.text();

	if (response.status === 404) {
		console.error('\n  FAILED: the model id "' + MODEL + '" does not exist on OpenRouter.');
		console.error('  (404 here means an unknown model, not a wrong URL.)\n');
		const models = await fetch('https://openrouter.ai/api/v1/models').then(r => r.json()).catch(() => null);
		if (models) {
			console.error('  Free models available right now:');
			models.data.filter(m => m.id.endsWith(':free')).slice(0, 10)
				.forEach(m => console.error('     ' + m.id));
			console.error('\n  Pick one and either set AI_MODEL, or change DEFAULT_MODEL in srv/ai.js.');
		}
		console.error('');
		process.exit(1);
	}

	if (response.status === 401 || response.status === 403) {
		fail('OpenRouter rejected the API key (HTTP ' + response.status + ').',
			'Check URL.headers.Authorization in the destination. It must read: Bearer sk-or-v1-...');
	}

	if (!response.ok) {
		fail('HTTP ' + response.status + ' from OpenRouter.', body.slice(0, 300));
	}

	const content = JSON.parse(body).choices?.[0]?.message?.content;
	console.log('\n  OK - the model answered: ' + JSON.stringify(content).slice(0, 120));
	console.log('\n  The AI path works. "Analyze with AI" should now work in the app.\n');
})().catch(error => fail(error.message));
