#!/usr/bin/env python3
"""Deterministic train-only asset retrieval and prompt injection."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any


ALGORITHM = "lexical-idf-v1"
TOKEN = re.compile(r"[a-zA-Z][a-zA-Z0-9_]{2,}|[\u4e00-\u9fff]{2,}")
STOP_WORDS = {
    "answer", "code", "expert", "format", "given", "input", "output", "problem",
    "program", "python", "question", "solution", "specification", "task", "tests",
    "the", "and", "for", "from", "into", "that", "this", "use", "with", "will",
}


def _tokens(text: str) -> Counter[str]:
    return Counter(
        token.lower()
        for token in TOKEN.findall(text)
        if token.lower() not in STOP_WORDS
    )


def _search_text(kind: str, asset: dict[str, Any]) -> str:
    fields = (
        ("task_intent", "approach", "key_insight", "applicability")
        if kind == "memory"
        else ("name", "description", "content")
    )
    return "\n".join(str(asset.get(field) or "") for field in fields)


def select_assets(
    query: str,
    kind: str,
    assets: list[dict[str, Any]],
    *,
    top_k: int = 2,
) -> list[dict[str, Any]]:
    """Select only assets with lexical evidence, breaking ties by stable ID."""
    if kind not in {"memory", "skill"}:
        raise ValueError("UNKNOWN_ASSET_KIND")
    if not 0 <= top_k <= 2:
        raise ValueError("RETRIEVAL_TOP_K_INVALID")
    query_tokens = _tokens(query)
    documents = [_tokens(_search_text(kind, asset)) for asset in assets]
    document_frequency = Counter(
        token for document in documents for token in document
    )
    ranked: list[tuple[float, str, dict[str, Any]]] = []
    for asset, document in zip(assets, documents, strict=True):
        asset_id = asset.get("id")
        content_hash = asset.get("content_hash")
        if not isinstance(asset_id, str) or not isinstance(content_hash, str):
            raise ValueError("ASSET_IDENTITY_INVALID")
        score = 0.0
        for token, query_count in query_tokens.items():
            if token not in document:
                continue
            inverse_frequency = math.log((len(documents) + 1) / (document_frequency[token] + 1)) + 1
            score += min(query_count, document[token]) * inverse_frequency
        if score > 0:
            ranked.append((score, asset_id, asset))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [asset for _, _, asset in ranked[:top_k]]


def injection_text(kind: str, assets: list[dict[str, Any]]) -> str:
    """Render selected assets without exposing benchmark IDs or arm labels."""
    if kind == "memory":
        blocks = [
            "\n".join(
                (
                    f"Intent: {asset['task_intent']}",
                    f"Approach: {asset['approach']}",
                    f"Key insight: {asset['key_insight']}",
                    f"Applicability: {asset['applicability']}",
                )
            )
            for asset in assets
        ]
        heading = "Retrieved experiences"
        guidance = "Treat these as fallible prior experiences. Use them only when their applicability matches the current problem."
    elif kind == "skill":
        blocks = [
            "\n".join(
                (
                    f"Name: {asset['name']}",
                    f"Description: {asset['description']}",
                    f"Procedure: {asset['content']}",
                )
            )
            for asset in assets
        ]
        heading = "Retrieved strategies"
        guidance = "Apply only strategies whose trigger conditions match. The task statement and verifier requirements take priority."
    else:
        raise ValueError("UNKNOWN_ASSET_KIND")
    if not blocks:
        return ""
    numbered = "\n\n".join(f"### {index}\n{block}" for index, block in enumerate(blocks, start=1))
    return f"\n\n## {heading}\n\n{guidance}\n\n{numbered}"
