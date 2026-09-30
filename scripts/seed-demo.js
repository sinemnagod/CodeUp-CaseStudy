/**
 * Fills the database with a few demo suppliers so the Approvals table is not
 * empty. Run it with the backend already running:
 *
 *     node scripts/seed-demo.js
 *
 * It only uses the public portal endpoints, exactly as a real supplier would -
 * so it also doubles as an end-to-end smoke test of register + submit.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:4004';
const PASSWORD = 'Secret123!';
const CERT = path.join(__dirname, '..', 'test-files', 'certificate-valid.pdf');

const SUPPLIERS = [
	{ email: 'info@ornekticaret.com.tr', companyName: 'Örnek Ticaret Ltd.',   contactPerson: 'Sinem Doğan',    category: 'Services',   country: 'TR', phone: '+90 212 555 01 01', taxNumber: '1234567890', website: 'https://ornekticaret.com.tr' },
	{ email: 'kontakt@beta-software.de', companyName: 'Beta Software AG',     contactPerson: 'Lena Fischer',   category: 'Software',   country: 'DE', phone: '+49 30 555 0202',   taxNumber: 'DE811234567', website: 'https://beta-software.de' },
	{ email: 'sales@ceta-hardware.nl',   companyName: 'Ceta Hardware B.V.',   contactPerson: 'Jeroen Bakker',  category: 'Hardware',   country: 'NL', phone: '+31 20 555 0303',   taxNumber: 'NL812345678B01', website: 'https://ceta-hardware.nl' },
	{ email: 'hello@delta-consult.co.uk', companyName: 'Delta Consulting Ltd', contactPerson: 'Priya Raman',   category: 'Consulting', country: 'GB', phone: '+44 20 5550 0404',  taxNumber: 'GB123456789', website: 'https://delta-consult.co.uk' },
	{ email: 'buro@epsilon.at',          companyName: 'Epsilon Services GmbH', contactPerson: 'Markus Gruber', category: 'Services',   country: 'AT', phone: '+43 1 555 0505',    taxNumber: 'ATU12345678', website: 'https://epsilon.at' }
];

async function post(path, body, token) {
	const headers = { 'Content-Type': 'application/json' };
	if (token) { headers['x-supplier-token'] = token; }
	const response = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
	const text = await response.text();
	const data = text ? JSON.parse(text) : null;
	if (!response.ok) { throw new Error(data?.error?.message || response.status); }
	return data;
}

(async function main() {
	if (!fs.existsSync(CERT)) {
		console.error('Missing test certificate at', CERT);
		process.exit(1);
	}
	const certificateBase64 = fs.readFileSync(CERT).toString('base64');

	for (const supplier of SUPPLIERS) {
		try {
			const session = await post('/portal/register', { email: supplier.email, password: PASSWORD });
			await post('/portal/submitApplication', {
				data: Object.assign({}, supplier, {
					email: undefined,
					certificateName: 'certificate-valid.pdf',
					certificateMime: 'application/pdf',
					certificateBase64
				})
			}, session.token);
			console.log('  created  ', supplier.companyName);
		} catch (error) {
			console.log('  skipped  ', supplier.companyName, '(' + error.message + ')');
		}
	}

	console.log('\nDone. Every demo account uses the password: ' + PASSWORD);
})();
