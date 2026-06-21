"""Patch unbound.py with upstream root + cache flush."""
from pathlib import Path

ADDITIONS = '''

ROOT_FORWARD_FILE = CONFIG_DIR / "00-root-forward.conf"


def get_root_upstream() -> dict[str, Any]:
    """Forwarders per zona root (.) — resolver verso internet / AD DNS."""
    targets: list[str] = []
    if ROOT_FORWARD_FILE.exists():
        for line in ROOT_FORWARD_FILE.read_text(errors="replace").splitlines():
            ls = line.strip()
            if ls.startswith("forward-addr:"):
                targets.append(ls.split(":", 1)[1].strip())
    return {"zone": ".", "targets": targets, "file": str(ROOT_FORWARD_FILE)}


def set_root_upstream(targets: list[str]) -> dict[str, Any]:
    if not targets or not all(_SAFE_IP_RE.match(t) for t in targets):
        return {"ok": False, "error": "missing or invalid upstream targets"}
    if not CONFIG_DIR.exists():
        return {"ok": False, "error": f"CONFIG_DIR {CONFIG_DIR} not present"}
    body = "# managed by net-services-bridge — root forwarders (conditional default)\\nforward-zone:\\n    name: \\".\\"\\n"
    for t in targets:
        body += f"    forward-addr: {t}\\n"
    ROOT_FORWARD_FILE.write_text(body)
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
'''

p = Path("/opt/net-services-bridge/adapters/unbound.py")
if "get_root_upstream" in p.read_text():
    print("unbound already patched")
else:
    p.write_text(p.read_text().rstrip() + ADDITIONS + "\n")
    print("unbound patched")
