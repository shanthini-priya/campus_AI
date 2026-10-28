"""Local development server for KCE Campus AI.

Serves the static site and a local chat API backed by the verified knowledge
base. Uses only the Python standard library — no AWS, no external services.

Run from the project root:

    python backend/server.py

Then open http://localhost:8000
"""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

try:
    from .local_kb import answer as kb_answer, get_knowledge_base
except ImportError:  # running as a script: python backend/server.py
    from local_kb import answer as kb_answer, get_knowledge_base

BASE_DIR = Path(__file__).resolve().parent.parent
MAX_MESSAGE_LENGTH = 800


class KCEHandler(SimpleHTTPRequestHandler):
    """Static file handler with a small local JSON API."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    # ----- helpers -----------------------------------------------------
    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Accept, Authorization"
        )

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    # ----- HTTP verbs --------------------------------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802 (http.server naming)
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "service": "kce-campus-ai",
                    "engine": "local-knowledge-base",
                    "entries": len(get_knowledge_base()),
                    "aws": False,
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/api/chat":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"error": "Not found. Use POST /api/chat."},
            )
            return

        try:
            body = self._read_json_body()
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(
                HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON in request body"}
            )
            return

        message = str(body.get("message", "")).strip()
        if not message:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Message is required and cannot be empty"},
            )
            return
        if len(message) > MAX_MESSAGE_LENGTH:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "error": (
                        f"Message too long. Maximum {MAX_MESSAGE_LENGTH} "
                        "characters allowed."
                    )
                },
            )
            return

        try:
            result = kb_answer(message)
        except Exception as error:  # pragma: no cover - defensive
            self.log_error("Knowledge base error: %s", error)
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "The local knowledge base could not answer. Please try again."},
            )
            return

        payload = {
            "answer": result.get("answer", ""),
            "sources": result.get("sources", []),
            "followups": result.get("followups", []),
            "matched": result.get("matched"),
            "source": "local",
        }
        self._send_json(HTTPStatus.OK, payload)


def main() -> None:
    base = get_knowledge_base()
    port = int(os.environ.get("PORT", "8000"))

    server = ThreadingHTTPServer(("0.0.0.0", port), KCEHandler)
    print("KCE Campus AI local server")
    print(f"  Knowledge base entries: {len(base)}")
    print(f"  Serving: {BASE_DIR}")
    print(f"  Open:    http://localhost:{port}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
