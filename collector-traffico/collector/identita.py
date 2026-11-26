"""Chi è un indirizzo: dalla copia del traffico si legge quale MAC ha quale IP, e come si presenta.

Fonti: ARP, DHCP (nome dell'host, classe del produttore, opzioni chieste), mDNS, NetBIOS, SSDP,
LLDP e CDP (l'apparato vicino e la sua porta). Modulo puro: da un pacchetto Ethernet a una lista
di osservazioni `{mac, ip, vlan, fonte, nome, tipo}`. Niente contenuto: solo come un apparato
si annuncia alla rete.

Il MAC di chi manda vale come MAC dell'indirizzo solo dentro la stessa rete di livello 2: per
mDNS, NetBIOS e SSDP si guardano solo i pacchetti a tutti (multicast o broadcast), che un
router non inoltra. Per DHCP il MAC è quello scritto nel messaggio, non quello di chi lo porta.
"""
from __future__ import annotations

from .controlli import _nome_netbios

TESTO_MASSIMO = 120
_CDP = b"\x01\x00\x0c\xcc\xcc\xcc"
_PORTE = {67, 68, 137, 1900, 5353}


def _mac(b: bytes) -> str:
    return ":".join(f"{x:02x}" for x in b)


def _ip(b: bytes) -> str:
    return ".".join(str(x) for x in b)


def _testo(b: bytes, massimo: int = TESTO_MASSIMO) -> str:
    """Testo leggibile e corto: via i caratteri di controllo, mai più di `massimo`."""
    t = b.decode("utf-8", "replace")
    return "".join(c for c in t if c.isprintable() and c != "�").strip()[:massimo]


def _mac_buono(b: bytes) -> bool:
    return len(b) == 6 and b != b"\x00" * 6 and not b[0] & 1


def _voce(mac: bytes, ip: str, vlan: int, fonte: str, nome: str = "", tipo: str = "") -> dict:
    return {"mac": _mac(mac), "ip": ip, "vlan": vlan, "fonte": fonte, "nome": nome, "tipo": tipo}


def _arp(p: bytes, i: int, vlan: int) -> list[dict]:
    if len(p) < i + 28 or p[i + 2:i + 4] != b"\x08\x00" or p[i + 4] != 6 or p[i + 5] != 4:
        return []
    sha, spa = p[i + 8:i + 14], p[i + 14:i + 18]
    # la prova d'indirizzo (ARP probe) ha l'IP a zero: non dice di chi è
    if not _mac_buono(sha) or spa == b"\x00\x00\x00\x00":
        return []
    return [_voce(sha, _ip(spa), vlan, "arp")]


def _dhcp(c: bytes, vlan: int) -> list[dict]:
    if len(c) < 240 or c[1] != 1 or c[2] != 6 or c[236:240] != b"\x63\x82\x53\x63":
        return []
    chaddr = c[28:34]
    if not _mac_buono(chaddr):
        return []
    opzioni: dict[int, bytes] = {}
    i = 240
    while i < len(c):
        codice = c[i]
        if codice == 255:
            break
        if codice == 0:
            i += 1
            continue
        if i + 2 > len(c):
            break
        lung = c[i + 1]
        opzioni[codice] = c[i + 2:i + 2 + lung]  # un'opzione tagliata dalla cattura resta corta
        i += 2 + lung
    messaggio = opzioni.get(53, b"\x00")[:1]
    if c[0] == 2:
        # la conferma del server (ACK): l'indirizzo dato a quel MAC
        if messaggio != b"\x05" or c[16:20] == b"\x00\x00\x00\x00":
            return []
        return [_voce(chaddr, _ip(c[16:20]), vlan, "dhcp")]
    if c[0] != 1:
        return []
    chiesto = opzioni.get(50, b"")
    ip = _ip(chiesto) if len(chiesto) == 4 else (_ip(c[12:16]) if c[12:16] != b"\x00\x00\x00\x00" else "")
    tipo = _testo(opzioni.get(60, b""), 60)
    if 55 in opzioni:
        tipo = f"{tipo} [{','.join(str(x) for x in opzioni[55][:40])}]".strip()
    return [_voce(chaddr, ip, vlan, "dhcp", _testo(opzioni.get(12, b""), 63).lower(), tipo[:TESTO_MASSIMO])]


def _nome_compresso(c: bytes, i: int) -> tuple[str, int]:
    """Un nome DNS che può rimandare indietro (compressione). Ritorna (nome, posizione dopo il nome)."""
    pezzi: list[str] = []
    dopo = -1
    salti = 0
    while i < len(c):
        n = c[i]
        if n == 0:
            i += 1
            break
        if n & 0xC0 == 0xC0:
            if i + 1 >= len(c) or salti >= 8:
                return "", len(c)
            if dopo < 0:
                dopo = i + 2
            i = ((n & 0x3F) << 8) | c[i + 1]
            salti += 1
            continue
        if n & 0xC0 or i + 1 + n > len(c):
            return "", len(c)
        pezzi.append(c[i + 1:i + 1 + n].decode("ascii", "replace"))
        i += 1 + n
    return ".".join(pezzi).lower(), (dopo if dopo >= 0 else i)


def _mdns(c: bytes, mac: bytes, ip_di_chi_manda: str, vlan: int) -> list[dict]:
    """Da una risposta mDNS il nome che l'host dà a sé stesso: il record A che porta il suo indirizzo."""
    if len(c) < 12 or not c[2] & 0x80:
        return []
    domande = int.from_bytes(c[4:6], "big")
    risposte = int.from_bytes(c[6:8], "big") + int.from_bytes(c[10:12], "big")
    i = 12
    for _ in range(min(domande, 8)):
        _, i = _nome_compresso(c, i)
        i += 4
    for _ in range(min(risposte, 24)):
        nome, i = _nome_compresso(c, i)
        if i + 10 > len(c):
            break
        tipo = int.from_bytes(c[i:i + 2], "big")
        lung = int.from_bytes(c[i + 8:i + 10], "big")
        dati = c[i + 10:i + 10 + lung]
        i += 10 + lung
        if tipo == 1 and len(dati) == 4 and _ip(dati) == ip_di_chi_manda and nome:
            return [_voce(mac, ip_di_chi_manda, vlan, "mdns", _testo(nome.encode(), 253))]
    return []


def _netbios(c: bytes, mac: bytes, ip: str, vlan: int) -> list[dict]:
    """Un host che registra il proprio nome NetBIOS (operazione 5), a tutta la rete."""
    if len(c) < 12 or c[2] & 0x80 or (c[2] >> 3) & 0x0F != 5:
        return []
    nome = _nome_netbios(c)
    return [_voce(mac, ip, vlan, "netbios", nome)] if nome else []


def _ssdp(c: bytes, mac: bytes, ip: str, vlan: int) -> list[dict]:
    if not c.startswith(b"NOTIFY "):
        return []
    for riga in c.split(b"\r\n")[1:12]:
        if riga[:7].upper() == b"SERVER:":
            tipo = _testo(riga[7:])
            return [_voce(mac, ip, vlan, "ssdp", "", tipo)] if tipo else []
    return []


def _lldp(p: bytes, i: int, mac_di_chi_manda: bytes, vlan: int) -> list[dict]:
    telaio, porta, descrizione, nome = b"", "", "", ""
    while i + 2 <= len(p):
        testa = int.from_bytes(p[i:i + 2], "big")
        tipo, lung = testa >> 9, testa & 0x1FF
        v = p[i + 2:i + 2 + lung]
        i += 2 + lung
        if tipo == 0:
            break
        if tipo == 1 and len(v) == 7 and v[0] == 4:
            telaio = v[1:]
        elif tipo == 2 and len(v) > 1:
            porta = _mac(v[1:]) if v[0] == 3 and len(v) == 7 else _testo(v[1:], 40)
        elif tipo == 4:
            descrizione = _testo(v, 40)
        elif tipo == 5:
            nome = _testo(v, 63)
    mac = telaio if _mac_buono(telaio) else mac_di_chi_manda
    if not _mac_buono(mac) or not (nome or porta):
        return []
    return [_voce(mac, "", vlan, "lldp", nome, f"porta {descrizione or porta}".strip()[:TESTO_MASSIMO])]


def _cdp(p: bytes, i: int, mac: bytes, vlan: int) -> list[dict]:
    # LLC/SNAP di Cisco (aa aa 03 00 00 0c 20 00), poi versione, durata, somma di controllo
    if p[i:i + 8] != b"\xaa\xaa\x03\x00\x00\x0c\x20\x00" or not _mac_buono(mac):
        return []
    i += 12
    nome, porta, modello = "", "", ""
    while i + 4 <= len(p):
        tipo = int.from_bytes(p[i:i + 2], "big")
        lung = int.from_bytes(p[i + 2:i + 4], "big")
        if lung < 4:
            break
        v = p[i + 4:i + lung]
        i += lung
        if tipo == 1:
            nome = _testo(v, 63)
        elif tipo == 3:
            porta = _testo(v, 40)
        elif tipo == 6:
            modello = _testo(v, 40)
    if not (nome or porta):
        return []
    return [_voce(mac, "", vlan, "cdp", nome, " · ".join(x for x in (f"porta {porta}" if porta else "", modello) if x)[:TESTO_MASSIMO])]


def osserva(p: bytes) -> list[dict]:
    """Le osservazioni che questo pacchetto dà. Lista vuota quasi sempre: si esce presto."""
    if len(p) < 14:
        return []
    dst, src = p[0:6], p[6:12]
    i = 12
    vlan = 0
    tipo = int.from_bytes(p[i:i + 2], "big")
    while tipo in (0x8100, 0x88A8) and i + 6 <= len(p):
        if not vlan:
            vlan = int.from_bytes(p[i + 2:i + 4], "big") & 0x0FFF
        i += 4
        tipo = int.from_bytes(p[i:i + 2], "big")
    i += 2
    if tipo == 0x0806:
        return _arp(p, i, vlan)
    if tipo == 0x88CC:
        return _lldp(p, i, src, vlan)
    if tipo < 0x0600:
        return _cdp(p, i, src, vlan) if dst == _CDP else []
    if tipo != 0x0800 or len(p) < i + 28 or p[i + 9] != 17 or int.from_bytes(p[i + 6:i + 8], "big") & 0x1FFF:
        return []
    j = i + (p[i] & 0x0F) * 4
    if len(p) < j + 8:
        return []
    sport = int.from_bytes(p[j:j + 2], "big")
    dport = int.from_bytes(p[j + 2:j + 4], "big")
    if sport not in _PORTE and dport not in _PORTE:
        return []
    carico = p[j + 8:]
    if dport in (67, 68):
        return _dhcp(carico, vlan)
    # da qui il MAC di chi manda vale solo se il pacchetto è per tutti: un router non lo inoltra
    if not dst[0] & 1 or not _mac_buono(src):
        return []
    ip = _ip(p[i + 12:i + 16])
    if ip == "0.0.0.0":
        return []
    if sport == 5353:
        return _mdns(carico, src, ip, vlan)
    if dport == 137:
        return _netbios(carico, src, ip, vlan)
    if dport == 1900:
        return _ssdp(carico, src, ip, vlan)
    return []


def indirizzi_dns(c: bytes) -> list[tuple[str, str]]:
    """Da una risposta DNS: (indirizzo IPv4, nome CHIESTO) per ogni record A. Il nome è quello della domanda,
    non quello del record: dietro un CNAME il record porta il nome della rete di distribuzione."""
    if len(c) < 12 or not c[2] & 0x80 or int.from_bytes(c[4:6], "big") < 1:
        return []
    chiesto, i = _nome_compresso(c, 12)
    i += 4
    if not chiesto:
        return []
    for _ in range(int.from_bytes(c[4:6], "big") - 1):
        _, i = _nome_compresso(c, i)
        i += 4
    trovati: list[tuple[str, str]] = []
    for _ in range(min(int.from_bytes(c[6:8], "big"), 24)):
        _, i = _nome_compresso(c, i)
        if i + 10 > len(c):
            break
        tipo = int.from_bytes(c[i:i + 2], "big")
        lung = int.from_bytes(c[i + 8:i + 10], "big")
        dati = c[i + 10:i + 10 + lung]
        i += 10 + lung
        if tipo == 1 and len(dati) == 4:
            trovati.append((_ip(dati), chiesto[:253]))
    return trovati
