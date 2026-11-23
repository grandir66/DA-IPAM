"""Archivio SQLite del collector: coppie per finestra, con un numero progressivo (cursore).

Date sempre `AAAA-MM-GG HH:MM:SS` in UTC, mai `isoformat()`: la `T` rompe i confronti
con `datetime('now')`.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS coppia (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, inizio TEXT NOT NULL, durata_s INTEGER NOT NULL,
  client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,
  byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL, flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0,
  fonte TEXT NOT NULL DEFAULT 'mirror');
CREATE INDEX IF NOT EXISTS idx_coppia_inizio ON coppia (inizio);
CREATE TABLE IF NOT EXISTS stato (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fatto (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, visto TEXT NOT NULL, tipo TEXT NOT NULL,
  client TEXT NOT NULL, server TEXT NOT NULL, porta INTEGER NOT NULL, dettaglio TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS nome (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, visto TEXT NOT NULL, client TEXT NOT NULL,
  tipo TEXT NOT NULL, nome TEXT NOT NULL, conteggio INTEGER NOT NULL);
"""

CREATE_IDENTITA = """
CREATE TABLE IF NOT EXISTS identita (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, visto TEXT NOT NULL, mac TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '',
  vlan INTEGER NOT NULL DEFAULT 0, fonte TEXT NOT NULL, nome TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '',
  UNIQUE (mac, ip, fonte));
"""
CREATE_ESTERNI = """
CREATE TABLE IF NOT EXISTS esterno (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, inizio TEXT NOT NULL, interno TEXT NOT NULL, ip TEXT NOT NULL,
  verso TEXT NOT NULL DEFAULT 'fuori', proto INTEGER NOT NULL, porta INTEGER NOT NULL,
  byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL, flussi INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_esterno_inizio ON esterno (inizio);
CREATE TABLE IF NOT EXISTS nome_ip (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, visto TEXT NOT NULL, ip TEXT NOT NULL, tipo TEXT NOT NULL, nome TEXT NOT NULL,
  UNIQUE (ip, tipo));
"""
CREATE_CONNESSIONI = """
CREATE TABLE IF NOT EXISTS connessione (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, inizio TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', server TEXT NOT NULL, porta INTEGER NOT NULL,
  tentate INTEGER NOT NULL, senza_risposta INTEGER NOT NULL, rifiutate INTEGER NOT NULL, ripetute INTEGER NOT NULL,
  riuscite INTEGER NOT NULL, ms_minimo INTEGER NOT NULL, ms_mediano INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_connessione_inizio ON connessione (inizio);
"""
COLONNE_CONNESSIONE = ("seq", "inizio", "client", "server", "porta", "tentate", "senza_risposta", "rifiutate", "ripetute", "riuscite", "ms_minimo", "ms_mediano")
COLONNE_ESTERNO = ("seq", "inizio", "interno", "ip", "verso", "proto", "porta", "byte", "pacchetti", "flussi")
COLONNE_NOME_IP = ("seq", "visto", "ip", "tipo", "nome")
COLONNE_IDENTITA = ("seq", "visto", "mac", "ip", "vlan", "fonte", "nome", "tipo")
COLONNE_FATTO = ("seq", "visto", "tipo", "client", "server", "porta", "dettaglio")
COLONNE_NOME = ("seq", "visto", "client", "tipo", "nome", "conteggio")

# byte_ritorno e risposta: solo dal profilo avanzato (Zeek sa chi ha aperto); NULL = «non so», mai 0.
COLONNE = ("seq", "inizio", "durata_s", "client", "server", "proto", "porta", "byte", "pacchetti", "flussi", "esterni", "fonte",
           "byte_ritorno", "risposta")
FONTI = ("mirror", "netflow", "sflow")
FINESTRA_S = 300


def ora_utc(epoca: float | None = None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(epoca))


def apri(percorso: str) -> sqlite3.Connection:
    db = sqlite3.connect(percorso, timeout=10)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript(SCHEMA)
    db.executescript(CREATE_IDENTITA)
    db.executescript(CREATE_ESTERNI)
    db.executescript(CREATE_CONNESSIONI)
    # Archivio nato prima di NetFlow e sFlow: la colonna si aggiunge, le righe vecchie sono mirror.
    if "fonte" not in [c[1] for c in db.execute("PRAGMA table_info(coppia)")]:
        db.execute("ALTER TABLE coppia ADD COLUMN fonte TEXT NOT NULL DEFAULT 'mirror'")
    gia = [c[1] for c in db.execute("PRAGMA table_info(coppia)")]
    for colonna in ("byte_ritorno", "risposta"):
        if colonna not in gia:
            db.execute(f"ALTER TABLE coppia ADD COLUMN {colonna} INTEGER")
    db.commit()
    return db


@contextmanager
def transazione(db: sqlite3.Connection):
    """Una transazione; dentro un'altra già aperta non chiude niente, decide quella di fuori.
    Serve all'adattatore di Zeek: righe di una finestra e nome del registro tradotto insieme, o niente."""
    if db.in_transaction:
        yield
        return
    with db:
        db.execute("BEGIN")
        yield


def scrivi_finestra(db: sqlite3.Connection, inizio: str, coppie: list[dict], durata_s: int = FINESTRA_S, fonte: str = "mirror") -> int:
    """Scrive le coppie di una finestra in una sola transazione. Ritorna quante righe."""
    with transazione(db):
        db.executemany(
            "INSERT INTO coppia (inizio, durata_s, client, server, proto, porta, byte, pacchetti, flussi, esterni, fonte, byte_ritorno, risposta)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (inizio, durata_s, c["client"], c["server"], c["proto"], c["porta"],
                 c["byte"], c["pacchetti"], c["flussi"], c.get("esterni", 0), fonte, c.get("byte_ritorno"), c.get("risposta"))
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


def ultimo_seq(db: sqlite3.Connection, tabella: str = "coppia") -> int:
    r = db.execute("SELECT seq FROM sqlite_sequence WHERE name = ?", (tabella,)).fetchone()
    return int(r[0]) if r else 0


def scrivi_fatto(db: sqlite3.Connection, visto: str, tipo: str, client: str, server: str, porta: int, dettaglio: dict) -> None:
    with transazione(db):
        db.execute(
            "INSERT INTO fatto (visto, tipo, client, server, porta, dettaglio) VALUES (?, ?, ?, ?, ?, ?)",
            (visto, tipo, client, server, int(porta), json.dumps(dettaglio, separators=(",", ":"), sort_keys=True)),
        )


def scrivi_nomi(db: sqlite3.Connection, visto: str, conteggi: dict[tuple[str, str, str], int]) -> None:
    """`conteggi`: (client, tipo, nome) → quante volte nella finestra."""
    with transazione(db):
        db.executemany(
            "INSERT INTO nome (visto, client, tipo, nome, conteggio) VALUES (?, ?, ?, ?, ?)",
            [(visto, k[0], k[1], k[2], n) for k, n in conteggi.items()],
        )


def _leggi(db: sqlite3.Connection, tabella: str, colonne: tuple[str, ...], dopo: int, limite: int):
    """Stessa forma di `leggi_coppie`, per le tabelle col numero progressivo."""
    limite = max(1, min(int(limite), 1000))
    dopo = max(0, int(dopo))
    grezze = db.execute(
        f"SELECT {', '.join(colonne)} FROM {tabella} WHERE seq > ? ORDER BY seq LIMIT ?", (dopo, limite + 1)
    ).fetchall()
    altri = len(grezze) > limite
    righe = [dict(zip(colonne, r)) for r in grezze[:limite]]
    piu_vecchio = db.execute(f"SELECT MIN(seq) FROM {tabella}").fetchone()[0]
    buco = dopo > 0 and piu_vecchio is not None and dopo < piu_vecchio - 1
    return righe, (righe[-1]["seq"] if righe else dopo), altri, buco


def leggi_fatti(db: sqlite3.Connection, dopo: int, limite: int):
    righe, ultimo, altri, buco = _leggi(db, "fatto", COLONNE_FATTO, dopo, limite)
    for r in righe:
        try:
            r["dettaglio"] = json.loads(r["dettaglio"])
        except ValueError:
            r["dettaglio"] = {}
    return righe, ultimo, altri, buco


def leggi_nomi(db: sqlite3.Connection, dopo: int, limite: int):
    return _leggi(db, "nome", COLONNE_NOME, dopo, limite)


def scrivi_identita(db: sqlite3.Connection, voci: list[dict]) -> None:
    """Una riga per (mac, ip, fonte): quella vecchia si toglie e la nuova prende un numero nuovo,
    così chi legge col cursore la riceve di nuovo quando qualcosa è cambiato."""
    with transazione(db):
        for v in voci:
            db.execute("DELETE FROM identita WHERE mac = ? AND ip = ? AND fonte = ?", (v["mac"], v["ip"], v["fonte"]))
            db.execute(
                "INSERT INTO identita (visto, mac, ip, vlan, fonte, nome, tipo) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (v["visto"], v["mac"], v["ip"], int(v["vlan"]), v["fonte"], v["nome"], v["tipo"]),
            )


def leggi_identita(db: sqlite3.Connection, dopo: int, limite: int):
    """Come le altre letture, ma senza «buco»: qui le righe si riscrivono, i numeri mancanti sono normali."""
    righe, ultimo, altri, _ = _leggi(db, "identita", COLONNE_IDENTITA, dopo, limite)
    return righe, ultimo, altri, False


def scrivi_esterni(db: sqlite3.Connection, inizio: str, voci: list[dict]) -> int:
    with transazione(db):
        db.executemany(
            "INSERT INTO esterno (inizio, interno, ip, verso, proto, porta, byte, pacchetti, flussi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(inizio, v["interno"], v["ip"], v["verso"], v["proto"], v["porta"], v["byte"], v["pacchetti"], v["flussi"]) for v in voci],
        )
    return len(voci)


def leggi_esterni(db: sqlite3.Connection, dopo: int, limite: int):
    return _leggi(db, "esterno", COLONNE_ESTERNO, dopo, limite)


def scrivi_nomi_ip(db: sqlite3.Connection, voci: list[dict]) -> None:
    """Il nome con cui un indirizzo esterno è stato chiesto (DNS) o chiamato (TLS): uno per (ip, tipo), l'ultimo."""
    with transazione(db):
        for v in voci:
            db.execute("DELETE FROM nome_ip WHERE ip = ? AND tipo = ?", (v["ip"], v["tipo"]))
            db.execute("INSERT INTO nome_ip (visto, ip, tipo, nome) VALUES (?, ?, ?, ?)", (v["visto"], v["ip"], v["tipo"], v["nome"]))


def leggi_nomi_ip(db: sqlite3.Connection, dopo: int, limite: int):
    righe, ultimo, altri, _ = _leggi(db, "nome_ip", COLONNE_NOME_IP, dopo, limite)
    return righe, ultimo, altri, False


def scrivi_connessioni(db: sqlite3.Connection, inizio: str, righe: list[dict]) -> None:
    nomi = COLONNE_CONNESSIONE[2:]
    with transazione(db):
        db.executemany(
            f"INSERT INTO connessione (inizio, {', '.join(nomi)}) VALUES (?{', ?' * len(nomi)})",
            [(inizio, *(r[n] for n in nomi)) for r in righe],
        )


def leggi_connessioni(db: sqlite3.Connection, dopo: int, limite: int):
    return _leggi(db, "connessione", COLONNE_CONNESSIONE, dopo, limite)


def sfoltisci(db: sqlite3.Connection, giorni: int = 7) -> int:
    """Butta le finestre più vecchie di `giorni`. Ritorna quante righe ha tolto."""
    with transazione(db):
        tolte = db.execute("DELETE FROM coppia WHERE inizio < datetime('now', ?)", (f"-{int(giorni)} days",)).rowcount
        db.execute("DELETE FROM fatto WHERE visto < datetime('now', ?)", (f"-{int(giorni)} days",))
        db.execute("DELETE FROM nome WHERE visto < datetime('now', ?)", (f"-{int(giorni)} days",))
        db.execute("DELETE FROM identita WHERE visto < datetime('now', ?)", (f"-{int(giorni)} days",))
        db.execute("DELETE FROM esterno WHERE inizio < datetime('now', ?)", (f"-{int(giorni)} days",))
        db.execute("DELETE FROM nome_ip WHERE visto < datetime('now', ?)", (f"-{int(giorni)} days",))
        db.execute("DELETE FROM connessione WHERE inizio < datetime('now', ?)", (f"-{int(giorni)} days",))
    return tolte


def metti_stato(db: sqlite3.Connection, chiave: str, valore: object) -> None:
    with transazione(db):
        db.execute(
            "INSERT INTO stato (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore",
            (chiave, str(valore)),
        )


def leggi_stato(db: sqlite3.Connection, chiave: str, ripiego: str = "") -> str:
    r = db.execute("SELECT valore FROM stato WHERE chiave = ?", (chiave,)).fetchone()
    return r[0] if r else ripiego
