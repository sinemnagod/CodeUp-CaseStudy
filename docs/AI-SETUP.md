# AI Setup — the destination for the certificate check

The "Analyze with AI" button sends the uploaded certificate to an AI, which
decides whether it is still valid.

**The API key never goes in the code.** It is stored in a BTP **destination**,
and the application only ever knows that destination's *name*. That is what the
use case asks for, and it means the key can be rotated in the cockpit without
touching the project.

```
Approvals app → CAP backend → destination "openrouter" → openrouter.ai
                              (holds URL + API key)
```

---

## 1. Create the destination

BTP Cockpit → your **trial** subaccount → left menu **Connectivity** →
**Destinations** → **Create Destination**.

| Field | Value |
|---|---|
| Name | `openrouter` ← exactly this |
| Type | `HTTP` |
| Description | `OpenRouter AI for certificate checks` |
| URL | `https://openrouter.ai` |
| Proxy Type | `Internet` |
| Authentication | `NoAuthentication` |

> `NoAuthentication` is not a mistake. It means *BTP* does not add a login of
> its own. OpenRouter wants an `Authorization` header instead, which we add
> below as an additional property.

Now click **New Property** twice and add:

| Property | Value |
|---|---|
| `URL.headers.Authorization` | `Bearer sk-or-v1-...` ← your OpenRouter key |
| `URL.headers.Content-Type` | `application/json` |

Mind the space after `Bearer`. The SAP Cloud SDK turns any
`URL.headers.<name>` property into a real request header.

Click **Save**, then **Check Connection**. A `200` or a `401` from
openrouter.ai both prove the address is reachable; anything about DNS or
proxies means the URL is wrong.

---

## 2. Create a destination *service* instance

The destination above is just a stored record. For your locally running app to
read it, the app needs credentials for the Destination **service**.

1. **Services** → **Instances and Subscriptions** → **Create**
2. Service: `Destination Service`, Plan: `lite`,
   Runtime Environment: `Cloud Foundry`, Space: `dev`
3. **Instance Name**: `codeup-destination`
4. Click **Create** (this one genuinely needs no parameters)

Then a service key, exactly as you did for XSUAA:

1. Click `codeup-destination` → **Service Keys** → **Create**
2. Name it `codeup-destination-key` → **Create**
3. Download it and save it in the project root as:

   ```
   destination-key.json
   ```

Then regenerate the local config:

```bash
node scripts/setup-env.js
```

It should now print `destination service : bound`.

---

## 3. Restart and try it

```bash
npm run watch:hybrid      # terminal 1
npm run approuter         # terminal 2, from the project root
```

Open the Approvals app, click a pending application, and press
**Analyze with AI**.

| test file | expected |
|---|---|
| `test-files/certificate-valid.pdf` | **Approved** — valid until 2028 |
| `test-files/certificate-expired.pdf` | **Rejected** — expired in 2022 |

Both files are already attached to seeded demo suppliers, or you can submit
them yourself through the portal.

---

## Choosing the model

The default is a free model:

```
meta-llama/llama-3.3-70b-instruct:free
```

Free models are rate-limited and occasionally unavailable. To switch, set an
environment variable before starting the backend — no code change:

```bash
AI_MODEL="openai/gpt-4o-mini" npm run watch:hybrid
```

Paid models need credit on your OpenRouter account, but cost a fraction of a
cent per check.

---

## If something goes wrong

| message in the app | what it means |
|---|---|
| `The AI service could not be reached...` | the destination is missing, misnamed, or the key in it is wrong. Check the backend terminal — it logs the real reason after `[ai] call failed:` |
| `The certificate contains no readable text...` | the PDF is a scanned image with no text layer. Expected behaviour — we refuse to guess |
| `The AI did not give a clear answer...` | the model replied with something that was not the JSON we asked for. Try another model |

A useful check from the backend terminal: if `[ai] call failed` mentions
`401`, the API key is wrong; `404` means the URL is wrong; anything about
`destination` not found means step 2 did not take effect.

---

## Fallback if the destination service instance will not cooperate

The SAP Cloud SDK also accepts destinations from a local `destinations` array
in `default-env.json` — the same array the approuter uses for `srv-api`:

```json
{ "name": "openrouter", "url": "https://openrouter.ai",
  "headers": { "Authorization": "Bearer sk-or-v1-..." } }
```

This works, and gets you unblocked. **But say so if you use it**: the use case
asks for the credentials to live in a *BTP* destination, and this keeps them in
a local file instead. Use it to keep moving, then go back and do step 2
properly before recording.
