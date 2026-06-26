"""Patched toggle section for net-services-bridge main.py"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, HTTPException, status

from auth import require_token
from adapters import adguard_install

logger = logging.getLogger("net-services-bridge")

# ALLOWED_TOGGLES, systemctl, service_state imported from main at patch time


def toggle_impl(service: str, enable: bool, allowed_toggles, systemctl_fn, service_state_fn) -> dict[str, Any]:
    if service not in allowed_toggles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unknown service '{service}', accepted: {list(allowed_toggles)}",
        )

    provision: dict[str, Any] | None = None
    if service == "adblock" and enable:
        provision = adguard_install.ensure_provisioned()
        if not provision.get("ok"):
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=provision)

    units = allowed_toggles[service]
    results = []
    for unit in units:
        if enable:
            rc_e, out_e = systemctl_fn("enable", unit)
            rc_s, out_s = systemctl_fn("start", unit)
        else:
            rc_e, out_e = systemctl_fn("disable", unit)
            rc_s, out_s = systemctl_fn("stop", unit)
        results.append({
            "unit": unit,
            "rc_enable_or_disable": rc_e,
            "rc_start_or_stop": rc_s,
            "out": (out_e + " | " + out_s).strip(),
            "state": service_state_fn(unit),
        })

    ok = True
    for r in results:
        if enable:
            if r["rc_enable_or_disable"] != 0 or r["rc_start_or_stop"] != 0:
                ok = False
        elif r["rc_start_or_stop"] != 0:
            ok = False

    return {
        "service": service,
        "enable": enable,
        "ok": ok,
        "provision": provision,
        "results": results,
    }
