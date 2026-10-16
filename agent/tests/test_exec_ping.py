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


# Tre esiti come in src/lib/scanner/ping.ts (T3-19, INV-2): un ping che non può
# girare porta `error` e la discovery non spegne l'host.
from da_invent_agent.exec import ping as ping_mod  # noqa: E402


class _ProcFinto:
    def __init__(self, returncode: int) -> None:
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"", b""


def _con_uscita(monkeypatch: pytest.MonkeyPatch, returncode: int, sistema: str) -> None:
    async def finto(*_a, **_k):
        return _ProcFinto(returncode)

    monkeypatch.setattr(ping_mod.asyncio, "create_subprocess_exec", finto)
    monkeypatch.setattr(ping_mod.platform, "system", lambda: sistema)


@pytest.mark.asyncio
@pytest.mark.parametrize("eccezione", [FileNotFoundError(2, "ping"), PermissionError(13, "ping")])
async def test_ping_non_eseguibile_porta_errore(monkeypatch: pytest.MonkeyPatch, eccezione: OSError) -> None:
    async def finto(*_a, **_k):
        raise eccezione

    monkeypatch.setattr(ping_mod.asyncio, "create_subprocess_exec", finto)
    r = await ping_one("10.250.0.1", timeout_ms=500)
    assert r.alive is False
    assert r.error


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sistema", "codice", "sconosciuto"),
    [("Linux", 1, False), ("Linux", 2, True), ("Darwin", 2, False), ("Darwin", 68, True)],
)
async def test_codice_di_uscita_letto_per_piattaforma(
    monkeypatch: pytest.MonkeyPatch, sistema: str, codice: int, sconosciuto: bool
) -> None:
    _con_uscita(monkeypatch, codice, sistema)
    r = await ping_one("10.250.0.1", timeout_ms=500)
    assert r.alive is False
    assert (r.error is not None) is sconosciuto
    if sconosciuto:
        assert str(codice) in (r.error or "")
