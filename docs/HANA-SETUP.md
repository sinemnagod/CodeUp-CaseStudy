# SAP HANA Cloud — the database for the hybrid profile

The briefing asked for data like e-mail and password to be stored in **SAP
HANA Cloud**. The code side is already done; what follows is the part only you
can do, in the BTP cockpit.

**How it is wired:**

| profile | command | database |
|---|---|---|
| development (default) | `npm run watch` | SQLite, `db.sqlite` |
| **hybrid** | `npm run watch:hybrid` | **SAP HANA Cloud** |

Local development therefore never depends on a cloud instance being awake,
while the version you demonstrate and record runs on HANA.

> `db/schema.cds` mentions no database anywhere. Proof:
> ```bash
> npx cds compile db/schema.cds --to sql --dialect hana
> npx cds compile db/schema.cds --to sql --dialect sqlite
> ```
> Same file, two dialects. That is worth showing on camera.

---

## 1. Create the HANA Cloud instance

1. BTP Cockpit → your **trial** subaccount → **Services** → **Service Marketplace**
2. Find **SAP HANA Cloud** → **Create**
3. Choose **SAP HANA Cloud, SAP HANA Database**
4. Give it a name, e.g. `codeup-hana`
5. Set the **DBADMIN password** — write it down, you cannot recover it
6. **Important:** on the *Connections* step set
   **Allowed connections → Allow all IP addresses**.
   Without this your laptop cannot reach the database and the hybrid profile
   fails with a connection timeout.
7. Create, then wait. **Provisioning takes 20–40 minutes.**

---

## 2. Create an HDI container

The application does not log in as DBADMIN; it gets its own schema.

1. **Service Marketplace** → **SAP HANA Schemas & HDI Containers**
2. **Create** → Plan: `hdi-shared`, Runtime: `Cloud Foundry`, Space: `dev`
3. **Instance Name**: `codeup-db`
4. Create

Then a service key, as before:

1. **Instances and Subscriptions** → `codeup-db` → **Service Keys** → **Create**
2. Name: `codeup-db-key` → **Create** → **Download**
3. Save it in the project root as:

   ```
   hana-key.json
   ```

```bash
node scripts/setup-env.js
```

It should now print `HANA (hybrid) : bound`.

---

## 3. Create the tables

```bash
npx cds deploy --to hana --profile hybrid
```

This reads `db/schema.cds`, generates HANA SQL and creates the tables inside
your HDI container. Re-run it whenever the model changes.

---

## 4. Run it

```bash
npm run watch:hybrid      # terminal 1 - now talking to HANA
npm run approuter         # terminal 2, from the project root
```

The startup line should read `connect to db > hana` instead of `sqlite`.
That one line is your proof on camera.

Then seed some demo data, which now lands in HANA:

```bash
node scripts/seed-demo.js
```

---

## The two things that will catch you out

**A trial HANA instance stops itself every day.** If it is stopped, the hybrid
profile cannot start. Before recording:

> BTP Cockpit → **SAP HANA Cloud** → if the instance says *Stopped*, press
> **Start** and wait a few minutes.

Build this into your pre-recording checklist. It is the single most likely
reason the demo fails on the day.

**A trial instance is deleted after about 30 days stopped.** If you come back
to this project later and the instance is gone, recreate it and re-run
steps 2–3.

---

## If it will not connect

| symptom | cause |
|---|---|
| connection timeout on startup | the instance is **stopped** — start it in the cockpit; or *Allow all IP addresses* was not set |
| `No service matching hana found` | `hana-key.json` missing — run `node scripts/setup-env.js` |
| tables do not exist | `cds deploy --to hana --profile hybrid` has not been run |
| works with `npm run watch` but not `watch:hybrid` | that is the point — plain `watch` is SQLite. The failure is in the HANA setup, not in the app |
