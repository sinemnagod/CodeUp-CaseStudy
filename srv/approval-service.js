const cds = require('@sap/cds');
const { analyzeCertificate } = require('./ai');

/** Collects a readable stream into a single Buffer. */
async function readStream(stream) {
	if (!stream) { return null; }
	if (Buffer.isBuffer(stream)) { return stream; }
	const chunks = [];
	for await (const chunk of stream) { chunks.push(chunk); }
	return Buffer.concat(chunks);
}

module.exports = class ApprovalService extends cds.ApplicationService {

	async init() {
		const { Suppliers } = cds.entities('codeup.supplier');

		/**
		 * Both decisions do the same bookkeeping, so they share this.
		 * `req.user.id` is the logged-in approver - CAP fills it in from the
		 * SAP token, so we do not have to trust anything the browser sent.
		 */
		const decide = async (req, ID, status, note, editableFields, byAI) => {
			const application = await SELECT.one.from(Suppliers).where({ ID });
			if (!application) return req.reject(404, 'APPLICATION_NOT_FOUND');

			// Only an application that is actually waiting can be decided.
			// This also stops two approvers deciding the same one twice.
			if (application.status !== 'Submitted') {
				return req.reject(409, 'ALREADY_DECIDED');
			}

			await UPDATE(Suppliers, ID).with({
				status:         status,
				decisionNote:   note || null,
				decidedAt:      new Date(),
				decidedBy:      req.user.id,
				aiDecision:     !!byAI,
				editableFields: status === 'Rejected' ? (editableFields || null) : null
			});
			return status;
		};

		this.on('approveApplication', (req) =>
			decide(req, req.data.ID, 'Approved', req.data.note, null, false));

		this.on('rejectApplication', (req) => {
			// A rejection without a reason would leave the supplier with no idea
			// what to fix, so the use case makes the reason mandatory.
			if (!(req.data.note || '').trim()) {
				return req.reject(400, 'REJECTION_NOTE_REQUIRED');
			}
			return decide(req, req.data.ID, 'Rejected', req.data.note, req.data.editableFields, false);
		});

		/**
		 * Hands the decision to the AI: it reads the uploaded PDF certificate
		 * and approves or rejects on its own.
		 *
		 * The decision is written through the very same `decide()` helper the
		 * human buttons use, so the AI cannot bypass any rule - it still cannot
		 * decide an application twice, and `aiDecision` records that it was
		 * the machine and not a person.
		 */
		this.on('analyzeWithAI', async (req) => {
			const application = await SELECT.one.from(Suppliers).where({ ID: req.data.ID });
			if (!application) return req.reject(404, 'APPLICATION_NOT_FOUND');
			if (application.status !== 'Submitted') return req.reject(409, 'ALREADY_DECIDED');

			// A column annotated with @Core.MediaType is left out of an ordinary
			// SELECT and has to be asked for by name - and it then arrives as a
			// stream, not as a Buffer.
			const stored = await SELECT.one.from(Suppliers).columns('certificate').where({ ID: application.ID });
			const certificateBuffer = await readStream(stored && stored.certificate);

			let result;
			try {
				result = await analyzeCertificate(application, certificateBuffer);
			} catch (error) {
				// analyzeCertificate throws our own error codes
				return req.reject(502, error.message);
			}

			await decide(req, application.ID, result.decision, result.reason, null, true);
			return result;
		});

		return super.init();
	}
};
