# QA Test Plan — Clients & Hours Tracking Feature

**Project:** Dabelu Tax-Office PWA  
**Date:** 2026-10-21  
**Feature branches:** `feature-clients-hours-api` (backend) · `feature-clients-hours-ui` (frontend)

---

## Section 1 — API Contract

All endpoints are Vercel serverless functions in `api/`. They use `lib/firestore.js` (`fsFetch`) with service-account auth (API-key fallback). All responses are JSON. CORS headers must be set on every response.

### `GET /api/clients`

**Request**
```
GET /api/clients?userId=<string>
```

**Response 200**
```json
{ "clients": [ { "id": "<docId>", "name": "...", "email": "...", "whatsapp": "..." } ] }
```

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `userId` query param | 400 | `{ "error": "missing userId" }` |
| No clients found for that userId | 200 | `{ "clients": [] }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

### `POST /api/clients`

**Request**
```json
{ "name": "כהן בע\"מ", "email": "c@ex.com", "whatsapp": "972501234567", "userId": "<string>" }
```
`email` and `whatsapp` are optional. `name` and `userId` are required.

**Response 200**
```json
{ "ok": true, "id": "<newDocId>" }
```

**Firestore document written to:** `clients/<autoId>`  
**Fields saved:** `name`, `email`, `whatsapp`, `userId`, `createdAt` (ISO string)

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `name` | 400 | `{ "error": "missing name" }` |
| Missing `userId` | 400 | `{ "error": "missing userId" }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

### `PATCH /api/clients`

**Request**
```json
{ "id": "<docId>", "userId": "<string>", "name": "...", "email": "...", "whatsapp": "..." }
```
`id` and `userId` are required. At least one of `name`/`email`/`whatsapp` must be present.

**Behavior:** Must verify that the document's `userId` field matches the request `userId` before patching (ownership check).  
Uses Firestore `updateMask.fieldPaths` to patch only supplied fields.

**Response 200**
```json
{ "ok": true }
```

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `id` | 400 | `{ "error": "missing id" }` |
| Missing `userId` | 400 | `{ "error": "missing userId" }` |
| No fields to update | 400 | `{ "error": "nothing to update" }` |
| Document belongs to different userId | 403 | `{ "error": "forbidden" }` |
| Document not found | 404 | `{ "error": "not found" }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

### `DELETE /api/clients`

**Request**
```json
{ "id": "<docId>", "userId": "<string>" }
```
Must verify ownership before deleting.

**Response 200**
```json
{ "ok": true }
```

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `id` | 400 | `{ "error": "missing id" }` |
| Missing `userId` | 400 | `{ "error": "missing userId" }` |
| Document belongs to different userId | 403 | `{ "error": "forbidden" }` |
| Document not found | 404 | `{ "error": "not found" }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

### `GET /api/hours`

**Request**
```
GET /api/hours?userId=<string>[&clientId=<docId>][&from=YYYY-MM-DD][&to=YYYY-MM-DD]
```
All filters are optional except `userId`.

**Response 200**
```json
{
  "hours": [
    {
      "id": "<docId>",
      "userId": "...",
      "clientId": "...",
      "minutes": 90,
      "date": "2026-10-20",
      "note": "הכנת דוח",
      "createdAt": "2026-10-20T14:30:00.000Z"
    }
  ],
  "totalMinutes": 90
}
```

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `userId` | 400 | `{ "error": "missing userId" }` |
| No records found | 200 | `{ "hours": [], "totalMinutes": 0 }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

### `POST /api/hours`

**Request**
```json
{ "userId": "<string>", "clientId": "<docId>", "minutes": 90, "date": "2026-10-20", "note": "optional" }
```
`userId`, `clientId`, `minutes`, and `date` are required. `minutes` must be a positive integer.

**Response 200**
```json
{ "ok": true, "id": "<newDocId>" }
```

**Firestore document written to:** `hours/<autoId>`  
**Fields saved:** `userId`, `clientId`, `minutes`, `date`, `note`, `createdAt`

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `userId` | 400 | `{ "error": "missing userId" }` |
| Missing `clientId` | 400 | `{ "error": "missing clientId" }` |
| Missing `minutes` | 400 | `{ "error": "missing minutes" }` |
| `minutes` ≤ 0 | 400 | `{ "error": "minutes must be positive" }` |
| `minutes` not a number | 400 | `{ "error": "minutes must be positive" }` |
| Missing `date` | 400 | `{ "error": "missing date" }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

### `DELETE /api/hours`

**Request**
```json
{ "id": "<docId>", "userId": "<string>" }
```
Must verify ownership before deleting.

**Response 200**
```json
{ "ok": true }
```

**Error cases**
| Condition | Status | Body |
|-----------|--------|------|
| Missing `id` | 400 | `{ "error": "missing id" }` |
| Missing `userId` | 400 | `{ "error": "missing userId" }` |
| Document belongs to different userId | 403 | `{ "error": "forbidden" }` |
| Document not found | 404 | `{ "error": "not found" }` |
| Wrong HTTP method | 405 | *(empty body)* |

---

## Section 2 — Test Cases

### Clients API

**TC-C01 — Happy path: list clients**
- Setup: Two clients in Firestore for userId=U1, one for userId=U2
- Request: `GET /api/clients?userId=U1`
- Expected: 200, `clients` array with 2 items, each has `id`, `name`, `email`, `whatsapp`

**TC-C02 — No clients for user**
- Request: `GET /api/clients?userId=NONEXISTENT`
- Expected: 200, `{ "clients": [] }`

**TC-C03 — Missing userId on GET**
- Request: `GET /api/clients` (no query param)
- Expected: 400, `{ "error": "missing userId" }`

**TC-C04 — Happy path: create client**
- Request: `POST /api/clients` body `{ name:"רות כהן", userId:"U1" }`
- Expected: 200, `{ "ok": true, "id": "<docId>" }`
- Verify: document exists in Firestore `clients/<docId>` with `userId="U1"`

**TC-C05 — Create client with all optional fields**
- Request: `POST /api/clients` body `{ name:"x", email:"x@x.com", whatsapp:"972501234567", userId:"U1" }`
- Expected: 200, `{ "ok": true, "id": "..." }`

**TC-C06 — Create with missing name**
- Request: `POST /api/clients` body `{ userId:"U1" }`
- Expected: 400

**TC-C07 — Create with missing userId**
- Request: `POST /api/clients` body `{ name:"x" }`
- Expected: 400

**TC-C08 — Happy path: edit client**
- Request: `PATCH /api/clients` body `{ id:"<existing>", userId:"U1", email:"new@x.com" }`
- Expected: 200, `{ "ok": true }`, Firestore document updated

**TC-C09 — PATCH ownership violation**
- Request: `PATCH /api/clients` body `{ id:"<U2's doc>", userId:"U1", name:"hack" }`
- Expected: 403

**TC-C10 — PATCH missing id**
- Request: `PATCH /api/clients` body `{ userId:"U1", name:"x" }`
- Expected: 400

**TC-C11 — Happy path: delete client**
- Request: `DELETE /api/clients` body `{ id:"<docId>", userId:"U1" }`
- Expected: 200, `{ "ok": true }`, document deleted from Firestore

**TC-C12 — DELETE ownership violation**
- Request: `DELETE /api/clients` body `{ id:"<U2's doc>", userId:"U1" }`
- Expected: 403

**TC-C13 — Invalid HTTP method on clients**
- Request: `PUT /api/clients`
- Expected: 405

---

### Hours API

**TC-H01 — Happy path: list hours**
- Setup: 3 hours entries for userId=U1, clientId=CL1
- Request: `GET /api/hours?userId=U1`
- Expected: 200, `{ "hours": [...3 items...], "totalMinutes": <sum> }`

**TC-H02 — Filter by clientId**
- Setup: entries for CL1 and CL2 under U1
- Request: `GET /api/hours?userId=U1&clientId=CL1`
- Expected: only CL1 entries returned

**TC-H03 — Filter by date range**
- Request: `GET /api/hours?userId=U1&from=2026-10-01&to=2026-10-31`
- Expected: only entries where `date` is within range

**TC-H04 — No hours for user**
- Request: `GET /api/hours?userId=NONEXISTENT`
- Expected: 200, `{ "hours": [], "totalMinutes": 0 }`

**TC-H05 — Missing userId on GET**
- Request: `GET /api/hours`
- Expected: 400

**TC-H06 — Happy path: create hours entry**
- Request: `POST /api/hours` body `{ userId:"U1", clientId:"CL1", minutes:90, date:"2026-10-20" }`
- Expected: 200, `{ "ok": true, "id": "..." }`, document in Firestore

**TC-H07 — Create with note**
- Request: `POST /api/hours` body `{ userId:"U1", clientId:"CL1", minutes:30, date:"2026-10-20", note:"ביקורת" }`
- Expected: 200, note field saved in Firestore

**TC-H08 — minutes = 0 rejected**
- Request: `POST /api/hours` body `{ userId:"U1", clientId:"CL1", minutes:0, date:"2026-10-20" }`
- Expected: 400

**TC-H09 — minutes negative rejected**
- Request: `POST /api/hours` body `{ userId:"U1", clientId:"CL1", minutes:-5, date:"2026-10-20" }`
- Expected: 400

**TC-H10 — minutes non-numeric rejected**
- Request: `POST /api/hours` body `{ userId:"U1", clientId:"CL1", minutes:"abc", date:"2026-10-20" }`
- Expected: 400

**TC-H11 — Future date accepted**
- Request: `POST /api/hours` body `{ ..., date:"2030-01-01" }`
- Expected: 200 (API should accept future dates; UI may warn but API must not reject)

**TC-H12 — Missing clientId**
- Request: `POST /api/hours` body `{ userId:"U1", minutes:60, date:"2026-10-20" }`
- Expected: 400

**TC-H13 — Missing date**
- Request: `POST /api/hours` body `{ userId:"U1", clientId:"CL1", minutes:60 }`
- Expected: 400

**TC-H14 — Happy path: delete hours entry**
- Request: `DELETE /api/hours` body `{ id:"<docId>", userId:"U1" }`
- Expected: 200, document removed from Firestore

**TC-H15 — DELETE ownership violation**
- Request: `DELETE /api/hours` body `{ id:"<U2's doc>", userId:"U1" }`
- Expected: 403

**TC-H16 — Invalid method on hours**
- Request: `PUT /api/hours`
- Expected: 405

**TC-H17 — totalMinutes calculation**
- Setup: entries for U1: 60 min, 90 min, 30 min
- Request: `GET /api/hours?userId=U1`
- Expected: `totalMinutes = 180`

---

## Section 3 — UI Checklist

### Client List (`clients` tab)

- [ ] Page loads and fetches `GET /api/clients?userId=<localStorage userId>`
- [ ] Client cards display name, email, whatsapp
- [ ] Empty state shown when no clients
- [ ] "הוספת לקוח" button opens the new-client modal (`m-newclient`)
- [ ] New client form: name required, email + whatsapp optional
- [ ] Saving new client calls `POST /api/clients` and refreshes the list
- [ ] Edit button opens edit modal with pre-filled fields
- [ ] Saving edits calls `PATCH /api/clients`
- [ ] Delete button shows confirmation, then calls `DELETE /api/clients`
- [ ] After delete, client removed from the displayed list
- [ ] Search / filter box narrows visible clients without page reload
- [ ] `userId` taken from `localStorage.getItem('userId')` (not hardcoded)

### Task Filter by Client

- [ ] When no clients exist, task filter shows "כל הלקוחות" only
- [ ] After clients load, dropdown lists all clients
- [ ] Selecting a client filters the tasks list to that client only
- [ ] Selecting "כל הלקוחות" (or empty) shows all tasks
- [ ] Selected filter persists across page re-renders within the session
- [ ] Filter label updates when a client is renamed

### Timer (client detail card)

- [ ] "התחלת עבודה" button calls `startClientTimer(clientId)` and shows elapsed clock
- [ ] Timer ticks in real time via the `#client-timer-elapsed` element
- [ ] "סיום עבודה" button calls `stopClientTimer(clientId)` and saves an hours entry via `POST /api/hours`
- [ ] Saved entry is visible in the monthly summary immediately after stop
- [ ] Timer persists across page reloads (started-at stored in Firestore on the client doc)
- [ ] While timer is running, the card background changes to amber (`#fef3c7`)
- [ ] `minutes` passed to API = `Math.round((now − startedAt) / 60000)`, minimum 1

### Weekly Summary

- [ ] Date-range picker defaults to current ISO week (Mon–Sun)
- [ ] Changing the range refetches `GET /api/hours?userId=...&from=...&to=...`
- [ ] Total minutes / hours displayed correctly
- [ ] Per-client breakdown shown (client name, hours)
- [ ] Entries with `minutes=0` excluded or not displayed
- [ ] Empty state shown when no hours in selected range

---

## Section 4 — Edge Cases & Risks

**Two browser tabs with timer running**  
If the user opens the client page in two tabs and starts the timer in both, two `startedAt` writes will race in Firestore. The second write overwrites the first. When either tab stops the timer, it reads `startedAt` from Firestore (not in-memory), so the elapsed time should be calculated from the actual Firestore value. Worst case: minutes are undercounted. Mitigation: use `createIfMissing` conditional write or check for existing `activeTimerStartedAt` before writing.

**Offline PWA**  
The app is served as a PWA with a service worker. When offline, API calls to `/api/clients` and `/api/hours` will fail. The UI should not crash — it should show a stale cache or an empty state with a user-facing error, not a blank screen or JS exception.

**Missing userId in localStorage**  
If `localStorage.getItem('userId')` returns `null` or empty string:
- All API GET calls will return `400` or an empty list.
- POST/PATCH/DELETE calls will return `400`.
- The UI must not proceed with empty userId; it should redirect to login / show an error banner, not silently create records with `userId=""`.

**Client deleted while timer is running**  
If the timer is running for client C and C is deleted from another session (or same session via quick double-action), stopping the timer will try to `POST /api/hours` with a `clientId` that no longer exists. The `hours` endpoint should accept orphaned clientIds (no FK constraint in Firestore), but the UI should handle a 404 on the GET client call gracefully — show "לקוח נמחק" instead of crashing.

**Hours entry referencing deleted client**  
After a client is deleted, existing `hours` docs that reference that `clientId` remain in Firestore. `GET /api/hours?userId=U1` still returns them. The weekly summary must handle missing client names gracefully (show "לקוח לא ידוע" or the raw ID, not a JS `undefined`).

**Concurrent edits (two sessions, same client)**  
Two sessions editing the same client simultaneously: the last PATCH wins. No optimistic lock in Firestore REST. Risk: one user's changes silently overwritten. Acceptable for current scope; document that last-write-wins applies.

**Very large minutes value**  
A timer left running for 24+ hours and then stopped would produce `minutes ≥ 1440`. The API should accept it without truncation. The UI monthly summary must display it as hours + minutes (e.g. "24:00") not as a raw number.

**No CORS preflight for DELETE**  
The browser sends a preflight `OPTIONS` for `DELETE` with a JSON body. The endpoint must respond to `OPTIONS` with `200` and the correct `Access-Control-Allow-Methods` header that includes `DELETE`. Missing this causes a CORS error even if the DELETE handler is correct.

---

## Section 5 — Regression Check

The following existing features must continue working after the merge:

| Feature | Key endpoints / code to re-verify |
|---------|-----------------------------------|
| WhatsApp bot | `POST /api/whatsapp-webhook` — `getClients`, `createClient`, `upsertClient` in `whatsapp-webhook.js` (these touch the same `clients` collection; new `api/clients.js` must not conflict) |
| Task creation | `openModal('task')` flow in the UI — task list renders, modal opens, task saved to Firestore `tasks/` |
| Appointment flow | Calendar modal, `POST /api/delete-appointment`, `GET /api/cron` — must not break after UI changes |
| Push subscriptions | `POST /api/save-subscription` — unchanged, but verify `lib/firestore.js` import not broken |
| Cron jobs | `/api/cron?type=overdue|appointment|trial` — serverless functions untouched, still listed in `vercel.json` |
| Client detail page | Existing timer code at line 3756 in `tax_manager_app.html` — start/stop functions `startClientTimer`, `stopClientTimer` — must still work; new API must match what the UI calls |
| Fee items | `saveFeeItems(clientId)` — writes to the existing client doc; must not be clobbered by the new PATCH endpoint |
| Onboarding link | `sendOnboardingLink(clientId)` — must still send the invite via `POST /api/invite` |
