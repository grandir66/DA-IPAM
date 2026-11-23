"""Ascolto dell'inizio delle connessioni: nomi (DNS, TLS) e controlli sul contenuto.

Lancia `tcpdump` col filtro nel kernel (qui arrivano pochi pacchetti), legge il flusso pcap
dallo stdout e passa ogni carico a `controlli`. In archivio va il fatto, mai il carico.
Secondo processo del collector: se muore, il conteggio delle coppie continua.
"""
from __future__ import annotations

import os
import signal
import struct
import subprocess
import sys
import time

from . import archivio, connessioni, controlli, identita, piega

# Solo le porte dei controlli, più il saluto TLS su qualunque porta (primo byte del carico = 0x16).
_BASE = (
    "port 21 or port 23 or port 25 or port 110 or port 143 or port 389 or port 80 or port 445 "
    "or port 502 or port 102 or udp port 53 or udp port 161 or udp port 5355 or udp port 137 "
    # connessioni che non vanno (23/11): i pacchetti che aprono o rifiutano una connessione (SYN, RST).
    # DEVE stare PRIMA della clausola TLS: quella legge il primo byte del carico, e su un pacchetto senza
    # carico (un SYN, un RST) la lettura cade fuori dal pacchetto e il kernel lo SCARTA senza guardare il
    # resto del filtro. Visto sul banco il 23/11: i rifiuti verso una porta fuori dall'elenco non arrivavano.
    "or (tcp[13] & 6 != 0) "
    "or (tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16) "
    # chi è un indirizzo (23/11): ARP, DHCP, mDNS, SSDP, LLDP, CDP; NetBIOS (137) c'è già
    "or arp or udp port 67 or udp port 68 or udp port 5353 or udp port 1900 "
    "or ether proto 0x88cc or ether dst 01:00:0c:cc:cc:cc"
)
# Byte tenuti per pacchetto: le opzioni DHCP (nome dell'host) cominciano al byte 282.
CATTURA = 600
IDENTITA_OGNI_S = 10
# Il mirror di un trunk porta il tag VLAN: la stessa espressione va ripetuta dietro «vlan».
FILTRO = f"({_BASE}) or (vlan and ({_BASE}))"
# Secondo gruppo (protocollo su qualunque porta): il primo pacchetto con dati di ogni connessione.
# SOLO PER LA MISURA: non si accende senza il sì di Riccardo (piano, Task 6).
_PSH = "tcp[13] & 8 != 0"
FILTRO_SECONDO_GRUPPO = f"({_BASE}) or ({_PSH}) or (vlan and (({_BASE}) or ({_PSH})))"

FINESTRA_S = 300
UNA_VOLTA_OGNI_S = 3600
NOMI_PER_HOST_AL_GIORNO = 200
DNS_RICHIESTE_MASSIME = 1000
DNS_ATTESA_S = 10       # una richiesta DNS senza risposta da più di così è «senza risposta»
DNS_ERRORI_SOGLIA = 20  # errori o richieste senza risposta per host e finestra prima di dirlo
MEMORIA_MASSIMA = 20000  # voci per dizionario: oltre, si svuota (meglio ripetere un fatto che finire la RAM)


def leggi_pcap(flusso):
    """Genera (istante, pacchetto) da un flusso pcap classico. Si ferma a fine flusso."""
    testa = flusso.read(24)
    if len(testa) < 24:
        return
    magia = struct.unpack("<I", testa[:4])[0]
    if magia in (0xA1B2C3D4, 0xA1B23C4D):
        ordine = "<"
    elif magia in (0xD4C3B2A1, 0x4D3CB2A1):
        ordine = ">"
    else:
        raise ValueError("flusso pcap non riconosciuto")
    divisore = 1e9 if magia in (0xA1B23C4D, 0x4D3CB2A1) else 1e6
    if struct.unpack(ordine + "I", testa[20:24])[0] != 1:
        raise ValueError("serve una cattura Ethernet")
    while True:
        t = flusso.read(16)
        if len(t) < 16:
            return
        secondi, frazione, presi, _ = struct.unpack(ordine + "IIII", t)
        dati = flusso.read(presi)
        if len(dati) < presi:
            return
        yield secondi + frazione / divisore, dati


def spacchetta(pacchetto: bytes) -> tuple[str, str, int, int, int, bytes] | None:
    """Da un pacchetto Ethernet: (sorgente, destinazione, proto, porta sorgente, porta destinazione, carico).
    None se non è TCP o UDP su IP. I tag VLAN (anche doppi) si saltano."""
    i = 12
    if len(pacchetto) < 14:
        return None
    tipo = int.from_bytes(pacchetto[i:i + 2], "big")
    while tipo in (0x8100, 0x88A8) and i + 6 <= len(pacchetto):
        i += 4
        tipo = int.from_bytes(pacchetto[i:i + 2], "big")
    i += 2
    if tipo == 0x0800:
        if len(pacchetto) < i + 20:
            return None
        ihl = (pacchetto[i] & 0x0F) * 4
        proto = pacchetto[i + 9]
        # un frammento che non è il primo non ha l'intestazione TCP/UDP
        if int.from_bytes(pacchetto[i + 6:i + 8], "big") & 0x1FFF:
            return None
        src = ".".join(str(b) for b in pacchetto[i + 12:i + 16])
        dst = ".".join(str(b) for b in pacchetto[i + 16:i + 20])
        j = i + ihl
    elif tipo == 0x86DD:
        if len(pacchetto) < i + 40:
            return None
        proto = pacchetto[i + 6]
        src = _ipv6(pacchetto[i + 8:i + 24])
        dst = _ipv6(pacchetto[i + 24:i + 40])
        j = i + 40
    else:
        return None
    if proto == controlli.TCP:
        if len(pacchetto) < j + 20:
            return None
        k = j + ((pacchetto[j + 12] >> 4) * 4)
    elif proto == controlli.UDP:
        if len(pacchetto) < j + 8:
            return None
        k = j + 8
    else:
        return None
    sport = int.from_bytes(pacchetto[j:j + 2], "big")
    dport = int.from_bytes(pacchetto[j + 2:j + 4], "big")
    return src, dst, proto, sport, dport, pacchetto[k:]


def _ipv6(b: bytes) -> str:
    import ipaddress
    return str(ipaddress.IPv6Address(b))


class Ascolto:
    """Lo stato fra un pacchetto e l'altro: cosa è già stato detto, chi ha risposto per un nome,
    quante richieste DNS ha fatto un host. `scrivi_fatto` e `scrivi_nomi` si passano da fuori,
    così le prove non hanno bisogno di un archivio."""

    def __init__(self, reti_interne: list[str], scrivi_fatto, scrivi_nomi, scrivi_identita=None, scrivi_nomi_ip=None, scrivi_connessioni=None):
        self._reti = piega._reti(reti_interne)
        self._memo: dict[str, str] = {}
        self._scrivi_fatto = scrivi_fatto
        self._scrivi_nomi = scrivi_nomi
        self._scrivi_identita = scrivi_identita
        self._identita: dict[tuple[str, str, str], tuple[tuple, int]] = {}  # (mac, ip, fonte) → (cosa si sa, ultima scrittura)
        self._identita_nuove: dict[tuple[str, str, str], dict] = {}
        self._identita_scritte = 0
        self._scrivi_nomi_ip = scrivi_nomi_ip
        self._connessioni = connessioni.Connessioni(self._lato, scrivi_connessioni) if scrivi_connessioni else None
        self._nomi_ip: dict[tuple[str, str], tuple[str, int]] = {}  # (ip, tipo) → (nome, ultima scrittura)
        self._nomi_ip_nuovi: dict[tuple[str, str], dict] = {}
        self._detti: dict[tuple, int] = {}                # (tipo, client, server) → ultima volta
        self._risponde: dict[str, str] = {}               # nome → chi ha risposto per primo
        self._dns: dict[str, int] = {}                    # host → richieste DNS nella finestra
        self._dns_attese: dict[tuple[str, str, bytes], float] = {}  # (client, server, id) → quando è partita
        self._dns_esito: dict[str, list[int]] = {}        # client → [richieste, errori, senza risposta] nella finestra
        self._dns_risposte = 0
        self._nomi: dict[tuple[str, str, str], int] = {}  # (client, tipo, nome) → conteggio nella finestra
        self._nomi_del_giorno: dict[str, set] = {}
        self._giorno = ""
        self._finestra = 0

    def _lato(self, ip: str) -> str:
        return piega._lato(ip, self._reti, self._memo)

    def _fatto(self, adesso: int, tipo: str, client: str, server: str, porta: int, dettaglio: dict) -> None:
        chiave = (tipo, client, server)
        if adesso - self._detti.get(chiave, -UNA_VOLTA_OGNI_S) < UNA_VOLTA_OGNI_S:
            return
        if len(self._detti) >= MEMORIA_MASSIMA:
            self._detti.clear()
        self._detti[chiave] = adesso
        self._scrivi_fatto(archivio.ora_utc(adesso), tipo, client, server, porta, dettaglio)

    def _chiudi_dns(self, adesso: int) -> None:
        """Le richieste DNS rimaste senza risposta e gli errori della finestra: un fatto per host oltre la soglia.
        Senza nemmeno una risposta in tutta la finestra la copia porta una direzione sola: i «senza risposta» non si contano."""
        for k in [k for k, t in self._dns_attese.items() if adesso - t >= DNS_ATTESA_S]:
            del self._dns_attese[k]
            if self._dns_risposte > 0:
                self._dns_esito.setdefault(k[0], [0, 0, 0])[2] += 1
        for client, (richieste, errori, senza) in self._dns_esito.items():
            if errori >= DNS_ERRORI_SOGLIA or senza >= DNS_ERRORI_SOGLIA:
                self._fatto(adesso, "dns_errori", self._lato(client), "", 53, {"richieste": richieste, "errori": errori, "senza_risposta": senza})
        self._dns_esito = {}
        self._dns_risposte = 0

    def _dns_visto(self, adesso: int, src: str, dst: str, sport: int, dport: int, carico: bytes) -> None:
        if len(carico) < 12:
            return
        if dport == 53 and not carico[2] & 0x80:
            if len(self._dns_attese) < MEMORIA_MASSIMA:
                self._dns_attese[(src, dst, carico[:2])] = adesso
            if len(self._dns_esito) < MEMORIA_MASSIMA or src in self._dns_esito:
                self._dns_esito.setdefault(src, [0, 0, 0])[0] += 1
            client = self._lato(src)
            if self._lato(dst) == piega.ESTERNO and client not in (piega.ESTERNO, piega.DIFFUSIONE):
                # chi chiede direttamente a un DNS fuori salta quello di casa (o è il DNS di casa che inoltra)
                self._fatto(adesso, "dns_esterno", client, piega.ESTERNO, 53, {})
        elif sport == 53 and carico[2] & 0x80:
            self._dns_risposte += 1
            self._dns_attese.pop((dst, src, carico[:2]), None)
            if carico[3] & 0x0F in (2, 5) and (len(self._dns_esito) < MEMORIA_MASSIMA or dst in self._dns_esito):  # SERVFAIL, REFUSED
                self._dns_esito.setdefault(dst, [0, 0, 0])[1] += 1

    def _certificato(self, adesso: int, src: str, sport: int, carico: bytes) -> None:
        """Certificato di un servizio di casa scaduto o autofirmato (si vede fino a TLS 1.2). Uno per servizio, non per client."""
        server = self._lato(src)
        if server in (piega.ESTERNO, piega.DIFFUSIONE):
            return
        c = controlli.certificato(carico)
        if not c:
            return
        if c["scade"] and c["scade"] < archivio.ora_utc(adesso):
            self._fatto(adesso, "tls_certificato", "", server, sport, {"motivo": "scaduto", "scaduto_il": c["scade"][:10]})
        elif c["autofirmato"]:
            self._fatto(adesso, "tls_certificato", "", server, sport, {"motivo": "autofirmato"})

    def _chiudi_finestra(self, adesso: int) -> None:
        if self._connessioni and self._finestra:
            self._connessioni.chiudi_finestra(archivio.ora_utc(self._finestra), adesso)
        if self._nomi:
            self._scrivi_nomi(archivio.ora_utc(self._finestra), self._nomi)
        self._nomi = {}
        self._dns = {}
        self._chiudi_dns(adesso)
        self._finestra = adesso - adesso % FINESTRA_S
        giorno = archivio.ora_utc(adesso)[:10]
        if giorno != self._giorno:
            self._giorno = giorno
            self._nomi_del_giorno = {}

    def _osserva(self, adesso: int, voce: dict) -> None:
        """Una riga per (mac, ip, fonte): si riscrive solo se cambia qualcosa o dopo un'ora."""
        chiave = (voce["mac"], voce["ip"], voce["fonte"])
        nota = self._identita.get(chiave)
        # un pacchetto senza nome (la conferma DHCP) non cancella il nome già visto
        nome = voce["nome"] or (nota[0][0] if nota else "")
        tipo = voce["tipo"] or (nota[0][1] if nota else "")
        cosa = (nome, tipo, voce["vlan"])
        if nota and nota[0] == cosa and adesso - nota[1] < UNA_VOLTA_OGNI_S:
            return
        if len(self._identita) >= MEMORIA_MASSIMA:
            self._identita.clear()
        self._identita[chiave] = (cosa, adesso)
        if len(self._identita_nuove) < MEMORIA_MASSIMA:
            self._identita_nuove[chiave] = {**voce, "nome": nome, "tipo": tipo, "visto": archivio.ora_utc(adesso)}

    def _scrivi_le_identita(self, adesso: int) -> None:
        self._identita_scritte = adesso
        if self._identita_nuove and self._scrivi_identita:
            self._scrivi_identita(list(self._identita_nuove.values()))
        self._identita_nuove = {}
        if self._nomi_ip_nuovi and self._scrivi_nomi_ip:
            self._scrivi_nomi_ip(list(self._nomi_ip_nuovi.values()))
        self._nomi_ip_nuovi = {}

    def _nome_di_ip(self, adesso: int, ip: str, tipo: str, nome: str) -> None:
        """Il nome di un indirizzo esterno: uno per (ip, tipo). Si riscrive se cambia (non più di una volta
        ogni cinque minuti: dietro una rete di distribuzione lo stesso indirizzo serve molti nomi) o dopo un'ora."""
        if not self._scrivi_nomi_ip or self._lato(ip) != piega.ESTERNO:
            return
        chiave = (ip, tipo)
        nota = self._nomi_ip.get(chiave)
        if nota and adesso - nota[1] < (FINESTRA_S if nota[0] != nome else UNA_VOLTA_OGNI_S):
            return
        if len(self._nomi_ip) >= MEMORIA_MASSIMA:
            self._nomi_ip.clear()
        self._nomi_ip[chiave] = (nome, adesso)
        if len(self._nomi_ip_nuovi) < MEMORIA_MASSIMA:
            self._nomi_ip_nuovi[chiave] = {"visto": archivio.ora_utc(adesso), "ip": ip, "tipo": tipo, "nome": nome}

    def pacchetto(self, adesso: int, pacchetto: bytes, istante: float | None = None) -> None:
        """`istante`: l'ora del pacchetto con le frazioni di secondo (dalla cattura), per i tempi di risposta."""
        if adesso - self._finestra >= FINESTRA_S:
            self._chiudi_finestra(adesso)
        if self._connessioni:
            self._connessioni.pacchetto(float(adesso) if istante is None else istante, pacchetto)
        if self._scrivi_identita:
            for voce in identita.osserva(pacchetto):
                self._osserva(adesso, voce)
        if adesso - self._identita_scritte >= IDENTITA_OGNI_S:
            self._scrivi_le_identita(adesso)
        p = spacchetta(pacchetto)
        if not p or not p[5]:
            return
        src, dst, proto, sport, dport, carico = p

        for f in controlli.controlla(proto, sport, dport, carico):
            client, server, porta = (src, dst, dport) if f["verso_server"] else (dst, src, sport)
            self._fatto(adesso, f["tipo"], self._lato(client), self._lato(server), porta, f["dettaglio"])

        nome = controlli.risposta_nome(proto, sport, carico)
        if nome:
            primo = self._risponde.get(nome)
            if primo is None:
                if len(self._risponde) >= MEMORIA_MASSIMA:
                    self._risponde.clear()
                self._risponde[nome] = src
            elif primo != src:
                # chi risponde ora per un nome che era di un altro: client = lui, server = chi c'era prima
                self._fatto(adesso, "nome_conteso", self._lato(src), self._lato(primo), sport, {"nome": nome[:80]})

        if proto == controlli.UDP and 53 in (sport, dport):
            self._dns_visto(adesso, src, dst, sport, dport, carico)
        if proto == controlli.TCP and len(carico) > 5 and carico[0] == 0x16 and carico[5] == 2:
            self._certificato(adesso, src, sport, carico)

        if proto == controlli.UDP and dport == 53:
            n = self._dns.get(src, 0) + 1
            self._dns[src] = n
            if n == DNS_RICHIESTE_MASSIME + 1:
                self._fatto(adesso, "dns_anomalo", self._lato(src), self._lato(dst), 53, {"motivo": "molte_richieste", "soglia": DNS_RICHIESTE_MASSIME})

        if self._scrivi_nomi_ip and proto == controlli.UDP and sport == 53:
            for ip, chiesto in identita.indirizzi_dns(carico):
                self._nome_di_ip(adesso, ip, "dns", chiesto)

        for tipo, n in controlli.nomi(proto, sport, dport, carico):
            if tipo == "sni":
                self._nome_di_ip(adesso, dst, "sni", n)
            client = self._lato(src)
            if client in (piega.ESTERNO, piega.DIFFUSIONE):
                continue
            visti = self._nomi_del_giorno.setdefault(client, set())
            if (tipo, n) not in visti:
                if len(visti) >= NOMI_PER_HOST_AL_GIORNO:
                    continue
                visti.add((tipo, n))
            self._nomi[(client, tipo, n)] = self._nomi.get((client, tipo, n), 0) + 1

    def chiudi(self, adesso: int) -> None:
        self._chiudi_finestra(adesso)
        self._scrivi_le_identita(adesso)


def main() -> int:
    dati = os.environ.get("DATI", "/var/lib/collector-traffico")
    scheda = os.environ.get("MIRROR_IF", "")
    if not scheda:
        print("ascolto: MIRROR_IF non configurata, non parto", file=sys.stderr)
        return 1
    reti = piega.RETI_INTERNE_DI_SERIE + [r for r in os.environ.get("RETI_INTERNE", "").split(",") if r.strip()]
    filtro = FILTRO_SECONDO_GRUPPO if os.environ.get("SECONDO_GRUPPO_MISURA", "0") == "1" else FILTRO
    db = archivio.apri(os.path.join(dati, "collector.db"))
    ascolto = Ascolto(
        reti,
        lambda visto, tipo, client, server, porta, dettaglio: archivio.scrivi_fatto(db, visto, tipo, client, server, porta, dettaglio),
        lambda visto, conteggi: archivio.scrivi_nomi(db, visto, conteggi),
        (lambda voci: archivio.scrivi_identita(db, voci)) if os.environ.get("IDENTITA", "1") != "0" else None,
        (lambda voci: archivio.scrivi_nomi_ip(db, voci)) if os.environ.get("ESTERNI", "1") != "0" else None,
        (lambda inizio, righe: archivio.scrivi_connessioni(db, inizio, righe)) if os.environ.get("CONNESSIONI", "1") != "0" else None,
    )
    # -s: bastano i primi byte (600, per le opzioni DHCP); -U: ogni pacchetto esce subito; -n: nessuna risoluzione di nomi.
    tcpdump = subprocess.Popen(
        ["tcpdump", "-i", scheda, "-n", "-U", "-s", os.environ.get("CATTURA", str(CATTURA)), "-w", "-", filtro],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    print("ascolto: avviato", flush=True)

    # systemd ferma il servizio con SIGTERM: si esce passando dal `finally`, che scrive i nomi della finestra in corso.
    def _ferma(*_a: object) -> None:
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, _ferma)
    visti = 0
    try:
        scarto = None
        for istante, pacchetto in leggi_pcap(tcpdump.stdout):
            visti += 1
            try:
                # i tempi di risposta si misurano sull'ora della cattura, riportata all'orologio di qui
                adesso = time.time()
                if scarto is None:
                    scarto = adesso - istante
                ascolto.pacchetto(int(adesso), pacchetto, istante + scarto)
            except Exception as e:  # un pacchetto storto non ferma l'ascolto
                print(f"ascolto: pacchetto saltato ({type(e).__name__})", file=sys.stderr, flush=True)
            if visti % 1000 == 0:
                archivio.metti_stato(db, "ascolto_pacchetti", visti)
    finally:
        ascolto.chiudi(int(time.time()))
        tcpdump.terminate()
    print("ascolto: tcpdump si è fermato", file=sys.stderr, flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
