# BTP Setup — real SAP login for the local app

Do these once. At the end, `http://localhost:5000` will ask you to sign in with
your real SAP account, and the Approvals app will be locked behind a real role.

Everything still runs on your laptop. Only the **identity** comes from BTP.
That mixture is what SAP calls **hybrid** mode.

---

## 0. Make sure Cloud Foundry is enabled

BTP Cockpit → your **trial** subaccount → **Overview**.

Look for a **Cloud Foundry Environment** section with an **Org** and a **Space**
(usually called `dev`). If instead you see an *Enable Cloud Foundry* button,
click it and accept the defaults, then create a space called `dev`.

You need this because the XSUAA service instance lives in a CF space.

---

## 1. Create the XSUAA service instance

XSUAA is the service that issues login tokens and knows who has which role.

1. Left menu → **Services** → **Instances and Subscriptions**
2. Click **Create** (top right)
3. Fill in:
   - **Service**: `Authorization and Trust Management Service`
   - **Plan**: `application`
   - **Runtime Environment**: `Cloud Foundry`
   - **Space**: `dev`
   - **Instance Name**: `codeup-uaa`  ← use exactly this name
4. Click **Next** — **do not click Create yet.**

   > This is the step everyone misses. If you click **Create** on the first
   > screen, BTP makes the instance with *empty* parameters and your whole
   > security setup is silently skipped.

5. You land on a **Parameters** step with a JSON box.
   Open `xs-security.json` from the project root, copy **all** of it, and paste
   it in, replacing whatever is there.
6. *Now* click **Create**

### Check it worked before going on

After step 2 below (once you have the service key), run:

```bash
node scripts/check-xsuaa.js
```

It should say **OK**. If it reports `na-<uuid>`, the parameters were not
applied — delete the instance and redo this step. `na` stands for
*not available*: BTP invented a name because it was given nothing.

> **What that JSON does.** It declares one *scope* (`Approval`), one *role
> template* that grants the scope, and one *role collection* named
> **CodeUp Supplier Approver** that you can assign to people. It also lists
> `http://localhost:5000/**` as an allowed redirect URI — without that, SAP
> would refuse to send you back to your laptop after login.

---

## 2. Create a service key and download it

The service key is the username/password your local app uses to talk to XSUAA.

1. Still in **Instances and Subscriptions**, click the `codeup-uaa` instance
2. Open the **Service Keys** tab → **Create**
3. **Name**: `codeup-uaa-key` → **Create**
4. Click the new key → **Download** (or copy the JSON shown)
5. Save the file in the **project root** as exactly:

   ```
   service-key.json
   ```

   Same folder as `package.json`. It is already in `.gitignore` — this file is
   a password, never commit it.

Then run:

```bash
node scripts/setup-env.js
```

That writes `default-env.json` and `approuter/default-env.json`, which is where
the backend and the approuter each look for the credentials.

---

## 3. Give yourself the Approval role

Creating the instance also created the role collection. Now assign it.

1. Left menu → **Security** → **Role Collections**
2. Find **CodeUp Supplier Approver** in the list, and click it
3. Click **Edit**
4. Under **Users**, click the `+`, and enter:
   - **ID** and **E-Mail**: the e-mail you log into BTP with
   - **Identity Provider**: `Default identity provider`
5. Click **Save**

> If the role collection is not in the list, the instance creation did not read
> your JSON. Go back to step 1 and check the parameters were actually pasted.

**Do not do this yet if you want to film the failure case first** — see the
note at the bottom.

---

## 4. Run it

Two terminals, both in the project folder.

Terminal 1 — the backend, now validating real SAP tokens:

```bash
npm run watch:hybrid
```

Terminal 2 — the approuter, the front door. **Run this from the project root**,
not from inside `approuter/`:

```bash
npm run approuter
```

> The approuter resolves `localDir` relative to the folder it is started in, so
> starting it anywhere else means it cannot find the web pages.

Then open:

```
http://localhost:5000
```

You should be redirected to a real SAP login page, and land back on the
Fiori Launchpad with **your name in the top-right corner**.

---

## What good looks like

| you open | what should happen |
|---|---|
| `localhost:5000` | SAP login, then the launchpad with your name in the header |
| the **Supplier Portal** tile | opens with no extra login — it is public |
| the **Supplier Approvals** tile | opens only if you have the role |
| `localhost:5000/supplier-approvals/index.html` **without** the role | **403 Forbidden** |

---

## Filming the "no role yet" failure

The use case asks you to show *"attempting to log into the Supplier Approvals
application before the role is assigned"*. Two ways:

- **Easiest**: do step 3 **after** you record that clip. Open the Approvals
  app, get the 403, then assign the role, log out, log back in, and show it
  working.
- **If you already assigned it**: remove yourself from the role collection,
  log out of `localhost:5000/do/logout`, log back in, and record. Then add
  yourself back.

Either way you must **log out and back in** after changing roles — the role
list is baked into your login token when it is issued, so an existing token
keeps the old permissions until it is replaced.

---

## If something goes wrong

| symptom | cause |
|---|---|
| **403 at `localhost:5000` with `Server: AirTunes`** | **macOS AirPlay Receiver owns port 5000.** System Settings → General → AirDrop & Handoff → AirPlay Receiver → **Off**. Check with `lsof -nP -iTCP:5000 -sTCP:LISTEN` — no output means free. |
| approuter exits with `EADDRINUSE` | same thing: something else already has port 5000 |
| `No UAA service found` | `approuter/default-env.json` missing — run `node scripts/setup-env.js` |
| `Route references unknown destination "srv-api"` | same file missing |
| Login loops, or "redirect URI mismatch" | `http://localhost:5000/**` is not in the redirect URIs. Fix `xs-security.json` and update the instance parameters |
| 403 on the Approvals app although you assigned the role | you did not log out and in again |
| `Forbidden` on every page *after* a successful SAP login | the approuter was started from the wrong folder. Run `npm run approuter` from the project root |
| 401 from the backend but fine at the approuter | backend not started with `--profile hybrid` |
