#!/usr/bin/env python3
"""Dump dello schema OpenAPI dell'agente in ``agent/openapi.json``.

Pensato per essere eseguito sia in dev che in CI:

    python scripts/dump_openapi.py [output_path]

Esce 0 se il file viene scritto. Il check di freshness rispetto al
committed openapi.json è in ``scripts/check_openapi_fresh.sh``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    # Forziamo una config "vuota" e dev_mode per evitare che la creazione
    # dell'app (lifespan) richieda token/Tailscale.
    os.environ.setdefault("DA_INVENT_AGENT_DEV_MODE", "true")
    os.environ.setdefault("DA_INVENT_AGENT_TOKENS", "[]")
    os.environ.setdefault("DA_INVENT_AGENT_CONFIG", os.devnull)

    # Import differito: env var devono essere settate prima del caricamento moduli.
    from da_invent_agent.config import reset_settings_cache
    from da_invent_agent.main import app

    reset_settings_cache()

    spec = app.openapi()
    out = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent / "openapi.json"
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"OpenAPI scritto in {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
