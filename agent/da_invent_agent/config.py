"""Caricamento configurazione agente.

Sorgenti, in ordine di precedenza:
    1. Variabili d'ambiente con prefisso ``DA_INVENT_AGENT_``
    2. File YAML indicato da ``DA_INVENT_AGENT_CONFIG`` (default
       ``/etc/da-invent-agent/config.yml``)
    3. Default hardcoded nella classe ``Settings``

In dev locale è sufficiente esportare le variabili d'ambiente.

Multi-token (v0.2.0+):
    ``tokens`` è una lista di ``TokenEntry``. Su env si passa come JSON::

        DA_INVENT_AGENT_TOKENS='[{"label":"hub","token_hash":"$2b$10$...","scopes":["exec:network","exec:device"]}]'

    Su YAML come lista nativa. La vecchia env ``DA_INVENT_AGENT_TOKEN_HASH``
    è stata rimossa in v0.2.0: non c'è fallback.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_CONFIG_PATH = "/etc/da-invent-agent/config.yml"


class TokenEntry(BaseModel):
    """Record di un singolo bearer token autorizzato.

    ``token_hash`` è il bcrypt hash del plaintext; il plaintext NON viene
    mai persistito né loggato. ``label`` identifica il chiamante negli
    audit log (es. "hub-prod", "debug-rg").
    """

    label: str = Field(min_length=1, max_length=64)
    token_hash: SecretStr
    scopes: list[str] = Field(default_factory=list)

    @field_validator("scopes")
    @classmethod
    def _normalize_scopes(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s and s.strip()]


def _load_yaml(path: str | os.PathLike[str]) -> dict[str, Any]:
    p = Path(path)
    if not p.exists() or str(p) in {"/dev/null", os.devnull}:
        return {}
    with p.open("r", encoding="utf-8") as fp:
        data = yaml.safe_load(fp) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config YAML root deve essere un mapping: {path}")
    return data


def _parse_tokens_env(raw: str) -> list[TokenEntry]:
    if not raw or not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"DA_INVENT_AGENT_TOKENS non è JSON valido: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("DA_INVENT_AGENT_TOKENS deve essere una lista JSON")
    return [TokenEntry.model_validate(item) for item in data]


class Settings(BaseSettings):
    """Configurazione runtime dell'agente."""

    model_config = SettingsConfigDict(
        env_prefix="DA_INVENT_AGENT_",
        env_file=None,
        extra="ignore",
    )

    tenant_code: str = Field(default="", description="Codice cliente del tenant servito.")
    hub_url: str = Field(default="", description="URL dell'hub DA-INVENT (per heartbeat in Phase 6).")
    tokens: list[TokenEntry] = Field(default_factory=list)
    port: int = Field(default=8443, ge=1, le=65535)
    host: str = Field(default="0.0.0.0")
    dev_mode: bool = Field(default=False)
    log_level: str = Field(default="INFO")
    cgnat_network: str = Field(default="100.64.0.0/10")

    @field_validator("tokens", mode="before")
    @classmethod
    def _coerce_tokens(cls, v: Any) -> Any:
        # Quando proviene da una env var pydantic-settings ce la passa come stringa JSON.
        if isinstance(v, str):
            return _parse_tokens_env(v)
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    config_path = os.environ.get("DA_INVENT_AGENT_CONFIG", DEFAULT_CONFIG_PATH)
    yaml_data = _load_yaml(config_path)
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
