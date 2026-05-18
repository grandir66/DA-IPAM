"""Scopes di autorizzazione per i bearer token.

Modello chiuso (StrEnum) per evitare typo. Il wildcard ``"*"`` non è membro
dell'enum ma è gestito da ``token_has_scope`` come "tutte" — utile per token
admin one-off.

Endpoint dichiarano lo scope richiesto via dependency ``require_scope(...)``
in ``auth.py``.
"""

from __future__ import annotations

from enum import StrEnum


class Scope(StrEnum):
    EXEC_NETWORK = "exec:network"
    """Operazioni read-only di rete (ping, nmap, DNS, SNMP walk/routes/ARP)."""

    EXEC_DEVICE = "exec:device"
    """Esecuzione comandi remoti su device (SSH, WinRM)."""

    ADMIN_UPDATE = "admin:update"
    """Auto-aggiornamento dell'agente (Phase 5)."""


WILDCARD = "*"


def token_has_scope(token_scopes: list[str], required: Scope) -> bool:
    if WILDCARD in token_scopes:
        return True
    return required.value in token_scopes
