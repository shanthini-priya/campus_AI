"""Local KCE knowledge-base retrieval engine (no AWS, no paid APIs).

This is deterministic keyword/relevance retrieval over
``knowledge/kce-knowledge.json``. It is intentionally NOT a generative model:
answers come only from the verified local knowledge base, and unknown questions
receive an honest "not in the knowledge base" response.
"""

from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
KB_PATH = BASE_DIR / "knowledge" / "kce-knowledge.json"

STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "have", "has", "had", "of", "for", "to", "in", "on",
    "at", "by", "with", "from", "as", "and", "or", "but", "if", "so", "than",
    "then", "that", "this", "these", "those", "there", "here", "it", "its",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must",
    "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
    "please", "tell", "about", "give", "want", "need", "know", "any", "some",
    "much", "many", "more", "most", "also", "just", "get", "got",
}

SYNONYMS = {
    "course": ["course"],
    "courses": ["course"],
    "program": ["course"],
    "programs": ["course"],
    "programme": ["course"],
    "programmes": ["course"],
    "branch": ["course"],
    "branches": ["course"],
    "department": ["department"],
    "departments": ["department"],
    "dept": ["department"],
    "admission": ["admission"],
    "admissions": ["admission"],
    "apply": ["admission"],
    "application": ["admission"],
    "enrol": ["admission"],
    "enroll": ["admission"],
    "enrollment": ["admission"],
    "enrolment": ["admission"],
    "join": ["admission"],
    "fee": ["fee"],
    "fees": ["fee"],
    "tuition": ["fee"],
    "cost": ["fee"],
    "placement": ["placement"],
    "placements": ["placement"],
    "job": ["placement"],
    "jobs": ["placement"],
    "career": ["placement"],
    "recruit": ["placement"],
    "recruitment": ["placement"],
    "hostel": ["hostel"],
    "hostels": ["hostel"],
    "accommodation": ["hostel"],
    "room": ["hostel"],
    "stay": ["hostel"],
    "bus": ["transport"],
    "buses": ["transport"],
    "transport": ["transport"],
    "commute": ["transport"],
    "library": ["library"],
    "books": ["library"],
    "wifi": ["internet"],
    "wi-fi": ["internet"],
    "internet": ["internet"],
    "network": ["internet"],
    "phone": ["contact"],
    "contact": ["contact"],
    "email": ["contact"],
    "mail": ["contact"],
    "call": ["contact"],
    "reach": ["contact"],
    "address": ["location"],
    "location": ["location"],
    "where": ["location"],
    "scholarship": ["scholarship"],
    "scholarships": ["scholarship"],
    "timetable": ["exam"],
    "exam": ["exam"],
    "exams": ["exam"],
    "examination": ["exam"],
    "schedule": ["exam"],
    "attendance": ["attendance"],
    "sports": ["sport"],
    "sport": ["sport"],
    "games": ["sport"],
    "club": ["club"],
    "clubs": ["club"],
    "activities": ["club"],
    "about": ["about"],
    "overview": ["about"],
    "history": ["about"],
}

_NON_ALNUM = re.compile(r"[^a-z0-9\s'-]")
_WS = re.compile(r"\s+")


def normalize(text: Any) -> str:
    value = "" if text is None else str(text)
    value = value.lower()
    value = value.replace("\u2018", "'").replace("\u2019", "'")
    value = _NON_ALNUM.sub(" ", value)
    return _WS.sub(" ", value).strip()


def stem(word: str) -> str:
    if len(word) <= 3:
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("es") and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def tokenize(text: Any) -> List[str]:
    tokens: set[str] = set()
    for part in normalize(text).split(" "):
        token = part.replace("'", "")
        if not token:
            continue
        for term in SYNONYMS.get(token, [token]):
            stemmed = stem(term)
            if stemmed and stemmed not in STOPWORDS:
                tokens.add(stemmed)
    return sorted(tokens)


class KnowledgeBase:
    """Loads the JSON knowledge base once and answers questions locally."""

    def __init__(self, path: Path | str = KB_PATH) -> None:
        self.path = Path(path)
        self.entries: List[Dict[str, Any]] = json.loads(
            self.path.read_text(encoding="utf-8")
        )
        self._index = [self._build_index(entry) for entry in self.entries]

    @staticmethod
    def _build_index(entry: Dict[str, Any]) -> Dict[str, Any]:
        haystack = " ".join(
            [
                str(entry.get("title", "")),
                str(entry.get("category", "")),
                str(entry.get("question", "")),
                " ".join(entry.get("keywords", []) or []),
                str(entry.get("answer", "")),
            ]
        )
        return {
            "entry": entry,
            "tokens": set(tokenize(haystack)),
            "title_tokens": set(
                tokenize(
                    f"{entry.get('title', '')} {entry.get('question', '')}"
                )
            ),
            "keywords": [normalize(k) for k in (entry.get("keywords") or []) if k],
        }

    def _score(
        self, item: Dict[str, Any], normalized_query: str, query_tokens: List[str]
    ) -> Dict[str, Any]:
        score = 0.0
        matched_keywords = 0
        for keyword in item["keywords"]:
            if not keyword:
                continue
            word_count = len(keyword.split(" "))
            if keyword in normalized_query:
                score += 7 if word_count > 1 else 4
                matched_keywords += 1

        matched_tokens = 0
        for token in query_tokens:
            if token in item["tokens"]:
                score += 2
                matched_tokens += 1
            if token in item["title_tokens"]:
                score += 1.5

        coverage = (matched_tokens / len(query_tokens)) if query_tokens else 0.0
        score += coverage * 5

        return {
            "score": score,
            "coverage": coverage,
            "matched_keywords": matched_keywords,
            "matched_tokens": matched_tokens,
            "entry": item["entry"],
        }

    def retrieve(self, question: str) -> Optional[Dict[str, Any]]:
        normalized_query = normalize(question)
        query_tokens = tokenize(question)
        if not query_tokens:
            return None

        best: Optional[Dict[str, Any]] = None
        for item in self._index:
            result = self._score(item, normalized_query, query_tokens)
            if best is None or result["score"] > best["score"]:
                best = result

        if best is None:
            return None
        if best["score"] < 4 or best["coverage"] < 0.2:
            return None
        return best["entry"]

    @staticmethod
    def fallback() -> Dict[str, Any]:
        return {
            "answer": (
                "I couldn't find verified information about that in the KCE "
                "knowledge base, and I won't guess.\n\n"
                "Please check the official college website or contact the college office:\n"
                "• Website: https://kingsengg.edu.in/\n"
                "• Phone: +91-6380989024\n"
                "• Email: contact@kingsengg.edu.in\n\n"
                "You can also try rephrasing your question — for example, ask about "
                "courses, admissions, facilities, placements, or contact details."
            ),
            "sources": [
                {"title": "KCE Home", "url": "https://kingsengg.edu.in/"},
                {"title": "Contact Us", "url": "https://kingsengg.edu.in/contact.html"},
            ],
            "followups": [
                "What courses does KCE offer?",
                "How do I apply for admission?",
                "How can I contact the college?",
            ],
            "matched": None,
            "source": "local",
            "unknown": True,
        }

    def answer(self, question: str) -> Dict[str, Any]:
        entry = self.retrieve(question)
        if not entry:
            return self.fallback()
        return {
            "answer": entry.get("answer", ""),
            "sources": entry.get("sources", []) or [],
            "followups": (entry.get("followups") or [])[:3],
            "matched": entry.get("id"),
            "source": "local",
            "unknown": False,
        }

    def __len__(self) -> int:
        return len(self.entries)


_LOCK = threading.Lock()
_KB: Optional[KnowledgeBase] = None


def get_knowledge_base() -> KnowledgeBase:
    global _KB
    with _LOCK:
        if _KB is None:
            _KB = KnowledgeBase()
        return _KB


def answer(question: str) -> Dict[str, Any]:
    """Convenience wrapper used by the server and Lambda handler."""
    return get_knowledge_base().answer(question)


if __name__ == "__main__":
    kb = get_knowledge_base()
    print(f"Loaded {len(kb)} entries from {KB_PATH}")
    for question in (
        "What courses does KCE offer?",
        "How can I contact the college?",
        "What is tomorrow's exam timetable?",
        "What is the capital of France?",
    ):
        reply = kb.answer(question)
        print("-", question)
        print("  matched:", reply.get("matched"))
        print("  answer :", reply["answer"].splitlines()[0][:100])
