# API Documentation

The local API is served by `backend/server.py` using only the Python standard library. It is optional: the browser answers from the knowledge base by default. No AWS services are involved.

## Base URL

```
http://localhost:8000
```

Start the server:

```powershell
python backend/server.py
```

## Endpoints

### GET /api/health

Returns local engine status.

#### Response — 200 OK

```json
{
  "status": "ok",
  "service": "kce-campus-ai",
  "engine": "local-knowledge-base",
  "entries": 36,
  "aws": false
}
```

### POST /api/chat

Send a question and receive an answer from the verified local knowledge base.

#### Request

```http
POST /api/chat
Content-Type: application/json
```

```json
{
  "message": "What courses does KCE offer?"
}
```

#### Request Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| message | string | Yes | The student's question (max 800 characters) |

#### Response — Success (200 OK)

```json
{
  "answer": "**Undergraduate programmes (B.E. / B.Tech.)**\n…",
  "sources": [
    {
      "title": "Courses Offered",
      "url": "https://kingsengg.edu.in/courses-offered.html"
    }
  ],
  "followups": ["What is the intake for CSE?"],
  "matched": "courses",
  "source": "local"
}
```

#### Response — No Confident Match (200 OK)

The request still succeeds, but `matched` is `null` and the answer honestly states that the information is not in the knowledge base.

```json
{
  "answer": "I couldn't find verified information about that in the KCE knowledge base, and I won't guess.\n\n…",
  "sources": [
    { "title": "KCE Home", "url": "https://kingsengg.edu.in/" }
  ],
  "followups": [
    "What courses does KCE offer?",
    "How do I apply for admission?",
    "How can I contact the college?"
  ],
  "matched": null,
  "source": "local"
}
```

#### Response — Bad Request (400)

```json
{ "error": "Message is required and cannot be empty" }
```

```json
{ "error": "Message too long. Maximum 800 characters allowed." }
```

```json
{ "error": "Invalid JSON in request body" }
```

#### Response — Not Found (404)

```json
{ "error": "Not found. Use POST /api/chat." }
```

#### Response — Internal Server Error (500)

```json
{ "error": "The local knowledge base could not answer. Please try again." }
```

## CORS

The local server allows any origin for development:

- `Access-Control-Allow-Origin`: `*`
- `Access-Control-Allow-Headers`: `Content-Type, Accept, Authorization`
- `Access-Control-Allow-Methods`: `GET, POST, OPTIONS`

`OPTIONS` preflight requests return `204 No Content`.

## Testing

### cURL

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"What are the library hours?\"}"
```

### JavaScript Fetch

```javascript
fetch("http://localhost:8000/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json"
  },
  body: JSON.stringify({ message: "What are the library hours?" })
})
  .then((res) => res.json())
  .then((data) => console.log(data));
```

### Python

```python
import json
from urllib.request import Request, urlopen

request = Request(
    "http://localhost:8000/api/chat",
    data=json.dumps({"message": "What are the library hours?"}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
with urlopen(request) as response:
    print(json.loads(response.read().decode("utf-8")))
```
