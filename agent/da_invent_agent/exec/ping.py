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


def _errore_uscita(returncode: int | None) -> str | None:
    """Codice di uscita ≠0 letto per piattaforma, come ``classifyPingError``.

    «Nessuna risposta» è 1 su Linux (iputils) e 2 su macOS; ogni altro codice
    è un errore del ping (es. il 2 di iputils, permessi) → esito sconosciuto.
    Un codice negativo è un segnale arrivato da fuori: anche quello sconosciuto.
    """
    nessuna_risposta = 2 if platform.system() == "Darwin" else 1
    if returncode == nessuna_risposta:
        return None
    if returncode is not None and returncode < 0:
        return f"ping terminato da segnale {-returncode}"
    return f"ping uscito con codice {returncode}"


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
            # Timeout nostro: equivale al `killed` di execFile, nessuna risposta.
            proc.kill()
            await proc.wait()
            return PingResult(ip=ip, alive=False)
        elapsed_ms = (time.monotonic() - start) * 1000
        if proc.returncode != 0:
            return PingResult(ip=ip, alive=False, error=_errore_uscita(proc.returncode))
        combined = (stdout_b.decode("utf-8", errors="replace") + "\n" + stderr_b.decode("utf-8", errors="replace"))
        ttl_match = _TTL_RE.search(combined)
        ttl = int(ttl_match.group(1)) if ttl_match else None
        return PingResult(ip=ip, alive=True, latency_ms=round(elapsed_ms, 2), ttl=ttl)
    except FileNotFoundError:
        # `ping` non disponibile (immagine minimale): esito sconosciuto
        return PingResult(ip=ip, alive=False, error="ping non eseguibile (ENOENT)")
    except OSError as exc:
        return PingResult(ip=ip, alive=False, error=f"ping non eseguibile ({type(exc).__name__})")


async def ping_sweep(ips: list[str], concurrency: int = 50) -> list[PingResult]:
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _bounded(ip: str) -> PingResult:
        async with sem:
            return await ping_one(ip)

    return await asyncio.gather(*(_bounded(ip) for ip in ips))
