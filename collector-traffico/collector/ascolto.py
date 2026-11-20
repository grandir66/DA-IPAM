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

from . import archivio, controlli, piega

# Solo le porte dei controlli, più il saluto TLS su qualunque porta (primo byte del carico = 0x16).
_BASE = (
    "port 21 or port 23 or port 25 or port 110 or port 143 or port 389 or port 80 or port 445 "
    "or port 502 or port 102 or udp port 53 or udp port 161 or udp port 5355 or udp port 137 "
    "or (tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16)"
)
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
    if struct.unpack(ordine + "I", testa[20:24])[0] != 1:
        raise ValueError("serve una cattura Ethernet")
    while True:
        t = flusso.read(16)
        if len(t) < 16:
            return
        secondi, _, presi, _ = struct.unpack(ordine + "IIII", t)
        dati = flusso.read(presi)
        if len(dati) < presi:
            return
        yield secondi, dati


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

    def __init__(self, reti_interne: list[str], scrivi_fatto, scrivi_nomi):
        self._reti = piega._reti(reti_interne)
        self._memo: dict[str, str] = {}
        self._scrivi_fatto = scrivi_fatto
        self._scrivi_nomi = scrivi_nomi
        self._detti: dict[tuple, int] = {}                # (tipo, client, server) → ultima volta
        self._risponde: dict[str, str] = {}               # nome → chi ha risposto per primo
        self._dns: dict[str, int] = {}                    # host → richieste DNS nella finestra
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

    def _chiudi_finestra(self, adesso: int) -> None:
        if self._nomi:
            self._scrivi_nomi(archivio.ora_utc(self._finestra), self._nomi)
        self._nomi = {}
        self._dns = {}
        self._finestra = adesso - adesso % FINESTRA_S
        giorno = archivio.ora_utc(adesso)[:10]
        if giorno != self._giorno:
            self._giorno = giorno
            self._nomi_del_giorno = {}

    def pacchetto(self, adesso: int, pacchetto: bytes) -> None:
        if adesso - self._finestra >= FINESTRA_S:
            self._chiudi_finestra(adesso)
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

        if proto == controlli.UDP and dport == 53:
            n = self._dns.get(src, 0) + 1
            self._dns[src] = n
            if n == DNS_RICHIESTE_MASSIME + 1:
                self._fatto(adesso, "dns_anomalo", self._lato(src), self._lato(dst), 53, {"motivo": "molte_richieste", "soglia": DNS_RICHIESTE_MASSIME})

        for tipo, n in controlli.nomi(proto, sport, dport, carico):
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
    )
    # -s 256: bastano i primi byte; -U: ogni pacchetto esce subito; -n: nessuna risoluzione di nomi.
    tcpdump = subprocess.Popen(
        ["tcpdump", "-i", scheda, "-n", "-U", "-s", "256", "-w", "-", filtro],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    print("ascolto: avviato", flush=True)

    # systemd ferma il servizio con SIGTERM: si esce passando dal `finally`, che scrive i nomi della finestra in corso.
    def _ferma(*_a: object) -> None:
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, _ferma)
    visti = 0
    try:
        for _, pacchetto in leggi_pcap(tcpdump.stdout):
            visti += 1
            try:
                ascolto.pacchetto(int(time.time()), pacchetto)
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
