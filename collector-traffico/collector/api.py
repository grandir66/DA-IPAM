"""API del collector: sola lettura, HTTPS, gettone in `Authorization: Bearer`.

Chi legge (IPAM) tiene il cursore: `GET /v1/coppie?dopo=<seq>`. Il collector non conosce IPAM.
Nei log non finisce niente delle richieste (niente IP, niente gettoni).
"""
from __future__ import annotations

import hmac
import json
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import VERSIONE, archivio

PORTA = 8477
# Tutte con la stessa forma: ?dopo=<seq>&limite=<1..1000> → {righe, ultimo_seq, altri, buco}
LETTURE = {"/v1/coppie": archivio.leggi_coppie, "/v1/fatti": archivio.leggi_fatti, "/v1/nomi": archivio.leggi_nomi,
           "/v1/identita": archivio.leggi_identita,
           "/v1/esterni": archivio.leggi_esterni, "/v1/nomi-ip": archivio.leggi_nomi_ip,
           "/v1/connessioni": archivio.leggi_connessioni}


def _intero(valori: dict, nome: str, ripiego: int) -> int:
    try:
        return int(valori.get(nome, [ripiego])[0])
    except (TypeError, ValueError):
        raise ValueError(nome)


def crea_server(percorso_db: str, gettone: str, nome: str, avviato: str,
                indirizzo: str = "0.0.0.0", porta: int = PORTA,
                certificato: str | None = None, chiave: str | None = None) -> ThreadingHTTPServer:
    """Il server pronto (non ancora in ascolto attivo: chi chiama fa `serve_forever`).
    Senza certificato parla HTTP: serve solo alle prove."""
    if not gettone:
        raise ValueError("gettone vuoto: l'API non parte senza")
    atteso = f"Bearer {gettone}".encode()

    class Richiesta(BaseHTTPRequestHandler):
        server_version = "collector"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, *_a: object) -> None:  # niente IP nei log
            return

        def _rispondi(self, codice: int, corpo: dict) -> None:
            dati = json.dumps(corpo, separators=(",", ":")).encode()
            self.send_response(codice)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(dati)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(dati)

        def do_GET(self) -> None:  # noqa: N802 (nome imposto da http.server)
            dato = (self.headers.get("Authorization") or "").encode()
            if not hmac.compare_digest(dato, atteso):
                self._rispondi(401, {"errore": "gettone mancante o sbagliato"})
                return
            url = urlsplit(self.path)
            try:
                db = archivio.apri(percorso_db)
                try:
                    if url.path == "/v1/stato":
                        visti = int(archivio.leggi_stato(db, "pacchetti_visti", "0"))
                        persi = int(archivio.leggi_stato(db, "pacchetti_persi", "0"))
                        self._rispondi(200, {
                            "versione": VERSIONE, "nome": nome, "avviato": avviato,
                            "ultimo_seq": archivio.ultimo_seq(db),
                            "ultimo_fatto": archivio.ultimo_seq(db, "fatto"),
                            "ultimo_nome": archivio.ultimo_seq(db, "nome"),
                            "pacchetti_visti": visti, "pacchetti_persi": persi,
                            "copertura": 1.0 if visti + persi == 0 else round(1 - persi / (visti + persi), 6),
                            # sonda avanzata (23/11): chi conta, e se Zeek è fermo per il disco
                            "profilo": archivio.leggi_stato(db, "profilo", "leggero"),
                            "motore": archivio.leggi_stato(db, "motore", "pmacct"),
                            "versione_motore": archivio.leggi_stato(db, "versione_motore", ""),
                            "freno": archivio.leggi_stato(db, "freno", "0") == "1",
                            "scartati": int(archivio.leggi_stato(db, "zeek_scartati", "0") or 0),
                        })
                    elif url.path in LETTURE:
                        q = parse_qs(url.query)
                        dopo, limite = _intero(q, "dopo", 0), _intero(q, "limite", 1000)
                        if dopo < 0 or not 1 <= limite <= 1000:
                            raise ValueError("limite")
                        righe, ultimo, altri, buco = LETTURE[url.path](db, dopo, limite)
                        self._rispondi(200, {"righe": righe, "ultimo_seq": ultimo, "altri": altri, "buco": buco})
                    else:
                        self._rispondi(404, {"errore": "rotta sconosciuta"})
                finally:
                    db.close()
            except ValueError as e:
                self._rispondi(400, {"errore": f"parametro non valido: {e}"})

    srv = ThreadingHTTPServer((indirizzo, porta), Richiesta)
    srv.daemon_threads = True
    if certificato:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(certificato, chiave)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    return srv
