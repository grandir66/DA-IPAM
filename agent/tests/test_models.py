"""Test di serializzazione dei modelli pydantic — assicura che restino allineati
con i type TypeScript dell'hub (``src/lib/executor/types.ts``).
"""

from __future__ import annotations

from da_invent_agent.models import (
    DnsBatchEntry,
    DnsResolution,
    HealthCheckResult,
    NmapPort,
    NmapResult,
    PingResult,
)


def test_ping_result_serializza_campi_minimi() -> None:
    pr = PingResult(ip="10.0.0.1", alive=False)
    payload = pr.model_dump()
    assert payload == {"ip": "10.0.0.1", "alive": False, "latency_ms": None, "ttl": None}


def test_ping_result_round_trip_con_latency() -> None:
    pr = PingResult(ip="10.0.0.1", alive=True, latency_ms=1.23, ttl=64)
    parsed = PingResult.model_validate(pr.model_dump())
    assert parsed == pr


def test_nmap_result_default_ports_vuoto() -> None:
    nr = NmapResult(ip="10.0.0.1", alive=True)
    assert nr.ports == []


def test_nmap_port_richiede_campi_obbligatori() -> None:
    p = NmapPort(port=22, protocol="tcp", state="open")
    assert p.service is None
    assert p.product is None


def test_health_check_serializza_mode() -> None:
    h = HealthCheckResult(ok=True, version="0.1.0", mode="remote")
    assert h.model_dump()["mode"] == "remote"


def test_dns_batch_entry_nested_resolution() -> None:
    e = DnsBatchEntry(ip="10.0.0.1", resolution=DnsResolution(reverse="host.local", forward="10.0.0.1"))
    assert e.model_dump() == {
        "ip": "10.0.0.1",
        "resolution": {"reverse": "host.local", "forward": "10.0.0.1"},
    }
