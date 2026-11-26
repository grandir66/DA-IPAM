"""Sonda avanzata: copertura dai contatori di Zeek e freno sul disco.

Il freno gira da root ogni minuto (`zeek-freno.timer`): sopra SOGLIA_FERMA del disco di DATI ferma Zeek e lascia
il file-segno `DATI/zeek-freno`; sotto SOGLIA_RIPARTI lo toglie e riavvia Zeek. `collector-traffico` legge il segno
e lo dice in `/v1/stato` (`freno`). La copertura viene da `stats.log` (`pkts_link`, `pkts_dropped`), mai da
`capture_loss`: sul banco e sul DA-PX-03 dava picchi fino al 72% con zero pacchetti scartati (23/11/2026).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

SOGLIA_FERMA = 70.0
SOGLIA_RIPARTI = 50.0
SEGNO = "zeek-freno"


def copertura_da_stats(righe: list[dict]) -> tuple[int, int]:
    """(pacchetti visti dalla scheda, pacchetti scartati prima di Zeek), sommando le righe di `stats.log`.
    Ogni riga conta l'intervallo dall'ultima: la somma è il totale del registro. Una riga senza i due campi
    (lettura da file, non dalla scheda) non conta."""
    visti = persi = 0
    for r in righe:
        try:
            visti += max(0, int(r.get("pkts_link") or 0))
            persi += max(0, int(r.get("pkts_dropped") or 0))
        except (TypeError, ValueError):
            continue
    return visti, persi


def freno(percento_usato: float, fermo: bool) -> str:
    """"ferma" sopra SOGLIA_FERMA (se non è già fermo), "riparti" sotto SOGLIA_RIPARTI se fermo, altrimenti "niente".
    Fra le due soglie non si cambia: niente avanti e indietro a ogni minuto."""
    if not fermo and percento_usato > SOGLIA_FERMA:
        return "ferma"
    if fermo and percento_usato < SOGLIA_RIPARTI:
        return "riparti"
    return "niente"


def percento_usato(cartella: str) -> float:
    u = shutil.disk_usage(cartella)
    return 100.0 * u.used / u.total if u.total else 0.0


def main() -> int:
    if os.environ.get("PROFILO", "leggero") != "avanzato":
        return 0
    dati = os.environ.get("DATI", "/var/lib/collector-traffico")
    segno = os.path.join(dati, SEGNO)
    fermo = os.path.exists(segno)
    p = percento_usato(dati)
    azione = freno(p, fermo)
    if azione == "ferma":
        with open(segno, "w", encoding="ascii") as f:
            f.write(f"{p:.1f}\n")
        subprocess.run(["systemctl", "stop", "zeek-collector.service"], check=False)
        print(f"freno: disco al {p:.1f}%, Zeek fermato", flush=True)
    elif azione == "riparti":
        os.unlink(segno)
        subprocess.run(["systemctl", "start", "zeek-collector.service"], check=False)
        print(f"freno: disco al {p:.1f}%, Zeek riavviato", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
