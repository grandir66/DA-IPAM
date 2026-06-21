"""AdGuard Home provisioning — crea unit systemd se mancante (fix install incompleto)."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

PROVISION_SCRIPT = Path("/usr/local/bin/net-services-adguard-provision.sh")
UNIT = Path("/etc/systemd/system/adguardhome.service")


def ensure_provisioned() -> dict[str, Any]:
    """Idempotente: config Unbound :5335 + adguardhome.service."""
    if UNIT.exists() and Path("/etc/AdGuardHome/AdGuardHome.yaml").exists():
        return {"ok": True, "provisioned": True, "note": "already present"}

    if not PROVISION_SCRIPT.is_file():
        return {
            "ok": False,
            "error": f"missing {PROVISION_SCRIPT} — re-run net-services install",
        }

    try:
        proc = subprocess.run(
            [str(PROVISION_SCRIPT)],
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ},
        )
        if proc.returncode == 0:
            return {"ok": True, "provisioned": True, "out": proc.stdout.strip()}
        return {
            "ok": False,
            "error": "provision script failed",
            "rc": proc.returncode,
            "out": (proc.stdout + proc.stderr).strip(),
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
