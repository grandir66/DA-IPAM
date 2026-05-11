"""FastAPI app dell'agente DA-INVENT.

In produzione viene avviato da systemd via ``uvicorn`` (vedi
``agent/scripts/da-invent-agent.service``). In dev:

    cd agent
    DA_INVENT_AGENT_DEV_MODE=true \\
        DA_INVENT_AGENT_TOKEN_HASH='$2b$10$...' \\
        uvicorn da_invent_agent.main:app --reload --port 8443

Lo startup verifica la presenza di ``tailscale0`` quando ``dev_mode`` è
disattivato: rifiutarsi di partire è preferibile al binding accidentale su
una NIC pubblica.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI

from . import __version__
from .auth import require_bearer
from .config import Settings, get_settings
from .exec import dns as exec_dns
from .exec import nmap as exec_nmap
from .exec import ping as exec_ping
from .models import (
    DnsBatchEntry,
    DnsBatchRequest,
    DnsForwardRequest,
    DnsResolution,
    DnsReverseRequest,
    HealthCheckResult,
    NmapDiscoverHostsRequest,
    NmapPortScanRequest,
    NmapResult,
    PingRequest,
    PingResult,
    PingSweepRequest,
)


log = logging.getLogger(__name__)


def _tailscale_available() -> bool:
    """Heuristic: la presenza di ``/sys/class/net/tailscale0`` indica un
    daemon Tailscale attivo. Niente shell-out a ``tailscale status`` qui
    per non aggiungere dipendenze esterne in startup path.
    """

    return Path("/sys/class/net/tailscale0").exists()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001 — firma richiesta da FastAPI
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    if not settings.dev_mode and not _tailscale_available():
        log.error("tailscale0 non disponibile e dev_mode=false — rifiuto avvio.")
        raise SystemExit(2)

    if not settings.token_hash.get_secret_value():
        log.warning("token_hash non configurato: tutte le route protette risponderanno 401.")

    log.info("DA-INVENT agent v%s pronto su porta %s (dev_mode=%s)", __version__, settings.port, settings.dev_mode)
    yield
    log.info("Shutdown agente.")


app = FastAPI(
    title="DA-INVENT Agent",
    version=__version__,
    lifespan=lifespan,
)


# ─────────────────────────────────────────────────────────────────────────────
# Public endpoints
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/healthz", response_model=HealthCheckResult)
async def healthz() -> HealthCheckResult:
    return HealthCheckResult(ok=True, version=__version__, mode="remote")


@app.get("/version")
async def version() -> dict[str, str]:
    return {"version": __version__}


# ─────────────────────────────────────────────────────────────────────────────
# Protected exec endpoints
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/exec/ping", response_model=PingResult, dependencies=[Depends(require_bearer)])
async def exec_ping_one(payload: PingRequest) -> PingResult:
    return await exec_ping.ping_one(payload.ip, payload.timeout_ms)


@app.post("/exec/ping-sweep", response_model=list[PingResult], dependencies=[Depends(require_bearer)])
async def exec_ping_sweep(payload: PingSweepRequest) -> list[PingResult]:
    return await exec_ping.ping_sweep(payload.ips, payload.concurrency)


@app.post("/exec/nmap-discover", response_model=list[NmapResult], dependencies=[Depends(require_bearer)])
async def exec_nmap_discover(payload: NmapDiscoverHostsRequest) -> list[NmapResult]:
    return await exec_nmap.discover_hosts(payload.target, payload.timeout_ms)


@app.post("/exec/nmap-port-scan", response_model=NmapResult | None, dependencies=[Depends(require_bearer)])
async def exec_nmap_port_scan(payload: NmapPortScanRequest) -> NmapResult | None:
    return await exec_nmap.port_scan(
        payload.ip,
        custom_args=payload.custom_args,
        timeout_ms=payload.timeout_ms,
        skip_udp=payload.skip_udp,
        udp_ports=payload.udp_ports,
    )


@app.post("/exec/dns-reverse", response_model=DnsResolution, dependencies=[Depends(require_bearer)])
async def exec_dns_reverse(payload: DnsReverseRequest) -> DnsResolution:
    reverse = await exec_dns.reverse_dns(payload.ip, payload.dns_server, payload.timeout_ms)
    return DnsResolution(reverse=reverse, forward=None)


@app.post("/exec/dns-forward", response_model=list[str], dependencies=[Depends(require_bearer)])
async def exec_dns_forward(payload: DnsForwardRequest) -> list[str]:
    return await exec_dns.forward_dns(payload.hostname, payload.dns_server, payload.timeout_ms)


@app.post("/exec/dns-batch", response_model=list[DnsBatchEntry], dependencies=[Depends(require_bearer)])
async def exec_dns_batch(payload: DnsBatchRequest) -> list[DnsBatchEntry]:
    return await exec_dns.resolve_batch(payload.ips, payload.dns_server, payload.concurrency)


# ─────────────────────────────────────────────────────────────────────────────
# Entrypoint (utile per `da-invent-agent` script o tooling)
# ─────────────────────────────────────────────────────────────────────────────


def run() -> None:  # pragma: no cover — invocato da entry-point
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
