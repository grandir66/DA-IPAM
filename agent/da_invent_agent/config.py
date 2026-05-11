"""Caricamento configurazione agente.

Sorgenti, in ordine di precedenza:
    1. Variabili d'ambiente con prefisso ``DA_INVENT_AGENT_``
    2. File YAML indicato da ``DA_INVENT_AGENT_CONFIG`` (default
       ``/etc/da-invent-agent/config.yml``)
    3. Default hardcoded nella classe ``Settings``

In dev locale è sufficiente esportare le variabili d'ambiente.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_CONFIG_PATH = "/etc/da-invent-agent/config.yml"


def _load_yaml(path: str | os.PathLike[str]) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        return {}
    with p.open("r", encoding="utf-8") as fp:
        data = yaml.safe_load(fp) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config YAML root deve essere un mapping: {path}")
    return data


class Settings(BaseSettings):
    """Configurazione runtime dell'agente."""

    model_config = SettingsConfigDict(
        env_prefix="DA_INVENT_AGENT_",
        env_file=None,
        extra="ignore",
    )

    tenant_code: str = Field(default="", description="Codice cliente del tenant servito.")
    hub_url: str = Field(default="", description="URL dell'hub DA-INVENT (per heartbeat in Phase 6).")
    token_hash: SecretStr = Field(
        default=SecretStr(""),
        description="Hash bcrypt del bearer token. Confrontato con costante-time.",
    )
    port: int = Field(default=8443, ge=1, le=65535)
    host: str = Field(default="0.0.0.0", description="Bind address (default 0.0.0.0 — il binding effettivo è limitato dalla rete Tailscale).")

    dev_mode: bool = Field(default=False, description="Se true, salta il check tailscale0 e accetta richieste da 127.0.0.1.")
    log_level: str = Field(default="INFO")

    # CGNAT range Tailscale (100.64.0.0/10). Configurabile per test.
    cgnat_network: str = Field(default="100.64.0.0/10")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    config_path = os.environ.get("DA_INVENT_AGENT_CONFIG", DEFAULT_CONFIG_PATH)
    yaml_data = _load_yaml(config_path)
    # `Settings()` legge env var con prefisso; per i valori dal YAML li applichiamo manualmente
    # passandoli come kwargs (env var ha comunque precedenza grazie alla validation di pydantic-settings).
    merged: dict[str, Any] = {}
    for key, value in yaml_data.items():
        env_key = f"DA_INVENT_AGENT_{key.upper()}"
        if env_key in os.environ:
            continue
        merged[key] = value
    return Settings(**merged)


def reset_settings_cache() -> None:
    """Utile nei test per riapplicare env var modificati."""
    get_settings.cache_clear()
