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
import itertools
import json
import os
import re
import time

from . import archivio, connessioni, piega, profili, zeek_stato

# Nome di un registro chiuso da Zeek senza zeekctl, visto sul banco il 23/11/2026 (Zeek 9.0.1):
# `conn.2026-11-23-13-00-00.log`. L'ora è quella di APERTURA del file (UTC: il servizio gira con TZ=UTC), e Zeek
# chiude ogni 5 minuti allineato all'orologio (:00, :05, ...). Il primo file dopo l'avvio si apre alla prima riga
# (`conn.2026-11-23-12-57-33.log`, `dns.2026-11-23-12-57-26.log`): per questo si raggruppa per finestra arrotondata.
NOME_CHIUSO = re.compile(r"^(?P<registro>[a-z_]+)\.(?P<ora>\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.log$")
# I registri che l'adattatore legge; gli altri chiusi si cancellano senza leggerli.
REGISTRI = ("conn", "dns", "ssl", "x509", "snmp", "http", "ftp", "modbus", "ldap", "notice", "software", "stats")
# Ordine in cui si leggono per i fatti: il certificato scaduto (con la data, da ssl+x509) prima dell'avviso di Zeek
# sullo stesso servizio, che altrimenti lo direbbe senza data (uno l'ora per servizio: vince il primo).
ORDINE_FATTI = ("ssl", "ftp", "http", "ldap", "snmp", "modbus", "notice")
# Avvisi di Zeek che diventano fatti: solo questi, il resto si ignora (spec, «Dai registri di Zeek alle nostre tabelle»).
_AVVISI = {"SSH::Password_Guessing": "password_ssh_provate", "HTTP::SQL_Injection_Attacker": "sql_injection",
           "SSL::Invalid_Server_Cert": "tls_certificato"}
_CONNESSIONI_NEL_TESTO = re.compile(r"seen in (\d+) connections")
UNA_VOLTA_OGNI_S = 3600    # lo stesso fatto fra gli stessi due host, una volta l'ora (come `ascolto`)
_TLS_VECCHIO = {"SSLv2": "più vecchia", "SSLv3": "SSL 3.0", "TLSv10": "TLS 1.0"}  # stesse soglie di controlli.saluto_tls
_MODBUS_SCRITTURE = {"WRITE_SINGLE_COIL": "bobina", "WRITE_SINGLE_REGISTER": "registro",
                     "WRITE_MULTIPLE_COILS": "bobine", "WRITE_MULTIPLE_REGISTERS": "registri"}
NOMI_PER_HOST = 200        # nomi diversi per host e finestra, come il tetto dell'ascolto
PARZIALE_SCARTA_S = 900    # un file chiuso ma tronco da più di così non si completerà più: si scarta
# Tetti per finestra (24/11/2026): una scansione di tutte le porte da un solo host dava un `conn` da 1,35 milioni di
# righe, una coppia a riga, e `collector-traffico` moriva a 256 MB riga dopo riga, per sempre sullo stesso file.
# Oltre il tetto il dettaglio si perde e si DICE (`stato.finestra_tagliata` → IPAM «dati persi»).
COPPIE_PER_CLIENT = 3000   # coppie di uno stesso client; oltre, le sue porte finiscono nella porta 0 dello stesso server
COPPIE_MASSIME = 40000     # coppie in tutto; oltre, le nuove non si contano
ESTERNI_MASSIMI = 30000    # indirizzi esterni diversi seguiti
STORTE_MASSIME = 30000     # (client, server, porta) con aperture storte; se ne scrivono connessioni.RIGHE_MASSIME
RIGHE_PER_REGISTRO = 50000 # righe lette degli altri registri
# Dei registri diversi da `conn` si tengono in memoria solo i campi che qualcuno legge.
CAMPI = frozenset((
    "ts", "id.orig_h", "id.resp_h", "id.resp_p", "query", "answers", "server_name", "version", "cert_chain_fps", "fingerprint",
    "certificate.not_valid_after", "accesso_chiaro", "accesso_basic", "comunita_nota", "func", "note", "msg", "src", "dst", "p",
    "host", "name", "software_type", "version.major", "version.minor", "version.minor2", "version.minor3", "version.addl",
    "pkts_link", "pkts_dropped",
))
_RIUSCITE = {"SF", "S1", "S2", "S3", "RSTO", "RSTR"}
_CON_PORTA = {6, 17, 132}


def righe_file(percorso: str):
    """Le righe JSON di un registro, una alla volta: un `conn` di 5 minuti sul DA-PX-03 pesa 39 MB e letto tutto
    insieme faceva uccidere `collector-traffico` per memoria (23/11/2026). Un byte storto non ferma la lettura."""
    with open(percorso, encoding="utf-8", errors="replace") as f:
        for linea in f:
            linea = linea.strip()
            if not linea.startswith("{"):
                continue
            try:
                o = json.loads(linea)
            except ValueError:
                continue
            if isinstance(o, dict):
                yield o


def righe_altri(percorso: str) -> tuple[list[dict], bool]:
    """(righe coi soli CAMPI, tagliato) di un registro diverso da `conn`."""
    righe = [{k: v for k, v in r.items() if k in CAMPI} for r in itertools.islice(righe_file(percorso), RIGHE_PER_REGISTRO + 1)]
    return righe[:RIGHE_PER_REGISTRO], len(righe) > RIGHE_PER_REGISTRO


def _finisce_a_capo(percorso: str) -> bool:
    with open(percorso, "rb") as f:
        f.seek(0, os.SEEK_END)
        if f.tell() == 0:
            return True
        f.seek(-1, os.SEEK_END)
        return f.read(1) == b"\n"


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


def traduci_conn(righe, reti: list[str], tetto_esterni: int = piega.ESTERNI_PER_HOST, sonde: frozenset[str] = frozenset()) -> dict:
    """-> {"coppie": [...], "esterni": [...], "connessioni": [...], "tagliate": righe a cui il tetto ha tolto dettaglio}. `righe`: un elenco o un generatore (si legge una volta).
    Il verso viene da Zeek: client = chi ha aperto (`id.orig_h`), server = chi risponde. Niente indovinare dalle porte.
    In memoria restano solo i totali (coppie, esterni per indirizzo, connessioni storte), mai le righe."""
    rr = piega._reti(reti)
    memo: dict[str, str] = {}
    coppie: dict[tuple, dict] = {}
    grezze: dict[tuple, dict] = {}        # (client, server, proto, porta) con gli indirizzi veri → totali, per gli esterni
    storte: dict[tuple, list[int]] = {}   # (client, server, porta) → [tentate, senza risposta, rifiutate, ripetute]
    servizi: dict[tuple, int] = {}        # (server, porta) → riuscite
    per_client: dict[str, int] = {}
    risposte = tagliate = 0
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
        if sonde and piega.rumore_di_sonda(oh, rh, proto, porta, sonde):
            continue
        if len(memo) > 50000:
            memo.clear()
        ob, rb = _intero(r.get("orig_ip_bytes")), _intero(r.get("resp_ip_bytes"))
        opk, rpk = _intero(r.get("orig_pkts")), _intero(r.get("resp_pkts"))
        client, server = piega.lato(oh, rr, memo), piega.lato(rh, rr, memo)
        c = coppie.get((client, server, proto, porta))
        if c is None:
            chiave = (client, server, proto, porta)
            if per_client.get(client, 0) >= COPPIE_PER_CLIENT:
                tagliate += 1
                chiave = (client, server, proto, 0)
                c = coppie.get(chiave)
            if c is None and len(coppie) >= COPPIE_MASSIME:
                tagliate += 1 if chiave[3] == porta else 0
                continue
            if c is None:
                c = coppie[chiave] = {"byte": 0, "pacchetti": 0, "flussi": 0, "byte_ritorno": 0, "risposta": 0, "_esterni": None}
                per_client[client] = per_client.get(client, 0) + 1
        c["byte"] += ob + rb
        c["byte_ritorno"] += rb
        c["pacchetti"] += opk + rpk
        c["flussi"] += 1
        if rpk > 0:
            c["risposta"] = 1
        if client == piega.ESTERNO or server == piega.ESTERNO:
            if c["_esterni"] is None:
                c["_esterni"] = set()
            if len(c["_esterni"]) < ESTERNI_MASSIMI:
                if client == piega.ESTERNO:
                    c["_esterni"].add(oh)
                if server == piega.ESTERNO:
                    c["_esterni"].add(rh)
        if client == piega.ESTERNO or server == piega.ESTERNO:
            g = grezze.get((oh, rh, proto, porta))
            if g is None and len(grezze) >= ESTERNI_MASSIMI:
                tagliate += 1
                g = {"byte": 0, "pacchetti": 0, "flussi": 0}  # non si tiene
            elif g is None:
                g = grezze[(oh, rh, proto, porta)] = {"c": oh, "s": rh, "proto": proto, "porta": porta, "byte": 0, "pacchetti": 0, "flussi": 0}
            g["byte"] += ob + rb
            g["pacchetti"] += opk + rpk
            g["flussi"] += 1
        if proto == 6:
            stato = str(r.get("conn_state", ""))
            if rpk > 0:
                risposte += 1
            if stato == "S0" or stato == "REJ":
                k = (client, server, rp)
                # oltre il tetto non si tiene: se ne scrivono comunque solo RIGHE_MASSIME, e le coppie contano tutto
                s = storte.setdefault(k, [0, 0, 0, 0]) if k in storte or len(storte) < STORTE_MASSIME else [0, 0, 0, 0]
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
        fuori = piega.esterni(list(grezze.values()), reti, tetto_esterni, estremi=lambda g: (g["c"], g["s"], 0, g["proto"], g["porta"]))
    return {
        "coppie": [
            {"client": k[0], "server": k[1], "proto": k[2], "porta": k[3], "byte": c["byte"], "pacchetti": c["pacchetti"],
             "flussi": c["flussi"], "esterni": len(c["_esterni"] or ()), "byte_ritorno": c["byte_ritorno"], "risposta": c["risposta"]}
            for k, c in coppie.items()
        ],
        "esterni": fuori,
        "connessioni": righe_conn[:connessioni.RIGHE_MASSIME],
        "tagliate": tagliate,
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
    if registro == "notice":
        tipo = _AVVISI.get(str(r.get("note", "")))
        if tipo == "password_ssh_provate":
            m = _CONNESSIONI_NEL_TESTO.search(str(r.get("msg", "")))
            return [(tipo, {"connessioni": int(m.group(1))} if m else {})]
        if tipo == "sql_injection":
            return [(tipo, {})]
        if tipo == "tls_certificato":
            testo = str(r.get("msg", "")).lower()
            motivo = "autofirmato" if "self signed" in testo else "scaduto" if "expired" in testo else "non_valido"
            return [(tipo, {"motivo": motivo})]
    return []


def traduci_software(righe: list[dict], reti: list[str]) -> dict[tuple[str, str, str], int]:
    """Programmi dichiarati in rete (`software.log`: server HTTP e SSH, browser...) → conteggi per `scrivi_nomi` col
    tipo "software" e nome `<tipo>:<nome> <versione>` (es. `HTTP::SERVER:nginx 1.22.1`). Solo host di casa.
    È la versione che il programma dice di sé, non una verifica."""
    rr = piega._reti(reti)
    memo: dict[str, str] = {}
    conteggi: dict[tuple[str, str, str], int] = {}
    per_host: dict[str, set] = {}
    for r in righe:
        host = piega.lato(str(r.get("host", "")), rr, memo)
        nome = str(r.get("name") or "").strip()
        if not nome or host in (piega.ESTERNO, piega.DIFFUSIONE):
            continue
        pezzi = [str(r[k]) for k in ("version.major", "version.minor", "version.minor2", "version.minor3") if r.get(k) is not None]
        versione = ".".join(pezzi) + (str(r["version.addl"]) if r.get("version.addl") else "")
        testo = f"{r.get('software_type', '')}:{nome}{(' ' + versione) if versione else ''}"[:253]
        visti = per_host.setdefault(host, set())
        if testo not in visti and len(visti) >= NOMI_PER_HOST:
            continue
        visti.add(testo)
        conteggi[(host, "software", testo)] = conteggi.get((host, "software", testo), 0) + 1
    return conteggi


def _estremi_fatto(registro: str, tipo: str, r: dict) -> tuple[str, str, int] | None:
    """(client, server, porta) del fatto, come li scrive `ascolto`. Un avviso di Zeek ha `src`/`dst` invece di `id`;
    il certificato è del servizio, non di chi si collega (client vuoto, uno per servizio)."""
    if tipo == "tls_certificato":
        server = r.get("id.resp_h") or r.get("dst")
        porta = r.get("id.resp_p") or r.get("p") or 0
        return ("", str(server), int(porta)) if server else None
    if registro == "notice":
        porta = {"password_ssh_provate": 22, "sql_injection": 80}.get(tipo, 0)
        return (str(r["src"]), str(r.get("dst") or ""), porta) if r.get("src") else None
    return str(r["id.orig_h"]), str(r["id.resp_h"]), int(r.get("id.resp_p", 0) or 0)


def _scaduti(registri: dict[str, list[dict]]) -> list[dict]:
    """Righe di `ssl` il cui certificato del server (il primo della catena, letto in `x509`) era scaduto quando è stato visto.
    Diventano `tls_certificato` col motivo «scaduto» e la data, come nell'ascolto."""
    scadenze: dict[str, float] = {}
    for x in registri.get("x509", []):
        try:
            scadenze[str(x["fingerprint"])] = float(x["certificate.not_valid_after"])
        except (KeyError, TypeError, ValueError):
            continue
    fuori = []
    for r in registri.get("ssl", []):
        catena = r.get("cert_chain_fps") or []
        try:
            scade = scadenze.get(str(catena[0])) if catena else None
            if scade is not None and scade < float(r["ts"]):
                fuori.append({**r, "_scaduto_il": archivio.ora_utc(scade)[:10]})
        except (KeyError, TypeError, ValueError):
            continue
    return fuori


def traduci_fatti(registri: dict[str, list[dict]], reti: list[str], detti: dict[tuple, float] | None = None) -> list[dict]:
    """-> fatti nella forma di `archivio.scrivi_fatto` (visto, tipo, client, server, porta, dettaglio), solo dei tipi
    che nel profilo avanzato fa Zeek (`profili.DA_ZEEK`). `detti`: (tipo, client, server) → ultima volta, condiviso
    fra un giro e l'altro dal chiamante: lo stesso fatto fra gli stessi due host si scrive una volta l'ora."""
    rr = piega._reti(reti)
    memo: dict[str, str] = {}
    detti = {} if detti is None else detti
    fuori = []
    righe_per: list[tuple[str, dict, list[tuple[str, dict]]]] = [
        ("ssl", r, [("tls_certificato", {"motivo": "scaduto", "scaduto_il": r["_scaduto_il"]})]) for r in _scaduti(registri)
    ]
    for registro in ORDINE_FATTI:
        righe_per += [(registro, r, _fatti_di(registro, r)) for r in registri.get(registro, [])]
    for registro, r, trovati in righe_per:
        for tipo, dettaglio in trovati:
            if profili.fonte(tipo, "avanzato") != "zeek":
                continue
            try:
                ts = float(r["ts"])
                estremi = _estremi_fatto(registro, tipo, r)
                if estremi is None:
                    continue
                client = piega.lato(estremi[0], rr, memo) if estremi[0] else ""
                server = piega.lato(estremi[1], rr, memo) if estremi[1] else ""
                porta = estremi[2]
            except (KeyError, TypeError, ValueError):
                continue
            # un certificato si guarda solo per i servizi di casa, come nell'ascolto
            if tipo == "tls_certificato" and server in ("", piega.ESTERNO, piega.DIFFUSIONE):
                continue
            chiave = (tipo, client, server)
            if ts - detti.get(chiave, -UNA_VOLTA_OGNI_S) < UNA_VOLTA_OGNI_S:
                continue
            detti[chiave] = ts
            fuori.append({"visto": archivio.ora_utc(ts), "tipo": tipo, "client": client, "server": server,
                          "porta": porta, "dettaglio": dettaglio})
    return fuori


def scrivi_registri(db, registri: dict[str, list[dict]], inizio: str, reti: list[str], tetto_esterni: int,
                    stato: dict[str, str] | None = None, detti: dict[tuple, float] | None = None,
                    sonde: frozenset[str] = frozenset(), tagliato: bool = False) -> int:
    """Tutti i registri di una finestra nell'archivio, in UNA transazione insieme a `stato` (caso 2). Ritorna le coppie scritte."""
    conn = traduci_conn(registri.get("conn", []), reti, tetto_esterni, sonde)
    if conn["tagliate"] or tagliato:
        print(f"collector: finestra {inizio} tagliata dal tetto ({conn['tagliate']} connessioni senza dettaglio)", flush=True)
    nomi_dns, ip_dns = traduci_dns(registri.get("dns", []), inizio, reti)
    nomi_sni, ip_sni = traduci_ssl(registri.get("ssl", []), inizio, reti)
    programmi = traduci_software(registri.get("software", []), reti)
    fatti = traduci_fatti(registri, reti, detti)
    visti, persi = zeek_stato.copertura_da_stats(registri.get("stats", []))
    with archivio.transazione(db):
        if visti or persi:
            # contatori cumulati, come quelli della scheda nel profilo leggero: /v1/stato ne fa la copertura
            archivio.metti_stato(db, "pacchetti_visti", int(archivio.leggi_stato(db, "pacchetti_visti", "0") or 0) + visti)
            archivio.metti_stato(db, "pacchetti_persi", int(archivio.leggi_stato(db, "pacchetti_persi", "0") or 0) + persi)
        if conn["tagliate"] or tagliato:
            archivio.metti_stato(db, "finestra_tagliata", inizio)
        for f in fatti:
            archivio.scrivi_fatto(db, f["visto"], f["tipo"], f["client"], f["server"], f["porta"], f["dettaglio"])
        scritte = archivio.scrivi_finestra(db, inizio, conn["coppie"])
        if conn["esterni"]:
            archivio.scrivi_esterni(db, inizio, conn["esterni"])
        if conn["connessioni"]:
            archivio.scrivi_connessioni(db, inizio, conn["connessioni"])
        if nomi_dns or nomi_sni or programmi:
            archivio.scrivi_nomi(db, inizio, {**nomi_dns, **nomi_sni, **programmi})
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
              detti: dict[tuple, float] | None = None, sonde: frozenset[str] = frozenset()) -> int:
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
        aspetta = tagliato = False
        for registro, nome in sorted(file.items()):
            percorso = os.path.join(cartella, nome)
            if registro not in REGISTRI:
                continue
            gia = NOME_CHIUSO.match(archivio.leggi_stato(db, f"zeek_ultimo_{registro}"))
            if gia and gia["ora"] >= NOME_CHIUSO.match(nome)["ora"]:
                os.unlink(percorso)  # tradotto prima di un arresto, mai cancellato: non si ritraduce
                continue
            try:
                intero = _finisce_a_capo(percorso)
            except OSError:
                _scarta(db, cartella, nome)
                continue
            if not intero:
                if adesso - os.path.getmtime(percorso) > PARZIALE_SCARTA_S:
                    _scarta(db, cartella, nome)
                    continue
                aspetta = True
                break
            # `conn` si legge mentre si traduce (generatore), gli altri sono piccoli
            if registro == "conn":
                registri[registro] = righe_file(percorso)
            else:
                registri[registro], troppe = righe_altri(percorso)
                tagliato = tagliato or troppe
            stato[f"zeek_ultimo_{registro}"] = nome
            tradotti.append(percorso)
        if aspetta:
            break  # le finestre si traducono in ordine: si riprova al giro dopo
        if registri:
            scritte += scrivi_registri(db, registri, inizio, reti, tetto_esterni, stato, _DETTI if detti is None else detti,
                                       sonde, tagliato)
            if len(_DETTI) > 20000:
                _DETTI.clear()  # meglio ripetere un fatto che finire la RAM (come `ascolto`)
        for percorso in tradotti:
            os.unlink(percorso)
        for registro, nome in file.items():
            if registro not in REGISTRI and os.path.exists(os.path.join(cartella, nome)):
                os.unlink(os.path.join(cartella, nome))
    return scritte
