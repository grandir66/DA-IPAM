"""Da righe di conteggio (una per flusso e direzione) a coppie client-server.

Funzioni pure: niente file, niente rete. Le usa `__main__` e le provano i test.
"""
from __future__ import annotations

import ipaddress
import json

RETI_INTERNE_DI_SERIE = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    # IPv6 locale: senza queste ogni vicino IPv6 della LAN risulterebbe «esterno».
    "fc00::/7",
    "fe80::/10",
]

PORTA_ALTA = 32768
ESTERNO = "esterno"
# Multicast e broadcast non sono un host: non vanno contati come uscita verso internet.
DIFFUSIONE = "diffusione"

_PROTO = {"icmp": 1, "igmp": 2, "tcp": 6, "udp": 17, "gre": 47, "esp": 50, "ipv6-icmp": 58, "icmpv6": 58}
_CON_PORTA = {6, 17, 132}


def numero_proto(valore: object) -> int:
    """pmacct scrive il protocollo per nome («tcp») o per numero: qui sempre numero."""
    if isinstance(valore, int):
        return valore
    testo = str(valore).strip().lower()
    if testo.isdigit():
        return int(testo)
    return _PROTO.get(testo, 0)


def da_pmacct(testo: str) -> list[dict]:
    """Il file del plugin `print` di pmacct (un oggetto JSON per riga) nelle righe di `piega`.
    Una riga che non si legge si salta: un file troncato non deve fermare il giro."""
    righe: list[dict] = []
    for linea in testo.splitlines():
        linea = linea.strip()
        if not linea.startswith("{"):
            continue
        try:
            o = json.loads(linea)
        except ValueError:
            continue
        if not isinstance(o, dict) or "ip_src" not in o or "ip_dst" not in o:
            continue
        try:
            righe.append({
                "src": str(o["ip_src"]),
                "dst": str(o["ip_dst"]),
                "proto": numero_proto(o.get("ip_proto", 0)),
                "sport": int(o.get("port_src", 0) or 0),
                "dport": int(o.get("port_dst", 0) or 0),
                "byte": int(o.get("bytes", 0) or 0),
                "pacchetti": int(o.get("packets", 0) or 0),
            })
        except (TypeError, ValueError):
            continue
    return righe


def _reti(reti_interne: list[str]) -> list[ipaddress._BaseNetwork]:
    fatte = []
    for r in reti_interne:
        try:
            fatte.append(ipaddress.ip_network(r.strip(), strict=False))
        except ValueError:
            continue
    return fatte


def _lato(ip: str, reti: list, memo: dict[str, str]) -> str:
    """L'indirizzo com'è se è interno, altrimenti «esterno» o «diffusione»."""
    gia = memo.get(ip)
    if gia is not None:
        return gia
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        memo[ip] = ESTERNO
        return ESTERNO
    if a.is_multicast or ip == "255.255.255.255":
        esito = DIFFUSIONE
    elif any(a.version == r.version and a in r for r in reti):
        esito = ip
    else:
        esito = ESTERNO
    memo[ip] = esito
    return esito


def piega(righe: list[dict], reti_interne: list[str]) -> list[dict]:
    """Da righe pmacct (src, dst, proto, sport, dport, byte, pacchetti) a coppie.
    porta = min(sport, dport) se < 32768, altrimenti 0 («porte alte»).
    server = il lato che ha quella porta; client = l'altro. Con porta 0: server = dst.
    Le due direzioni dello stesso scambio finiscono nella stessa coppia (byte sommati).
    Un lato fuori da reti_interne diventa "esterno" e la riga porta esterni = numero di
    indirizzi esterni diversi. ICMP e protocolli senza porta: porta 0.
    Ritorna: client, server, proto, porta, byte, pacchetti, flussi, esterni."""
    reti = _reti(reti_interne)
    memo: dict[str, str] = {}
    coppie: dict[tuple, dict] = {}
    for r in righe:
        proto = int(r["proto"])
        src, dst = str(r["src"]), str(r["dst"])
        sport, dport = int(r.get("sport", 0) or 0), int(r.get("dport", 0) or 0)
        if proto not in _CON_PORTA:
            sport = dport = 0
        porta = min(sport, dport) if proto in _CON_PORTA else 0
        if porta >= PORTA_ALTA:
            porta = 0
        if porta != 0 and sport == porta and dport != porta:
            client_ip, server_ip, cport = dst, src, dport
        else:
            # porta 0, oppure il servizio è sul destinatario (anche con le due porte uguali)
            client_ip, server_ip, cport = src, dst, sport
        client, server = _lato(client_ip, reti, memo), _lato(server_ip, reti, memo)
        chiave = (client, server, proto, porta)
        c = coppie.get(chiave)
        if c is None:
            c = coppie[chiave] = {"byte": 0, "pacchetti": 0, "_flussi": set(), "_esterni": set()}
        c["byte"] += int(r.get("byte", 0) or 0)
        c["pacchetti"] += int(r.get("pacchetti", 0) or 0)
        # un flusso = una connessione: le sue due direzioni hanno gli stessi estremi
        c["_flussi"].add((client_ip, cport, server_ip))
        if client == ESTERNO:
            c["_esterni"].add(client_ip)
        if server == ESTERNO:
            c["_esterni"].add(server_ip)
    return [
        {
            "client": k[0], "server": k[1], "proto": k[2], "porta": k[3],
            "byte": c["byte"], "pacchetti": c["pacchetti"],
            "flussi": len(c["_flussi"]), "esterni": len(c["_esterni"]),
        }
        for k, c in coppie.items()
    ]


def dimezza(coppie: list[dict]) -> list[dict]:
    """Mirror che copia entrata e uscita (`MIRROR_DOPPIO=1`): ogni pacchetto è visto due volte."""
    return [{**c, "byte": c["byte"] // 2, "pacchetti": (c["pacchetti"] + 1) // 2} for c in coppie]
