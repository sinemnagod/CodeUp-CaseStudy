# Study Notes — CodeUp Supplier Management

Running notes for understanding and explaining this project.
Added to as we build. Read top to bottom.

---

## 1. The big picture

Four pieces, all running on your laptop:

```
        BROWSER
           |
           v
   :5000  APPROUTER  ............ the front door. Handles SAP login,
           |                      decides who may reach which path,
           |                      and serves the Fiori Launchpad.
           |
     +-----+------+
     |            |
  static      /portal, /approval
  UI5 files      |
                 v
        :4004  CAP BACKEND ...... the brain + database.
                 |
                 v
              db.sqlite ........ the actual data on disk.
```

- **Supplier Portal** — the UI5 app external suppliers use (register, apply, track).
- **Supplier Approvals** — the UI5 app internal staff use (review, approve, reject).
- Both are *freestyle* UI5 apps: we write the screens ourselves, as opposed to
  *Fiori Elements*, where SAP generates the screens from annotations.

During development we can talk to :4004 directly. The real authorization
behaviour only exists at :5000, because that is where the approuter lives.

---

## 2. Glossary

| Term | What it actually means |
|---|---|
| **CAP** | *Cloud Application Programming model*. SAP's Node.js framework for building backends. Gives you a database, a web server and an API from a short description file. |
| **CDS** | The little language CAP uses to describe data and services (`.cds` files). CAP reads it and generates SQL tables and REST/OData endpoints. |
| **OData** | A standard way of shaping a web API (how you filter, sort, page, call actions). SAP UI5 tables know OData natively, so a table can talk to the backend with no glue code. |
| **UI5 / SAPUI5** | SAP's frontend framework. Like React, but older and with a huge library of ready-made business controls (tables, forms, dialogs). |
| **Freestyle app** | A UI5 app where you write the views yourself. |
| **XSUAA** | SAP's login/authorization service on BTP. Issues the token that proves who you are and what you may do. |
| **Approuter** | A small Node.js server that sits in front of everything: it forces you to log in, then forwards your request to the backend. |
| **Destination** | A named address + credentials stored in BTP. The app says "call the destination named `openrouter`" and never sees the API key itself. |
| **Fiori Launchpad** | The tile page you land on, from which you open apps. |
| **Scope / Role** | A permission. Here there is one: `Approval`. |
| **i18n** | *internationalization*. Keeping all visible text in language files instead of in the code. |

---

## 3. Reading the `cds watch` startup output

```
cds serve all --with-mocks --in-memory?
```
`--in-memory?` — the `?` means *"use an in-memory database **unless** a real one
is configured."* We configured one, which is why the next line says:

```
[cds] - connect to db > sqlite { url: 'db.sqlite' }
```

So the data lives in the file `db.sqlite` and **survives restarts**. Had it used
in-memory, every restart would wipe the test accounts.

```
[cds] - using auth strategy { kind: 'mocked' }
```
SAP login is currently **faked**, using two local users defined in
`package.json`:

| user | password | roles |
|---|---|---|
| `approver` | `approver` | `Approval` |
| `employee` | `employee` | *(none)* |

That is what lets us prove the "no role → 403" case before BTP is wired up.
Later this becomes `kind: 'xsuaa'` and it is the real thing.

```
[cds] - serving ApprovalService { at: [ '/approval' ] }
[cds] - serving PortalService  { at: [ '/portal' ] }
```
The two services and the URLs they answer on.

Useful: **`cds watch` restarts the server automatically on every file save.**
Leave it running in its own terminal tab.

Other commands:

| Command | What it does |
|---|---|
| `npx cds watch` | run the backend, auto-restart on save |
| `npx cds deploy --to sqlite` | (re)create `db.sqlite` from the model — wipes all data |
| `npx cds compile srv --to sql` | print the SQL tables CAP would create, without running anything |

---

## 4. The data model — `db/schema.cds`

Two tables.

**`Suppliers`** — one row is *both* the login account *and* the application.
A supplier only ever has one application, so splitting them into two tables
would have added a join for no benefit.

The `status` column drives the entire application:

| status | meaning | what the portal shows |
|---|---|---|
| `New` | registered, never submitted | the empty form |
| `Submitted` | waiting for a decision | the process flow |
| `Approved` | accepted | the process flow, green |
| `Rejected` | refused, may re-apply | the flow + reason + "Re-apply" button |

**`Sessions`** — login tokens for suppliers. Explained in §6.

Two details worth pointing out:

- `passwordHash` — we never store the password itself. See §5.
- `certificate : LargeBinary @Core.MediaType : certificateMime` — the
  `@Core.MediaType` annotation turns that column into a **downloadable file**.
  Without it, it would just be a blob of bytes; with it, OData serves it as a
  real PDF at its own URL, which is how the approver opens the certificate.

---

## 5. Passwords

Stored with **bcrypt**:

```
Secret123!   ->   $2a$10$N9qo8uLOickgx2ZMRZoMye...
```

This is one-way. Even we cannot read the original password back. Login works
by hashing what the user just typed and comparing the two hashes.

`bcrypt.hash(password, 10)` — the `10` is the *cost factor*: how much work each
hash takes. Higher = slower to check, and slower for an attacker guessing
millions of passwords. 10 is the normal default.

**Why login returns the same error for "no such user" and "wrong password":**
if they differed, anybody could type e-mail addresses into the login page and
learn which ones are registered. One shared `LOGIN_FAILED` closes that.

---

## 6. How a supplier stays logged in

Suppliers are *external* — they have no SAP user, so XSUAA cannot help.
So the portal has its own tiny session system:

1. On register/login the backend generates a random 64-character token
   and stores it in the `Sessions` table with an expiry 8 hours out.
2. The browser keeps it in `sessionStorage`.
3. Every later request sends it as the header `x-supplier-token`.
4. The backend looks it up and thereby knows who is calling.

Like a wristband at a festival: show the wristband, we know who you are.

`sessionStorage` (not `localStorage`) because the token is a credential — it
survives a page reload but disappears when the tab closes.

---

## 7. The two services, and why there are two

This is the most important design decision in the project.

| | `/portal` | `/approval` |
|---|---|---|
| file | `srv/portal-service.cds` | `srv/approval-service.cds` |
| guard | `@requires: 'any'` | `@requires: 'Approval'` |
| who | external suppliers | internal staff |
| shape | **only actions** | a real, listable entity |

`@requires: 'any'` means *anybody, even not logged in*. It has to be public:
a brand-new supplier has no SAP user yet, so they must be able to reach
`/register` and `/login`.

**The portal exposes no list endpoint at all.** There is no URL that returns
"all suppliers". So it isn't that a supplier is *blocked* from reading other
suppliers' data — the door simply does not exist. That is a stronger guarantee
than a permission check, because there is no check to get wrong.

`@requires: 'Approval'` on the other service means CAP answers **403 Forbidden**
before any of our code runs, unless the caller's token carries the `Approval`
scope.

The `Applications` entity is also `@readonly`, and excludes `passwordHash`:

```cds
@readonly
entity Applications as projection on db.Suppliers
  excluding { passwordHash }
  where status <> 'New';
```

- `@readonly` — approvers can read, but cannot write directly. Every change has
  to go through the `approveApplication` / `rejectApplication` actions, so rules
  like *"a rejection needs a reason"* can never be bypassed.
- `excluding { passwordHash }` — even a legitimate approver never receives it.
- `where status <> 'New'` — someone who registered but never submitted is not
  an application yet, so they don't clutter the list.

### Proven behaviour

| request | result |
|---|---|
| `GET /approval/Applications` with no login | **401** |
| same, as `employee` (no role) | **403** |
| same, as `approver` | **200** |

The 403 case is one of the scenarios the use case requires in the video.

---

## 8. Validation — always twice

Every rule is enforced in **two** places:

- **in the browser**, so the user gets instant feedback;
- **on the server**, because anything running in a browser can be switched off.
  Open the dev tools and you can disable a JavaScript check in seconds.

The server is the one that actually matters. The browser check is a courtesy.

Server-side rules, all in `srv/portal-service.js`:

| rule | error code returned |
|---|---|
| e-mail looks like an e-mail | `EMAIL_INVALID` |
| password passes all 5 rules | `PASSWORD_WEAK` |
| e-mail not already used | `EMAIL_ALREADY_REGISTERED` |
| correct credentials | `LOGIN_FAILED` |
| Company Name filled | `COMPANY_NAME_REQUIRED` |
| Contact Person filled | `CONTACT_PERSON_REQUIRED` |
| a certificate was attached | `CERTIFICATE_REQUIRED` |
| certificate ≤ 10 MB | `FILE_TOO_LARGE` |
| certificate really is a PDF | `FILE_NOT_PDF` |
| not already submitted | `APPLICATION_ALREADY_SUBMITTED` |

### The PDF check is not a filename check

```js
const isPdf = data.certificateMime === 'application/pdf'
           && buffer.subarray(0, 4).toString('latin1') === '%PDF';
```

Anyone can rename `virus.exe` to `cert.pdf`, and the browser will happily claim
its type is `application/pdf`. Every real PDF file begins with the four bytes
`%PDF`, so we look **inside the file** instead of trusting its name.

### Why the size is checked twice in a row

```js
if (b64.length > MAX_FILE_BYTES * 1.4) return req.reject(400, 'FILE_TOO_LARGE');
const buffer = Buffer.from(b64, 'base64');
if (buffer.length > MAX_FILE_BYTES)     return req.reject(400, 'FILE_TOO_LARGE');
```

Base64 text is about 4/3 the size of the file it encodes. The first check is on
the *text*, and is cheap — it throws out an obviously oversized upload without
spending memory decoding it. The second is the real, exact check.

### Error codes, not error sentences

The backend returns `EMAIL_ALREADY_REGISTERED`, not "This e-mail is already
registered." The UI looks that code up in its i18n file, so the user reads the
message **in their own language**. The backend never has to know what language
anybody speaks.

---

## 9. Why `401` had to become `403` and `400`

Originally the login failure used `req.reject(401, 'LOGIN_FAILED')`. The
response came back as the bare word `Unauthorized`, with our error code gone.

Reason: `401 Unauthorized` is the status a server sends to say *"authenticate
yourself"*. CAP's authentication layer intercepts it and replaces the body with
a standard challenge, so our message never survives.

Fix: `400` for a failed login, `403` for a missing/expired session token. The
message body then reaches the browser intact.

---

## 10. The Supplier Portal app

Files under `app/supplier-portal/`:

| file | job |
|---|---|
| `index.html` | loads UI5 from SAP's CDN and starts the component |
| `manifest.json` | the app's descriptor: routes, models, libraries |
| `Component.js` | the entry point; starts routing |
| `view/*.view.xml` | the screens, written in XML |
| `controller/*.js` | the behaviour behind each screen |
| `i18n/*.properties` | every visible text, per language |
| `service/Backend.js` | one place that talks to the backend |

### Routing

`manifest.json` maps the part after `#` to a screen:

| URL | screen |
|---|---|
| `index.html` | Login |
| `index.html#/register` | Register |
| `index.html#/application` | Application form / status |

### Why the portal does not use OData model binding

The Approvals app binds a table straight to an OData entity — that is where
OData earns its keep (filter, sort, page, all for free).

The portal has no list. Every endpoint is a single action returning a single
object, and each call needs a custom `x-supplier-token` header. A plain HTTP
call in `service/Backend.js` is shorter, and its error handling is much easier
to read. Different problems, different tools.

### The live password checklist

`liveChange` fires on every keystroke. The controller tests the five rules and
writes the result into a JSON model; each rule is an `ObjectStatus` whose
`state` is `Success` (green) or `None` (grey). The list is hidden until the
user starts typing, and the Register button stays disabled until all five pass.

No custom CSS — `ObjectStatus` already draws the colour and icon. The whole
project uses only standard UI5 controls and the standard `sap_horizon` theme,
plus SAP's predefined spacing classes like `sapUiSmallMarginTop`.

### The process flow

`sap.suite.ui.commons.ProcessFlow`, three lanes:
`Gönderildi → İncelemede → Sonuç`.

Node colours come from the status:

| status | node 1 | node 2 | node 3 |
|---|---|---|---|
| `Submitted` | Positive (green) | Critical (orange) | Planned (empty, dashed) |
| `Approved` | Positive | Positive | Positive |
| `Rejected` | Positive | Positive | Negative (red) |

This library only exists in **SAPUI5**, not OpenUI5 — which is why
`index.html` loads from `https://ui5.sap.com/` and not `openui5.org`.

### Language detection

`index.html` deliberately has **no** `data-sap-ui-language` attribute. Without
it, UI5 takes the language from the browser — exactly what the use case asks
for. There is no language selector anywhere in the UI.

In `manifest.json`:

```json
"supportedLocales": ["", "tr"],
"fallbackLocale": ""
```

`""` means the file with no suffix — `i18n.properties`, our English/default.
`"tr"` means `i18n_tr.properties`.

**A bug worth remembering:** this first read `["en", "tr"]` with
`fallbackLocale: "en"`. UI5 then looked for `i18n_en.properties`, did not find
it, and — because `en` had been *declared supported* — refused to fall back to
the base file. Every label rendered as its raw key (`appTitle`, `loginLabel`).
Declaring the unsuffixed file as the default with `""` fixed it.

For testing you can force a language with `?sap-language=tr` in the URL, but
that is only a shortcut — the real demo must show the **browser** language
being changed.

---

## 11. Known design choices (say these before someone asks)

- **The portal page does not live-update.** It reads its data when it loads, so
  if an approver decides while the supplier's tab sits open, the supplier must
  refresh. Live push was not required, so it was not built.
- **The certificate is sent as base64 inside the action**, rather than streamed
  as a separate file upload. It keeps the submission to a single request and
  makes validation atomic. The cost is that the request body is ~33 % larger
  than the file, which is why `package.json` raises CAP's body limit to 15 MB
  for a 10 MB file limit.
- **One row for account + application**, because a supplier can only ever have
  one application.
