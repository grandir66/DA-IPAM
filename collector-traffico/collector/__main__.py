"""Servizio del collector: prende i file di pmacct, li piega in coppie, li archivia, espone l'API.

Configurazione da variabili d'ambiente (systemd le carica da /etc/collector-traffico/collector.env):
MIRROR_IF, RETI_INTERNE (aggiunte, separate da virgola), MIRROR_DOPPIO=1, NOME, DATI, CONF.
"""
from __future__ import annotations

import calendar
import os
import re
import sys
import threading
import time

from . import api, archivio, piega

OGNI_S = 30
# Un file più giovane di così può essere ancora in scrittura da parte di pmacct.
FERMO_DA_S = 5
_ORA_NEL_NOME = re.compile(r"(\d{8})-(\d{6})")


def inizio_da_nome(nome: str, mtime: float, durata_s: int = archivio.FINESTRA_S) -> str:
    """pmacct mette nel nome l'ora (UTC) in cui chiude la finestra: l'inizio è 300 secondi prima.
    Nome senza ora: si ripiega sull'ora del file."""
    m = _ORA_NEL_NOME.search(nome)
    if m:
        try:
            fine = calendar.timegm(time.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S"))
            return archivio.ora_utc(fine - durata_s)
        except ValueError:
            pass
    return archivio.ora_utc(mtime - durata_s)


def contatori_scheda(scheda: str, testo: str) -> tuple[int, int] | None:
    """Da /proc/net/dev: (pacchetti ricevuti, pacchetti scartati in ricezione) della scheda."""
    for linea in testo.splitlines():
        nome, _, resto = linea.partition(":")
        if nome.strip() == scheda:
            campi = resto.split()
            if len(campi) >= 5:
                # ricezione: bytes packets errs drop fifo ...
                return int(campi[1]), int(campi[3]) + int(campi[4])
    return None


def giro(db, cartella_in: str, reti: list[str], doppio: bool, adesso: float | None = None) -> int:
    """Un giro: ogni file pronto diventa una finestra, poi si cancella. Ritorna le righe scritte."""
    adesso = time.time() if adesso is None else adesso
    scritte = 0
    for nome in sorted(os.listdir(cartella_in)):
        percorso = os.path.join(cartella_in, nome)
        try:
            mtime = os.path.getmtime(percorso)
            if not os.path.isfile(percorso) or adesso - mtime < FERMO_DA_S:
                continue
            with open(percorso, encoding="utf-8", errors="replace") as f:
                coppie = piega.piega(piega.da_pmacct(f.read()), reti)
        except OSError:
            continue
        if doppio:
            coppie = piega.dimezza(coppie)
        scritte += archivio.scrivi_finestra(db, inizio_da_nome(nome, mtime), coppie)
        os.unlink(percorso)
    return scritte


def main() -> int:
    dati = os.environ.get("DATI", "/var/lib/collector-traffico")
    conf = os.environ.get("CONF", "/etc/collector-traffico")
    scheda = os.environ.get("MIRROR_IF", "")
    reti = piega.RETI_INTERNE_DI_SERIE + [r for r in os.environ.get("RETI_INTERNE", "").split(",") if r.strip()]
    doppio = os.environ.get("MIRROR_DOPPIO", "0") == "1"
    try:
        with open(os.path.join(conf, "gettone"), encoding="utf-8") as f:
            gettone = f.read().strip()
    except OSError:
        print("collector: gettone non leggibile, non parto", file=sys.stderr)
        return 1
    if not gettone:
        print("collector: gettone vuoto, non parto", file=sys.stderr)
        return 1

    percorso_db = os.path.join(dati, "collector.db")
    cartella_in = os.path.join(dati, "in")
    os.makedirs(cartella_in, exist_ok=True)
    db = archivio.apri(percorso_db)
    avviato = archivio.ora_utc()
    srv = api.crea_server(
        percorso_db, gettone, os.environ.get("NOME", os.uname().nodename), avviato,
        indirizzo=os.environ.get("ASCOLTA", "0.0.0.0"), porta=int(os.environ.get("PORTA", api.PORTA)),
        certificato=os.path.join(conf, "cert.pem"), chiave=os.path.join(conf, "chiave.pem"),
    )
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"collector: avviato, scheda in mirror {'presente' if scheda else 'NON configurata'}", flush=True)

    ultimo_sfoltimento = 0.0
    while True:
        try:
            scritte = giro(db, cartella_in, reti, doppio)
            if scritte:
                print(f"collector: {scritte} coppie archiviate", flush=True)
            if scheda:
                try:
                    with open("/proc/net/dev", encoding="ascii") as f:
                        c = contatori_scheda(scheda, f.read())
                except OSError:
                    c = None
                if c:
                    archivio.metti_stato(db, "pacchetti_visti", c[0])
                    archivio.metti_stato(db, "pacchetti_persi", c[1])
            if time.time() - ultimo_sfoltimento > 3600:
                archivio.sfoltisci(db, 7)
                ultimo_sfoltimento = time.time()
        except Exception as e:  # il giro dopo riprova: il servizio non deve morire per un file storto
            print(f"collector: giro fallito ({type(e).__name__})", file=sys.stderr, flush=True)
        time.sleep(OGNI_S)


if __name__ == "__main__":
    sys.exit(main())
