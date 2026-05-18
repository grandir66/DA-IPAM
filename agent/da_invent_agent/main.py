"""FastAPI app dell'agente DA-INVENT.

In produzione viene avviato da systemd via ``uvicorn`` (vedi
``agent/scripts/da-invent-agent.service``). In dev:

    cd agent
    DA_INVENT_AGENT_DEV_MODE=true \\
        DA_INVENT_AGENT_TOKENS='[{"label":"dev","token_hash":"$2b$10$...","scopes":["exec:network","exec:device","admin:update"]}]' \\
        uvicorn da_invent_agent.main:app --reload --port 8443

Lo startup verifica la presenza di ``tailscale0`` quando ``dev_mode`` è
disattivato: rifiutarsi di partire è preferibile al binding accidentale su
una NIC pubblica. Logghiamo un warning se uno dei tool di sistema attesi
(nmap, snmpwalk, ssh) manca, ma non blocchiamo l'avvio.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import __version__
from .auth import require_bearer, require_scope
from .config import Settings, TokenEntry, get_settings
from .errors import AgentException, ErrorCode, agent_exception_handler, envelope
from .exec import arp as exec_arp
from .exec import dns as exec_dns
from .exec import nmap as exec_nmap
from .exec import ping as exec_ping
from .exec import snmp as exec_snmp
from .exec import ssh as exec_ssh
from .exec import winrm as exec_winrm
from .models import (
    ArpEntry,
    ArpPollRequest,
    ArpPollResponse,
    DnsBatchEntry,
    DnsBatchRequest,
    DnsForwardRequest,
    DnsResolution,
    DnsReverseRequest,
    ExecResult,
    HealthCheckResult,
    NetworkStatus,
    NmapDiscoverHostsRequest,
    NmapPortScanRequest,
    NmapResult,
    PingRequest,
    PingResult,
    PingSweepRequest,
    SnmpRoute,
    SnmpRoutesRequest,
    SnmpWalkRequest,
    SnmpWalkRow,
    SshExecRequest,
    ToolsAvailability,
    TruncatedFlags,
    WhoamiResponse,
    WinrmExecRequest,
    WinrmExecResult,
    reveal_ssh_auth,
    reveal_v3,
    reveal_winrm_auth,
)
from .scopes import Scope
from .system_probe import probe_network, probe_tools


log = logging.getLogger(__name__)


def _tailscale_available() -> bool:
    return Path("/sys/class/net/tailscale0").exists()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    if not settings.dev_mode and not _tailscale_available():
        log.error("tailscale0 non disponibile e dev_mode=false — rifiuto avvio.")
        raise SystemExit(2)

    if not settings.tokens:
        log.warning("Nessun token configurato in DA_INVENT_AGENT_TOKENS — le route protette risponderanno 401.")
    else:
        log.info("Token configurati: %s", ", ".join(t.label for t in settings.tokens))

    tools = probe_tools(use_cache=False)
    for name, present in (("nmap", tools.nmap), ("snmpwalk", tools.snmpwalk), ("ping", tools.ping), ("ssh", tools.ssh)):
        if not present:
            log.warning("Tool '%s' non trovato nel PATH: gli endpoint che lo richiedono restituiranno 503 tool_missing.", name)

    log.info("DA-INVENT agent v%s pronto su porta %s (dev_mode=%s)", __version__, settings.port, settings.dev_mode)
    yield
    log.info("Shutdown agente.")


app = FastAPI(
    title="DA-INVENT Agent",
    version=__version__,
    lifespan=lifespan,
)


# ─────────────────────────────────────────────────────────────────────────────
# Error handlers
# ─────────────────────────────────────────────────────────────────────────────


app.add_exception_handler(AgentException, agent_exception_handler)  # type: ignore[arg-type]


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:  # noqa: ARG001
    return JSONResponse(
        status_code=400,
        content=envelope(ErrorCode.INVALID_INPUT, "Validazione richiesta fallita", details=exc.errors()),
    )


@app.exception_handler(Exception)
async def _internal_handler(request: Request, exc: Exception) -> JSONResponse:  # noqa: ARG001
    log.exception("Errore non gestito su %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content=envelope(ErrorCode.INTERNAL, "Errore interno dell'agente"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public endpoints
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/healthz", response_model=HealthCheckResult)
async def healthz() -> HealthCheckResult:
    tools = probe_tools()
    network = probe_network()
    return HealthCheckResult(
        ok=True,
        version=__version__,
        mode="remote",
        tools=ToolsAvailability(nmap=tools.nmap, snmpwalk=tools.snmpwalk, ping=tools.ping, ssh=tools.ssh),
        network=NetworkStatus(tailscale=network.tailscale, tailscale_ip=network.tailscale_ip),
    )


@app.get("/version")
async def version() -> dict[str, str]:
    return {"version": __version__}


# ─────────────────────────────────────────────────────────────────────────────
# Whoami (autenticato, qualunque scope)
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/whoami", response_model=WhoamiResponse)
async def whoami(
    token: TokenEntry = Depends(require_bearer),
    settings: Settings = Depends(get_settings),
) -> WhoamiResponse:
    return WhoamiResponse(
        label=token.label,
        scopes=list(token.scopes),
        tenant_code=settings.tenant_code,
    )


# ─────────────────────────────────────────────────────────────────────────────
# exec:network — read-only network ops
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/exec/ping", response_model=PingResult, dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_ping_one(payload: PingRequest) -> PingResult:
    return await exec_ping.ping_one(payload.ip, payload.timeout_ms)


@app.post("/exec/ping-sweep", response_model=list[PingResult], dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_ping_sweep(payload: PingSweepRequest) -> list[PingResult]:
    return await exec_ping.ping_sweep(payload.ips, payload.concurrency)


@app.post("/exec/nmap-discover", response_model=list[NmapResult], dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_nmap_discover(payload: NmapDiscoverHostsRequest) -> list[NmapResult]:
    return await exec_nmap.discover_hosts(payload.target, payload.timeout_ms)


@app.post("/exec/nmap-port-scan", response_model=NmapResult | None, dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_nmap_port_scan(payload: NmapPortScanRequest) -> NmapResult | None:
    return await exec_nmap.port_scan(
        payload.ip,
        custom_args=payload.custom_args,
        timeout_ms=payload.timeout_ms,
        skip_udp=payload.skip_udp,
        udp_ports=payload.udp_ports,
    )


@app.post("/exec/dns-reverse", response_model=DnsResolution, dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_dns_reverse(payload: DnsReverseRequest) -> DnsResolution:
    reverse = await exec_dns.reverse_dns(payload.ip, payload.dns_server, payload.timeout_ms)
    return DnsResolution(reverse=reverse, forward=None)


@app.post("/exec/dns-forward", response_model=list[str], dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_dns_forward(payload: DnsForwardRequest) -> list[str]:
    return await exec_dns.forward_dns(payload.hostname, payload.dns_server, payload.timeout_ms)


@app.post("/exec/dns-batch", response_model=list[DnsBatchEntry], dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_dns_batch(payload: DnsBatchRequest) -> list[DnsBatchEntry]:
    return await exec_dns.resolve_batch(payload.ips, payload.dns_server, payload.concurrency)


@app.post("/exec/snmp-walk", response_model=list[SnmpWalkRow], dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_snmp_walk(payload: SnmpWalkRequest) -> list[SnmpWalkRow]:
    rows = await exec_snmp.snmp_walk(
        host=payload.host,
        community=payload.community.get_secret_value() if payload.community else None,
        oid=payload.oid,
        version=payload.version,
        timeout_ms=payload.timeout_ms,
        v3=reveal_v3(payload.v3),
    )
    return [SnmpWalkRow(oid=r.oid, type=r.type, value=r.value) for r in rows]


@app.post("/exec/arp-poll", response_model=ArpPollResponse, dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_arp_poll(payload: ArpPollRequest) -> ArpPollResponse:
    result = await exec_arp.arp_poll(
        router_ip=payload.router_ip,
        community=payload.community.get_secret_value(),
        version=payload.version,
        timeout_ms=payload.timeout_ms,
    )
    return ArpPollResponse(
        entries=[ArpEntry(**e) for e in result["entries"]],  # type: ignore[arg-type]
        raw_lines=result["raw_lines"],  # type: ignore[arg-type]
        duration_ms=result["duration_ms"],  # type: ignore[arg-type]
    )


@app.post("/exec/snmp-routes", response_model=list[SnmpRoute], dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
async def exec_snmp_routes(payload: SnmpRoutesRequest) -> list[SnmpRoute]:
    rows = await exec_snmp.snmp_routes(
        router_ip=payload.router_ip,
        community=payload.community.get_secret_value(),
        version=payload.version,
        timeout_ms=payload.timeout_ms,
    )
    return [SnmpRoute(**r) for r in rows]  # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────────────────────
# exec:device — esecuzione comandi remoti
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/exec/ssh-exec", response_model=ExecResult, dependencies=[Depends(require_scope(Scope.EXEC_DEVICE))])
async def exec_ssh_run(payload: SshExecRequest) -> ExecResult:
    result = await exec_ssh.ssh_exec(
        host=payload.host,
        port=payload.port,
        user=payload.user,
        auth=reveal_ssh_auth(payload.auth),
        command=payload.command,
        timeout_ms=payload.timeout_ms,
    )
    return ExecResult(
        stdout=result["stdout"],
        stderr=result["stderr"],
        exit_code=result["exit_code"],
        duration_ms=result["duration_ms"],
        truncated=TruncatedFlags(**result["truncated"]),
    )


@app.post("/exec/winrm-exec", response_model=WinrmExecResult, dependencies=[Depends(require_scope(Scope.EXEC_DEVICE))])
async def exec_winrm_run(payload: WinrmExecRequest) -> WinrmExecResult:
    result = await exec_winrm.winrm_exec(
        host=payload.host,
        port=payload.port,
        user=payload.user,
        auth=reveal_winrm_auth(payload.auth),
        command=payload.command,
        use_powershell=payload.use_powershell,
        realm=payload.realm,
        transport=payload.transport,
        timeout_ms=payload.timeout_ms,
    )
    return WinrmExecResult(
        stdout=result["stdout"],
        stderr=result["stderr"],
        exit_code=result["exit_code"],
        duration_ms=result["duration_ms"],
        transport_used=result["transport_used"],
        truncated=TruncatedFlags(**result["truncated"]),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────────────────────────────────────


def run() -> None:  # pragma: no cover
    import uvicorn

    settings: Settings = get_settings()
    uvicorn.run(
        "da_invent_agent.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":  # pragma: no cover
    run()
