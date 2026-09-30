const cds = require('@sap/cds');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Rules. These live on the server so they can never be skipped, even if
// somebody bypasses our web page and calls the service directly.
// ---------------------------------------------------------------------------
const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB
const SESSION_HOURS  = 8;
const EMAIL_PATTERN  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The same five password rules the portal shows live under the input. */
function passwordProblems(password) {
  const p = typeof password === 'string' ? password : '';
  const problems = [];
  if (p.length < 8)           problems.push('length');
  if (!/[A-Z]/.test(p))       problems.push('upper');
  if (!/[a-z]/.test(p))       problems.push('lower');
  if (!/[0-9]/.test(p))       problems.push('digit');
  if (!/[^A-Za-z0-9]/.test(p)) problems.push('special');
  return problems;
}

/** Copy only the fields the supplier is allowed to see back to the browser. */
function toView(s) {
  if (!s) return null;
  return {
    ID: s.ID, email: s.email,
    companyName: s.companyName, contactPerson: s.contactPerson,
    phone: s.phone, country: s.country, category: s.category,
    taxNumber: s.taxNumber, website: s.website, address: s.address,
    notes: s.notes, certificateName: s.certificateName,
    status: s.status, submittedAt: s.submittedAt, decidedAt: s.decidedAt,
    decisionNote: s.decisionNote, editableFields: s.editableFields
  };
}

module.exports = class PortalService extends cds.ApplicationService {

  async init() {
    const { Suppliers, Sessions } = cds.entities('codeup.supplier');

    // -- helpers -----------------------------------------------------------

    /** Hand out a fresh "wristband" and remember it in the Sessions table. */
    const startSession = async (supplierID) => {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
      await INSERT.into(Sessions).entries({ token, supplier_ID: supplierID, expiresAt });
      return token;
    };

    /** Read the wristband from the request header and find out who it is. */
    const currentSupplier = async (req) => {
      const token = req.http?.req?.headers['x-supplier-token'];
      if (!token) return req.reject(403, 'NOT_LOGGED_IN');

      const session = await SELECT.one.from(Sessions).where({ token });
      if (!session || new Date(session.expiresAt) < new Date()) {
        return req.reject(403, 'SESSION_EXPIRED');
      }
      const supplier = await SELECT.one.from(Suppliers).where({ ID: session.supplier_ID });
      if (!supplier) return req.reject(403, 'SESSION_EXPIRED');
      return supplier;
    };

    // -- register ----------------------------------------------------------

    this.on('register', async (req) => {
      const email = (req.data.email || '').trim().toLowerCase();
      const password = req.data.password || '';

      if (!EMAIL_PATTERN.test(email)) return req.reject(400, 'EMAIL_INVALID');
      if (passwordProblems(password).length) return req.reject(400, 'PASSWORD_WEAK');

      const existing = await SELECT.one.from(Suppliers).where({ email });
      if (existing) return req.reject(409, 'EMAIL_ALREADY_REGISTERED');

      // bcrypt turns "Secret123!" into something like "$2a$10$N9qo8uLO...".
      // We store only that. Even we cannot read the original password back.
      const passwordHash = await bcrypt.hash(password, 10);

      const created = await INSERT.into(Suppliers).entries({
        ID: cds.utils.uuid(), email, passwordHash, status: 'New'
      });
      const ID = created.results?.[0]?.ID ?? (await SELECT.one.from(Suppliers).where({ email })).ID;

      // Registering logs you straight in, as the use case asks.
      const token = await startSession(ID);
      const supplier = await SELECT.one.from(Suppliers).where({ ID });
      return { token, email, application: toView(supplier) };
    });

    // -- login -------------------------------------------------------------

    this.on('login', async (req) => {
      const email = (req.data.email || '').trim().toLowerCase();
      const password = req.data.password || '';

      const supplier = await SELECT.one.from(Suppliers).where({ email });

      // Deliberately the SAME error for "no such user" and "wrong password",
      // so an attacker cannot use the login page to discover who is registered.
      const ok = supplier && await bcrypt.compare(password, supplier.passwordHash);
      if (!ok) return req.reject(400, 'LOGIN_FAILED');

      const token = await startSession(supplier.ID);
      return { token, email: supplier.email, application: toView(supplier) };
    });

    // -- logout ------------------------------------------------------------

    this.on('logout', async (req) => {
      const token = req.http?.req?.headers['x-supplier-token'];
      if (token) await DELETE.from(Sessions).where({ token });
      return true;
    });

    // -- read my own application ------------------------------------------

    this.on('myApplication', async (req) => {
      const supplier = await currentSupplier(req);
      return toView(supplier);
    });

    // -- submit (first time) or re-apply (after a rejection) ---------------

    this.on('submitApplication', async (req) => {
      const supplier = await currentSupplier(req);
      const data = req.data.data || {};

      // You may only submit when you have never submitted, or were rejected.
      if (supplier.status === 'Submitted' || supplier.status === 'Approved') {
        return req.reject(409, 'APPLICATION_ALREADY_SUBMITTED');
      }

      const isReapply = supplier.status === 'Rejected';
      // After a rejection the approver decided which fields may be corrected.
      const allowed = isReapply
        ? (supplier.editableFields || '').split(',').map(f => f.trim()).filter(Boolean)
        : null;   // null = first submission, everything is allowed

      /** Take the new value only if this field may be changed right now. */
      const pick = (field) => {
        if (allowed && !allowed.includes(field)) return supplier[field];
        const value = data[field];
        return value === undefined ? supplier[field] : value;
      };

      const companyName   = (pick('companyName')   || '').trim();
      const contactPerson = (pick('contactPerson') || '').trim();

      // --- mandatory fields (also checked in the browser, enforced here) ---
      if (!companyName)   return req.reject(400, 'COMPANY_NAME_REQUIRED');
      if (!contactPerson) return req.reject(400, 'CONTACT_PERSON_REQUIRED');

      // --- the certificate --------------------------------------------------
      const b64 = data.certificateBase64;
      if (!b64) return req.reject(400, 'CERTIFICATE_REQUIRED');

      // A base64 string is ~4/3 the size of the file. Check the cheap way first
      // so we never bother decoding an obviously oversized upload.
      if (b64.length > MAX_FILE_BYTES * 1.4) return req.reject(400, 'FILE_TOO_LARGE');

      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length > MAX_FILE_BYTES) return req.reject(400, 'FILE_TOO_LARGE');

      // Trusting the file name or the browser's content type is not enough -
      // anyone can rename virus.exe to cert.pdf. Every real PDF starts with
      // the four bytes "%PDF", so we look inside the file itself.
      const isPdf = data.certificateMime === 'application/pdf'
                 && buffer.subarray(0, 4).toString('latin1') === '%PDF';
      if (!isPdf) return req.reject(400, 'FILE_NOT_PDF');

      await UPDATE(Suppliers, supplier.ID).with({
        companyName, contactPerson,
        phone:      pick('phone'),
        country:    pick('country'),
        category:   pick('category'),
        taxNumber:  pick('taxNumber'),
        website:    pick('website'),
        address:    pick('address'),
        notes:      pick('notes'),
        certificate:     buffer,
        certificateMime: 'application/pdf',
        certificateName: data.certificateName || 'certificate.pdf',
        certificateSize: buffer.length,
        status:      'Submitted',
        submittedAt: new Date(),
        // a fresh attempt starts with a clean slate
        decidedAt: null, decisionNote: null, decidedBy: null,
        editableFields: null, aiDecision: false
      });

      return toView(await SELECT.one.from(Suppliers).where({ ID: supplier.ID }));
    });

    return super.init();
  }
};
