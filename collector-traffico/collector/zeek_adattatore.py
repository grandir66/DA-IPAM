"""Dai registri di Zeek (profilo avanzato) alle tabelle dell'archivio: le stesse del profilo leggero.

Zeek scrive registri JSON e li chiude ogni 5 minuti (`sonda.zeek`); qui si prendono SOLO i file chiusi, si
traducono e si cancellano. Funzioni pure per la traduzione, `giro_zeek` per i file. Piano 2026-11-23-sonda-avanzata-zeek.

Casi da non dimenticare (dal piano):
1. un registro letto mentre Zeek lo scrive: si prendono solo i file col nome dei chiusi, e un file la cui ultima
   riga non finisce con «a capo» si lascia al giro dopo;
2. arresto fra la scrittura nell'archivio e la cancellazione: il nome del registro tradotto si scrive in `stato`
   (`zeek_ultimo_<registro>`) nella stessa transazione delle righe; un file già tradotto si cancella senza ritradurlo.
"""
from __future__ import annotations

import calendar
import ipaddress
import json
import os
import re
import time

from . import archivio, connessioni, piega, profili

# Nome di un registro chiuso da Zeek senza zeekctl, visto sul banco il 23/11/2026 (Zeek 9.0.1):
# `conn.2026-11-23-13-00-00.log`. L'ora è quella di APERTURA del file (UTC: il servizio gira con TZ=UTC), e Zeek
# chiude ogni 5 minuti allineato all'orologio (:00, :05, ...). Il primo file dopo l'avvio si apre alla prima riga
# (`conn.2026-11-23-12-57-33.log`, `dns.2026-11-23-12-57-26.log`): per questo si raggruppa per finestra arrotondata.
NOME_CHIUSO = re.compile(r"^(?P<registro>[a-z_]+)\.(?P<ora>\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.log$")
# I registri che l'adattatore legge; gli altri chiusi si cancellano senza leggerli.
REGISTRI = ("conn", "dns", "ssl", "snmp", "http", "ftp", "modbus", "ldap")
UNA_VOLTA_OGNI_S = 3600    # lo stesso fatto fra gli stessi due host, una volta l'ora (come `ascolto`)
_TLS_VECCHIO = {"SSLv2": "più vecchia", "SSLv3": "SSL 3.0", "TLSv10": "TLS 1.0"}  # stesse soglie di controlli.saluto_tls
_MODBUS_SCRITTURE = {"WRITE_SINGLE_COIL": "bobina", "WRITE_SINGLE_REGISTER": "registro",
                     "WRITE_MULTIPLE_COILS": "bobine", "WRITE_MULTIPLE_REGISTERS": "registri"}
NOMI_PER_HOST = 200        # nomi diversi per host e finestra, come il tetto dell'ascolto
PARZIALE_SCARTA_S = 900    # un file chiuso ma tronco da più di così non si completerà più: si scarta
_RIUSCITE = {"SF", "S1", "S2", "S3", "RSTO", "RSTR"}
_CON_PORTA = {6, 17, 132}


def leggi_registro(testo: str) -> list[dict]:
    """Righe JSON; salta righe vuote, righe che non si leggono e un'ultima riga senza a capo (in scrittura)."""
    linee = testo.split("\n")
    linee.pop()  # dopo l'ultimo «a capo» c'è "" se il file è intero, altrimenti la riga a metà
    righe = []
    for linea in linee:
        linea = linea.strip()
        if not linea.startswith("{"):
            continue
        try:
            o = json.loads(linea)
        except ValueError:
            continue
        if isinstance(o, dict):
            righe.append(o)
    return righe


def _intero(v: object) -> int:
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


def traduci_conn(righe: list[dict], reti: list[str], tetto_esterni: int = piega.ESTERNI_PER_HOST) -> dict:
    """-> {"coppie": [...], "esterni": [...], "connessioni": [...]}.
    Il verso viene da Zeek: client = chi ha aperto (`id.orig_h`), server = chi risponde. Niente indovinare dalle porte."""
    rr = piega._reti(reti)
    memo: dict[str, str] = {}
    coppie: dict[tuple, dict] = {}
    grezze: list[dict] = []
    storte: dict[tuple, list[int]] = {}   # (client, server, porta) → [tentate, senza risposta, rifiutate, ripetute]
    servizi: dict[tuple, int] = {}        # (server, porta) → riuscite
    risposte = 0
    for r in righe:
        try:
            oh, rh = str(r["id.orig_h"]), str(r["id.resp_h"])
            op, rp = int(r.get("id.orig_p", 0) or 0), int(r.get("id.resp_p", 0) or 0)
        except (KeyError, TypeError, ValueError):
            continue
        proto = piega.numero_proto(r.get("proto", 0))
        if proto not in _CON_PORTA:
            op = rp = 0
        porta = rp if rp < piega.PORTA_ALTA else 0
        ob, rb = _intero(r.get("orig_ip_bytes")), _intero(r.get("resp_ip_bytes"))
        opk, rpk = _intero(r.get("orig_pkts")), _intero(r.get("resp_pkts"))
        client, server = piega.lato(oh, rr, memo), piega.lato(rh, rr, memo)
        c = coppie.get((client, server, proto, porta))
        if c is None:
            c = coppie[(client, server, proto, porta)] = {"byte": 0, "pacchetti": 0, "flussi": 0, "byte_ritorno": 0, "risposta": 0, "_esterni": set()}
        c["byte"] += ob + rb
        c["byte_ritorno"] += rb
        c["pacchetti"] += opk + rpk
        c["flussi"] += 1
        if rpk > 0:
            c["risposta"] = 1
        if client == piega.ESTERNO:
            c["_esterni"].add(oh)
        if server == piega.ESTERNO:
            c["_esterni"].add(rh)
        grezze.append({"c": oh, "s": rh, "cp": op, "proto": proto, "porta": porta, "byte": ob + rb, "pacchetti": opk + rpk})
        if proto == 6:
            stato = str(r.get("conn_state", ""))
            if rpk > 0:
                risposte += 1
            if stato == "S0" or stato == "REJ":
                s = storte.setdefault((client, server, rp), [0, 0, 0, 0])
                s[0] += 1
                s[1 if stato == "S0" else 2] += 1
            elif stato in _RIUSCITE:
                servizi[(server, rp)] = servizi.get((server, rp), 0) + 1
    # senza nemmeno una risposta nella finestra la copia porta una direzione sola: i «senza risposta» sarebbero tutti falsi
    if risposte == 0:
        for s in storte.values():
            s[0] -= s[1]
            s[1] = 0
    righe_conn = [
        {"client": c, "server": s, "porta": p, "tentate": v[0], "senza_risposta": v[1], "rifiutate": v[2], "ripetute": 0,
         "riuscite": 0, "ms_minimo": -1, "ms_mediano": -1}
        for (c, s, p), v in sorted(storte.items(), key=lambda kv: -kv[1][0]) if v[0] > 0
    ]
    # Zeek non dà il tempo fra SYN e SYN-ACK: -1 = «non misurato da questa sonda», mai 0
    righe_conn += [
        {"client": "", "server": s, "porta": p, "tentate": n, "senza_risposta": 0, "rifiutate": 0, "ripetute": 0,
         "riuscite": n, "ms_minimo": -1, "ms_mediano": -1}
        for (s, p), n in servizi.items()
    ]
    fuori = []
    if tetto_esterni > 0:
        fuori = piega.esterni(grezze, reti, tetto_esterni, estremi=lambda g: (g["c"], g["s"], g["cp"], g["proto"], g["porta"]))
    return {
        "coppie": [
            {"client": k[0], "server": k[1], "proto": k[2], "porta": k[3], "byte": c["byte"], "pacchetti": c["pacchetti"],
             "flussi": c["flussi"], "esterni": len(c["_esterni"]), "byte_ritorno": c["byte_ritorno"], "risposta": c["risposta"]}
            for k, c in coppie.items()
        ],
        "esterni": fuori,
        "connessioni": righe_conn[:connessioni.RIGHE_MASSIME],
    }


def _nomi(coppie_nome: list[tuple[str, str, str]], reti: list[str], adesso: str, tipo: str) -> tuple[dict, list[dict]]:
    """(client, ip del server, nome) → conteggi per `scrivi_nomi` (solo client di casa) e voci per `scrivi_nomi_ip`
    (solo indirizzi esterni: il nome con cui un indirizzo di fuori è stato chiamato)."""
    rr = piega._reti(reti)
    memo: dict[str, str] = {}
    conteggi: dict[tuple[str, str, str], int] = {}
    per_host: dict[str, set] = {}
    nomi_ip: dict[str, dict] = {}
    for client_ip, ip, nome in coppie_nome:
        if ip and piega.lato(ip, rr, memo) == piega.ESTERNO:
            nomi_ip[ip] = {"visto": adesso, "ip": ip, "tipo": tipo, "nome": nome}
        client = piega.lato(client_ip, rr, memo)
        if client in (piega.ESTERNO, piega.DIFFUSIONE):
            continue
        visti = per_host.setdefault(client, set())
        if nome not in visti:
            if len(visti) >= NOMI_PER_HOST:
                continue
            visti.add(nome)
        chiave = (client, tipo, nome)
        conteggi[chiave] = conteggi.get(chiave, 0) + 1
    return conteggi, list(nomi_ip.values())


def _nome_pulito(v: object) -> str:
    return str(v or "").strip().rstrip(".").lower()[:253]


def traduci_dns(righe: list[dict], adesso: str, reti: list[str]) -> tuple[dict, list[dict]]:
    """-> (conteggi per scrivi_nomi {(client, "dns", nome): n}, voci per scrivi_nomi_ip dalle risposte A/AAAA)."""
    trovati: list[tuple[str, str, str]] = []
    for r in righe:
        nome = _nome_pulito(r.get("query"))
        client = str(r.get("id.orig_h", ""))
        if not nome or not client:
            continue
        ip_risposte = []
        for a in r.get("answers") or []:
            try:
                ip_risposte.append(str(ipaddress.ip_address(str(a))))
            except ValueError:
                continue  # un CNAME o un testo, non un indirizzo
        trovati.append((client, "", nome))
        trovati += [("", ip, nome) for ip in ip_risposte]
    return _nomi(trovati, reti, adesso, "dns")


def traduci_ssl(righe: list[dict], adesso: str, reti: list[str]) -> tuple[dict, list[dict]]:
    """-> nomi di tipo "sni" da `server_name`, voci nome_ip per `id.resp_h`."""
    trovati = []
    for r in righe:
        nome = _nome_pulito(r.get("server_name"))
        if nome:
            trovati.append((str(r.get("id.orig_h", "")), str(r.get("id.resp_h", "")), nome))
    return _nomi(trovati, reti, adesso, "sni")


def _fatti_di(registro: str, r: dict) -> list[tuple[str, dict]]:
    """I fatti (tipo, dettaglio) che una riga dimostra. Mai un valore: solo il fatto, come `controlli`."""
    if registro == "ftp" and r.get("accesso_chiaro") is True:
        return [("chiaro_ftp", {})]
    if registro == "http" and r.get("accesso_basic") is True:
        return [("chiaro_http_basic", {})]
    if registro == "ldap" and r.get("accesso_chiaro") is True:
        return [("chiaro_ldap", {})]
    if registro == "snmp" and str(r.get("version", "")) in ("1", "2c"):
        d: dict = {"versione": str(r["version"])}
        if isinstance(r.get("comunita_nota"), bool):
            d["comunita_nota"] = r["comunita_nota"]
        return [("snmp_vecchio", d)]
    if registro == "ssl" and str(r.get("version", "")) in _TLS_VECCHIO:
        return [("tls_vecchio", {"versione": _TLS_VECCHIO[str(r["version"])]})]
    if registro == "modbus":
        cosa = _MODBUS_SCRITTURE.get(str(r.get("func", "")).upper())
        if cosa:
            return [("impianto_scrittura", {"protocollo": "modbus", "cosa": cosa})]
    return []


def traduci_fatti(registri: dict[str, list[dict]], reti: list[str], detti: dict[tuple, float] | None = None) -> list[dict]:
    """-> fatti nella forma di `archivio.scrivi_fatto` (visto, tipo, client, server, porta, dettaglio), solo dei tipi
    che nel profilo avanzato fa Zeek (`profili.DA_ZEEK`). `detti`: (tipo, client, server) → ultima volta, condiviso
    fra un giro e l'altro dal chiamante: lo stesso fatto fra gli stessi due host si scrive una volta l'ora."""
    rr = piega._reti(reti)
    memo: dict[str, str] = {}
    detti = {} if detti is None else detti
    fuori = []
    for registro in sorted(registri):
        for r in registri[registro]:
            for tipo, dettaglio in _fatti_di(registro, r):
                if profili.fonte(tipo, "avanzato") != "zeek":
                    continue
                try:
                    ts = float(r["ts"])
                    client = piega.lato(str(r["id.orig_h"]), rr, memo)
                    server = piega.lato(str(r["id.resp_h"]), rr, memo)
                    porta = int(r.get("id.resp_p", 0) or 0)
                except (KeyError, TypeError, ValueError):
                    continue
                chiave = (tipo, client, server)
                if ts - detti.get(chiave, -UNA_VOLTA_OGNI_S) < UNA_VOLTA_OGNI_S:
                    continue
                detti[chiave] = ts
                fuori.append({"visto": archivio.ora_utc(ts), "tipo": tipo, "client": client, "server": server,
                              "porta": porta, "dettaglio": dettaglio})
    return fuori


def scrivi_registri(db, registri: dict[str, list[dict]], inizio: str, reti: list[str], tetto_esterni: int,
                    stato: dict[str, str] | None = None, detti: dict[tuple, float] | None = None) -> int:
    """Tutti i registri di una finestra nell'archivio, in UNA transazione insieme a `stato` (caso 2). Ritorna le coppie scritte."""
    conn = traduci_conn(registri.get("conn", []), reti, tetto_esterni)
    nomi_dns, ip_dns = traduci_dns(registri.get("dns", []), inizio, reti)
    nomi_sni, ip_sni = traduci_ssl(registri.get("ssl", []), inizio, reti)
    fatti = traduci_fatti(registri, reti, detti)
    with archivio.transazione(db):
        for f in fatti:
            archivio.scrivi_fatto(db, f["visto"], f["tipo"], f["client"], f["server"], f["porta"], f["dettaglio"])
        scritte = archivio.scrivi_finestra(db, inizio, conn["coppie"])
        if conn["esterni"]:
            archivio.scrivi_esterni(db, inizio, conn["esterni"])
        if conn["connessioni"]:
            archivio.scrivi_connessioni(db, inizio, conn["connessioni"])
        if nomi_dns or nomi_sni:
            archivio.scrivi_nomi(db, inizio, {**nomi_dns, **nomi_sni})
        if ip_dns or ip_sni:
            archivio.scrivi_nomi_ip(db, ip_dns + ip_sni)
        for chiave, valore in (stato or {}).items():
            archivio.metti_stato(db, chiave, valore)
    return scritte


def finestra(ora: str) -> str:
    """Dall'ora nel nome (apertura del file) all'inizio della sua finestra di 5 minuti, nel formato dell'archivio."""
    t = calendar.timegm(time.strptime(ora, "%Y-%m-%d-%H-%M-%S"))
    return archivio.ora_utc(t - t % archivio.FINESTRA_S)


def _scarta(db, cartella: str, nome: str) -> None:
    os.makedirs(os.path.join(cartella, "scartati"), exist_ok=True)
    os.replace(os.path.join(cartella, nome), os.path.join(cartella, "scartati", nome))
    archivio.metti_stato(db, "zeek_scartati", int(archivio.leggi_stato(db, "zeek_scartati", "0") or 0) + 1)


_DETTI: dict[tuple, float] = {}  # fra un giro e l'altro, nel processo del servizio


def giro_zeek(db, cartella: str, reti: list[str], tetto_esterni: int, adesso: float | None = None,
              detti: dict[tuple, float] | None = None) -> int:
    """Prende i file chiusi in `cartella`, li traduce per finestra, scrive, li cancella. Ritorna le coppie scritte.
    Un file che non si legge va in `cartella/scartati/` e incrementa `stato.zeek_scartati`: mai buttato in silenzio."""
    adesso = time.time() if adesso is None else adesso
    finestre: dict[str, dict[str, str]] = {}
    for nome in sorted(os.listdir(cartella)):
        m = NOME_CHIUSO.match(nome)
        if m:
            try:
                inizio = finestra(m["ora"])
            except ValueError:
                continue
            # due file dello stesso registro nella stessa finestra (Zeek riavviato): il secondo al giro dopo
            finestre.setdefault(inizio, {}).setdefault(m["registro"], nome)
    scritte = 0
    for inizio in sorted(finestre):
        file = finestre[inizio]
        registri: dict[str, list[dict]] = {}
        stato: dict[str, str] = {}
        tradotti: list[str] = []
        aspetta = False
        for registro, nome in sorted(file.items()):
            percorso = os.path.join(cartella, nome)
            if registro not in REGISTRI:
                continue
            gia = NOME_CHIUSO.match(archivio.leggi_stato(db, f"zeek_ultimo_{registro}"))
            if gia and gia["ora"] >= NOME_CHIUSO.match(nome)["ora"]:
                os.unlink(percorso)  # tradotto prima di un arresto, mai cancellato: non si ritraduce
                continue
            try:
                with open(percorso, encoding="utf-8") as f:
                    testo = f.read()
            except (OSError, UnicodeDecodeError):
                _scarta(db, cartella, nome)
                continue
            if testo and not testo.endswith("\n"):
                if adesso - os.path.getmtime(percorso) > PARZIALE_SCARTA_S:
                    _scarta(db, cartella, nome)
                    continue
                aspetta = True
                break
            registri[registro] = leggi_registro(testo)
            stato[f"zeek_ultimo_{registro}"] = nome
            tradotti.append(percorso)
        if aspetta:
            break  # le finestre si traducono in ordine: si riprova al giro dopo
        if registri:
            scritte += scrivi_registri(db, registri, inizio, reti, tetto_esterni, stato, _DETTI if detti is None else detti)
            if len(_DETTI) > 20000:
                _DETTI.clear()  # meglio ripetere un fatto che finire la RAM (come `ascolto`)
        for percorso in tradotti:
            os.unlink(percorso)
        for registro, nome in file.items():
            if registro not in REGISTRI and os.path.exists(os.path.join(cartella, nome)):
                os.unlink(os.path.join(cartella, nome))
    return scritte
