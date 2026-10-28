# KCE Campus AI

A local-first college assistant for **Kings College of Engineering (KCE), Punalkulam**, built with **HTML5, CSS3 and vanilla JavaScript**.

Answers come from a **verified local knowledge base**. No AWS account, AWS credentials, Bedrock, DynamoDB, or paid AI API is required. The assistant is deterministic retrieval — it does **not** invent answers, and it says so when information is not in the knowledge base.

---

## Quick start

### Option A — open the file directly (simplest)

Double-click `index.html`. The app works from `file://` because the knowledge base is loaded as a plain script, not fetched over the network.

### Option B — run the local server (recommended)

```powershell
python backend/server.py
```

Open <http://localhost:8000>. The server also exposes the local API used when `API_ENDPOINT` is enabled.

To change the port:

```powershell
$env:PORT = "5500"; python backend/server.py
```

---

## How answers work

1. The student asks a question in the chat.
2. `knowledge/kce-retrieval.js` normalises the question, expands common synonyms, and scores it against every entry in `knowledge/kce-knowledge.json`.
3. The best match above a relevance threshold is returned with its official source links.
4. If nothing matches confidently, the assistant replies honestly that it cannot verify the answer and points to the college office — it never guesses.

This is local retrieval, not a generative model. The default path makes no network requests and cannot leave the UI stuck in a "Thinking…" state.

---

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell, sidebar, chat, About and Settings pages, inline SVG icon sprite. |
| `style.css` | Design tokens, light/dark themes, layout, components, responsive breakpoints. |
| `script.js` | Chat behaviour, local-first answer flow, sources rendering, theme, dialogs, toasts. |
| `knowledge/kce-knowledge.json` | Canonical verified KCE knowledge base (36 entries). |
| `knowledge/kce-knowledge.js` | Generated browser mirror exposing `window.KCE_KNOWLEDGE_BASE`. |
| `knowledge/kce-retrieval.js` | Deterministic retrieval engine exposing `window.KCERetrieval`. |
| `knowledge/sync_knowledge.py` | Regenerates the JS mirror after editing the JSON. |
| `backend/local_kb.py` | Python port of the retrieval engine. |
| `backend/server.py` | Standard-library local HTTP server + `/api/chat` and `/api/health`. |
| `backend/lambda_function.py` | Optional Lambda-compatible adapter over the same local KB (no AWS SDK). |
| `.env.example` | Example local environment variables. |
| `docs/` | API and architecture notes. |

No npm install, bundler, framework, or paid UI library is required. All icons are inline SVG; the app falls back to system fonts offline.

---

## Update the knowledge base

Edit `knowledge/kce-knowledge.json`, then regenerate the browser mirror:

```powershell
python knowledge/sync_knowledge.py
```

Each entry has this shape:

```json
{
  "id": "courses",
  "category": "Academics",
  "title": "Courses offered",
  "question": "What courses does KCE offer?",
  "keywords": ["courses", "programmes", "branches", "b.e", "b.tech"],
  "answer": "The verified answer shown in chat.",
  "sources": [
    { "title": "Courses Offered", "url": "https://kingsengg.edu.in/courses-offered.html" }
  ],
  "followups": ["What is the intake for CSE?"]
}
```

Guidelines:

- Keep `id` unique.
- Add the words students are likely to type to `keywords`; multi-word phrases score higher.
- Use only verified official KCE information. Do not add invented fees, dates, timetables, or statistics.
- Keep `sources` on official `kingsengg.edu.in` pages.
- Re-run the sync script and refresh the page.

---

## Optional local API

The browser uses the local engine by default. If you prefer the Python backend, set `API_ENDPOINT` in `script.js`:

```js
const API_ENDPOINT = "/api/chat";
```

Request:

```http
POST /api/chat
Content-Type: application/json
```

```json
{ "message": "What courses does KCE offer?" }
```

Response:

```json
{
  "answer": "…",
  "sources": [{ "title": "Courses Offered", "url": "https://kingsengg.edu.in/courses-offered.html" }],
  "followups": ["…"]
}
```

Health check:

```http
GET /api/health
```

```json
{ "status": "ok", "engine": "local-knowledge-base", "entries": 36, "aws": false }
```

If a configured endpoint fails, the UI shows a clear error with **Try again**. The browser request has a 6-second timeout.

---

## Tests

```powershell
python backend/local_kb.py
python -c "import json; print(len(json.load(open('knowledge/kce-knowledge.json', encoding='utf-8'))))"
```

Then open the app and ask:

- `What courses does KCE offer?` → course list with a Courses Offered source link
- `How can I contact the college?` → phone, email and contact page
- `What is tomorrow's exam timetable?` → honest "cannot verify" answer with official links
- `What is the capital of France?` → honest "not in the knowledge base" answer

The typing indicator must disappear after every reply, including errors.

---

## Limitations

- Retrieval-based answers only; there is no generative AI model.
- No live fees, dates, timetables, attendance, or personal student records.
- Chat history lives in memory only; refreshing clears it.
- Only the theme preference is saved, under `campusai-theme`.

For the latest official information, always check <https://kingsengg.edu.in/> or contact the college at +91-6380989024 / contact@kingsengg.edu.in.
