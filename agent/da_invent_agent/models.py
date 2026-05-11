"""Pydantic models — speculari ai TypeScript types in ``src/lib/executor/types.ts``.

Ogni modifica qui DEVE essere rispecchiata lato hub e viceversa: l'agente e
l'hub comunicano via JSON e devono concordare sui campi.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, SecretStr


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────


class ToolsAvailability(BaseModel):
    nmap: bool
    snmpwalk: bool
    ping: bool
    ssh: bool


class NetworkStatus(BaseModel):
    tailscale: bool
    tailscale_ip: str | None = None


class HealthCheckResult(BaseModel):
    ok: bool
    version: str | None = None
    mode: Literal["local", "remote"] = "remote"
    error: str | None = None
    tools: ToolsAvailability | None = None
    network: NetworkStatus | None = None


class WhoamiResponse(BaseModel):
    label: str
    scopes: list[str]
    tenant_code: str


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


# ─────────────────────────────────────────────────────────────────────────────
# SNMP
# ─────────────────────────────────────────────────────────────────────────────


SnmpVersion = Literal["1", "2c", "3"]


class SnmpV3Credentials(BaseModel):
    security_name: str
    auth_protocol: str | None = None
    auth_password: SecretStr | None = None
    priv_protocol: str | None = None
    priv_password: SecretStr | None = None


class SnmpWalkRequest(BaseModel):
    host: str
    community: SecretStr | None = None
    oid: str
    version: SnmpVersion = "2c"
    v3: SnmpV3Credentials | None = None
    timeout_ms: int = Field(default=10_000, ge=500, le=120_000)


class SnmpWalkRow(BaseModel):
    oid: str
    type: str
    value: str


class ArpPollRequest(BaseModel):
    router_ip: str
    community: SecretStr
    version: SnmpVersion = "2c"
    timeout_ms: int = Field(default=10_000, ge=500, le=120_000)


class ArpEntry(BaseModel):
    ip: str
    mac: str


class ArpPollResponse(BaseModel):
    entries: list[ArpEntry]
    raw_lines: list[str]
    duration_ms: int


class SnmpRoutesRequest(BaseModel):
    router_ip: str
    community: SecretStr
    version: SnmpVersion = "2c"
    timeout_ms: int = Field(default=15_000, ge=500, le=120_000)


class SnmpRoute(BaseModel):
    cidr: str
    source: Literal["ipAddrTable", "ipCidrRouteTable"]


# ─────────────────────────────────────────────────────────────────────────────
# SSH / WinRM exec
# ─────────────────────────────────────────────────────────────────────────────


class SshPasswordAuth(BaseModel):
    type: Literal["password"]
    password: SecretStr


class SshKeyAuth(BaseModel):
    type: Literal["key"]
    private_key_pem: SecretStr
    passphrase: SecretStr | None = None


SshAuth = SshPasswordAuth | SshKeyAuth


class SshExecRequest(BaseModel):
    host: str
    port: int = Field(default=22, ge=1, le=65535)
    user: str
    auth: SshAuth
    command: str
    timeout_ms: int = Field(default=30_000, ge=500, le=600_000)


class TruncatedFlags(BaseModel):
    stdout: bool = False
    stderr: bool = False


class ExecResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    truncated: TruncatedFlags


class WinrmExecRequest(BaseModel):
    host: str
    port: int | None = Field(default=None, ge=1, le=65535)
    user: str
    auth: SshPasswordAuth
    command: str
    use_powershell: bool = True
    realm: str | None = None
    transport: Literal["auto", "kerberos", "ntlm", "credssp", "basic"] | None = None
    timeout_ms: int = Field(default=60_000, ge=1_000, le=900_000)


class WinrmExecResult(ExecResult):
    transport_used: str


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — conversioni to-dict per passare i SecretStr alle exec primitives
# ─────────────────────────────────────────────────────────────────────────────


def reveal_v3(creds: SnmpV3Credentials | None) -> dict[str, str] | None:
    if creds is None:
        return None
    out: dict[str, str] = {"security_name": creds.security_name}
    if creds.auth_protocol:
        out["auth_protocol"] = creds.auth_protocol
    if creds.auth_password:
        out["auth_password"] = creds.auth_password.get_secret_value()
    if creds.priv_protocol:
        out["priv_protocol"] = creds.priv_protocol
    if creds.priv_password:
        out["priv_password"] = creds.priv_password.get_secret_value()
    return out


def reveal_ssh_auth(auth: SshAuth) -> dict[str, Any]:
    if isinstance(auth, SshPasswordAuth):
        return {"type": "password", "password": auth.password.get_secret_value()}
    return {
        "type": "key",
        "private_key_pem": auth.private_key_pem.get_secret_value(),
        "passphrase": auth.passphrase.get_secret_value() if auth.passphrase else None,
    }


def reveal_winrm_auth(auth: SshPasswordAuth) -> dict[str, Any]:
    return {"type": "password", "password": auth.password.get_secret_value()}
