"""Independent memory-condition contract; never changes old Skill evaluation semantics."""
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frozen_files(root):
    files = {}
    for folder in ("runtime", "prepared"):
        for path in sorted((root / folder).rglob("*")):
            if path.is_symlink():
                raise ValueError("frozen symlink rejected")
            if path.is_file() and "__pycache__" not in path.parts:
                files[str(path.relative_to(root))] = digest(path)
    files["runspecs.json"] = digest(root / "runspecs.json")
    return files


def verify_freeze(root):
    frozen = json.loads((root / "study-freeze.json").read_text())
    if frozen["files"] != frozen_files(root):
        raise ValueError("RUNSPEC_MISMATCH: frozen source/data changed")
    return frozen


def compare_usage(run, responses):
    """SDK totals must equal all actual upstream responses, not just their count."""
    usage = run["usage"]
    if len(responses) != usage["model_calls"]:
        raise ValueError("TELEMETRY_INCOMPLETE: response count")
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        values = [r.get("usage", {}).get(key) for r in responses]
        if any(type(v) is not int or v < 0 for v in values) or sum(values) != usage[key]:
            raise ValueError("TELEMETRY_INCOMPLETE: " + key)


def classification(left, right):
    if "INFRA_ERROR" in (left, right):
        return "incomparable"
    return {(True, True): "unchanged_success", (False, False): "unchanged_failure",
            (False, True): "newly_fixed", (True, False): "newly_broken"}[
                left == "TASK_PASS", right == "TASK_PASS"]


def needs_probe(left, right, max_calls=8):
    # Calls are discrete: 8/8 crosses 90%; 7/8 does not.
    return (left["status"] != right["status"] or
            any(r["usage"].get(k, 0) >= .9 * max_calls
                for r in (left, right) for k in ("tool_calls", "model_calls")))
