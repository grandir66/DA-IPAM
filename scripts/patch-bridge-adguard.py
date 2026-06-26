"""Patch adguard.py with cache flush + upstream config."""
from pathlib import Path

ADDITIONS = '''

def flush_cache() -> dict[str, Any]:
    if not _is_running():
        return {"ok": False, "error": "adguardhome not running"}
    try:
        r = httpx.post(f"{API_URL}/control/cache_clear", timeout=10.0, auth=_auth())
        return {"ok": r.status_code in (200, 204), "http": r.status_code}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def get_upstream() -> dict[str, Any]:
    if not _is_running():
        return {"running": False, "upstream_dns": [], "bootstrap_dns": []}
    try:
        r = httpx.get(f"{API_URL}/control/dns_info", timeout=5.0, auth=_auth())
        if r.status_code != 200:
            return {"running": True, "error": f"http {r.status_code}"}
        body = r.json()
        return {
            "running": True,
            "upstream_dns": body.get("upstream_dns") or [],
            "bootstrap_dns": body.get("bootstrap_dns") or [],
            "protection_enabled": body.get("protection_enabled"),
            "filtering_enabled": body.get("filtering_enabled"),
        }
    except Exception as e:  # noqa: BLE001
        return {"running": True, "error": str(e)}


def set_upstream(upstream_dns: list[str], bootstrap_dns: list[str] | None = None) -> dict[str, Any]:
    if not _is_running():
        return {"ok": False, "error": "adguardhome not running"}
    if not upstream_dns:
        return {"ok": False, "error": "upstream_dns required"}
    payload: dict[str, Any] = {"upstream_dns": upstream_dns}
    if bootstrap_dns:
        payload["bootstrap_dns"] = bootstrap_dns
    try:
        r = httpx.post(
            f"{API_URL}/control/dns_config",
            json=payload,
            timeout=10.0,
            auth=_auth(),
        )
        return {"ok": r.status_code in (200, 204), "http": r.status_code, "upstream_dns": upstream_dns}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
'''

p = Path("/opt/net-services-bridge/adapters/adguard.py")
if "def flush_cache" in p.read_text() and "get_upstream" in p.read_text():
    print("adguard already patched")
else:
    p.write_text(p.read_text().rstrip() + ADDITIONS + "\n")
    print("adguard patched")
