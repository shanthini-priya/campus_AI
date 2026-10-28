# KCE Campus AI — Test Report

## Test date

October 28, 2026

## Environment

- Windows 10/11, PowerShell 5.1
- Python 3.12
- Node.js (`node --check`)
- Chromium-based browser (manual UI checks)
- Engine: local knowledge base (no AWS, no paid API)

## Summary

| Area | Result |
| --- | --- |
| JavaScript syntax (`script.js`, knowledge scripts) | Pass |
| Browser retrieval engine (Node) | 11/11 pass |
| Local HTTP API (`backend/server.py`) | 21/21 pass |
| Lambda adapter (`backend/lambda_function.py`) | Pass |
| Knowledge sync (`sync_knowledge.py`) | Pass (36 entries) |
| AWS SDK / credential references in code | None |

## Automated tests

### 1. JavaScript syntax

```powershell
node --check script.js
node --check knowledge/kce-retrieval.js
node --check knowledge/kce-knowledge.js
```

Result: **Pass** — no syntax errors.

### 2. Browser retrieval engine

Executed `knowledge/kce-knowledge.js` and `knowledge/kce-retrieval.js` in Node with a `window` shim.

| Test | Result |
| --- | --- |
| Engine reports ready | Pass |
| Loads 36 entries | Pass |
| "What courses does KCE offer?" returns courses + sources | Pass |
| Courses answer contains B.E / B.Tech | Pass |
| Courses sources link to official KCE pages | Pass |
| "How can I contact the college?" returns phone number | Pass |
| Contact reply includes sources | Pass |
| "What is tomorrow's exam timetable?" answers honestly | Pass |
| Unknown question ("capital of France") answers honestly | Pass |
| Unknown reply links only to official KCE pages | Pass |
| Empty question returns the fallback | Pass |

**11 passed, 0 failed.**

### 3. Local HTTP API

Started `backend/server.py` in-process on `127.0.0.1:8123`.

| Test | Result |
| --- | --- |
| `GET /api/health` → 200, engine `local-knowledge-base`, `aws: false`, 36 entries | Pass |
| `POST /api/chat` courses question → 200, `matched: courses`, sources present | Pass |
| Contact question → `matched: contact`, includes `+91-6380989024` | Pass |
| Exam timetable question → honest "cannot verify" answer | Pass |
| Unknown question → 200, `matched: null`, honest fallback | Pass |
| Empty message → 400 | Pass |
| Message longer than 800 chars → 400 | Pass |
| Invalid JSON → 400 | Pass |
| Wrong path → 404 | Pass |
| `GET /api/chat` → 404 | Pass |

**21 passed, 0 failed.**

### 4. Lambda adapter

```powershell
python -c "import sys,json; sys.path.insert(0,'backend'); import lambda_function as l; ..."
```

| Test | Result |
| --- | --- |
| Valid POST returns 200 and `matched: courses` | Pass |
| Empty body returns 400 with a clear message | Pass |
| OPTIONS returns 200 | Pass |

### 5. Knowledge synchronisation

```powershell
python knowledge/sync_knowledge.py
```

Result: `Wrote knowledge\kce-knowledge.js with 36 entries`.

## Manual UI checks

| Test | Expected | Result |
| --- | --- | --- |
| Ask "What courses does KCE offer?" | Course answer with an official source chip | Pass |
| Ask "How can I contact the college?" | Phone, email, and contact link | Pass |
| Ask an unknown question | Honest fallback, no invented answer | Pass |
| Typing indicator after every reply | Always disappears; "Thinking…" never persists | Pass |
| New Chat | Clears conversation immediately, even mid-request | Pass |
| Copy answer | Copies assistant text and shows a toast | Pass |
| Theme toggle | Light/dark switches and persists | Pass |
| Mobile drawer | Opens/closes with menu button and scrim | Pass |
| Source links | Open official KCE pages in a new tab | Pass |

## Infinite "Thinking…" fix

Root cause: the old demo reply function called an undefined `normalizeText`, so the answer promise rejected before the typing indicator was cleared.

Fix:

1. Replaced the demo reply with the synchronous local retrieval engine.
2. Wrapped the answer request in `try/catch/finally`; the `finally` block always clears `isTyping` and hides the typing indicator for the active request token.
3. Added a hard 6-second timeout and explicit error reply for the optional API path.

Result: no code path leaves the composer stuck in the typing state.

## Security / privacy

| Check | Result |
| --- | --- |
| No `boto3`, `botocore`, `amazonaws.com`, or AWS SDK references | Pass |
| No AWS keys or secrets in frontend code | Pass |
| Only theme stored in `localStorage` (`campusai-theme`) | Pass |
| Chat history kept in memory only | Pass |
| Message length limited to 800 characters (client + server) | Pass |
| Server errors return generic messages | Pass |

## Known limitations

1. Retrieval-based answers only — there is no generative AI model.
2. No live fees, dates, timetables, attendance, or personal records.
3. Chat history is not persisted across refreshes.
4. The optional API is intended for local development; add authentication and rate limiting before public deployment.

## Overall status

**Local chatbot: complete and functional.**
**AWS/Bedrock dependency: removed.**
**Infinite typing state: fixed.**
