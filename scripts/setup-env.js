/**
 * Turns your XSUAA service key into the local config file that the backend
 * and the approuter both read.
 *
 *   1. download the service key from the BTP cockpit
 *   2. save it as  service-key.json  in the project root
 *   3. node scripts/setup-env.js
 *
 * It writes:
 *   default-env.json  -> read by both the CAP backend (:4004) and the
 *                      approuter (:5000), which are both started from here.
 *
 * It is in .gitignore, because a service key is a password.
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

// The destination service is optional: it is only needed once you add the AI
// feature. Save its service key as destination-key.json next to this one.
const DEST_KEY_FILE = path.join(ROOT, 'destination-key.json');
if (fs.existsSync(DEST_KEY_FILE)) {
	const destRaw = JSON.parse(fs.readFileSync(DEST_KEY_FILE, 'utf8'));
	const destCredentials = destRaw.credentials || destRaw;
	vcap.destination = [{
		label: 'destination',
		tags: ['destination'],
		name: 'codeup-destination',
		instance_name: 'codeup-destination',
		credentials: destCredentials
	}];
}

// One file at the project root, read by BOTH processes: the backend and the
// approuter are started from here, and each picks out the part it needs.
// forwardAuthToken passes the SAP token on to the backend, so CAP can check
// the Approval scope for itself instead of trusting the approuter.
fs.writeFileSync(
	path.join(ROOT, 'default-env.json'),
	JSON.stringify({
		destinations: [{ name: 'srv-api', url: 'http://localhost:4004', forwardAuthToken: true }],
		VCAP_SERVICES: vcap
	}, null, 2) + '\n'
);

console.log('\n  Wrote default-env.json');
console.log('  XSUAA tenant : ' + credentials.url);
console.log('  clientid     : ' + credentials.clientid.slice(0, 12) + '...');
console.log('  destination service : ' + (vcap.destination ? 'bound' : 'not bound (only needed for the AI feature)') + '\n');
console.log('  Now run the two servers in two terminals:');
console.log('    npm run watch:hybrid');
console.log('    npm run approuter        <- from the PROJECT ROOT\n');
console.log('  Then open http://localhost:5000\n');
