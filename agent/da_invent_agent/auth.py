"""Autenticazione e ammissione di rete dell'agente.

Doppio livello di difesa:
    1. **Origine di rete**: in produzione il client remoto DEVE provenire dalla
       rete CGNAT di Tailscale (100.64.0.0/10). In dev_mode è ammesso anche
       127.0.0.1 e ::1.
    2. **Bearer token**: confronto bcrypt costante-time contro l'hash configurato.

Errori restituiti come ``HTTPException(401)`` per non distinguere "token errato"
da "origine non ammessa" — riduce la superficie di information disclosure.
"""

from __future__ import annotations

import ipaddress
import logging
from typing import Annotated

import bcrypt
from fastapi import Depends, Header, HTTPException, Request, status

from .config import Settings, get_settings


log = logging.getLogger(__name__)


_LOCALHOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


def _is_localhost(client_ip: str | None) -> bool:
    return client_ip is not None and client_ip in _LOCALHOSTS


def _is_in_cgnat(client_ip: str, cgnat_network: str) -> bool:
    try:
        net = ipaddress.ip_network(cgnat_network, strict=False)
        return ipaddress.ip_address(client_ip) in net
    except ValueError:
        return False


def check_request_origin(request: Request, settings: Settings) -> None:
    client_ip = request.client.host if request.client else None
    if client_ip is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Origine sconosciuta")

    if settings.dev_mode and _is_localhost(client_ip):
        return

    if _is_in_cgnat(client_ip, settings.cgnat_network):
        return

    log.warning("Richiesta rifiutata da %s (fuori dalla rete Tailscale %s)", client_ip, settings.cgnat_network)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Origine non ammessa")


def _verify_token(plaintext: str, token_hash: str) -> bool:
    if not token_hash:
        return False
    try:
        return bcrypt.checkpw(plaintext.encode("utf-8"), token_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def require_bearer(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
) -> None:
    """Dependency FastAPI da iniettare nelle route protette."""

    check_request_origin(request, settings)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token mancante")

    plaintext = authorization.split(" ", 1)[1].strip()
    if not plaintext:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token vuoto")

    token_hash = settings.token_hash.get_secret_value()
    if not _verify_token(plaintext, token_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido")
