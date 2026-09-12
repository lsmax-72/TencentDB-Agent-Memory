#!/usr/bin/env python3
"""Deterministic train-only asset retrieval and prompt injection."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any


ALGORITHM = "lexical-idf-v1"
APPLICABILITY_ALGORITHM = "lexical-idf-applicability-v6"
TOKEN = re.compile(r"[a-zA-Z][a-zA-Z0-9_]{2,}|[\u4e00-\u9fff]{2,}")
STOP_WORDS = {
    "answer", "code", "expert", "format", "given", "input", "output", "problem",
    "program", "python", "question", "solution", "specification", "task", "tests",
    "the", "and", "for", "from", "into", "that", "this", "use", "with", "will",
}
FAMILY_STOP_WORDS = STOP_WORDS | {
    "algorithm", "array", "arrays", "brute", "constraints", "enumeration",
    "force", "optimization", "small", "strategy",
}
OBJECTIVE_ALIASES = {
    "count": "count", "counting": "count", "number": "count", "total": "count",
    "max": "maximum", "maximum": "maximum", "maximize": "maximum", "maximise": "maximum",
    "largest": "maximum", "highest": "maximum",
    "min": "minimum", "minimum": "minimum", "minimize": "minimum", "minimise": "minimum",
    "smallest": "minimum", "lowest": "minimum",
    "optimum": "optimum", "optimal": "optimum",
}
OBJECTIVE_STOP_WORDS = STOP_WORDS | {
    "compute", "determine", "find", "return", "value", "values",
}


def _tokens(text: str) -> Counter[str]:
    return Counter(
        token.lower() for token in TOKEN.findall(text)
        if token.lower() not in STOP_WORDS
    )


def _family_tokens(text: str) -> set[str]:
    tokens = set(_tokens(text)) - FAMILY_STOP_WORDS
    return {token[:-1] if token.endswith("s") and len(token) > 4 else token for token in tokens}


def _search_text(kind: str, asset: dict[str, Any]) -> str:
    fields = (
        ("task_intent", "approach", "key_insight", "applicability")
        if kind == "memory"
        else ("name", "description", "content")
    )
    return "\n".join(str(asset.get(field) or "") for field in fields)


def _parse_number(value: str) -> float:
    compact = re.sub(r"[,\s_{}]", "", value).lower().replace("×", "x")
    scientific = re.fullmatch(r"(\d+(?:\.\d+)?)[x*]10\^(\d+)", compact)
    if scientific:
        return float(scientific.group(1)) * 10 ** int(scientific.group(2))
    return float(compact)


def _query_upper_bounds(query: str) -> dict[str, float]:
    query = query.replace(r"\leq", "<=").replace(r"\times", "x")
    number = r"\d+(?:\.\d+)?(?:\s*(?:[x×*]\s*10\s*\^\s*\{?\d+\}?|e[+-]?\d+))?"
    bounds: dict[str, float] = {}

    def record(parameter: str, value: float) -> None:
        normalized = parameter.lower()
        bounds[normalized] = max(bounds.get(normalized, 0), value)
        if normalized.endswith(".length"):
            bounds["n"] = max(bounds.get("n", 0), value)

    grouped = re.compile(
        rf"\b([a-zA-Z][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z][a-zA-Z0-9_]*)+)\s*<=\s*({number})",
        re.I,
    )
    patterns = (
        re.compile(rf"\b([a-zA-Z][a-zA-Z0-9_]*(?:\.length)?)\s*<=\s*({number})", re.I),
        re.compile(rf"\b([a-zA-Z][a-zA-Z0-9_]*(?:\.length)?)\s+(?:is\s+)?at\s+most\s+({number})", re.I),
    )
    for match in grouped.finditer(query):
        try:
            parsed = _parse_number(match.group(2))
        except ValueError:
            continue
        for parameter in re.split(r"\s*,\s*", match.group(1)):
            record(parameter, parsed)
    for pattern in patterns:
        for match in pattern.finditer(query):
            try:
                record(match.group(1), _parse_number(match.group(2)))
            except ValueError:
                continue
    return bounds


def _profile(asset: dict[str, Any]) -> dict[str, Any]:
    profile = asset.get("applicability_profile")
    required = {
        "task_family", "when_to_apply", "do_not_apply_when", "constraints",
        "complexity", "evidence_refs", "task_signals",
    }
    if not isinstance(profile, dict) or set(profile) != required:
        raise ValueError("SKILL_APPLICABILITY_PROFILE_SCHEMA_INVALID")
    for field in ("task_family", "when_to_apply", "complexity"):
        if not isinstance(profile[field], str) or not profile[field].strip():
            raise ValueError("SKILL_APPLICABILITY_TEXT_INVALID")
    if not isinstance(profile["do_not_apply_when"], str):
        raise ValueError("SKILL_APPLICABILITY_TEXT_INVALID")
    evidence = profile["evidence_refs"]
    if not isinstance(evidence, list) or not all(isinstance(item, str) and item for item in evidence) or len(set(evidence)) < 2:
        raise ValueError("SKILL_APPLICABILITY_EVIDENCE_INVALID")
    constraints = profile["constraints"]
    if not isinstance(constraints, list):
        raise ValueError("SKILL_APPLICABILITY_CONSTRAINT_INVALID")
    for constraint in constraints:
        if not isinstance(constraint, dict) or set(constraint) != {"parameter", "max_value"}:
            raise ValueError("SKILL_APPLICABILITY_CONSTRAINT_INVALID")
        maximum = constraint["max_value"]
        if not isinstance(constraint["parameter"], str) or not constraint["parameter"].strip():
            raise ValueError("SKILL_APPLICABILITY_CONSTRAINT_INVALID")
        if isinstance(maximum, bool) or not isinstance(maximum, (int, float)) or maximum <= 0:
            raise ValueError("SKILL_APPLICABILITY_CONSTRAINT_INVALID")
    signals = profile["task_signals"]
    if not isinstance(signals, dict) or set(signals) != {"entity_terms", "objective_terms", "same_sentence"}:
        raise ValueError("SKILL_APPLICABILITY_TASK_SIGNALS_INVALID")
    if signals["same_sentence"] is not True:
        raise ValueError("SKILL_APPLICABILITY_TASK_SIGNALS_INVALID")
    for field in ("entity_terms", "objective_terms"):
        values = signals[field]
        if not isinstance(values, list) or not values or not all(isinstance(item, str) and item.strip() for item in values):
            raise ValueError("SKILL_APPLICABILITY_TASK_SIGNALS_INVALID")
    return profile


def _objective_tokens(text: str) -> set[str]:
    return {
        OBJECTIVE_ALIASES.get(token, token)
        for token in (match.lower() for match in TOKEN.findall(text))
        if token not in OBJECTIVE_STOP_WORDS
    }


def _task_signal_match(query: str, profile: dict[str, Any]) -> bool:
    signals = profile["task_signals"]
    entities = _family_tokens(" ".join(signals["entity_terms"]))
    objectives = _objective_tokens(" ".join(signals["objective_terms"]))
    if not entities or not objectives:
        raise ValueError("SKILL_APPLICABILITY_TASK_SIGNALS_INVALID")
    return any(
        _family_tokens(sentence) & entities and _objective_tokens(sentence) & objectives
        for sentence in re.split(r"[.!?\n]+", query)
    )


def select_applicable_skills(
    query: str,
    assets: list[dict[str, Any]],
    *,
    top_k: int = 2,
    min_token_overlap: int = 2,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Select Skills only when task signature and explicit constraints agree."""
    if not 0 <= top_k <= 2 or min_token_overlap < 1:
        raise ValueError("SKILL_APPLICABILITY_LIMIT_INVALID")
    query_tokens = _tokens(query)
    query_family = _family_tokens(query)
    query_bounds = _query_upper_bounds(query)
    profiles = [_profile(asset) for asset in assets]
    documents = []
    for asset, profile in zip(assets, profiles, strict=True):
        signals = profile["task_signals"]
        documents.append(_tokens("\n".join((
            _search_text("skill", asset), profile["task_family"],
            profile["when_to_apply"], " ".join(signals["entity_terms"]),
            " ".join(signals["objective_terms"]),
        ))))
    frequency = Counter(token for document in documents for token in document)
    ranked: list[tuple[float, str, dict[str, Any]]] = []
    decisions = []
    for asset, profile, document in zip(assets, profiles, documents, strict=True):
        asset_id = asset.get("id")
        if not isinstance(asset_id, str) or not isinstance(asset.get("content_hash"), str):
            raise ValueError("ASSET_IDENTITY_INVALID")
        matched = sorted(set(query_tokens) & set(document))
        matched_family = sorted(query_family & _family_tokens(profile["task_family"]))
        reason = "ELIGIBLE"
        if not _task_signal_match(query, profile):
            reason = "TASK_SIGNAL_MISMATCH"
        elif not matched_family:
            reason = "TASK_FAMILY_MISMATCH"
        else:
            for constraint in profile["constraints"]:
                parameter = constraint["parameter"].lower()
                if parameter not in query_bounds:
                    reason = f"CONSTRAINT_NOT_OBSERVED:{parameter}"
                    break
                if query_bounds[parameter] > float(constraint["max_value"]):
                    reason = f"CONSTRAINT_MISMATCH:{parameter}"
                    break
        if reason == "ELIGIBLE" and len(matched) < min_token_overlap:
            reason = "LOW_LEXICAL_OVERLAP"
        score = 0.0
        if reason == "ELIGIBLE":
            for token, count in query_tokens.items():
                if token in document:
                    inverse = math.log((len(documents) + 1) / (frequency[token] + 1)) + 1
                    score += min(count, document[token]) * inverse
            ranked.append((score, asset_id, asset))
        decisions.append({
            "id": asset_id, "selected": False, "reason": reason,
            "matched_tokens": matched, "matched_family_tokens": matched_family,
            "score": round(score, 6),
        })
    ranked.sort(key=lambda item: (-item[0], item[1]))
    selected = [asset for _, _, asset in ranked[:top_k]]
    selected_ids = {asset["id"] for asset in selected}
    for decision in decisions:
        if decision["id"] in selected_ids:
            decision["selected"] = True
            decision["reason"] = "SELECTED"
        elif decision["reason"] == "ELIGIBLE":
            decision["reason"] = "BELOW_TOP_K"
    return selected, decisions


def select_skill_assets_for_algorithm(
    query: str, assets: list[dict[str, Any]], algorithm: str, *, top_k: int = 2
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if algorithm != APPLICABILITY_ALGORITHM:
        raise ValueError("SKILL_APPLICABILITY_ALGORITHM_INVALID")
    return select_applicable_skills(query, assets, top_k=top_k)


def select_assets(
    query: str,
    kind: str,
    assets: list[dict[str, Any]],
    *,
    top_k: int = 2,
) -> list[dict[str, Any]]:
    """Legacy frozen lexical retrieval; keep its semantics unchanged."""
    if kind not in {"memory", "skill"}:
        raise ValueError("UNKNOWN_ASSET_KIND")
    if not 0 <= top_k <= 2:
        raise ValueError("RETRIEVAL_TOP_K_INVALID")
    query_tokens = _tokens(query)
    documents = [_tokens(_search_text(kind, asset)) for asset in assets]
    frequency = Counter(token for document in documents for token in document)
    ranked: list[tuple[float, str, dict[str, Any]]] = []
    for asset, document in zip(assets, documents, strict=True):
        asset_id = asset.get("id")
        if not isinstance(asset_id, str) or not isinstance(asset.get("content_hash"), str):
            raise ValueError("ASSET_IDENTITY_INVALID")
        score = 0.0
        for token, count in query_tokens.items():
            if token in document:
                inverse = math.log((len(documents) + 1) / (frequency[token] + 1)) + 1
                score += min(count, document[token]) * inverse
        if score > 0:
            ranked.append((score, asset_id, asset))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [asset for _, _, asset in ranked[:top_k]]


def injection_text(kind: str, assets: list[dict[str, Any]]) -> str:
    """Render selected assets without exposing benchmark IDs or arm labels."""
    if kind == "memory":
        blocks = ["\n".join((
            f"Intent: {asset['task_intent']}", f"Approach: {asset['approach']}",
            f"Key insight: {asset['key_insight']}",
            f"Applicability: {asset['applicability']}",
        )) for asset in assets]
        heading = "Retrieved experiences"
        guidance = "Treat these as fallible prior experiences. Use them only when their applicability matches the current problem."
    elif kind == "skill":
        blocks = []
        for asset in assets:
            profile = asset.get("applicability_profile")
            applicability = () if not isinstance(profile, dict) else (
                f"Task family: {profile['task_family']}",
                f"Use when: {profile['when_to_apply']}",
                f"Do not use when: {profile['do_not_apply_when']}",
                f"Complexity: {profile['complexity']}",
            )
            blocks.append("\n".join((
                f"Name: {asset['name']}", f"Description: {asset['description']}",
                *applicability, f"Procedure: {asset['content']}",
            )))
        heading = "Retrieved strategies"
        guidance = "Apply only strategies whose trigger conditions match. The task statement and verifier requirements take priority."
    else:
        raise ValueError("UNKNOWN_ASSET_KIND")
    if not blocks:
        return ""
    numbered = "\n\n".join(f"### {index}\n{block}" for index, block in enumerate(blocks, start=1))
    return f"\n\n## {heading}\n\n{guidance}\n\n{numbered}"
