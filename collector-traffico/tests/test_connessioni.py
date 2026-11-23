import os
import struct
import tempfile
import unittest

from collector import archivio
from collector.ascolto import FILTRO, Ascolto
from collector.connessioni import ACK, RST, SYN, Connessioni, bandiere
from collector.piega import RETI_INTERNE_DI_SERIE as RETI

C, S = [10, 4, 0, 10], [10, 4, 0, 20]


def tcp(src, dst, sport, dport, flag, seq=1000, vlan=0):
    ip = bytes([0x45, 0]) + struct.pack(">H", 40) + b"\x00\x00\x00\x00" + bytes([64, 6]) + b"\x00\x00" + bytes(src) + bytes(dst)
    l4 = struct.pack(">HHIIBBHHH", sport, dport, seq, 0, 0x50, flag, 0, 0, 0)
    tag = struct.pack(">HH", 0x8100, vlan) if vlan else b""
    return b"\x02" * 6 + b"\x04" * 6 + tag + b"\x08\x00" + ip + l4


def lato(ip):
    return ip if ip.startswith("10.") else "esterno"


class Regole(unittest.TestCase):
    def setUp(self):
        self.scritte = []
        self.c = Connessioni(lato, lambda inizio, righe: self.scritte.append((inizio, righe)))

    def chiudi(self, adesso):
        self.c.chiudi_finestra("2026-11-23 10:00:00", adesso)
        return {(r["client"], r["server"], r["porta"]): r for r in (self.scritte[-1][1] if self.scritte else [])}

    def test_bandiere_anche_con_tag_e_niente_per_il_resto(self):
        self.assertEqual(bandiere(tcp(C, S, 50000, 443, SYN, seq=7, vlan=30)), ("10.4.0.10", "10.4.0.20", 50000, 443, SYN, 7))
        self.assertIsNone(bandiere(b"\x00" * 60))
        self.assertIsNone(bandiere(tcp(C, S, 1, 2, SYN)[:40]))

    def test_riuscita_col_tempo_rifiutata_senza_risposta_ripetuta(self):
        self.c.pacchetto(100.000, tcp(C, S, 50000, 443, SYN))
        self.c.pacchetto(100.020, tcp(S, C, 443, 50000, SYN | ACK))          # riuscita in 20 ms
        self.c.pacchetto(100.100, tcp(C, S, 50001, 23, SYN))
        self.c.pacchetto(100.101, tcp(S, C, 23, 50001, RST | ACK))           # rifiutata
        self.c.pacchetto(101.000, tcp(C, S, 50002, 8080, SYN, seq=5))
        self.c.pacchetto(102.000, tcp(C, S, 50002, 8080, SYN, seq=5))        # lo stesso SYN: ripetuto
        self.c.pacchetto(104.000, tcp(C, S, 50002, 8080, SYN, seq=5))
        self.c.pacchetto(119.000, tcp(C, S, 50003, 9000, SYN))               # troppo giovane alla chiusura
        self.c.pacchetto(119.500, tcp(S, C, 5555, 6666, RST))                # un RST a metà connessione: non c'entra
        r = self.chiudi(120.0)
        self.assertEqual(r[("", "10.4.0.20", 443)], {"client": "", "server": "10.4.0.20", "porta": 443, "tentate": 1, "senza_risposta": 0, "rifiutate": 0, "ripetute": 0, "riuscite": 1, "ms_minimo": 20, "ms_mediano": 20})
        self.assertEqual([r[("10.4.0.10", "10.4.0.20", 23)][k] for k in ("tentate", "senza_risposta", "rifiutate")], [1, 0, 1])
        self.assertEqual([r[("10.4.0.10", "10.4.0.20", 8080)][k] for k in ("tentate", "senza_risposta", "ripetute")], [1, 1, 2])
        self.assertNotIn(("10.4.0.10", "10.4.0.20", 9000), r)
        # il SYN giovane scade nella finestra dopo; ma lì non c'è nessuna risposta: non si può dire
        self.scritte.clear()
        self.assertEqual(self.chiudi(400.0), {})

    def test_copia_di_una_sola_direzione_non_inventa_fallimenti(self):
        for i in range(20):
            self.c.pacchetto(100.0 + i, tcp(C, S, 50000 + i, 443, SYN))
        self.assertEqual(self.chiudi(500.0), {})

    def test_esterno_piegato_mediana_e_tetto_dei_pendenti(self):
        for i, ms in enumerate([10, 30, 500]):
            self.c.pacchetto(100.0 + i, tcp(C, [93, 184, 216, 34 + i], 50000 + i, 443, SYN))
            self.c.pacchetto(100.0 + i + ms / 1000, tcp([93, 184, 216, 34 + i], C, 443, 50000 + i, SYN | ACK))
        r = self.chiudi(200.0)
        self.assertEqual([r[("", "esterno", 443)][k] for k in ("riuscite", "ms_minimo", "ms_mediano")], [3, 10, 30])
        from collector import connessioni
        vecchio, connessioni.PENDENTI_MASSIMI = connessioni.PENDENTI_MASSIMI, 5
        try:
            for i in range(50):
                self.c.pacchetto(300.0, tcp(C, S, 40000 + i, 443, SYN))
            self.assertEqual(len(self.c._pendenti), 5)
        finally:
            connessioni.PENDENTI_MASSIMI = vecchio


class NellAscolto(unittest.TestCase):
    def test_dalla_cattura_all_archivio(self):
        with tempfile.TemporaryDirectory() as d:
            db = archivio.apri(os.path.join(d, "c.db"))
            a = Ascolto(RETI, lambda *x: None, lambda *x: None, None, None, lambda inizio, righe: archivio.scrivi_connessioni(db, inizio, righe))
            t = 1_800_000_000
            a.pacchetto(t, tcp(C, S, 50000, 443, SYN), t + 0.0)
            a.pacchetto(t, tcp(S, C, 443, 50000, SYN | ACK), t + 0.007)
            a.pacchetto(t + 1, tcp(C, S, 50001, 23, SYN), t + 1.0)
            a.pacchetto(t + 400, tcp(C, S, 50002, 443, SYN), t + 400.0)  # apre la finestra dopo: la prima si chiude
            righe, ultimo, altri, buco = archivio.leggi_connessioni(db, 0, 100)
            per = {(r["client"], r["porta"]): r for r in righe}
            self.assertEqual([per[("", 443)]["riuscite"], per[("", 443)]["ms_mediano"]], [1, 7])
            self.assertEqual(per[("10.4.0.10", 23)]["senza_risposta"], 1)
            self.assertEqual((ultimo, altri, buco), (2, False, False))
            db.close()

    def test_il_filtro_chiede_syn_e_rst_anche_dietro_vlan(self):
        self.assertEqual(FILTRO.count("tcp[13] & 6 != 0"), 2)

    def test_syn_e_rst_prima_della_clausola_tls(self):
        """Banco del PX-NAS, 23/11/2026: un servizio spento sulla porta 8099 non compariva. La clausola TLS legge
        il primo byte del carico; su un SYN o un RST (senza carico) la lettura esce dal pacchetto e il filtro del
        kernel lo scarta prima di arrivare alle clausole dopo. Quella dei SYN e RST deve venire prima."""
        tls = "tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16"
        pezzi = FILTRO.split("(vlan and")
        self.assertEqual(len(pezzi), 2)
        for pezzo in pezzi:
            self.assertLess(pezzo.index("tcp[13] & 6 != 0"), pezzo.index(tls))


if __name__ == "__main__":
    unittest.main()
