"""Polling ARP table di un router via SNMP (OID ipNetToMediaPhysAddress).

Il parser è la parte tricky: i MAC arrivano in tre formati distinti
osservati in produzione sul parco Domarc.

    (a) ``aa:bb:cc:dd:ee:ff`` — formato canonico (la maggior parte dei
        device che rispondono con ``Hex-STRING:`` parsato).
    (b) ``"BC 24 11 FA 41 40 "`` — RouterOS CHR / RouterOS x86 quando si
        usa ``-Oq`` (senza ``-On``): il value compatto è una stringa
        space-separated con trailing space. Tipico di Cloud Hosted Router.
    (c) MAC vuoto (es. ``""`` o solo spazi) — MikroTik ARP incomplete:
        l'IP è "noto" ma il MAC non è stato risolto. Da scartare.

Output sempre normalizzato a ``aa:bb:cc:dd:ee:ff`` (lowercase, colon-separated).
"""

from __future__ import annotations

import re
import time

from .snmp import OID_IP_NET_TO_MEDIA_PHYS, SnmpRow, snmp_walk


_HEX_RE = re.compile(r"[0-9a-fA-F]")


def _normalize_mac(raw: str) -> str | None:
    """Converte un MAC in qualunque formato visto in produzione a
    ``aa:bb:cc:dd:ee:ff``. Ritorna ``None`` se non è un MAC valido o se è
    vuoto/incomplete."""

    s = raw.strip().strip('"').strip()
    if not s:
        return None

    # Estrai solo i caratteri esadecimali (gestisce colon, space, dash, dot).
    hex_only = "".join(c for c in s if _HEX_RE.match(c))
    if len(hex_only) != 12:
        return None
    if hex_only.upper() == "0" * 12:
        return None

    pairs = [hex_only[i:i + 2] for i in range(0, 12, 2)]
    return ":".join(p.lower() for p in pairs)


def _extract_ip_from_oid(oid: str, base: str = OID_IP_NET_TO_MEDIA_PHYS) -> str | None:
    """Da OID ``.1.3.6.1.2.1.4.22.1.2.<ifIndex>.<A>.<B>.<C>.<D>`` estrae
    ``A.B.C.D``. Robusto rispetto a OID che ritornano con o senza punto
    iniziale."""

    suffix = oid.lstrip(".")[len(base) + 1:] if oid.lstrip(".").startswith(base) else None
    if suffix is None:
        return None
    parts = suffix.split(".")
    if len(parts) < 5:
        return None
    ip_parts = parts[-4:]
    try:
        for p in ip_parts:
            if not (0 <= int(p) <= 255):
                return None
    except ValueError:
        return None
    return ".".join(ip_parts)


def parse_arp_rows(rows: list[SnmpRow]) -> tuple[list[dict[str, str]], list[str]]:
    """Ritorna ``(entries, raw_lines)``. ``raw_lines`` preserva l'output
    grezzo (utile per debug lato hub) — ogni riga è
    ``"<oid> <type> <value>"``.

    Le entry con MAC vuoto/zero/incomplete sono **escluse** dall'output
    parsed ma mantenute nelle raw_lines.
    """

    entries: list[dict[str, str]] = []
    raw: list[str] = []
    seen_ips: set[str] = set()

    for row in rows:
        raw.append(f"{row.oid} {row.type} {row.value}".strip())
        ip = _extract_ip_from_oid(row.oid)
        if not ip:
            continue
        mac = _normalize_mac(row.value)
        if not mac:
            continue
        if ip in seen_ips:
            continue
        seen_ips.add(ip)
        entries.append({"ip": ip, "mac": mac})

    return entries, raw


async def arp_poll(
    *,
    router_ip: str,
    community: str,
    version: str = "2c",
    timeout_ms: int = 10_000,
) -> dict[str, object]:
    """Walk ipNetToMediaPhysAddress e parsa la tabella ARP. Errori SNMP
    (timeout/auth/unreachable) si propagano come ``AgentException`` dal
    walk sottostante."""

    start = time.monotonic()
    rows = await snmp_walk(
        host=router_ip,
        community=community,
        oid=OID_IP_NET_TO_MEDIA_PHYS,
        version=version,
        timeout_ms=timeout_ms,
    )
    entries, raw_lines = parse_arp_rows(rows)
    duration_ms = int((time.monotonic() - start) * 1000)
    return {"entries": entries, "raw_lines": raw_lines, "duration_ms": duration_ms}
