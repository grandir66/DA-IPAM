"""Estensioni Unbound — upstream root, flush cache (append to unbound.py)."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

CONFIG_DIR = Path("/etc/unbound/unbound.conf.d")
ROOT_FORWARD = CONFIG_DIR / "00-root-forward.conf"
_SAFE_IP_RE = re.compile(r"^[a-fA-F0-9:.]+(@\d{1,5})?$")


def _reload() -> tuple[int, str]:
    try:
        r = subprocess.run(
            ["systemctl", "reload-or-restart", "unbound.service"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return r.returncode, (r.stdout + r.stderr).strip()
    except Exception as e:  # noqa: BLE001
        return -1, str(e)


def get_root_upstream() -> dict[str, Any]:
    targets: list[str] = []
    if ROOT_FORWARD.exists():
        for line in ROOT_FORWARD.read_text(errors="replace").splitlines():
            ls = line.strip()
            if ls.startswith("forward-addr:"):
                targets.append(ls.split(":", 1)[1].strip())
    return {"zone": ".", "targets": targets, "file": str(ROOT_FORWARD)}


def set_root_upstream(targets: list[str]) -> dict[str, Any]:
    if not targets or not all(_SAFE_IP_RE.match(t) for t in targets):
        return {"ok": False, "error": "missing or invalid upstream targets"}
    if not CONFIG_DIR.exists():
        return {"ok": False, "error": "unbound config dir missing"}
    body = "# managed by net-services-bridge — root recursive forwarders\nforward-zone:\n    name: \".\"\n"
    for t in targets:
        body += f"    forward-addr: {t}\n"
    ROOT_FORWARD.write_text(body)
    rc, out = _reload()
    return {"ok": rc == 0, "targets": targets, "reload_rc": rc, "reload_out": out}


def flush_cache() -> dict[str, Any]:
    try:
        r = subprocess.run(
            ["unbound-control", "flush"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return {"ok": r.returncode == 0, "rc": r.returncode, "out": (r.stdout + r.stderr).strip()}
    except FileNotFoundError:
        return {"ok": False, "error": "unbound-control not installed"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
