using { codeup.supplier as db } from '../db/schema';

/**
 * PROTECTED service used by the Supplier Approvals app.
 *
 * `@requires: 'Approval'` = you need the Approval scope in your SAP token.
 * Without it CAP answers 403 Forbidden before a single line of our code runs.
 * This is the "Attempting to log into Supplier Approvals before the role is
 * assigned" scenario the use case asks us to demonstrate.
 */
@path    : '/approval'
@requires: 'Approval'
service ApprovalService {

  /**
   * The table in the app is bound to this entity.
   * `@readonly` means the approver can list and read, but cannot write directly -
   * every change has to go through the approve / reject / AI actions below,
   * so our rules (e.g. "a rejection needs a reason") can never be bypassed.
   *
   * `@restrict` states the permission on the entity itself, in addition to the
   * `@requires` on the service. The service-level check already blocks anyone
   * without the role, so this is belt and braces - but it keeps the rule next
   * to the data it protects, which is where someone reading the model looks
   * for it.
   */
  @readonly
  @restrict: [
    { grant: 'READ', to: 'Approval' }
  ]
  entity Applications as projection on db.Suppliers
    excluding { passwordHash }
    where status <> 'New';   // suppliers who registered but never submitted are not applications yet

  /** Result of an AI analysis, shown to the approver before they commit to it. */
  type AiResult {
    decision : String(20);    // Approved | Rejected
    reason   : String(1000);
  }

  action approveApplication (ID : UUID, note : String(1000))                                     returns String;
  action rejectApplication  (ID : UUID, note : String(1000), editableFields : String(500)) returns String;

  /** Sends the uploaded PDF to the AI and lets it decide. */
  action analyzeWithAI      (ID : UUID)                                                          returns AiResult;
}
