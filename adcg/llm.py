"""LLM backends. ClaudeCodeLLM drives the `claude` CLI headlessly using the
user's Claude subscription (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`).
OllamaLLM runs a free open-weights model locally via Ollama (no paid key needed).
MockLLM is deterministic and only for testing the pipeline - never report its scores.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "results" / "cache"
if not (ROOT / "knowledge" / "payload_classes.json").exists():
    CACHE = Path.home() / ".cache" / "adc-guardrail"


def parse_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.S)
    if m:
        text = m.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object in LLM output")
    return json.loads(text[start : end + 1])


class ClaudeCodeLLM:
    def __init__(self, model: str = "sonnet", timeout_s: int = 180, use_cache: bool = True):
        self.model = model
        self.timeout_s = timeout_s
        self.use_cache = use_cache
        self.resolved_models: set[str] = set()

    @property
    def name(self) -> str:
        return f"claude-code:{self.model}"

    def complete(self, system: str, prompt: str) -> dict:
        key = hashlib.sha256(f"{self.model}\n{system}\n{prompt}".encode()).hexdigest()[:24]
        cache = CACHE / f"{key}.json"
        if self.use_cache and cache.exists():
            out = json.loads(cache.read_text())
        else:
            cmd = [
                "claude", "-p", "--output-format", "json", "--model", self.model,
                "--tools", "", "--no-session-persistence", "--system-prompt", system,
            ]
            with tempfile.TemporaryDirectory() as cwd:  # no repo files / CLAUDE.md visible
                proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                                      timeout=self.timeout_s, cwd=cwd, env=os.environ.copy())
            if proc.returncode != 0:
                raise RuntimeError(f"claude CLI failed: {proc.stderr[-500:] or proc.stdout[-500:]}")
            out = json.loads(proc.stdout)
            if out.get("is_error"):
                raise RuntimeError(f"claude CLI error: {out.get('result')}")
            CACHE.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(out))
        self.resolved_models.update((out.get("modelUsage") or {}).keys())
        return parse_json(out["result"])


class OllamaLLM:
    """Local open model via the Ollama HTTP API. Greedy decoding + fixed seed for reproducibility."""

    def __init__(self, model: str = "qwen2.5:7b-instruct", host: str | None = None,
                 timeout_s: int = 900, use_cache: bool = True):
        self.model = model
        self.host = host or os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
        self.timeout_s = timeout_s
        self.use_cache = use_cache
        self.resolved_models: set[str] = set()

    @property
    def name(self) -> str:
        return f"ollama:{self.model}"

    def complete(self, system: str, prompt: str) -> dict:
        key = hashlib.sha256(f"ollama\n{self.model}\n{system}\n{prompt}".encode()).hexdigest()[:24]
        cache = CACHE / f"{key}.json"
        if self.use_cache and cache.exists():
            out = json.loads(cache.read_text())
        else:
            body = {
                "model": self.model, "stream": False, "format": "json",
                "options": {"temperature": 0, "seed": 0, "num_ctx": 8192},
                "messages": [{"role": "system", "content": system + "\nReply with one JSON object only."},
                             {"role": "user", "content": prompt}],
            }
            for attempt in range(3):  # Ollama occasionally returns a transient 500 on CPU
                r = requests.post(f"{self.host}/api/chat", json=body, timeout=self.timeout_s)
                if r.status_code < 500 or attempt == 2:
                    break
                time.sleep(5)
            r.raise_for_status()
            out = r.json()
            CACHE.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(out))
        self.resolved_models.add(out.get("model", self.model))
        return parse_json(out["message"]["content"])


class MockLLM:
    """Deterministic stand-in. Echoes the rule engine; baseline mode knows nothing."""

    name = "mock"
    resolved_models = {"mock"}

    def complete(self, system: str, prompt: str) -> dict:
        if "MODE: draft_card" in system:
            flags = json.loads(prompt.split("RULE_FLAGS_JSON:", 1)[1].split("\n", 1)[0])
            return {
                "verdict": "supported",
                "answer": "Risk card: " + ", ".join(f"{f['id']} ({f['severity']})" for f in flags),
                "reason": "Summarised the rule-engine flags.",
                "confidence": 0.85,
                "extra_flags": [],
                "evidence": [],
            }
        if "MODE: judge_claim" in system:
            row = prompt.split("ADC_ROW_JSON:", 1)[1].split("\n", 1)[0].strip()
            if row == "null":
                return {"verdict": "dont_know", "confidence": 0.3, "answer": "No record.", "reason": "", "evidence": []}
            claim = prompt.split("CLAIM:", 1)[1].split("\n", 1)[0].lower()
            vals = [str(v).lower() for v in json.loads(row).values() if v]
            sup = any(len(v) > 2 and v in claim for v in vals if v not in ("phase",))
            return {"verdict": "supported" if sup else "not_supported", "confidence": 0.7,
                    "answer": "", "reason": "string match (mock)", "evidence": []}
        return {"verdict": "supported", "confidence": 0.8, "answer": "Mock baseline answer.",
                "reason": "", "flags": [], "evidence": [], "needs_human": False}


def get_llm(name: str):
    if name == "mock":
        return MockLLM()
    if name.startswith("claude"):
        _, _, model = name.partition(":")
        return ClaudeCodeLLM(model=model or "sonnet")
    if name.startswith("ollama"):
        _, _, model = name.partition(":")
        return OllamaLLM(model=model or "qwen2.5:7b-instruct")
    raise ValueError(name)
