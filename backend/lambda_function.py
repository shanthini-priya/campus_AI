"""AWS Lambda-compatible handler for KCE Campus AI.

No AWS services are required at runtime: answers come from the verified local
knowledge base in ``knowledge/kce-knowledge.json`` via ``local_kb.py``. This
handler only adapts HTTP/API Gateway events to that local engine, so it also
works as a plain function for tests.

Deploy notes: include ``backend/local_kb.py`` and the ``knowledge`` folder in the
deployment package.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

try:
    from .local_kb import answer as kb_answer
except ImportError:  # Lambda/script import
    from local_kb import answer as kb_answer

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MAX_MESSAGE_LENGTH = 800


def _cors_headers() -> Dict[str, str]:
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Accept,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _response(status: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": _cors_headers(),
        "body": json.dumps(payload, ensure_ascii=False),
    }


def lambda_handler(event: Dict[str, Any], context: Any = None) -> Dict[str, Any]:
    """Handle API Gateway proxy requests for the local chatbot."""
    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method")
        or "POST"
    ).upper()

    logger.info("Request received: %s", method)

    if method == "OPTIONS":
        return _response(200, {"message": "CORS preflight"})

    if method != "POST":
        return _response(405, {"error": "Method not allowed. Use POST."})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Invalid JSON in request body"})

    message = str(body.get("message", "")).strip()
    if not message:
        return _response(
            400, {"error": "Message is required and cannot be empty"}
        )
    if len(message) > MAX_MESSAGE_LENGTH:
        return _response(
            400,
            {
                "error": (
                    f"Message too long. Maximum {MAX_MESSAGE_LENGTH} "
                    "characters allowed."
                )
            },
        )

    try:
        result = kb_answer(message)
    except Exception as error:  # pragma: no cover - defensive
        logger.exception("Knowledge base error: %s", error)
        return _response(
            500,
            {"error": "The local knowledge base could not answer. Please try again."},
        )

    return _response(
        200,
        {
            "answer": result.get("answer", ""),
            "sources": result.get("sources", []),
            "followups": result.get("followups", []),
            "matched": result.get("matched"),
            "source": "local",
        },
    )
