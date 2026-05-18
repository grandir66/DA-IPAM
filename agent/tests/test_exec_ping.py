"""Test dell'executor ping. Richiede ``ping`` nel PATH (presente di default
su macOS/Linux). Su CI senza connettività i risultati per IP esterni saranno
``alive=False`` — il test rimane comunque verde perché controlla la struttura.
"""

from __future__ import annotations

import pytest

from da_invent_agent.exec.ping import ping_one, ping_sweep


@pytest.mark.asyncio
async def test_ping_one_su_localhost_struttura() -> None:
    result = await ping_one("127.0.0.1", timeout_ms=1500)
    assert result.ip == "127.0.0.1"
    assert isinstance(result.alive, bool)


@pytest.mark.asyncio
async def test_ping_one_indirizzo_non_routabile_non_solleva() -> None:
    # IP TEST-NET-1 (RFC 5737): non deve mai rispondere.
    result = await ping_one("192.0.2.1", timeout_ms=500)
    assert result.ip == "192.0.2.1"
    assert result.alive is False


@pytest.mark.asyncio
async def test_ping_sweep_preserva_lista_ip() -> None:
    ips = ["127.0.0.1", "192.0.2.1"]
    results = await ping_sweep(ips, concurrency=2)
    assert {r.ip for r in results} == set(ips)
