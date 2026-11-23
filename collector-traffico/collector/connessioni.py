"""Connessioni che non vanno: chi bussa e non riceve risposta, chi viene rifiutato, quanto ci mette un servizio.

Si guardano solo i pacchetti TCP che aprono o rifiutano una connessione (SYN, SYN-ACK, RST), IPv4.
Per finestra di 5 minuti si scrive:
- una riga per (client, server, porta) dove qualcosa è andato storto: tentativi, senza risposta, rifiutati, SYN ripetuti;
- una riga per servizio (client vuoto) con quante aperture sono riuscite e il tempo fra SYN e SYN-ACK (minimo, mediano).

Sono indizi, non misure esatte: la copia del traffico può perdere pacchetti, e una risposta che torna per
un'altra strada non si vede. Se in una finestra non si vede NESSUNA risposta (copia di una sola direzione),
i «senza risposta» non si scrivono: sarebbero tutti falsi.
"""
from __future__ import annotations

ATTESA_S = 10            # un SYN più vecchio di così senza risposta è «senza risposta»
PENDENTI_MASSIMI = 20000  # oltre, i SYN nuovi non si seguono (una scansione non deve finire la RAM)
CAMPIONI = 50             # tempi tenuti per servizio e finestra
RIGHE_MASSIME = 5000      # righe per finestra

SYN, RST, ACK = 0x02, 0x04, 0x10


def bandiere(p: bytes) -> tuple[str, str, int, int, int, int] | None:
    """Da un pacchetto Ethernet IPv4 TCP: (sorgente, destinazione, porta sorgente, porta destinazione, bandiere, numero di sequenza).
    None per tutto il resto. Si esce presto: chiamata per ogni pacchetto."""
    i = 12
    if len(p) < 54:
        return None
    tipo = int.from_bytes(p[i:i + 2], "big")
    while tipo in (0x8100, 0x88A8) and i + 6 <= len(p):
        i += 4
        tipo = int.from_bytes(p[i:i + 2], "big")
    i += 2
    if tipo != 0x0800 or len(p) < i + 40 or p[i + 9] != 6 or int.from_bytes(p[i + 6:i + 8], "big") & 0x1FFF:
        return None
    j = i + (p[i] & 0x0F) * 4
    if len(p) < j + 14:
        return None
    return (
        ".".join(str(b) for b in p[i + 12:i + 16]), ".".join(str(b) for b in p[i + 16:i + 20]),
        int.from_bytes(p[j:j + 2], "big"), int.from_bytes(p[j + 2:j + 4], "big"),
        p[j + 13], int.from_bytes(p[j + 4:j + 8], "big"),
    )


class Connessioni:
    """`lato(ip)`: l'indirizzo se è interno, altrimenti «esterno». `scrivi(inizio, righe)` a ogni finestra chiusa."""

    def __init__(self, lato, scrivi):
        self._lato = lato
        self._scrivi = scrivi
        self._pendenti: dict[tuple[str, int, str, int], list] = {}  # (client, porta client, server, porta) → [istante, seq, ripetuti]
        self._storte: dict[tuple[str, str, int], list[int]] = {}    # (client, server, porta) → [tentate, senza risposta, rifiutate, ripetute]
        self._servizi: dict[tuple[str, int], list] = {}             # (server, porta) → [riuscite, [tempi in ms]]
        self._risposte = 0

    def _storta(self, client: str, server: str, porta: int) -> list[int]:
        chiave = (self._lato(client), self._lato(server), porta)
        return self._storte.setdefault(chiave, [0, 0, 0, 0])

    def pacchetto(self, istante: float, p: bytes) -> None:
        b = bandiere(p)
        if b is None:
            return
        src, dst, sport, dport, flag, seq = b
        if flag & SYN and not flag & ACK:
            chiave = (src, sport, dst, dport)
            gia = self._pendenti.get(chiave)
            if gia is not None and gia[1] == seq:
                gia[2] += 1  # lo stesso SYN mandato di nuovo: nessuno ha risposto al primo
            elif len(self._pendenti) < PENDENTI_MASSIMI:
                self._pendenti[chiave] = [istante, seq, 0]
        elif flag & SYN and flag & ACK:
            self._risposte += 1
            gia = self._pendenti.pop((dst, dport, src, sport), None)
            if gia is not None:
                s = self._servizi.setdefault((self._lato(src), sport), [0, []])
                s[0] += 1
                if len(s[1]) < CAMPIONI:
                    s[1].append(max(0, round((istante - gia[0]) * 1000)))
                if gia[2]:
                    r = self._storta(dst, src, sport)
                    r[0] += 1
                    r[3] += gia[2]
        elif flag & RST:
            gia = self._pendenti.pop((dst, dport, src, sport), None)
            if gia is not None:
                self._risposte += 1
                r = self._storta(dst, src, sport)
                r[0] += 1
                r[2] += 1
                r[3] += gia[2]

    def chiudi_finestra(self, inizio: str, adesso: float) -> None:
        """Scrive la finestra. I SYN ancora giovani restano in attesa per la prossima."""
        scaduti = [k for k, v in self._pendenti.items() if adesso - v[0] >= ATTESA_S]
        for k in scaduti:
            v = self._pendenti.pop(k)
            # senza nemmeno una risposta in tutta la finestra la copia porta una direzione sola: non si può dire
            if self._risposte > 0:
                r = self._storta(k[0], k[2], k[3])
                r[0] += 1
                r[1] += 1
                r[3] += v[2]
        righe = [
            {"client": c, "server": s, "porta": p, "tentate": v[0], "senza_risposta": v[1], "rifiutate": v[2], "ripetute": v[3],
             "riuscite": 0, "ms_minimo": 0, "ms_mediano": 0}
            for (c, s, p), v in self._storte.items()
        ]
        for (s, p), (riuscite, tempi) in self._servizi.items():
            tempi.sort()
            righe.append({"client": "", "server": s, "porta": p, "tentate": riuscite, "senza_risposta": 0, "rifiutate": 0, "ripetute": 0,
                          "riuscite": riuscite, "ms_minimo": tempi[0] if tempi else 0, "ms_mediano": tempi[len(tempi) // 2] if tempi else 0})
        self._storte = {}
        self._servizi = {}
        self._risposte = 0
        if righe:
            # se sono troppe restano quelle con più tentativi
            righe.sort(key=lambda r: -r["tentate"])
            self._scrivi(inizio, righe[:RIGHE_MASSIME])
