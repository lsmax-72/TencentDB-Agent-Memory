"""One-shot, networkless Python tool. No Docker socket or host credentials inside."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

IMAGE = "sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf"
OUTPUT_LIMIT = 32 * 1024 * 1024
LOG_LIMIT = 128 * 1024


def tree_hash(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("symlinks are not allowed in workspace trees")
        if path.is_file():
            result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


class PythonSandbox:
    def __init__(self, inputs: Path, outputs: Path, packages: Path, image=IMAGE):
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
            raise ValueError("an immutable image id is required")
        for path in (inputs, outputs, packages):
            if path.is_symlink() or not path.is_dir() or "," in str(path):
                raise ValueError("invalid mount directory")
        self.inputs, self.outputs, self.packages = (p.resolve() for p in (inputs, outputs, packages))
        if self.inputs == self.outputs or self.inputs in self.outputs.parents or self.outputs in self.inputs.parents:
            raise ValueError("input and output mounts must be disjoint")
        self.image = image
        self._cancel = threading.Event()
        self._idle = threading.Event()
        self._idle.set()
        self._lock = threading.Lock()
        self.input_hashes = tree_hash(self.inputs)
        for module in ("openpyxl", "et_xmlfile"):
            if not (self.packages / module).is_dir() or (self.packages / module).is_symlink():
                raise ValueError(f"missing pure-Python dependency {module}")

    def command(self, name):
        args = ["docker", "run", "--rm", "-i", "--name", name, "--pull", "never",
                "--network", "none", "--read-only", "--user", "65534:65534",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--pids-limit", "32",
                "--ulimit", "fsize=16777216:16777216", "--ulimit", "nofile=128:128",
                "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777",
                "--workdir", "/outputs", "--env", "PYTHONPATH=/opt",
                "--env", "PYTHONDONTWRITEBYTECODE=1",
                "--mount", f"type=bind,src={self.inputs},dst=/inputs,readonly",
                "--mount", f"type=bind,src={self.outputs},dst=/outputs"]
        for module in ("openpyxl", "et_xmlfile"):
            args += ["--mount", f"type=bind,src={self.packages / module},dst=/opt/{module},readonly"]
        return args + ["--entrypoint", "python", self.image, "-B", "-c",
                       "import sys; exec(compile(sys.stdin.read(), '<tool-code>', 'exec'))"]

    def run(self, code: str, timeout_seconds=20) -> dict:
        if not isinstance(code, str) or len(code.encode()) > 128_000:
            raise ValueError("code must be bounded UTF-8 text")
        if not 0 < timeout_seconds <= 60:
            raise ValueError("tool timeout must be in (0,60]")
        if not self._lock.acquire(blocking=False):
            raise ValueError("concurrent tool execution rejected")
        self._idle.clear()
        self._cancel.clear()
        try:
            return self._run_locked(code, timeout_seconds)
        finally:
            # Mount validation or Docker startup can fail before a process exists.
            self._idle.set()
            self._lock.release()

    def _run_locked(self, code, timeout_seconds):
        if tree_hash(self.inputs) != self.input_hashes:
            raise ValueError("input snapshot changed before execution")
        tree_hash(self.outputs)
        name = "business-tool-" + uuid.uuid4().hex
        started = time.monotonic()
        stop = None
        with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as logs:
            source.write(code.encode())
            source.seek(0)
            process = subprocess.Popen(self.command(name), stdin=source, stdout=logs, stderr=logs)
            try:
                while process.poll() is None:
                    if self._cancel.is_set():
                        stop = "AGENT_ABORTED"
                    elif time.monotonic() - started > timeout_seconds:
                        stop = "TOOL_TIMEOUT"
                    elif logs.tell() > LOG_LIMIT:
                        stop = "TOOL_OUTPUT_LIMIT"
                    else:
                        size = 0
                        for path in self.outputs.rglob("*"):
                            if path.is_symlink():
                                stop = "TOOL_POLICY_VIOLATION"
                                break
                            if path.is_file():
                                try:
                                    size += path.stat().st_size
                                except FileNotFoundError:
                                    continue  # Atomic replacement during a tool call is valid.
                        if size > OUTPUT_LIMIT:
                            stop = "TOOL_OUTPUT_LIMIT"
                    if stop:
                        break
                    time.sleep(0.05)
            finally:
                if process.poll() is None:
                    # Exact random name belongs only to this invocation, never an existing service.
                    subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=10)
                    process.kill()
                process.wait(timeout=10)
            if logs.tell() > LOG_LIMIT:
                stop = stop or "TOOL_OUTPUT_LIMIT"
            logs.seek(0)
            text = logs.read(LOG_LIMIT).decode("utf8", errors="replace")
        try:
            if sum(p.stat().st_size for p in self.outputs.rglob("*")
                   if not p.is_symlink() and p.is_file()) > OUTPUT_LIMIT:
                stop = stop or "TOOL_OUTPUT_LIMIT"
            outputs = tree_hash(self.outputs)
        except ValueError:
            outputs, stop = {}, "TOOL_POLICY_VIOLATION"
        if tree_hash(self.inputs) != self.input_hashes:
            stop = "INPUT_SNAPSHOT_CHANGED"
        result = {"ok": process.returncode == 0 and stop is None, "exit_code": process.returncode,
                  "stop_reason": stop, "output": text, "output_hashes": outputs,
                  "elapsed_ms": round((time.monotonic() - started) * 1000), "image": self.image}
        return result

    def cancel(self):
        self._cancel.set()

    def wait_idle(self, timeout):
        return self._idle.wait(timeout)


def tool_result(result):
    return json.dumps(result, ensure_ascii=False)
