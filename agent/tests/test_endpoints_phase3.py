"""Happy + error path per gli endpoint Phase 3.

Dove possibile patchiamo le primitive ``exec.*`` per non richiedere
``snmpwalk``/SSH server reali in CI. Verifichiamo che l'envelope di errore
del contratto sia rispettato.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from da_invent_agent.errors import AgentException, ErrorCode


# ─────────────────────────────────────────────────────────────────────────────
# /exec/snmp-walk
# ─────────────────────────────────────────────────────────────────────────────


def test_snmp_walk_happy(client: TestClient, auth_headers: dict[str, str]) -> None:
    from da_invent_agent.exec.snmp import SnmpRow

    rows = [SnmpRow(oid="1.3.6.1.2.1.1.1.0", type="STRING", value='"RouterOS"')]
    with patch("da_invent_agent.main.exec_snmp.snmp_walk", return_value=rows) as mock:
        res = client.post(
            "/exec/snmp-walk",
            headers=auth_headers,
            json={"host": "10.0.0.1", "community": "public", "oid": "1.3.6.1.2.1.1.1", "version": "2c"},
        )
    assert mock.await_count == 1 or mock.call_count == 1
    assert res.status_code == 200
    body = res.json()
    assert body == [{"oid": "1.3.6.1.2.1.1.1.0", "type": "STRING", "value": '"RouterOS"'}]


def test_snmp_walk_tool_missing_envelope(
    client: TestClient, auth_headers: dict[str, str],
) -> None:
    with patch(
        "da_invent_agent.main.exec_snmp.snmp_walk",
        side_effect=AgentException(ErrorCode.TOOL_MISSING, "snmpwalk non trovato", details={"tool": "snmpwalk"}),
    ):
        res = client.post(
            "/exec/snmp-walk",
            headers=auth_headers,
            json={"host": "10.0.0.1", "community": "public", "oid": "1.3.6.1.2.1.1.1", "version": "2c"},
        )
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "tool_missing"
    assert body["error"]["retriable"] is False
    assert body["error"]["details"]["tool"] == "snmpwalk"


# ─────────────────────────────────────────────────────────────────────────────
# /exec/arp-poll
# ─────────────────────────────────────────────────────────────────────────────


def test_arp_poll_happy(client: TestClient, auth_headers: dict[str, str]) -> None:
    fake = {
        "entries": [{"ip": "192.168.1.1", "mac": "aa:bb:cc:dd:ee:ff"}],
        "raw_lines": ["1.3.6.1.2.1.4.22.1.2.1.192.168.1.1 Hex-STRING AA BB CC DD EE FF"],
        "duration_ms": 42,
    }
    with patch("da_invent_agent.main.exec_arp.arp_poll", return_value=fake):
        res = client.post(
            "/exec/arp-poll",
            headers=auth_headers,
            json={"router_ip": "10.0.0.1", "community": "public", "version": "2c"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["entries"] == [{"ip": "192.168.1.1", "mac": "aa:bb:cc:dd:ee:ff"}]
    assert body["duration_ms"] == 42
    assert isinstance(body["raw_lines"], list)


def test_arp_poll_target_unreachable(client: TestClient, auth_headers: dict[str, str]) -> None:
    with patch(
        "da_invent_agent.main.exec_arp.arp_poll",
        side_effect=AgentException(ErrorCode.TARGET_UNREACHABLE, "host non raggiungibile"),
    ):
        res = client.post(
            "/exec/arp-poll",
            headers=auth_headers,
            json={"router_ip": "10.0.0.1", "community": "public"},
        )
    assert res.status_code == 502
    body = res.json()
    assert body["error"]["code"] == "target_unreachable"
    assert body["error"]["retriable"] is True


# ─────────────────────────────────────────────────────────────────────────────
# /exec/snmp-routes
# ─────────────────────────────────────────────────────────────────────────────


def test_snmp_routes_happy(client: TestClient, auth_headers: dict[str, str]) -> None:
    fake = [
        {"cidr": "10.0.0.0/24", "source": "ipAddrTable"},
        {"cidr": "192.168.0.0/24", "source": "ipCidrRouteTable"},
    ]
    with patch("da_invent_agent.main.exec_snmp.snmp_routes", return_value=fake):
        res = client.post(
            "/exec/snmp-routes",
            headers=auth_headers,
            json={"router_ip": "10.0.0.1", "community": "public", "version": "2c"},
        )
    assert res.status_code == 200
    assert res.json() == fake


def test_snmp_routes_timeout(client: TestClient, auth_headers: dict[str, str]) -> None:
    with patch(
        "da_invent_agent.main.exec_snmp.snmp_routes",
        side_effect=AgentException(ErrorCode.TIMEOUT, "SNMP timeout"),
    ):
        res = client.post(
            "/exec/snmp-routes",
            headers=auth_headers,
            json={"router_ip": "10.0.0.1", "community": "public"},
        )
    assert res.status_code == 504
    assert res.json()["error"]["code"] == "timeout"


# ─────────────────────────────────────────────────────────────────────────────
# /exec/ssh-exec
# ─────────────────────────────────────────────────────────────────────────────


def test_ssh_exec_happy(client: TestClient, auth_headers: dict[str, str]) -> None:
    fake = {
        "stdout": "hello\n",
        "stderr": "",
        "exit_code": 0,
        "duration_ms": 50,
        "truncated": {"stdout": False, "stderr": False},
    }
    with patch("da_invent_agent.main.exec_ssh.ssh_exec", return_value=fake):
        res = client.post(
            "/exec/ssh-exec",
            headers=auth_headers,
            json={
                "host": "10.0.0.1",
                "user": "ubuntu",
                "auth": {"type": "password", "password": "x"},
                "command": "echo hello",
                "timeout_ms": 3000,
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["stdout"] == "hello\n"
    assert body["exit_code"] == 0
    assert body["truncated"] == {"stdout": False, "stderr": False}


def test_ssh_exec_auth_invalid(client: TestClient, auth_headers: dict[str, str]) -> None:
    with patch(
        "da_invent_agent.main.exec_ssh.ssh_exec",
        side_effect=AgentException(ErrorCode.AUTH_INVALID, "SSH auth fallita"),
    ):
        res = client.post(
            "/exec/ssh-exec",
            headers=auth_headers,
            json={
                "host": "10.0.0.1",
                "user": "ubuntu",
                "auth": {"type": "password", "password": "wrong"},
                "command": "id",
            },
        )
    assert res.status_code == 401
    body = res.json()
    assert body["error"]["code"] == "auth_invalid"
    assert body["error"]["retriable"] is False


def test_ssh_exec_invalid_auth_type_validation(
    client: TestClient, auth_headers: dict[str, str],
) -> None:
    res = client.post(
        "/exec/ssh-exec",
        headers=auth_headers,
        json={
            "host": "10.0.0.1",
            "user": "ubuntu",
            "auth": {"type": "biometric", "fingerprint": "x"},
            "command": "id",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_input"


# ─────────────────────────────────────────────────────────────────────────────
# /exec/winrm-exec
# ─────────────────────────────────────────────────────────────────────────────


def test_winrm_exec_happy(client: TestClient, auth_headers: dict[str, str]) -> None:
    fake = {
        "stdout": "PowerShellOutput\r\n",
        "stderr": "",
        "exit_code": 0,
        "duration_ms": 1200,
        "transport_used": "kerberos",
        "truncated": {"stdout": False, "stderr": False},
    }
    with patch("da_invent_agent.main.exec_winrm.winrm_exec", return_value=fake):
        res = client.post(
            "/exec/winrm-exec",
            headers=auth_headers,
            json={
                "host": "192.168.1.50",
                "user": "admin@DOMAIN.LOCAL",
                "auth": {"type": "password", "password": "secret"},
                "command": "Get-ComputerInfo",
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["transport_used"] == "kerberos"
    assert body["exit_code"] == 0


def test_winrm_exec_parse_error(client: TestClient, auth_headers: dict[str, str]) -> None:
    with patch(
        "da_invent_agent.main.exec_winrm.winrm_exec",
        side_effect=AgentException(
            ErrorCode.PARSE_ERROR,
            "winrm_bridge.py output non-JSON",
            details={"stdout": "...", "stderr": "..."},
        ),
    ):
        res = client.post(
            "/exec/winrm-exec",
            headers=auth_headers,
            json={
                "host": "192.168.1.50",
                "user": "admin",
                "auth": {"type": "password", "password": "x"},
                "command": "whoami",
            },
        )
    assert res.status_code == 502
    body = res.json()
    assert body["error"]["code"] == "parse_error"
    assert body["error"]["retriable"] is False
