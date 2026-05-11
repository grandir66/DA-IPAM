"""Test di autenticazione e ammissione di rete."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz_pubblico_senza_auth(client: TestClient) -> None:
    res = client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["mode"] == "remote"
    assert isinstance(body["version"], str)


def test_version_pubblico_senza_auth(client: TestClient) -> None:
    res = client.get("/version")
    assert res.status_code == 200
    assert "version" in res.json()


def test_exec_senza_auth_401(client: TestClient) -> None:
    res = client.post("/exec/ping", json={"ip": "127.0.0.1"})
    assert res.status_code == 401


def test_exec_con_token_errato_401(client: TestClient) -> None:
    res = client.post(
        "/exec/ping",
        headers={"Authorization": "Bearer wrong-token"},
        json={"ip": "127.0.0.1"},
    )
    assert res.status_code == 401


def test_exec_con_header_non_bearer_401(client: TestClient) -> None:
    res = client.post(
        "/exec/ping",
        headers={"Authorization": "Basic dXNlcjpwYXNz"},
        json={"ip": "127.0.0.1"},
    )
    assert res.status_code == 401


def test_exec_con_token_corretto_200(client: TestClient, auth_headers: dict[str, str]) -> None:
    # Su 127.0.0.1 il ping è quasi sempre alive; testiamo solo la struttura.
    res = client.post("/exec/ping", headers=auth_headers, json={"ip": "127.0.0.1"})
    assert res.status_code == 200
    body = res.json()
    assert body["ip"] == "127.0.0.1"
    assert isinstance(body["alive"], bool)
