using { codeup.supplier as db } from '../db/schema';

/**
 * PUBLIC service used by the Supplier Portal app.
 *
 * `@requires: 'any'` = anybody may call this, even without logging in to SAP.
 * That is on purpose: a brand new supplier has no SAP user yet, they must be
 * able to reach /register and /login.
 *
 * Note there is NO entity exposed here - only actions and functions.
 * A supplier can therefore never read anybody else's data, because there is
 * simply no URL that would return a list.
 */
@path    : '/portal'
@requires: 'any'
service PortalService {

  /** What the supplier is allowed to see about their own application. */
  type ApplicationView {
    ID              : UUID;
    email           : String(200);
    companyName     : String(100);
    contactPerson   : String(100);
    phone           : String(50);
    country         : String(100);
    category        : String(20);
    taxNumber       : String(50);
    website         : String(200);
    address         : String(500);
    notes           : String(1000);
    certificateName : String(255);
    status          : String(20);
    submittedAt     : Timestamp;
    decidedAt       : Timestamp;
    decisionNote    : String(1000);
    editableFields  : String(500);
  }

  /** Returned by register + login: the token is the supplier's "wristband". */
  type SessionInfo {
    token       : String(64);
    email       : String(200);
    application : ApplicationView;
  }

  /** Everything the supplier types into the application form. */
  type ApplicationInput {
    companyName       : String(100);
    contactPerson     : String(100);
    phone             : String(50);
    country           : String(100);
    category          : String(20);
    taxNumber         : String(50);
    website           : String(200);
    address           : String(500);
    notes             : String(1000);
    certificateName   : String(255);
    certificateMime   : String(100);
    /** the PDF itself, base64 encoded by the browser */
    certificateBase64 : LargeString;
  }

  action   register          (email : String(200), password : String(200)) returns SessionInfo;
  action   login             (email : String(200), password : String(200)) returns SessionInfo;
  action   logout            ()                                           returns Boolean;

  /** Reads the application belonging to the token in the request header. */
  function myApplication     ()                                           returns ApplicationView;

  /** Creates the application, or replaces it when re-applying after a rejection. */
  action   submitApplication (data : ApplicationInput)                     returns ApplicationView;
}
