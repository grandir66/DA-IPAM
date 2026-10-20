"""Sonda runtime per tooling esterno e stato di NetBird (interfaccia ``wt0``).

Esposto in ``/healthz`` per:
    - Diagnosi rapida senza SSH sul cliente.
    - Decidere se rifiutare endpoint che richiedono un tool mancante
      (``snmp-walk`` senza ``snmpwalk`` -> ``tool_missing``).

I check sono cached 60 s per non scaricare i probe a ogni request: l'hub
o healthchecks esterni possono pollare /healthz frequentemente.

Dal 20/10/2026 l'overlay è solo NetBird.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


_CACHE_TTL_S = 60.0

# Interfaccia del client NetBird; la cartella si sposta solo nelle prove.
NETBIRD_IFACE = "wt0"
SYS_CLASS_NET = Path("/sys/class/net")


@dataclass(frozen=True)
class ToolsProbe:
    nmap: bool
    snmpwalk: bool
    ping: bool
    ssh: bool


@dataclass(frozen=True)
class NetworkProbe:
    netbird: bool
    netbird_ip: str | None


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


def netbird_iface_present() -> bool:
    """``/sys/class/net/wt0`` esiste se il client NetBird è su (Linux only)."""

    return (SYS_CLASS_NET / NETBIRD_IFACE).exists()


def _netbird_ip() -> str | None:
    """Primo IPv4 di ``wt0`` (``ip -4 -o addr show dev wt0``), o ``None``.

    Timeout corto; senza ``ip`` o con un errore non solleva.
    """

    if not shutil.which("ip"):
        return None
    try:
        proc = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", "dev", NETBIRD_IFACE],
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
        parts = line.split()
        if "inet" in parts:
            i = parts.index("inet")
            if i + 1 < len(parts):
                return parts[i + 1].split("/")[0]
    return None


def probe_network(use_cache: bool = True) -> NetworkProbe:
    if use_cache:
        cached = _cached("network")
        if isinstance(cached, NetworkProbe):
            return cached
    netbird = netbird_iface_present()
    ip = _netbird_ip() if netbird else None
    result = NetworkProbe(netbird=netbird, netbird_ip=ip)
    _store("network", result)
    return result


def reset_cache() -> None:
    """Utile nei test."""
    _cache.clear()
