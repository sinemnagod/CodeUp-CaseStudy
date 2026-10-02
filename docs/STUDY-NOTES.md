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

---

## 12. The Supplier Approvals app

Files under `app/supplier-approvals/`. Same shape as the portal, plus two
**fragments** — a fragment is a reusable piece of UI that is not a whole
screen, which is how dialogs are normally written in UI5.

| file | job |
|---|---|
| `view/Main.view.xml` | tabs + table |
| `view/SettingsDialog.fragment.xml` | columns / sorting / category filter |
| `view/DetailDialog.fragment.xml` | one application + the decision buttons |
| `controller/Main.controller.js` | all the behaviour |
| `controller/BaseController.js` | shared helpers and formatters |

### This app *does* use OData model binding

Unlike the portal. `manifest.json` declares the service as a data source:

```json
"dataSources": {
  "approvalService": { "uri": "/approval/", "type": "OData",
                       "settings": { "odataVersion": "4.0" } }
}
```

and the table binds straight to the entity:

```xml
items="{ path: '/Applications', parameters: { $count: true } }"
```

That one line gives us loading, paging and a row count. Filtering and sorting
are then handed to the **server**:

```js
this._binding().filter(filters);
this._binding().sort(new Sorter(field, descending));
```

UI5 turns these into `$filter=` and `$orderby=` in the URL, so the database
does the work. The app would behave the same with 50 000 applications as with 6.

### How the filters combine

Three independent things can narrow the list:

| source | what it produces |
|---|---|
| the status tab | `status eq 'Submitted'` |
| the category ticks | `category eq 'Software' OR category eq 'Services'` |
| the search box | `contains(companyName,'x') OR contains(contactPerson,'x') OR contains(email,'x')` |

Each group is internally **OR**, and the groups are combined with **AND** —
"in the right tab, AND in one of those categories, AND matching the search".
In UI5, `new Filter({ filters: [...], and: false })` is the OR group;
passing an array of filters to `.filter()` ANDs them.

### The tab counts

Four small `$count` requests:

```
/approval/Applications/$count?$filter=status eq 'Submitted'
```

Asking the server to count is far cheaper than downloading every row just to
count them in the browser.

### Calling an action from UI5

```js
const action = this.getView().getModel().bindContext("/approveApplication(...)");
action.setParameter("ID", id);
await action.execute();
```

The `(...)` is **literal OData V4 syntax** meaning "parameters follow". For a
function that returns something, the result is read afterwards with
`action.getBoundContext().getObject()`.

### Why the approver cannot simply edit a row

`Applications` is `@readonly`. Every change goes through an action, which is
what lets the backend guarantee:

- a rejection always carries a reason;
- an application can only be decided **once** (`ALREADY_DECIDED`);
- `decidedBy` is taken from the SAP token (`req.user.id`), never from the
  browser, so an approver cannot claim to be somebody else.

### The certificate link

The `Link` in the detail dialog points at:

```
/approval/Applications(<id>)/certificate
```

That URL exists purely because of the `@Core.MediaType` annotation on the
column. OData streams the bytes out of the database with the right content
type, and the browser opens it as a PDF. We wrote no download code at all.

---

## 13. Three bugs found while building the approvals app

Worth knowing, because two of them are UI5 traps you will meet again.

### a) `getBinding("items")` was `undefined` in `onInit`

The table control exists during `onInit`, but its **binding** does not yet.
Two fixes were applied:

- the `dataReceived` event is declared on the binding in the XML instead:
  `events: { dataReceived: '.onDataReceived' }`;
- everywhere else the binding is fetched fresh via a small `_binding()`
  helper rather than cached in a variable.

### b) The date column was empty

The first attempt bound the column with an explicit OData type. UI5 threw
`Illegal sap.ui.model.odata.type.DateTimeOffset value` and then, after
switching to a formatter, `The given date instance isn't valid`.

Two separate causes, stacked:

1. **The formatter never saw the raw value.** In OData V4 the model converts a
   property using the type from `$metadata` *before* your formatter runs.
   The fix is `targetType: 'any'`, which tells UI5 to hand the formatter the
   untouched ISO string:

   ```xml
   text="{ path: 'submittedAt', targetType: 'any', formatter: '.formatDateTime' }"
   ```

2. **`DateFormat` rejects a plain `new Date()`.** Since UI5 1.111, when the UI5
   timezone can differ from the browser's, `DateFormat` wants a `UI5Date`:

   ```js
   DateFormat.getDateTimeInstance({ style: "medium" })
             .format(UI5Date.getInstance(value));
   ```

The payoff: the date now reads `30 Eyl 2026 21:50:51` in Turkish and
`Sep 30, 2026, 9:50:51 PM` in English, with no date logic of our own.

### c) A search-and-replace that ate itself

Replacing `this._table.getBinding("items")` with `this._binding()` everywhere
also rewrote the inside of `_binding()` — turning it into a function that
called itself forever. A reminder to read what a bulk replace actually did.

---

## 14. Demo data

`scripts/seed-demo.js` creates five suppliers with submitted applications:

```bash
node scripts/seed-demo.js
```

It only uses the **public portal endpoints**, exactly as a real supplier would,
so it doubles as an end-to-end test of register + submit. Every demo account
uses the password `Secret123!`.

To start completely fresh:

```bash
rm db.sqlite && npx cds deploy --to sqlite && node scripts/seed-demo.js
```

### Test files for the video — `test-files/`

| file | use it to show |
|---|---|
| `certificate-valid.pdf` | the happy path (valid until 2028) |
| `certificate-expired.pdf` | the AI rejecting an expired certificate (expired 2022) |
| `not-a-pdf.txt` | the "only PDF" rule |
| `too-big.pdf` | the 10 MB rule (this file is 11 MB) |

---

## 15. The Fiori Launchpad

`app/index.html` plus `app/appconfig/fioriSandboxConfig.json`.

This page belongs to **neither** UI5 app. It sits above both and just shows
tiles that open them — which is why it lives at the `app/` root rather than
inside `supplier-portal/` or `supplier-approvals/`.

"Sandbox" means a local stand-in for the real Fiori Launchpad you would get on
BTP. Same look and same navigation rules, no server needed.

### A tile does not point at a URL

It points at an **intent**, written `#SemanticObject-action`:

```
tile  →  #SupplierPortal-display  →  /supplier-portal/index.html
```

The middle step is *target resolution*, configured under
`ClientSideTargetResolution` in `fioriSandboxConfig.json`. The indirection
means an app can move without touching a single tile, and two different tiles
can resolve to the same app with different parameters. You can watch it happen:
clicking the tile first puts `#SupplierPortal-display` in the address bar, and
only then navigates to the real page.

### Why the scripts are loaded by JavaScript instead of plain `<script>` tags

The sandbox reads `window["sap-ushell-config"]` the instant it starts. We need
two things in there first:

1. the tile definitions, fetched from `fioriSandboxConfig.json`;
2. **who is logged in**, fetched from `/user-api/currentUser`.

So `index.html` fetches both, builds the config object, and only then injects
`sandbox.js` followed by `sap-ui-core.js` — in that order, because the sandbox
has to register itself before UI5 boots.

`/user-api/currentUser` is an endpoint the **approuter** provides. It therefore
only answers on `:5000`, which is also the only place there is a real SAP user
to show. Opened directly on `:4004` the fetch fails, we skip that part, and the
launchpad still works. That is the requirement *"the authenticated (XSUAA)
user's details must appear in the launchpad header"*.

### Two things that broke while building it

- `Container.createRenderer()` needs a renderer name in current UI5, otherwise
  it throws `Missing renderer name`. It must be `createRenderer("fiori2", true)`.
- A `"_comment"` array in `fioriSandboxConfig.json` made the shell log
  *"Merging of arrays is not supported"*. The shell merges that file into its
  own config, so stray keys cause noise. JSON has no comments — explanations
  belong in documentation, not in config files.

---

## 16. The approuter — the front door

`approuter/` contains almost no code: a `package.json` that pulls in
`@sap/approuter`, and `xs-app.json`, which is the whole configuration.

Everything the user touches goes through `:5000`. The approuter:

1. makes you log in with a real SAP account (XSUAA);
2. checks whether the path you asked for is allowed for *you*;
3. forwards the request to the backend on `:4004`, or serves a static file.

**The real authorization behaviour only exists here.** Talking to `:4004`
directly in development bypasses it, which is exactly why the use case insists
the demo runs through the approuter.

### Reading `xs-app.json`

Routes are tried **in order, first match wins**. Ours, in order:

| # | path | authentication | why |
|---|---|---|---|
| 1 | `/portal/**` | **none** | a new supplier has no SAP account yet |
| 2 | `/approval/**` | xsuaa + `Approval` scope | the approver API |
| 3 | `/supplier-portal/**` | **none** | the supplier's web pages |
| 4 | `/supplier-approvals/**` | xsuaa + `Approval` scope | so a user without the role cannot even open the app |
| 5 | `/**` | xsuaa | the launchpad — this is what puts the user's name in the header |

**The order is the security.** Route 5 matches everything. If it were first it
would swallow `/portal` and no supplier could ever register. The use case warns
about exactly this: *"If the regex order or the authorization mapping is wrong,
either the supplier cannot register or the approval endpoints are exposed to
everyone."*

### Two settings worth being able to explain

**`"csrfProtection": false` on the portal route only.** The approuter normally
demands a CSRF token on every POST. CSRF attacks work by making *your* browser
send a request with credentials it attaches automatically — a session cookie.
The portal route has no SAP session at all, and the supplier's own token is
sent in a custom header, which a cross-site form cannot set. So the protection
has nothing to protect there. It stays **on** for `/approval`, where there is a
real session; the UI5 OData V4 model handles those tokens by itself.

**`"forwardAuthToken": true` on the destination.** The approuter passes the SAP
token on to the backend, so CAP can check the `Approval` scope *itself*. The
permission is therefore enforced twice, independently. Without it, the backend
would have to simply trust that the approuter did its job.

### `xs-security.json`

The security contract, uploaded to BTP when the XSUAA instance is created:

| part | meaning |
|---|---|
| **scope** `$XSAPPNAME.Approval` | the permission itself |
| **role template** `Approver` | a role that grants that scope |
| **role collection** `CodeUp Supplier Approver` | what an administrator actually assigns to a person |
| **redirect-uris** `http://localhost:5000/**` | SAP refuses to send a user back to a URL not on this list |

`$XSAPPNAME` is a placeholder BTP replaces with the real application name, so
two apps in the same subaccount cannot collide on a scope called `Approval`.

### Roles live in the token

Assigning a role collection does **not** affect anyone already logged in. The
role list is written into the login token when the token is issued, so a user
keeps their old permissions until they log out and back in. Worth saying out
loud in the video, because otherwise the 403 demo looks like a bug.

### The `hybrid` profile

`package.json` now has:

```json
"auth": {
  "kind": "mocked",
  "[hybrid]":     { "kind": "xsuaa" },
  "[production]": { "kind": "xsuaa" }
}
```

A **profile** is a named set of overrides. Plain `cds watch` still uses the two
fake users, so day-to-day development needs no BTP at all;
`cds watch --profile hybrid` swaps in real token validation.

"Hybrid" = the app runs locally, the identity comes from the real cloud service.

### One service key, two files

`scripts/setup-env.js` reads `service-key.json` and writes both
`default-env.json` (for the backend) and `approuter/default-env.json` (for the
approuter), because the two processes each look in their own folder. All three
files are in `.gitignore` — a service key is a password.

---

## 17. Two setup traps that cost real time

Both were silent failures — nothing said "you did this wrong".

### a) The XSUAA instance was created without its parameters

The BTP create-instance wizard has a **Create** button on the *first* screen,
before the **Parameters** step. Clicking it produces a perfectly working XSUAA
instance that has **no scopes, no role templates, no role collection and no
redirect URIs** — none of our security model at all.

The tell is in the service key:

```
xsappname : na-7852b1c9-472e-46c1-94eb-c5c44993ab79!t720307
```

`na` is **not available** — BTP invented a name because it was given none.
A correct instance reads `codeup-supplier!t720307`.

The symptom appears three steps later ("I can't find the role collection"),
far away from the cause. `scripts/check-xsuaa.js` now turns this into a loud
failure right after the service key is downloaded.

### b) macOS AirPlay Receiver owns port 5000

On recent macOS, Control Center listens on port 5000 and answers **403
Forbidden** to everything. So `localhost:5000` returned a 403 that looked
exactly like a missing authorization — while the approuter was not running at
all, having failed with `EADDRINUSE`.

The giveaway was in the response headers:

```
HTTP/1.1 403 Forbidden
Server: AirTunes/870.14.1
```

**`Server: AirTunes` is not SAP.** Fix: System Settings → General →
AirDrop & Handoff → AirPlay Receiver → Off.

**The lesson worth repeating in the video:** when something returns an error,
check *who* answered before assuming it was your application. One `curl -i`
showing the response headers saved a long hunt through the security config.

### c) `localDir: "../app"` made the approuter forbid its own files

Symptom: SAP login succeeded, and then **every page** showed a bare
`Forbidden`. Confusingly, the *public* supplier pages were 403 too, while the
*protected* API routes looked like they returned 200.

Two separate things were going on.

**The 200s were a red herring.** An unauthenticated request to a protected
route does not get a 401 from the approuter — it gets **200 with an HTML page
whose script redirects you to the login server**. So "200" there meant "here is
a login page", not "here is your data". Checking the *body*, not just the
status code, made that obvious.

**The real bug** was in `xs-app.json`:

```json
"localDir": "../app"
```

The approuter serves static files relative to the directory it was **started**
in, and it refuses to follow `../` out of that directory — that is standard
path-traversal protection, and it is right to do it. Starting the approuter
inside `approuter/` meant every static route pointed outside its root, so it
answered 403 to all of them.

The fix was to start the approuter from the **project root** and drop the `..`:

```
xs-app.json          at the project root,  "localDir": "app"
default-env.json     at the project root,  read by BOTH processes
npm run approuter    started from the project root
```

Both the backend and the approuter are now started from the same folder, so
one `default-env.json` serves both — the backend reads `VCAP_SERVICES`, the
approuter reads `VCAP_SERVICES` and `destinations`.

**The diagnostic worth remembering:** the three failing routes had one thing in
common — they all served files from `localDir`. The two that worked
(`/portal`, `/approval`) both used `destination` instead. Grouping the failures
by what they shared pointed straight at `localDir`, with no guessing.

---

## 18. Showing the logged-in SAP user in the launchpad header

The use case requires *"the authenticated (XSUAA) user's details must appear in
the launchpad header"*. This took four attempts, and each failure was
informative.

### Attempt 1 — nothing appeared at all

`/user-api/currentUser` returned 404. The approuter only exposes that endpoint
if a route explicitly asks for the built-in service; otherwise the request
falls through to the static file handler. Added as the **first** route:

```json
{ "source": "^/user-api(.*)$", "target": "$1",
  "service": "sap-approuter-userapi", "authenticationType": "xsuaa" }
```

### Attempt 2 — `UserInfo` service was broken

```
TypeError: Cannot read properties of undefined (reading 'getSystem')
```

The sandbox `Container` adapter needs **`systemProperties`**. Without it the
shell's own user service throws while starting. Adding it made
`Container.getLogonSystem()` return real values.

### Attempt 3 — the config approach is a dead end

Even with `services.Container.adapter.config.userProfile.defaults` set,
`Container.getUser()` still returned **`Default User`**, and no avatar control
was created anywhere on the page.

**Current SAPUI5 has removed the classic user avatar from the launchpad
sandbox.** Setting the user profile in config cannot work, because nothing
reads it any more. Worth knowing in general: when a documented config key
appears to do nothing, check whether the control it feeds still exists.

So the user item is added explicitly instead, through the renderer API:

```js
renderer.addHeaderEndItem({ id: "currentUserItem", icon: "...", press: ... },
                          true, ["home", "app"], true);
```

### Attempt 4 — two objects with confusingly similar names

```js
Container.createRenderer("fiori2", true)   // -> the Shell CONTROL (has placeAt)
Container.getRendererInternal("fiori2")    // -> the Renderer API  (has addHeaderEndItem)
```

Calling `addHeaderEndItem` on the first one throws, and because the call sat
inside an `async` callback the error was swallowed and the page looked fine.

### And then a timing problem

With the right object the item was *created* — `getElementById` found it, with
the correct tooltip — but it did not render. Adding it immediately after
`placeAt` is too early: the shell rebuilds its header when it switches into the
`home` state, discarding what was there. Deferring to the shell's
`onAfterRendering` fixed it.

**The debugging lesson:** "created but not visible" and "not created" are
completely different problems. Checking
`sap.ui.core.Element.getElementById("currentUserItem")` separated them in one
step — without that, the obvious guess would have been that the code never ran.

### What it looks like

A person icon at the top right. Hovering shows `Full Name (email)`; clicking
opens a popover with the name, the e-mail, and a **Sign out** button that goes
to the approuter's `/do/logout`.

That sign-out matters for the demo: changing a role collection has no effect
until a **new** token is issued, so filming the "no role yet" scenario means
logging out and back in.

---

## 19. The AI certificate check

Files: `srv/ai.js` (reading the PDF and talking to the AI) and the
`analyzeWithAI` action in `srv/approval-service.js`.

### The flow

```
Approvals app
  -> CAP action analyzeWithAI(ID)
     -> read the PDF bytes out of the database
     -> pdf-parse: bytes -> plain text
     -> SAP Cloud SDK: POST through the destination "openrouter"
        -> openrouter.ai  -> a language model
     -> parse {"decision","reason"} out of the answer
     -> write the decision through the SAME decide() helper the buttons use
```

### Why a destination, and not an API key in the code

The application never sees the key. It says *"send this through the
destination called `openrouter`"*, and BTP attaches the address and the
`Authorization` header on the way out. So:

- the key is never in the source and never in git;
- it can be rotated in the cockpit with no code change and no redeploy;
- test and production can use different keys with identical code.

In the cockpit the key is an **additional property** named
`URL.headers.Authorization`. The SAP Cloud SDK turns any `URL.headers.<name>`
property into a real request header. The destination's own Authentication is
`NoAuthentication`, which only means *BTP* adds no login of its own.

### The AI decides, but it does not get special powers

`analyzeWithAI` writes its result through the same `decide()` helper that
`approveApplication` and `rejectApplication` use. So the AI is subject to every
rule a human is: it cannot decide an application twice, and the decision is
stamped with `aiDecision = true` so you can always tell who decided.

That is the point worth making on camera: the AI is wired in as *another
caller* of the existing rule, not as a second path around it.

### Reading a media column is not an ordinary SELECT

This cost a debugging round. The first version did:

```js
const application = await SELECT.one.from(Suppliers).where({ ID });
// application.certificate -> undefined
```

A column annotated `@Core.MediaType` is **left out of a normal SELECT** — CAP
assumes you want to stream it, not carry megabytes around in every query. It
has to be asked for by name, and it then arrives as a **Readable stream**:

```js
const stored = await SELECT.one.from(Suppliers).columns('certificate').where({ ID });
const buffer = await readStream(stored.certificate);   // 18848 bytes, starts "%PDF"
```

Diagnosing it took one throwaway script that printed the *type* of what came
back from each variant. "It is undefined" and "it is a stream, not a Buffer"
are both invisible if you only look at whether the call threw.

### Making a language model's answer safe to use

Models wrap JSON in prose, or in ```` ```json ```` fences, or add "Sure, here
you go!". So the answer is never trusted as-is:

1. find the first `{...}` block with a regular expression;
2. try to `JSON.parse` it;
3. accept `decision` **only** if it is exactly `Approved` or `Rejected`;
4. anything else -> `AI_UNCLEAR_ANSWER`, and the approver decides by hand.

Tested against five shapes of answer, including chatty preambles, fenced JSON
and a model that invented `"decision":"maybe"`. The last two correctly produce
no decision rather than a wrong one.

Also deliberate: `temperature: 0` so the same certificate gives the same
verdict, and only the first 6000 characters are sent, because a certificate's
dates are near the top and tokens cost money.

### When the AI refuses to answer

A scanned certificate — a photo saved as PDF — has no text layer. `pdf-parse`
returns almost nothing, and rather than let the model hallucinate a verdict
from an empty page, the backend stops with `AI_PDF_UNREADABLE`. Refusing to
guess is a feature here, not a limitation.

### Getting the AI working: three failures in a row

Each one looked like the previous one's cause, which is what made it slow.

**1. `404` — which was not a wrong URL.**
The model id hardcoded in `srv/ai.js` had been **retired** from OpenRouter, and
OpenRouter answers `404` for an unknown model. The destination was perfect all
along. Two checks separated them in a minute:

```bash
curl -o /dev/null -w "%{http_code}" -X POST https://openrouter.ai/api/v1/chat/completions ...
#   -> 401, so the endpoint exists and the path is right
curl -s https://openrouter.ai/api/v1/models | grep <model-id>
#   -> absent, so the model is the problem
```

**Free model ids are not stable infrastructure.** Pinning one in source is a
bug with a timer on it. It now lives in a constant with `AI_MODEL` as an
override, and `scripts/check-ai.js` lists the ids that exist today.

**2. `429` — rate-limited upstream.**
Free models are shared, and a popular one can simply be busy. That is not an
outage, so it gets its own message: *"try again in a minute"*.

**3. Models that answer `200` with nothing.**
Testing fourteen free models against one trivial prompt, most returned HTTP 200
with an **empty** `content` — they are reasoning models that put their output
elsewhere or spend the whole budget thinking. Only two returned clean JSON.
`poolside/laguna-s-2.1:free` was then verified on the real task:

```
expired cert (2022)  -> Rejected | The certificate expired on 02 March 2022.
valid cert   (2028)  -> Approved | The certificate is valid until 14 January 2028...
```

**"HTTP 200" is not "it worked".** Had the check only asserted a 2xx, a model
that answers nothing would have passed and then failed mysteriously in the app.

### Why the real error was invisible at first

The SAP Cloud SDK puts only the status code in `error.message`. The service's
own explanation — *"No endpoints found for ..."* — sits in
`error.response.data`, which nothing logged. One line fixed that:

```js
console.error('[ai] call failed:', error.message,
    body ? '\n[ai] service said: ' + JSON.stringify(body).slice(0, 500) : '');
```

And a single `AI_UNAVAILABLE` for every failure was hiding the distinction that
mattered. There are now four: `AI_MODEL_UNKNOWN` (404), `AI_KEY_REJECTED`
(401/403), `AI_RATE_LIMITED` (429) and `AI_UNAVAILABLE` for anything else.

**The lesson:** an error message that cannot distinguish between "wrong key",
"dead model" and "busy right now" is not a safety net, it is a blindfold.

### A quieter bug found on the way

In the detail dialog the certificate link showed its PDF icon but **no file
name**. The dialog copies its data from the table row, and the OData V4 model
with `autoExpandSelect` only requests the fields the table's columns bind —
`certificateName` is not a column, so it was never fetched. Fixed by naming the
fields explicitly in the binding's `$select`.

Worth remembering: with `autoExpandSelect`, anything you read in code rather
than bind in the view has to be requested on purpose.
