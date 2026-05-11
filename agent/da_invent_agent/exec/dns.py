"""Risoluzione DNS: reverse, forward, batch.

Per Phase 2 usiamo ``socket.getaddrinfo`` e ``socket.gethostbyaddr``: forniscono
risoluzione tramite resolver di sistema (configurabile via ``/etc/resolv.conf``).
Per il routing verso un DNS server specifico useremo ``aiodns`` in Phase 3 — qui
ignoriamo per ora il parametro ``dns_server`` e logghiamo un warning.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from typing import Awaitable, Callable, TypeVar

from ..models import DnsBatchEntry, DnsResolution


log = logging.getLogger(__name__)

T = TypeVar("T")


async def _to_thread_with_timeout(fn: Callable[[], T], timeout_ms: int) -> T | None:
    timeout_s = max(0.2, timeout_ms / 1000)
    try:
        return await asyncio.wait_for(asyncio.to_thread(fn), timeout=timeout_s)
    except (asyncio.TimeoutError, OSError):
        return None


async def reverse_dns(ip: str, dns_server: str | None = None, timeout_ms: int = 2500) -> str | None:
    if dns_server:
        log.warning("dns_server custom non supportato in Phase 2 — uso il resolver di sistema")

    def _resolve() -> str | None:
        try:
            hostname, _, _ = socket.gethostbyaddr(ip)
            return hostname or None
        except (socket.herror, socket.gaierror):
            return None

    return await _to_thread_with_timeout(_resolve, timeout_ms)


async def forward_dns(hostname: str, dns_server: str | None = None, timeout_ms: int = 2500) -> list[str]:
    if dns_server:
        log.warning("dns_server custom non supportato in Phase 2 — uso il resolver di sistema")

    def _resolve() -> list[str]:
        try:
            infos = socket.getaddrinfo(hostname, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
        except (socket.gaierror, OSError):
            return []
        out: list[str] = []
        for info in infos:
            addr = info[4][0]
            if addr not in out:
                out.append(addr)
        return out

    result = await _to_thread_with_timeout(_resolve, timeout_ms)
    return result or []


async def resolve_batch(
    ips: list[str],
    dns_server: str | None = None,
    concurrency: int = 16,
) -> list[DnsBatchEntry]:
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(ip: str) -> DnsBatchEntry:
        async with sem:
            reverse = await reverse_dns(ip, dns_server)
            forward: str | None = None
            if reverse:
                addresses = await forward_dns(reverse, dns_server)
                forward = addresses[0] if addresses else None
            return DnsBatchEntry(ip=ip, resolution=DnsResolution(reverse=reverse, forward=forward))

    return await asyncio.gather(*(_one(ip) for ip in ips))
