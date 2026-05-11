"""Wrapper attorno a ``snmpwalk`` (net-snmp) per le primitive richieste
dall'hub: walk generico, ARP table, route table.

Decisioni di design:
    - Subprocess invece di pysnmp: net-snmp è battle-tested, supporta tutti i
      protocolli moderni v3 (AES-256, SHA-512) senza dipendenze pip extra.
    - Args sempre come ``list[str]``, mai stringa: zero rischio di shell-injection.
    - ``-Oqn`` (numerico + quiet): output deterministico ``OID = value``.
    - Per ARP usiamo ``-Oq`` (numerico ma compatto): la parte ``value`` espone
      meglio i MAC nei vari formati che vediamo nel parco RouterOS.
    - Community/password mai loggate (redact in ``_log_args``).
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import shutil
from dataclasses import dataclass

from ..errors import AgentException, ErrorCode


log = logging.getLogger(__name__)


# OID di interesse, espressi in forma testuale per i log e numerica negli args.
OID_IP_NET_TO_MEDIA_PHYS = "1.3.6.1.2.1.4.22.1.2"      # ARP table (ipNetToMediaPhysAddress)
OID_IP_ADDR_TABLE = "1.3.6.1.2.1.4.20"                 # interface addresses (RFC1213)
OID_IP_CIDR_ROUTE_DEST = "1.3.6.1.2.1.4.24.4.1.1"      # ipCidrRouteDest
OID_IP_CIDR_ROUTE_MASK = "1.3.6.1.2.1.4.24.4.1.2"      # ipCidrRouteMask
OID_IP_ADDR_NETMASK = "1.3.6.1.2.1.4.20.1.3"           # ipAdEntNetMask


def _check_tool() -> None:
    if shutil.which("snmpwalk") is None:
        raise AgentException(
            ErrorCode.TOOL_MISSING,
            "snmpwalk non trovato nel PATH. Installare net-snmp.",
            details={"tool": "snmpwalk"},
        )


def _build_args(
    *,
    host: str,
    community: str | None,
    version: str,
    oid: str,
    timeout_ms: int,
    v3: dict[str, str] | None = None,
    compact_value: bool = False,
) -> list[str]:
    """Costruisce gli argomenti per ``snmpwalk``. ``-Oqn`` per default;
    con ``compact_value=True`` usiamo ``-Oq`` (numerico solo OID, value
    senza prefisso "Hex-STRING:" ecc.)."""

    args: list[str] = ["snmpwalk"]
    args.extend(["-Oqn"] if not compact_value else ["-Oq", "-On"])
    timeout_s = max(1, (timeout_ms + 999) // 1000)
    args.extend(["-t", str(timeout_s), "-r", "1"])

    if version in {"1", "2c"}:
        if not community:
            raise AgentException(ErrorCode.INVALID_INPUT, "community obbligatoria per SNMP v1/v2c")
        args.extend(["-v", version, "-c", community])
    elif version == "3":
        if not v3:
            raise AgentException(ErrorCode.INVALID_INPUT, "Parametri v3 mancanti")
        sec = v3.get("security_name")
        if not sec:
            raise AgentException(ErrorCode.INVALID_INPUT, "v3.security_name obbligatorio")
        auth_proto = v3.get("auth_protocol")
        auth_pass = v3.get("auth_password")
        priv_proto = v3.get("priv_protocol")
        priv_pass = v3.get("priv_password")
        args.extend(["-v", "3", "-u", sec])
        if auth_proto and auth_pass:
            args.extend(["-l", "authPriv" if priv_proto and priv_pass else "authNoPriv",
                         "-a", auth_proto, "-A", auth_pass])
        else:
            args.append("-l")
            args.append("noAuthNoPriv")
        if priv_proto and priv_pass:
            args.extend(["-x", priv_proto, "-X", priv_pass])
    else:
        raise AgentException(ErrorCode.INVALID_INPUT, f"Versione SNMP non supportata: {version}")

    args.append(host)
    args.append(oid)
    return args


def _redact(args: list[str]) -> list[str]:
    redacted: list[str] = []
    skip_next = False
    secret_flags = {"-c", "-A", "-X"}
    for a in args:
        if skip_next:
            redacted.append("***")
            skip_next = False
            continue
        if a in secret_flags:
            redacted.append(a)
            skip_next = True
        else:
            redacted.append(a)
    return redacted


@dataclass
class SnmpRow:
    oid: str
    type: str
    value: str


async def _run_snmpwalk(args: list[str], timeout_ms: int) -> str:
    _check_tool()
    timeout_s = max(1.0, timeout_ms / 1000)
    log.debug("snmpwalk %s", _redact(args[1:]))
    try:
        proc = await asyncio.create_subprocess_exec(
            args[0], *args[1:],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise AgentException(ErrorCode.TOOL_MISSING, "snmpwalk non eseguibile", details={"tool": "snmpwalk"}) from exc
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_s + 5)
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise AgentException(ErrorCode.TIMEOUT, f"snmpwalk timeout dopo {timeout_s:.0f}s") from exc
    stdout = stdout_b.decode("utf-8", errors="replace")
    stderr = stderr_b.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0:
        # Caso comune: timeout side, host unreachable, auth fail
        lower = stderr.lower()
        if "timeout" in lower or "no response" in lower:
            raise AgentException(ErrorCode.TIMEOUT, f"SNMP no response: {stderr[:200]}")
        if "authentication" in lower or "authorizationerror" in lower:
            raise AgentException(ErrorCode.AUTH_INVALID, f"SNMP auth fallita: {stderr[:200]}")
        raise AgentException(ErrorCode.TARGET_UNREACHABLE, f"snmpwalk exit {proc.returncode}: {stderr[:200]}")
    return stdout


def _parse_walk(stdout: str) -> list[SnmpRow]:
    """Parse output ``snmpwalk -Oqn``. Una riga per OID; format::

        .1.3.6.1.2.1.1.1.0 STRING: "Hello"
        .1.3.6.1.2.1.4.22.1.2.5.10.0.0.1 Hex-STRING: AA BB CC DD EE FF

    Le righe ``noSuchObject``/``noSuchInstance``/``endOfMibView`` vengono saltate.
    """

    out: list[SnmpRow] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        if "no such object" in line.lower() or "no such instance" in line.lower() or "end of mib" in line.lower():
            continue
        if " " not in line:
            continue
        oid, rest = line.split(" ", 1)
        oid = oid.lstrip(".")
        type_name = "value"
        value = rest
        if ":" in rest:
            head, _, tail = rest.partition(":")
            if head and " " not in head:
                type_name = head.strip()
                value = tail.strip()
        out.append(SnmpRow(oid=oid, type=type_name, value=value))
    return out


async def snmp_walk(
    *,
    host: str,
    community: str | None,
    oid: str,
    version: str = "2c",
    timeout_ms: int = 10_000,
    v3: dict[str, str] | None = None,
) -> list[SnmpRow]:
    args = _build_args(
        host=host, community=community, version=version, oid=oid,
        timeout_ms=timeout_ms, v3=v3, compact_value=False,
    )
    stdout = await _run_snmpwalk(args, timeout_ms)
    return _parse_walk(stdout)


# ──────────────────────────────────────────────────────────────────────────
# Route discovery
# ──────────────────────────────────────────────────────────────────────────


_SKIP_NETS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("224.0.0.0/4"),
]


def _is_filterable_cidr(cidr: ipaddress.IPv4Network) -> bool:
    """True se va scartato (loopback, link-local, multicast, /32, /0)."""

    if cidr.prefixlen in (0, 32):
        return True
    for net in _SKIP_NETS:
        if cidr.network_address in net or cidr.broadcast_address in net:
            return True
    return False


def _parse_ip_addr_table(rows: list[SnmpRow]) -> set[str]:
    """Da ipAddrTable.ipAdEntNetMask (OID 1.3.6.1.2.1.4.20.1.3.A.B.C.D = mask)
    deriva il CIDR dell'interfaccia. La parte index dell'OID è l'IP locale
    dell'interfaccia."""

    cidrs: set[str] = set()
    for row in rows:
        if not row.oid.startswith(OID_IP_ADDR_NETMASK + "."):
            continue
        ip_index = row.oid[len(OID_IP_ADDR_NETMASK) + 1:]
        try:
            iface_ip = ipaddress.IPv4Address(ip_index)
            mask = ipaddress.IPv4Address(row.value.strip().strip('"'))
        except (ipaddress.AddressValueError, ValueError):
            continue
        prefix = bin(int(mask)).count("1")
        if prefix == 0:
            continue
        try:
            cidr = ipaddress.IPv4Network((int(iface_ip) & int(mask), prefix), strict=False)
        except ValueError:
            continue
        if not _is_filterable_cidr(cidr):
            cidrs.add(str(cidr))
    return cidrs


def _parse_ip_cidr_route(dest_rows: list[SnmpRow], mask_rows: list[SnmpRow]) -> set[str]:
    """Combina ipCidrRouteDest + ipCidrRouteMask. L'OID index è
    DEST.MASK.TOS.NEXTHOP — basta usare DEST e MASK dai value, l'index
    serve solo a pairare le due tabelle (stesso suffisso post-OID base)."""

    dest_by_index: dict[str, str] = {}
    for row in dest_rows:
        if not row.oid.startswith(OID_IP_CIDR_ROUTE_DEST + "."):
            continue
        idx = row.oid[len(OID_IP_CIDR_ROUTE_DEST) + 1:]
        dest_by_index[idx] = row.value.strip().strip('"')

    cidrs: set[str] = set()
    for row in mask_rows:
        if not row.oid.startswith(OID_IP_CIDR_ROUTE_MASK + "."):
            continue
        idx = row.oid[len(OID_IP_CIDR_ROUTE_MASK) + 1:]
        dest_val = dest_by_index.get(idx)
        if dest_val is None:
            continue
        try:
            dest = ipaddress.IPv4Address(dest_val)
            mask = ipaddress.IPv4Address(row.value.strip().strip('"'))
        except (ipaddress.AddressValueError, ValueError):
            continue
        prefix = bin(int(mask)).count("1")
        try:
            cidr = ipaddress.IPv4Network((int(dest) & int(mask), prefix), strict=False)
        except ValueError:
            continue
        if not _is_filterable_cidr(cidr):
            cidrs.add(str(cidr))
    return cidrs


async def snmp_routes(
    *,
    router_ip: str,
    community: str,
    version: str = "2c",
    timeout_ms: int = 15_000,
) -> list[dict[str, str]]:
    """Polla in parallelo ipAddrTable + ipCidrRouteTable. Entrambi
    best-effort: se uno fallisce, l'altro contribuisce comunque."""

    async def _walk(oid: str) -> list[SnmpRow]:
        try:
            return await snmp_walk(
                host=router_ip, community=community, oid=oid,
                version=version, timeout_ms=timeout_ms,
            )
        except AgentException as e:
            log.warning("snmp-routes walk %s fallito: %s", oid, e.message)
            return []

    addr_task = _walk(OID_IP_ADDR_TABLE)
    dest_task = _walk(OID_IP_CIDR_ROUTE_DEST)
    mask_task = _walk(OID_IP_CIDR_ROUTE_MASK)
    addr_rows, dest_rows, mask_rows = await asyncio.gather(addr_task, dest_task, mask_task)

    cidrs_addr = _parse_ip_addr_table(addr_rows)
    cidrs_route = _parse_ip_cidr_route(dest_rows, mask_rows)

    out: list[dict[str, str]] = []
    for c in sorted(cidrs_addr):
        out.append({"cidr": c, "source": "ipAddrTable"})
    for c in sorted(cidrs_route):
        if c in cidrs_addr:
            continue  # dedup: già emesso da ipAddrTable
        out.append({"cidr": c, "source": "ipCidrRouteTable"})
    return out
