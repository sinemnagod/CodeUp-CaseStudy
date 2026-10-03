# Running the project

Cheat sheet for starting everything after a restart.

---

## Before you start: is HANA awake?

The **hybrid** profile uses SAP HANA Cloud, and a trial instance **stops itself
every day**. BTP Cockpit → SAP HANA Cloud → if it says *Stopped*, press
**Start** and wait a few minutes. See [HANA-SETUP.md](HANA-SETUP.md).

Plain `npm run watch` uses SQLite and needs none of this.

## Start it

**Two terminals, both in the project root:**

```
/Users/sinemdogan/Desktop/CodeUp SAP/CodeUp-CaseStudy
```

Terminal 1 — the backend (:4004):

```bash
npm run watch:hybrid
```

Terminal 2 — the approuter (:5000), **from the project root**, not from
`approuter/`:

```bash
npm run approuter
```

Then open:

```
http://localhost:5000
```

Sign in with your SAP account. You land on the Fiori Launchpad.

---

## Before recording: start from clean data

```bash
rm db.sqlite && npx cds deploy --to sqlite && node scripts/seed-demo.js
```

Five demo suppliers with submitted applications. Every demo account uses the
password `Secret123!`.

---

## Checks when something is wrong

```bash
node scripts/check-xsuaa.js    # is the SAP login set up correctly?
node scripts/check-ai.js       # is the AI destination + model working?
npx cds compile db/schema.cds --to sql --dialect hana    # same model, HANA SQL
lsof -nP -iTCP:5000 -sTCP:LISTEN   # is something else holding port 5000?
```

---

## Quick reference

| What | Where |
|---|---|
| Launchpad | <http://localhost:5000> |
| Supplier Portal | <http://localhost:5000/supplier-portal/index.html> |
| Supplier Approvals | <http://localhost:5000/supplier-approvals/index.html> |
| Sign out | <http://localhost:5000/do/logout> |
| Backend direct (dev only) | <http://localhost:4004> |

| Command | What it does |
|---|---|
| `npm run watch:hybrid` | backend with **real** SAP login **and HANA Cloud** |
| `npm run watch` | backend with **fake** users `approver` / `employee`, on SQLite (no BTP needed) |
| `npx cds deploy --to hana --profile hybrid` | create/update the tables in HANA |
| `npm run approuter` | the front door on :5000 |
| `node scripts/seed-demo.js` | add five demo suppliers |
| `AI_MODEL="..." npm run watch:hybrid` | run with a different AI model |

---

## Things that will trip you up

**Port 5000 is taken and you get a blank 403.** macOS AirPlay Receiver.
System Settings → General → AirDrop & Handoff → AirPlay Receiver → **Off**.

**You changed a role in BTP and nothing happened.** Roles are written into your
login token when it is issued. Sign out and back in.

**The approuter says `Forbidden` on every page after login.** It was started
from the wrong folder. It must run from the project root.

**The AI says the model no longer exists.** Free model ids get retired.
Run `node scripts/check-ai.js` — it lists the ones that work today.

**`cds watch` says port 4004 is in use.** An old server is still running:

```bash
pkill -f "cds serve"
```
