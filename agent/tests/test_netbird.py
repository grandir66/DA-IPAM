"""L'agente sta su NetBird (20/10/2026): l'overlay precedente non esiste più.

Prima l'agente rifiutava di partire senza l'interfaccia dell'overlay precedente e
``/healthz`` ne diceva lo stato. Ora:
- fuori da ``dev_mode`` parte solo se c'è l'interfaccia NetBird ``wt0`` (meglio non
  partire che ascoltare per sbaglio su una scheda pubblica: stessa regola di prima);
- ``/healthz`` dice ``netbird`` e ``netbird_ip`` (indirizzo IPv4 di ``wt0``);
- l'installatore legge la rete NetBird dell'account da ``netbird status`` e la scrive come
  rete ammessa (spec NetBird, rischio 9).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

INSTALL = Path(__file__).resolve().parents[1] / "scripts" / "install.sh"
BASH = shutil.which("bash") or "/bin/bash"

# `ip -4 -o addr show dev wt0` come lo stampa Ubuntu 24.04 con NetBird 0.81 (20/10/2026).
IP_ADDR_WT0 = "5: wt0    inet 100.107.32.181/16 brd 100.107.255.255 scope global wt0\\       valid_lft forever preferred_lft forever\n"

# `netbird status` in forma testo, client 0.81 connesso.
NB_CONNESSO = """OS: linux/amd64
Daemon version: 0.81.3
CLI version: 0.81.3
Management: Connected
Signal: Connected
Relays: 3/3 Available
Nameservers: 1/1 Available
FQDN: 70791-ipam.netbird.selfhosted
NetBird IP: 100.107.32.181/16
Interface type: Kernel
Peers count: 4/6 Connected
"""


@pytest.fixture
def sys_net(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from da_invent_agent import system_probe

    d = tmp_path / "sys-class-net"
    d.mkdir()
    monkeypatch.setattr(system_probe, "SYS_CLASS_NET", d, raising=False)
    system_probe.reset_cache()
    return d


def test_fuori_da_dev_mode_parte_con_wt0(sys_net: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (sys_net / "wt0").mkdir()
    monkeypatch.setenv("DA_INVENT_AGENT_DEV_MODE", "false")
    from da_invent_agent.config import reset_settings_cache
    from da_invent_agent.main import app

    reset_settings_cache()
    with TestClient(app) as c:
        assert c.get("/version").status_code == 200


def test_fuori_da_dev_mode_senza_wt0_non_parte(sys_net: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DA_INVENT_AGENT_DEV_MODE", "false")
    from da_invent_agent import main
    from da_invent_agent.config import get_settings, reset_settings_cache

    reset_settings_cache()
    with pytest.raises(SystemExit):
        main.controlla_interfaccia(get_settings())
    # in dev_mode si parte anche senza wt0
    monkeypatch.setenv("DA_INVENT_AGENT_DEV_MODE", "true")
    reset_settings_cache()
    main.controlla_interfaccia(get_settings())


def test_healthz_dice_netbird_e_il_suo_ip(sys_net: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from da_invent_agent import system_probe
    from da_invent_agent.main import app

    (sys_net / "wt0").mkdir()
    monkeypatch.setattr(system_probe.shutil, "which", lambda name: f"/usr/bin/{name}")

    def finto_run(cmd, **_kw):  # noqa: ANN001
        assert cmd == ["ip", "-4", "-o", "addr", "show", "dev", "wt0"], cmd
        return subprocess.CompletedProcess(cmd, 0, stdout=IP_ADDR_WT0, stderr="")

    monkeypatch.setattr(system_probe.subprocess, "run", finto_run)
    with TestClient(app) as c:
        rete = c.get("/healthz").json()["network"]
    assert rete == {"netbird": True, "netbird_ip": "100.107.32.181"}


def test_healthz_senza_wt0(sys_net: Path) -> None:
    from da_invent_agent.main import app

    with TestClient(app) as c:
        rete = c.get("/healthz").json()["network"]
    assert rete == {"netbird": False, "netbird_ip": None}


def _finti(tmp_path: Path, stato: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "nb-status.txt").write_text(stato)
    netbird = bin_dir / "netbird"
    netbird.write_text(f'#!/bin/bash\n[ "$1" = status ] && cat "{tmp_path}/nb-status.txt"\nexit 0\n')
    netbird.chmod(0o755)
    return {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path)}


def test_installatore_legge_la_rete_netbird(tmp_path: Path) -> None:
    env = _finti(tmp_path, NB_CONNESSO)
    r = subprocess.run([BASH, str(INSTALL), "--rete-netbird"], env=env, capture_output=True, text=True, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.strip() == "100.107.0.0/16"


def test_installatore_senza_netbird_connesso_si_ferma(tmp_path: Path) -> None:
    env = _finti(tmp_path, "Daemon status: NeedsLogin\n")
    r = subprocess.run([BASH, str(INSTALL), "--rete-netbird"], env=env, capture_output=True, text=True, check=False)
    assert r.returncode != 0
    assert "NetBird" in r.stderr
    assert r.stdout.strip() == ""
