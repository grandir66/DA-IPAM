"""Archivio SQLite del collector: coppie per finestra, con un numero progressivo (cursore).

Date sempre `AAAA-MM-GG HH:MM:SS` in UTC, mai `isoformat()`: la `T` rompe i confronti
con `datetime('now')`.
"""
from __future__ import annotations

import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS coppia (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, inizio TEXT NOT NULL, durata_s INTEGER NOT NULL,
  client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,
  byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL, flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_coppia_inizio ON coppia (inizio);
CREATE TABLE IF NOT EXISTS stato (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);
"""

COLONNE = ("seq", "inizio", "durata_s", "client", "server", "proto", "porta", "byte", "pacchetti", "flussi", "esterni")
FINESTRA_S = 300


def ora_utc(epoca: float | None = None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(epoca))


def apri(percorso: str) -> sqlite3.Connection:
    db = sqlite3.connect(percorso, timeout=10)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript(SCHEMA)
    return db


def scrivi_finestra(db: sqlite3.Connection, inizio: str, coppie: list[dict], durata_s: int = FINESTRA_S) -> int:
    """Scrive le coppie di una finestra in una sola transazione. Ritorna quante righe."""
    with db:
        db.executemany(
            "INSERT INTO coppia (inizio, durata_s, client, server, proto, porta, byte, pacchetti, flussi, esterni)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (inizio, durata_s, c["client"], c["server"], c["proto"], c["porta"],
                 c["byte"], c["pacchetti"], c["flussi"], c.get("esterni", 0))
                for c in coppie
            ],
        )
    return len(coppie)


def leggi_coppie(db: sqlite3.Connection, dopo: int, limite: int) -> tuple[list[dict], int, bool, bool]:
    """Le righe con seq > dopo, al più `limite`. Ritorna (righe, ultimo_seq, altri, buco).
    `buco`: chi legge era rimasto indietro e le righe fra `dopo` e la più vecchia rimasta
    sono state buttate dallo sfoltimento."""
    limite = max(1, min(int(limite), 1000))
    dopo = max(0, int(dopo))
    grezze = db.execute(
        f"SELECT {', '.join(COLONNE)} FROM coppia WHERE seq > ? ORDER BY seq LIMIT ?", (dopo, limite + 1)
    ).fetchall()
    altri = len(grezze) > limite
    righe = [dict(zip(COLONNE, r)) for r in grezze[:limite]]
    ultimo_seq = righe[-1]["seq"] if righe else dopo
    piu_vecchio = db.execute("SELECT MIN(seq) FROM coppia").fetchone()[0]
    buco = dopo > 0 and piu_vecchio is not None and dopo < piu_vecchio - 1
    return righe, ultimo_seq, altri, buco


def ultimo_seq(db: sqlite3.Connection) -> int:
    r = db.execute("SELECT seq FROM sqlite_sequence WHERE name = 'coppia'").fetchone()
    return int(r[0]) if r else 0


def sfoltisci(db: sqlite3.Connection, giorni: int = 7) -> int:
    """Butta le finestre più vecchie di `giorni`. Ritorna quante righe ha tolto."""
    with db:
        fatto = db.execute("DELETE FROM coppia WHERE inizio < datetime('now', ?)", (f"-{int(giorni)} days",))
    return fatto.rowcount


def metti_stato(db: sqlite3.Connection, chiave: str, valore: object) -> None:
    with db:
        db.execute(
            "INSERT INTO stato (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore",
            (chiave, str(valore)),
        )


def leggi_stato(db: sqlite3.Connection, chiave: str, ripiego: str = "") -> str:
    r = db.execute("SELECT valore FROM stato WHERE chiave = ?", (chiave,)).fetchone()
    return r[0] if r else ripiego
