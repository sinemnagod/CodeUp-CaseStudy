/**
 * Checks that the XSUAA instance was created WITH xs-security.json,
 * rather than with empty parameters.
 *
 *   node scripts/check-xsuaa.js
 *
 * It prints no secrets.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEY = path.join(ROOT, 'service-key.json');

if (!fs.existsSync(KEY)) {
	console.error('\n  service-key.json not found in the project root.\n');
	process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(KEY, 'utf8'));
const credentials = raw.credentials || raw;
const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'xs-security.json'), 'utf8')).xsappname;

const actual = credentials.xsappname || '';
// BTP writes "na-<uuid>!t<tenant>" when no parameters were supplied at all.
const isGenerated = /^na-[0-9a-f-]{36}!/.test(actual);
const matches = actual.startsWith(expected + '!');

console.log('\n  expected xsappname : ' + expected + '!t<tenant>');
console.log('  actual   xsappname : ' + actual);
console.log('  XSUAA tenant       : ' + (credentials.url || '(none)') + '\n');

if (matches) {
	console.log('  OK - the instance was created with xs-security.json.');
	console.log('  You should now see the role collection "CodeUp Supplier Approver"');
	console.log('  under Security -> Role Collections in the BTP cockpit.\n');
	process.exit(0);
}

if (isGenerated) {
	console.error('  PROBLEM - "na-<uuid>" means "not available": BTP generated a name');
	console.error('  because the instance was created WITHOUT any parameters.\n');
} else {
	console.error('  PROBLEM - the name does not match xs-security.json.\n');
}

console.error('  Consequences: no Approval scope, no role collection, and');
console.error('  http://localhost:5000 is not an allowed redirect URI.\n');
console.error('  Fix: delete the codeup-uaa instance and create it again, this time');
console.error('  pasting xs-security.json on the Parameters step of the wizard.');
console.error('  Then create a new service key and re-run scripts/setup-env.js.\n');
process.exit(1);
