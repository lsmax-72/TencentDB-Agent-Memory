"""Repeatable offline admission. Real SDK tool and container; ZERO model calls."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import et_xmlfile
import openpyxl
from nanobot.agent.tools.registry import ToolRegistry

from nanobot_tool import register_spreadsheet_only
from preflight import digest
from sandbox import IMAGE, PythonSandbox
from workbook_oracle import compare_workbooks


def write_json(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def validate(prepared: Path, root: Path):
    root.mkdir(mode=0o700)
    result = {"kind": "OFFLINE_ADMISSION", "model_calls": 0, "agent_run": False,
              "status": "IN_PROGRESS"}
    try:
        here = Path(__file__).resolve().parent
        repo = here.parent.parent
        suite = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(here),
                                "-p", "test_*.py", "-v"], capture_output=True, text=True,
                               env={**os.environ, "BUSINESS_DOCKER_TESTS": "1"}, timeout=120)
        with (root / "tests.log").open("x") as stream:
            stream.write(suite.stdout + suite.stderr)
        if suite.returncode:
            raise RuntimeError("unit/container admission tests failed; see tests.log")
        old = subprocess.run(["node", "--test", "scripts/phase6/acceptance-lib.test.mjs"],
                             cwd=repo, capture_output=True, text=True, timeout=30)
        with (root / "phase6-tests.log").open("x") as stream:
            stream.write(old.stdout + old.stderr)
        if old.returncode:
            raise RuntimeError("existing Phase 6 helper regression")
        manifest = json.loads((prepared / "manifest.json").read_text())
        for entry in manifest["files"]:
            if digest(prepared / entry["path"]) != entry["sha256"]:
                raise ValueError("prepared fixture changed")
        inputs, outputs = root / "inputs", root / "outputs"
        inputs.mkdir(mode=0o755)
        outputs.mkdir(mode=0o777)
        outputs.chmod(0o777)
        entry = next(f for f in manifest["files"] if f["role"] == "input")
        shutil.copyfile(prepared / entry["path"], inputs / "input.xlsx")
        (inputs / "input.xlsx").chmod(0o444)
        sandbox = PythonSandbox(inputs, outputs, Path(et_xmlfile.__file__).parent.parent)
        registry = ToolRegistry()
        register_spreadsheet_only(SimpleNamespace(_loop=SimpleNamespace(tools=registry)), sandbox)
        # Deliberately copy, not solve: demonstrates the judge rejects an unchanged workbook.
        code = ("import openpyxl, json; w=openpyxl.load_workbook('/inputs/input.xlsx'); "
                "print(json.dumps({'sheets':w.sheetnames})); w.save('/outputs/unchanged-copy.xlsx')")
        tool_result = asyncio.run(registry.get("spreadsheet_python").execute(code))
        write_json(root / "sdk-tool-event.json", {"name": "spreadsheet_python", "arguments": {"code": code},
                   "result": json.loads(tool_result), "is_error": tool_result.is_error,
                   "invocation": "direct SDK tool, not Agent.run or LLM"})
        if tool_result.is_error:
            raise RuntimeError("actual input cannot be processed by sandbox SDK tool")
        reference = next(f for f in manifest["files"] if f["role"] == "reference")
        oracle = compare_workbooks(prepared / reference["path"], outputs / "unchanged-copy.xlsx",
                                   manifest["task"]["answer_position"])
        write_json(root / "negative-control-oracle.json", oracle)
        if oracle["status"] != "TASK_FAIL":
            raise RuntimeError("unchanged copy did not produce expected negative control")
        sources = [*here.glob("*.py"), here / "protocol-smoke-v1.json"]
        freeze = {"image": IMAGE, "python": sys.version, "openpyxl": openpyxl.__version__,
                  "nanobot_revision": subprocess.check_output(["git", "-C", "/Users/lsmax/Coder/nanobot",
                                                               "rev-parse", "HEAD"], text=True).strip(),
                  "files": {str(p.relative_to(repo)): digest(p) for p in sources},
                  "input_hash": digest(inputs / "input.xlsx"),
                  "prepared_manifest_hash": digest(prepared / "manifest.json")}
        write_json(root / "freeze.json", freeze)
        result.update(status="PASS", sdk_tool_pass=True, unchanged_copy_rejected=True,
                      fixture_input_unchanged=digest(inputs / "input.xlsx") == entry["sha256"],
                      new_tests_exit=suite.returncode, phase6_tests_exit=old.returncode,
                      freeze_hash=hashlib.sha256((root / "freeze.json").read_bytes()).hexdigest(),
                      real_agent_smoke="NOT_RUN_REVIEW_REQUIRED")
    except Exception as exc:
        result.update(status="FAIL", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        write_json(root / "validation.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("prepared", type=Path)
    parser.add_argument("new_output", type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.prepared.resolve(), args.new_output.resolve()), indent=2))
