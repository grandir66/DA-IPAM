"""Autenticazione, ammissione di rete e scope enforcement.

Tre livelli:
    1. **Origine**: il client DEVE essere in CGNAT Tailscale 100.64.0.0/10.
       In ``dev_mode`` accettiamo anche ``127.0.0.1``/``::1``/``testclient``.
    2. **Bearer**: confronto bcrypt costante-time contro la lista di
       token configurati. Identifica il chiamante per label.
    3. **Scope**: la dependency ``require_scope(scope)`` controlla che
       il token autenticato copra lo scope richiesto dall'endpoint.

Identità del chiamante (label + scopes) viene salvata in
``request.state.token_label`` / ``request.state.token_scopes`` per audit
log e per la rotta ``/whoami``.

Nessun token plaintext viene mai loggato: solo la label.
"""

from __future__ import annotations

import ipaddress
import logging
from typing import Annotated

import bcrypt
from fastapi import Depends, Header, Request

from .config import Settings, TokenEntry, get_settings
from .errors import AgentException, ErrorCode
from .scopes import Scope, token_has_scope


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
        raise AgentException(ErrorCode.AUTH_INVALID, "Origine sconosciuta")

    if settings.dev_mode and _is_localhost(client_ip):
        return
    if _is_in_cgnat(client_ip, settings.cgnat_network):
        return

    log.warning("Richiesta rifiutata da %s (fuori da %s)", client_ip, settings.cgnat_network)
    raise AgentException(ErrorCode.AUTH_INVALID, "Origine non ammessa")


def _verify_token(plaintext: str, entry: TokenEntry) -> bool:
    token_hash = entry.token_hash.get_secret_value()
    if not token_hash:
        return False
    try:
        return bcrypt.checkpw(plaintext.encode("utf-8"), token_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _match_token(plaintext: str, tokens: list[TokenEntry]) -> TokenEntry | None:
    """Confronta contro tutti i token configurati per resistere ai timing-attack
    sull'esistenza del primo match (bcrypt è già costante-time per singolo confronto)."""

    matched: TokenEntry | None = None
    for entry in tokens:
        # Non short-circuit: continuo a invocare bcrypt anche dopo il match,
        # così il tempo totale è ~costante rispetto al numero di token configurati.
        if _verify_token(plaintext, entry) and matched is None:
            matched = entry
    return matched


def require_bearer(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
) -> TokenEntry:
    """Dependency FastAPI base: autentica il chiamante e ritorna il
    ``TokenEntry`` corrispondente. Da combinare con ``require_scope`` per
    controllo scope-specifico."""

    check_request_origin(request, settings)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise AgentException(ErrorCode.AUTH_INVALID, "Bearer token mancante")

    plaintext = authorization.split(" ", 1)[1].strip()
    if not plaintext:
        raise AgentException(ErrorCode.AUTH_INVALID, "Token vuoto")

    if not settings.tokens:
        log.warning("Tentativo di auth ma nessun token configurato in DA_INVENT_AGENT_TOKENS.")
        raise AgentException(ErrorCode.AUTH_INVALID, "Token non valido")

    matched = _match_token(plaintext, settings.tokens)
    if matched is None:
        raise AgentException(ErrorCode.AUTH_INVALID, "Token non valido")

    request.state.token_label = matched.label
    request.state.token_scopes = list(matched.scopes)
    log.info("Auth OK token=%s path=%s", matched.label, request.url.path)
    return matched


def require_scope(scope: Scope):
    """Factory per dependency che richiede uno scope specifico.

    Uso::

        @app.post("/exec/ping", dependencies=[Depends(require_scope(Scope.EXEC_NETWORK))])
        async def exec_ping(...): ...
    """

    async def _dep(
        request: Request,
        token: Annotated[TokenEntry, Depends(require_bearer)],
    ) -> TokenEntry:
        if not token_has_scope(list(token.scopes), scope):
            log.warning("Scope denied token=%s required=%s path=%s", token.label, scope.value, request.url.path)
            raise AgentException(
                ErrorCode.SCOPE_DENIED,
                f"Token '{token.label}' non ha lo scope richiesto '{scope.value}'",
                details={"required": scope.value, "granted": list(token.scopes)},
            )
        return token

    return _dep
