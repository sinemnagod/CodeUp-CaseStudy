namespace codeup.supplier;

using { cuid, managed } from '@sap/cds/common';

/**
 * One row = one supplier account AND their application.
 * A supplier registers (email + password) -> row is created with status 'New'.
 * They fill the form -> status becomes 'Submitted'.
 * An approver decides -> status becomes 'Approved' or 'Rejected'.
 */
entity Suppliers : cuid, managed {

  // --- account (created at registration) ---
  email           : String(200) not null;
  passwordHash    : String(200) not null;   // never the plain password!

  // --- application form fields ---
  companyName     : String(100);
  contactPerson   : String(100);
  phone           : String(50);
  country         : String(100);
  category        : String(20);             // Hardware | Software | Services | Consulting
  taxNumber       : String(50);
  website         : String(200);
  address         : String(500);
  notes           : String(1000);

  // --- uploaded PDF certificate ---
  // @Core.MediaType turns this column into a downloadable file stream.
  certificate     : LargeBinary @Core.MediaType: certificateMime;
  certificateMime : String(100) @Core.IsMediaType;
  certificateName : String(255);
  certificateSize : Integer;

  // --- workflow ---
  status          : String(20) default 'New';  // New | Submitted | Approved | Rejected
  submittedAt     : Timestamp;
  decidedAt       : Timestamp;
  decisionNote    : String(1000);   // reason shown to the supplier (required on reject)
  decidedBy       : String(200);    // which approver decided
  aiDecision      : Boolean default false;  // was this decided by the AI?

  // On reject the approver picks which fields the supplier may correct.
  // Stored as a simple comma-separated list, e.g. "phone,address".
  //
  // The certificate is deliberately NOT in this list: a new one is required on
  // every submission, re-applications included, so it is never optional and
  // never inherited from the attempt that was rejected.
  editableFields  : String(500);
}

/**
 * A login session for a supplier.
 * The portal is public (no SAP login), so we hand out our own token after login,
 * like a wristband at a festival: show the wristband, we know who you are.
 */
entity Sessions {
  key token     : String(64);
      supplier  : Association to Suppliers;
      expiresAt : Timestamp;
}
