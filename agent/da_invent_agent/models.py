"""Pydantic models — speculari ai TypeScript types in ``src/lib/executor/types.ts``.

Ogni modifica qui DEVE essere rispecchiata lato hub e viceversa: l'agente e
l'hub comunicano via JSON e devono concordare sui campi.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────


class HealthCheckResult(BaseModel):
    ok: bool
    version: str | None = None
    mode: Literal["local", "remote"] = "remote"
    error: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Ping
# ─────────────────────────────────────────────────────────────────────────────


class PingResult(BaseModel):
    ip: str
    alive: bool
    latency_ms: float | None = None
    ttl: int | None = None


class PingRequest(BaseModel):
    ip: str
    timeout_ms: int = Field(default=2000, ge=100, le=60_000)


class PingSweepRequest(BaseModel):
    ips: list[str] = Field(min_length=1)
    concurrency: int = Field(default=50, ge=1, le=256)


# ─────────────────────────────────────────────────────────────────────────────
# Nmap
# ─────────────────────────────────────────────────────────────────────────────


class NmapPort(BaseModel):
    port: int
    protocol: str
    state: str
    service: str | None = None
    product: str | None = None
    version: str | None = None


class NmapResult(BaseModel):
    ip: str
    alive: bool
    ports: list[NmapPort] = Field(default_factory=list)
    os: str | None = None
    mac: str | None = None


class NmapDiscoverHostsRequest(BaseModel):
    target: str
    timeout_ms: int = Field(default=90_000, ge=1_000, le=900_000)


class NmapPortScanRequest(BaseModel):
    ip: str
    custom_args: str | None = None
    timeout_ms: int = Field(default=280_000, ge=1_000, le=900_000)
    skip_udp: bool = False
    udp_ports: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# DNS
# ─────────────────────────────────────────────────────────────────────────────


class DnsReverseRequest(BaseModel):
    ip: str
    dns_server: str | None = None
    timeout_ms: int = Field(default=2500, ge=200, le=30_000)


class DnsForwardRequest(BaseModel):
    hostname: str
    dns_server: str | None = None
    timeout_ms: int = Field(default=2500, ge=200, le=30_000)


class DnsResolution(BaseModel):
    reverse: str | None = None
    forward: str | None = None


class DnsBatchRequest(BaseModel):
    ips: list[str] = Field(min_length=1)
    dns_server: str | None = None
    concurrency: int = Field(default=16, ge=1, le=64)


class DnsBatchEntry(BaseModel):
    ip: str
    resolution: DnsResolution
