const cds = require('@sap/cds');

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

		// The AI decision is wired up in the next step of the project.
		this.on('analyzeWithAI', (req) => req.reject(501, 'AI_NOT_CONFIGURED'));

		return super.init();
	}
};
