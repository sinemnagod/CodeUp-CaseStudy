const { PDFParse } = require('pdf-parse');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

/**
 * Asks an AI whether an uploaded certificate is still valid.
 *
 * The AI service is reached through a BTP **destination** called "openrouter".
 * The destination holds the address and the API key; this code only ever knows
 * the destination's *name*. That means the key is never in the source, never
 * in git, and can be rotated in the BTP cockpit without touching the app.
 */

// Which model to ask. Override with the AI_MODEL environment variable.
//
// Free models on OpenRouter come and go: an id that worked last month can be
// retired, and OpenRouter then answers 404 "No endpoints found". If the AI
// stops working for no apparent reason, check this id first - run
// `node scripts/check-ai.js`, which lists the ids that exist today.
const DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
const DESTINATION = 'openrouter';

// PDFs can be long and we pay per token, so only the beginning is sent.
// A certificate's dates are always near the top.
const MAX_CHARACTERS = 6000;

/** Pulls the readable text out of the PDF bytes. */
async function extractText(buffer) {
	const parser = new PDFParse({ data: buffer });
	try {
		const result = await parser.getText();
		return (result.text || '').trim();
	} finally {
		await parser.destroy();
	}
}

function buildPrompt(application, certificateText) {
	const today = new Date().toISOString().slice(0, 10);
	return [
		{
			role: 'system',
			content: [
				'You check supplier certificates for a procurement team.',
				'You are given the text of a certificate PDF.',
				'Decide whether the supplier should be approved.',
				'',
				'Reject if ANY of these is true:',
				'  - the certificate has expired (its validity date is in the past),',
				'  - no validity or expiry date can be found at all,',
				'  - the document is clearly not a certificate.',
				'Otherwise approve.',
				'',
				'Answer with nothing but a JSON object in exactly this shape:',
				'{"decision":"Approved"|"Rejected","reason":"<one short sentence>"}',
				'Write the reason in the same language as the certificate.'
			].join('\n')
		},
		{
			role: 'user',
			content: [
				'Today is ' + today + '.',
				'Company: ' + (application.companyName || '(unknown)'),
				'Certificate file: ' + (application.certificateName || '(unnamed)'),
				'',
				'--- certificate text ---',
				certificateText.slice(0, MAX_CHARACTERS)
			].join('\n')
		}
	];
}

/**
 * Models like to wrap JSON in prose or in ```json fences, so we look for the
 * first {...} block rather than trusting the whole answer to be clean JSON.
 */
function parseDecision(content) {
	const match = String(content || '').match(/\{[\s\S]*\}/);
	if (!match) { return null; }

	let parsed;
	try {
		parsed = JSON.parse(match[0]);
	} catch (error) {
		return null;
	}

	const decision = parsed.decision === 'Approved' ? 'Approved'
		: parsed.decision === 'Rejected' ? 'Rejected'
		: null;
	if (!decision) { return null; }

	return {
		decision: decision,
		reason: String(parsed.reason || '').slice(0, 1000)
	};
}

/**
 * Reads the certificate and returns { decision, reason }.
 * Throws an Error whose message is one of our error codes.
 *
 * The PDF bytes are passed in rather than read here, because fetching a media
 * column is a database concern and belongs in the service, not in this file.
 */
async function analyzeCertificate(application, certificateBuffer) {
	if (!certificateBuffer || !certificateBuffer.length) {
		throw new Error('CERTIFICATE_REQUIRED');
	}

	let certificateText;
	try {
		certificateText = await extractText(certificateBuffer);
	} catch (error) {
		throw new Error('AI_PDF_UNREADABLE');
	}

	// A PDF of a scanned photo has no text layer. We cannot read it, and
	// guessing would be worse than saying so.
	if (certificateText.length < 20) {
		throw new Error('AI_PDF_UNREADABLE');
	}

	let response;
	try {
		response = await executeHttpRequest(
			{ destinationName: DESTINATION },
			{
				method: 'POST',
				url: '/api/v1/chat/completions',
				headers: { 'Content-Type': 'application/json' },
				data: {
					model: process.env.AI_MODEL || DEFAULT_MODEL,
					temperature: 0,
					messages: buildPrompt(application, certificateText)
				}
			},
			{ fetchCsrfToken: false }
		);
	} catch (error) {
		// The SAP Cloud SDK only puts the status code in error.message, which is
		// nowhere near enough to debug with. The service's own explanation is in
		// the response body, so log that too.
		const status = error.response?.status;
		const body = error.response?.data;
		console.error('[ai] call failed:', error.message,
			body ? '\n[ai] service said: ' + JSON.stringify(body).slice(0, 500) : '');

		// 404 from OpenRouter means the *model id* is unknown, not the URL -
		// the endpoint itself answers 401 when it is reachable but unauthorised.
		if (status === 404) { throw new Error('AI_MODEL_UNKNOWN'); }
		if (status === 401 || status === 403) { throw new Error('AI_KEY_REJECTED'); }
		throw new Error('AI_UNAVAILABLE');
	}

	const content = response.data?.choices?.[0]?.message?.content;
	const result = parseDecision(content);
	if (!result) {
		console.error('[ai] could not read the answer:', JSON.stringify(content).slice(0, 300));
		throw new Error('AI_UNCLEAR_ANSWER');
	}
	return result;
}

module.exports = { analyzeCertificate, extractText, parseDecision };
