#!/usr/bin/env python3
"""Applica patch toggle adguard al bridge net-services (idempotente)."""
from pathlib import Path

MAIN = Path("/opt/net-services-bridge/main.py")

src = MAIN.read_text()

if "adguard_install" in src and '"ok": ok' in src:
    print("already patched")
    raise SystemExit(0)

if "from adapters import adguard, kea, powerdns, unbound" in src:
    src = src.replace(
        "from adapters import adguard, kea, powerdns, unbound",
        "from adapters import adguard, adguard_install, kea, powerdns, unbound",
    )

marker = '    units = ALLOWED_TOGGLES[service]\n    results = []'
if marker not in src:
    print("ERROR: toggle marker not found")
    raise SystemExit(1)

insert = '''    provision: dict[str, Any] | None = None
    if service == "adblock" and enable:
        provision = adguard_install.ensure_provisioned()
        if not provision.get("ok"):
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=provision)

'''

src = src.replace(
    marker,
    insert + marker,
    1,
)

old_return = '    return {"service": service, "enable": enable, "results": results}'
new_return = '''    ok = True
    for r in results:
        if enable:
            if r["rc_enable_or_disable"] != 0 or r["rc_start_or_stop"] != 0:
                ok = False
        elif r["rc_start_or_stop"] != 0:
            ok = False
    return {"service": service, "enable": enable, "ok": ok, "provision": provision, "results": results}'''

if old_return not in src:
    print("ERROR: return marker not found")
    raise SystemExit(1)

src = src.replace(old_return, new_return, 1)
MAIN.write_text(src)
print("patched OK")
