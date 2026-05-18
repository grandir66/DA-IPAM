"""Wrapper nmap. TCP-only quick discovery + port scan.

Specchio essenziale di ``src/lib/scanner/nmap.ts``: per Phase 2 implementiamo
solo discovery (-sn) e port scan TCP (-sT). La fase UDP, gli args personalizzati
e il merge TCP+UDP arriveranno in Phase 3 quando l'Executor remoto verrà
chiamato dai call site reali.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
import shutil
from typing import Iterable
from xml.etree import ElementTree as ET

from ..models import NmapPort, NmapResult


log = logging.getLogger(__name__)


def _nmap_cmd(args: list[str], need_root: bool) -> list[str]:
    """Costruisce il comando nmap, anteponendo ``sudo -n`` se serve root.

    Su Ubuntu 24.04 nmap 7.94SVN rifiuta ``-sU``/``-sS`` come non-root anche
    con file capabilities (``cap_net_raw=eip``) e ambient capabilities: hard-
    checka ``euid==0``. Per i path che richiedono root (UDP scan) usiamo
    sudo con NOPASSWD limitato a ``/usr/bin/nmap`` (configurato dall'installer
    via ``/etc/sudoers.d/da-invent-agent``).
    """
    if need_root and os.geteuid() != 0 and shutil.which("sudo"):
        return ["sudo", "-n", "/usr/bin/nmap", *args]
    return ["nmap", *args]


async def _run_nmap_xml(args: list[str], timeout_ms: int, need_root: bool = False) -> str | None:
    timeout_s = max(1.0, timeout_ms / 1000)
    cmd = _nmap_cmd(args, need_root)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        log.warning("nmap timeout dopo %.1fs (args=%s)", timeout_s, list(args))
        return None
    if proc.returncode != 0:
        log.warning("nmap exit %s: %s", proc.returncode, stderr_b.decode("utf-8", errors="replace").strip()[:200])
        return None
    return stdout_b.decode("utf-8", errors="replace")


def _parse_xml(xml: str) -> list[NmapResult]:
    out: list[NmapResult] = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        log.warning("nmap XML parse error: %s", e)
        return out

    for host_el in root.findall("host"):
        status_el = host_el.find("status")
        alive = status_el is not None and status_el.get("state") == "up"

        ip: str | None = None
        mac: str | None = None
        for addr_el in host_el.findall("address"):
            addrtype = addr_el.get("addrtype")
            if addrtype == "ipv4":
                ip = addr_el.get("addr")
            elif addrtype == "mac":
                mac = addr_el.get("addr")
        if not ip:
            continue

        ports: list[NmapPort] = []
        ports_root = host_el.find("ports")
        if ports_root is not None:
            for port_el in ports_root.findall("port"):
                state_el = port_el.find("state")
                service_el = port_el.find("service")
                ports.append(
                    NmapPort(
                        port=int(port_el.get("portid", "0")),
                        protocol=port_el.get("protocol", "tcp"),
                        state=state_el.get("state", "unknown") if state_el is not None else "unknown",
                        service=service_el.get("name") if service_el is not None else None,
                        product=service_el.get("product") if service_el is not None else None,
                        version=service_el.get("version") if service_el is not None else None,
                    ),
                )

        os_name: str | None = None
        os_root = host_el.find("os")
        if os_root is not None:
            best = os_root.find("osmatch")
            if best is not None:
                os_name = best.get("name")

        out.append(NmapResult(ip=ip, alive=alive, ports=sorted(ports, key=lambda p: p.port), os=os_name, mac=mac))

    return out


async def discover_hosts(target: str, timeout_ms: int = 90_000) -> list[NmapResult]:
    args = ["-sn", "-T4", "--min-rate", "200", "--max-retries", "1", "-oX", "-", target]
    xml = await _run_nmap_xml(args, timeout_ms)
    if xml is None:
        return []
    return _parse_xml(xml)


def _tcp_args_from_custom(custom: str | None) -> list[str]:
    """Sanitizza ``custom_args`` rimuovendo eventuali ``-sU``/``-sS`` ed
    assicurando la presenza di ``-sT`` (TCP connect, no root).
    """

    parts: list[str] = []
    if custom:
        # `shlex.split` con `posix=True` rifiuta caratteri shell pericolosi.
        try:
            parts = [p for p in shlex.split(custom) if p and not p.startswith("-sU") and p != "-sS"]
        except ValueError:
            parts = []
    has_scan_type = any(p.startswith(("-sT", "-sS")) for p in parts)
    if not has_scan_type:
        parts = ["-sT", *parts]
    return parts


_DEFAULT_UDP_PORTS = "53,67,68,69,123,137,138,161,162,500,514,520,1900,4500,5060,5353"


def _udp_args(udp_ports: str | None) -> list[str]:
    """Args per nmap UDP. ``-sU`` richiede CAP_NET_RAW (la systemd unit lo concede)."""
    ports = (udp_ports or _DEFAULT_UDP_PORTS).strip() or _DEFAULT_UDP_PORTS
    return ["-sU", "-T4", "--max-retries", "1", "-p", ports]


def _merge_ports(a: list[NmapPort], b: list[NmapPort]) -> list[NmapPort]:
    """Unione TCP+UDP senza duplicati su (port, protocol)."""
    seen: set[tuple[int, str]] = set()
    out: list[NmapPort] = []
    for p in (*a, *b):
        key = (p.port, p.protocol)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return sorted(out, key=lambda p: (p.protocol, p.port))


async def port_scan(
    ip: str,
    custom_args: str | None = None,
    timeout_ms: int = 280_000,
    skip_udp: bool = False,
    udp_ports: str | None = None,
) -> NmapResult | None:
    """Scansione TCP (sempre) + UDP (se ``skip_udp=False``).

    TCP e UDP sono **due processi nmap separati**: alcuni profili/ambienti
    falliscono se vengono fusi in un comando solo. Il timeout passato si
    applica a ciascuna fase singolarmente.

    Se UDP fallisce per mancanza di privilegi viene degradato a warning: il
    chiamante riceve comunque i risultati TCP.
    """

    tcp_args = _tcp_args_from_custom(custom_args)
    tcp_xml = await _run_nmap_xml([*tcp_args, "-oX", "-", ip], timeout_ms)
    tcp_result = _parse_xml(tcp_xml)[0] if tcp_xml else None

    if skip_udp:
        return tcp_result

    udp_xml = await _run_nmap_xml([*_udp_args(udp_ports), "-oX", "-", ip], timeout_ms, need_root=True)
    udp_result = _parse_xml(udp_xml)[0] if udp_xml else None

    if tcp_result is None and udp_result is None:
        return None

    merged_ports = _merge_ports(
        tcp_result.ports if tcp_result else [],
        udp_result.ports if udp_result else [],
    )

    return NmapResult(
        ip=ip,
        alive=True,
        ports=merged_ports,
        os=(tcp_result.os if tcp_result else None) or (udp_result.os if udp_result else None),
        mac=(tcp_result.mac if tcp_result else None) or (udp_result.mac if udp_result else None),
    )
