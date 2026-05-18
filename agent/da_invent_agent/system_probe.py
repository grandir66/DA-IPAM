"""Sonda runtime per tooling esterno e stato Tailscale.

Esposto in ``/healthz`` per:
    - Diagnosi rapida senza SSH sul cliente.
    - Decidere se rifiutare endpoint che richiedono un tool mancante
      (``snmp-walk`` senza ``snmpwalk`` -> ``tool_missing``).

I check sono cached 60 s per non scaricare i probe a ogni request: Tailscale
o healthchecks esterni possono pollare /healthz frequentemente.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass


_CACHE_TTL_S = 60.0


@dataclass(frozen=True)
class ToolsProbe:
    nmap: bool
    snmpwalk: bool
    ping: bool
    ssh: bool


@dataclass(frozen=True)
class NetworkProbe:
    tailscale: bool
    tailscale_ip: str | None


# Stato cache module-level (sufficiente: il process è lungo-vivo).
_cache: dict[str, tuple[float, object]] = {}


def _which(name: str) -> bool:
    return shutil.which(name) is not None


def _cached(key: str) -> object | None:
    hit = _cache.get(key)
    if not hit:
        return None
    ts, value = hit
    if (time.monotonic() - ts) > _CACHE_TTL_S:
        return None
    return value


def _store(key: str, value: object) -> None:
    _cache[key] = (time.monotonic(), value)


def probe_tools(use_cache: bool = True) -> ToolsProbe:
    if use_cache:
        cached = _cached("tools")
        if isinstance(cached, ToolsProbe):
            return cached
    result = ToolsProbe(
        nmap=_which("nmap"),
        snmpwalk=_which("snmpwalk"),
        ping=_which("ping"),
        ssh=_which("ssh"),
    )
    _store("tools", result)
    return result


def _tailscale_iface_present() -> bool:
    # /sys/class/net/tailscale0 esiste se il daemon è attivo (Linux only).
    from pathlib import Path

    return Path("/sys/class/net/tailscale0").exists()


def _tailscale_ip() -> str | None:
    """Restituisce il primo IPv4 in CGNAT del nodo Tailscale, o ``None``.

    Usa ``tailscale ip -4`` con timeout corto. In assenza del binary
    ``tailscale`` non solleva: l'interfaccia ``tailscale0`` può esistere
    anche con il CLI non installato (improbabile, ma robusto).
    """

    if not shutil.which("tailscale"):
        return None
    try:
        proc = subprocess.run(
            ["tailscale", "ip", "-4"],
            capture_output=True,
            text=True,
            timeout=1.0,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        ip = line.strip()
        if ip:
            return ip
    return None


def probe_network(use_cache: bool = True) -> NetworkProbe:
    if use_cache:
        cached = _cached("network")
        if isinstance(cached, NetworkProbe):
            return cached
    tailscale = _tailscale_iface_present()
    ip = _tailscale_ip() if tailscale else None
    result = NetworkProbe(tailscale=tailscale, tailscale_ip=ip)
    _store("network", result)
    return result


def reset_cache() -> None:
    """Utile nei test."""
    _cache.clear()
