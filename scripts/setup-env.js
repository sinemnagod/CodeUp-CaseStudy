/**
 * Turns one XSUAA service key into the two local config files that the
 * backend and the approuter need.
 *
 *   1. download the service key from the BTP cockpit
 *   2. save it as  service-key.json  in the project root
 *   3. node scripts/setup-env.js
 *
 * It writes:
 *   default-env.json            -> read by the CAP backend  (:4004)
 *   approuter/default-env.json  -> read by the approuter    (:5000)
 *
 * Both files are in .gitignore, because a service key is a password.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEY_FILE = path.join(ROOT, 'service-key.json');

if (!fs.existsSync(KEY_FILE)) {
	console.error('\n  Could not find service-key.json in the project root.\n');
	console.error('  Download it from the BTP cockpit:');
	console.error('    Instances and Subscriptions -> codeup-uaa -> Service Keys -> ... -> Download\n');
	process.exit(1);
}

let key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

// A downloaded key is sometimes already the credentials object, and sometimes
// wrapped in { "credentials": { ... } }. Accept either.
const credentials = key.credentials || key;

if (!credentials.clientid || !credentials.url) {
	console.error('\n  That file does not look like an XSUAA service key.');
	console.error('  It should contain at least "clientid", "clientsecret" and "url".\n');
	process.exit(1);
}

const vcap = {
	xsuaa: [{
		label: 'xsuaa',
		tags: ['xsuaa'],
		name: 'codeup-uaa',
		instance_name: 'codeup-uaa',
		credentials: credentials
	}]
};

// --- the backend ---------------------------------------------------------
fs.writeFileSync(
	path.join(ROOT, 'default-env.json'),
	JSON.stringify({ VCAP_SERVICES: vcap }, null, 2) + '\n'
);

// --- the approuter -------------------------------------------------------
// forwardAuthToken passes the SAP token on to the backend, so CAP can check
// the Approval scope for itself instead of trusting the approuter.
fs.writeFileSync(
	path.join(ROOT, 'approuter', 'default-env.json'),
	JSON.stringify({
		destinations: [{ name: 'srv-api', url: 'http://localhost:4004', forwardAuthToken: true }],
		VCAP_SERVICES: vcap
	}, null, 2) + '\n'
);

console.log('\n  Wrote default-env.json and approuter/default-env.json');
console.log('  XSUAA tenant : ' + credentials.url);
console.log('  clientid     : ' + credentials.clientid.slice(0, 12) + '...\n');
console.log('  Now run the two servers in two terminals:');
console.log('    npm run watch:hybrid');
console.log('    cd approuter && npm start\n');
console.log('  Then open http://localhost:5000\n');
