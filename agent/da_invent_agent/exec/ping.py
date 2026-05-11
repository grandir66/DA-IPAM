"""Implementazione ping: wrapper non-privilegiato sopra il comando di sistema.

Specchio funzionale di ``src/lib/scanner/ping.ts``. La differenza di sintassi
di ``-W`` (millisecondi su macOS, secondi su Linux) è rispettata.
"""

from __future__ import annotations

import asyncio
import platform
import re
import time

from ..models import PingResult


_TTL_RE = re.compile(r"ttl[=\s]+(\d+)", re.IGNORECASE)


def _build_args(ip: str, timeout_ms: int) -> list[str]:
    is_mac = platform.system() == "Darwin"
    timeout_sec = max(1, (timeout_ms + 999) // 1000)
    if is_mac:
        return ["-c", "1", "-W", str(timeout_ms), ip]
    return ["-c", "1", "-W", str(timeout_sec), ip]


async def ping_one(ip: str, timeout_ms: int = 2000) -> PingResult:
    args = _build_args(ip, timeout_ms)
    start = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=(timeout_ms + 1000) / 1000)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return PingResult(ip=ip, alive=False)
        elapsed_ms = (time.monotonic() - start) * 1000
        if proc.returncode != 0:
            return PingResult(ip=ip, alive=False)
        combined = (stdout_b.decode("utf-8", errors="replace") + "\n" + stderr_b.decode("utf-8", errors="replace"))
        ttl_match = _TTL_RE.search(combined)
        ttl = int(ttl_match.group(1)) if ttl_match else None
        return PingResult(ip=ip, alive=True, latency_ms=round(elapsed_ms, 2), ttl=ttl)
    except FileNotFoundError:
        # `ping` non disponibile (immagine minimale): non degradare in errore generico
        return PingResult(ip=ip, alive=False)
    except OSError:
        return PingResult(ip=ip, alive=False)


async def ping_sweep(ips: list[str], concurrency: int = 50) -> list[PingResult]:
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _bounded(ip: str) -> PingResult:
        async with sem:
            return await ping_one(ip)

    return await asyncio.gather(*(_bounded(ip) for ip in ips))
