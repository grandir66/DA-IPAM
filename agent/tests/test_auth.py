"""Test di autenticazione, scope enforcement e ammissione di rete."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz_pubblico_senza_auth(client: TestClient) -> None:
    res = client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["mode"] == "remote"
    assert isinstance(body["version"], str)
    # In v0.2.0 /healthz espone anche tools + network
    assert "tools" in body
    assert {"nmap", "snmpwalk", "ping", "ssh"} <= set(body["tools"].keys())
    assert "network" in body
    assert "tailscale" in body["network"]


def test_version_pubblico_senza_auth(client: TestClient) -> None:
    res = client.get("/version")
    assert res.status_code == 200
    assert "version" in res.json()


def test_exec_senza_auth_envelope(client: TestClient) -> None:
    res = client.post("/exec/ping", json={"ip": "127.0.0.1"})
    assert res.status_code == 401
    body = res.json()
    assert body["error"]["code"] == "auth_invalid"
    assert body["error"]["retriable"] is False


def test_exec_con_token_errato(client: TestClient) -> None:
    res = client.post(
        "/exec/ping",
        headers={"Authorization": "Bearer wrong-token"},
        json={"ip": "127.0.0.1"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "auth_invalid"


def test_exec_con_header_non_bearer(client: TestClient) -> None:
    res = client.post(
        "/exec/ping",
        headers={"Authorization": "Basic dXNlcjpwYXNz"},
        json={"ip": "127.0.0.1"},
    )
    assert res.status_code == 401


def test_exec_con_token_full_scope(client: TestClient, auth_headers: dict[str, str]) -> None:
    res = client.post("/exec/ping", headers=auth_headers, json={"ip": "127.0.0.1"})
    assert res.status_code == 200
    body = res.json()
    assert body["ip"] == "127.0.0.1"
    assert isinstance(body["alive"], bool)


def test_exec_device_richiede_scope_device(
    client: TestClient, auth_headers_ro: dict[str, str],
) -> None:
    """Il token 'network-only' non deve poter chiamare /exec/ssh-exec."""
    res = client.post(
        "/exec/ssh-exec",
        headers=auth_headers_ro,
        json={
            "host": "127.0.0.1",
            "user": "nobody",
            "auth": {"type": "password", "password": "x"},
            "command": "echo hi",
            "timeout_ms": 2000,
        },
    )
    assert res.status_code == 403
    body = res.json()
    assert body["error"]["code"] == "scope_denied"
    assert body["error"]["details"]["required"] == "exec:device"


def test_wildcard_token_passa_ovunque(
    client: TestClient, auth_headers_wildcard: dict[str, str],
) -> None:
    res = client.post("/exec/ping", headers=auth_headers_wildcard, json={"ip": "127.0.0.1"})
    assert res.status_code == 200


def test_whoami_richiede_solo_auth(
    client: TestClient, auth_headers_ro: dict[str, str],
) -> None:
    res = client.get("/whoami", headers=auth_headers_ro)
    assert res.status_code == 200
    body = res.json()
    assert body["label"] == "test-network-only"
    assert body["scopes"] == ["exec:network"]
    assert body["tenant_code"] == "TEST"


def test_validation_error_envelope(client: TestClient, auth_headers: dict[str, str]) -> None:
    """body non valido -> 400 con error.code=invalid_input."""
    res = client.post("/exec/ping", headers=auth_headers, json={"timeout_ms": 99999999})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_input"
