import os
import struct
import tempfile
import unittest

from collector import archivio, piega
from collector.ascolto import Ascolto
from collector.identita import indirizzi_dns
from collector.piega import RETI_INTERNE_DI_SERIE as RETI


def r(src, dst, sport, dport, byte, proto=6):
    return {"src": src, "dst": dst, "proto": proto, "sport": sport, "dport": dport, "byte": byte, "pacchetti": 1}


def nome(n):
    return b"".join(bytes([len(x)]) + x for x in n.split(b".")) + b"\x00"


def risposta_dns(chiesto, indirizzi, cname=None):
    testa = b"\x12\x34\x81\x80\x00\x01" + struct.pack(">H", len(indirizzi) + (1 if cname else 0)) + b"\x00\x00\x00\x00"
    corpo = nome(chiesto) + b"\x00\x01\x00\x01"
    if cname:
        dati = nome(cname)
        corpo += b"\xc0\x0c" + struct.pack(">HHIH", 5, 1, 60, len(dati)) + dati
    for ip in indirizzi:
        corpo += b"\xc0\x0c" + struct.pack(">HHIH", 1, 1, 60, 4) + bytes(ip)
    return testa + corpo


def pacchetto(src, dst, proto, sport, dport, carico):
    ip = bytes([0x45, 0]) + struct.pack(">H", 20 + (20 if proto == 6 else 8) + len(carico)) + b"\x00\x00\x00\x00" + bytes([64, proto]) + b"\x00\x00" + bytes(src) + bytes(dst)
    l4 = struct.pack(">HHIIBBHHH", sport, dport, 0, 0, 0x50, 0x18, 0, 0, 0) if proto == 6 else struct.pack(">HHHH", sport, dport, 8 + len(carico), 0)
    return b"\x02" * 6 + b"\x04" * 6 + b"\x08\x00" + ip + l4 + carico


class Esterni(unittest.TestCase):
    def test_le_due_direzioni_insieme_il_verso_e_solo_interno_con_esterno(self):
        righe = [
            r("10.4.0.10", "93.184.216.34", 50000, 443, 100), r("93.184.216.34", "10.4.0.10", 443, 50000, 900),
            r("8.8.8.8", "10.4.0.20", 40000, 25, 70),           # da fuori verso un servizio interno
            r("10.4.0.10", "10.4.0.20", 50001, 445, 5000),     # tutto interno: non c'entra
            r("1.1.1.1", "8.8.8.8", 1, 2, 9),                  # tutto esterno: non c'entra
        ]
        v = sorted(piega.esterni(righe, RETI), key=lambda x: x["interno"])
        self.assertEqual([(x["interno"], x["ip"], x["verso"], x["porta"], x["byte"], x["flussi"]) for x in v],
                         [("10.4.0.10", "93.184.216.34", "fuori", 443, 1000, 1), ("10.4.0.20", "8.8.8.8", "dentro", 25, 70, 1)])

    def test_il_tetto_tiene_i_piu_pesanti_e_dice_quanti_restano_fuori(self):
        righe = [r("10.4.0.10", f"93.184.216.{i}", 50000, 443, 1000 - i) for i in range(1, 8)] + [r("10.4.0.11", "93.184.216.1", 50000, 443, 5)]
        v = piega.esterni(righe, RETI, tetto=3)
        tenuti = sorted(x["ip"] for x in v if x["interno"] == "10.4.0.10" and x["ip"] != piega.ALTRI)
        self.assertEqual(tenuti, ["93.184.216.1", "93.184.216.2", "93.184.216.3"])
        altri = [x for x in v if x["ip"] == piega.ALTRI]
        self.assertEqual([(x["interno"], x["flussi"], x["byte"]) for x in altri], [("10.4.0.10", 4, 996 + 995 + 994 + 993)])
        # la somma non cambia: quello che non ha un indirizzo sta in «altri»
        self.assertEqual(sum(x["byte"] for x in v), sum(x["byte"] for x in righe))
        # l'altro host è sotto il tetto: nessuna riga «altri» per lui
        self.assertEqual(len([x for x in v if x["interno"] == "10.4.0.11"]), 1)

    def test_piega_da_gli_stessi_numeri_di_prima(self):
        righe = [r("10.4.0.10", "93.184.216.34", 50000, 443, 100), r("93.184.216.34", "10.4.0.10", 443, 50000, 900), r("10.4.0.10", "10.4.0.20", 50001, 445, 7)]
        c = sorted(piega.piega(righe, RETI), key=lambda x: x["server"])
        self.assertEqual([(x["client"], x["server"], x["porta"], x["byte"], x["esterni"]) for x in c],
                         [("10.4.0.10", "10.4.0.20", 445, 7, 0), ("10.4.0.10", "esterno", 443, 1000, 1)])

    def test_archivio_e_sfoltimento(self):
        with tempfile.TemporaryDirectory() as d:
            db = archivio.apri(os.path.join(d, "c.db"))
            archivio.scrivi_esterni(db, "2020-01-01 10:00:00", piega.esterni([r("10.4.0.10", "93.184.216.34", 50000, 443, 100)], RETI))
            righe, ultimo, altri, buco = archivio.leggi_esterni(db, 0, 10)
            self.assertEqual((righe[0]["ip"], righe[0]["verso"], ultimo, altri, buco), ("93.184.216.34", "fuori", 1, False, False))
            archivio.scrivi_nomi_ip(db, [{"visto": "2020-01-01 10:00:00", "ip": "93.184.216.34", "tipo": "sni", "nome": "a.example"}])
            archivio.scrivi_nomi_ip(db, [{"visto": archivio.ora_utc(), "ip": "93.184.216.34", "tipo": "sni", "nome": "b.example"}])
            righe, ultimo, _, _ = archivio.leggi_nomi_ip(db, 0, 10)
            self.assertEqual([(x["nome"], x["seq"]) for x in righe], [("b.example", 2)])
            archivio.sfoltisci(db, 7)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM esterno").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM nome_ip").fetchone()[0], 1)
            db.close()


class NomiDegliIndirizzi(unittest.TestCase):
    def test_risposta_dns_il_nome_e_quello_chiesto_anche_dietro_un_cname(self):
        self.assertEqual(indirizzi_dns(risposta_dns(b"posta.esempio.it", [[93, 184, 216, 34], [93, 184, 216, 35]], cname=b"edge.cdn.example")),
                         [("93.184.216.34", "posta.esempio.it"), ("93.184.216.35", "posta.esempio.it")])
        self.assertEqual(indirizzi_dns(b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00" + nome(b"a.it") + b"\x00\x01\x00\x01"), [])  # una domanda
        self.assertEqual(indirizzi_dns(risposta_dns(b"a.it", [[93, 184, 216, 34]])[:30]), [])  # tagliata
        self.assertEqual(indirizzi_dns(b"\xff" * 40), [])

    def test_nell_ascolto_solo_gli_esterni_e_non_a_ogni_pacchetto(self):
        scritti = []
        a = Ascolto(RETI, lambda *x: None, lambda *x: None, None, scritti.extend)
        t = 1_800_000_000
        dns = pacchetto([10, 4, 0, 1], [10, 4, 0, 10], 17, 53, 40000, risposta_dns(b"posta.esempio.it", [[93, 184, 216, 34], [10, 4, 0, 99]]))
        for i in range(20):
            a.pacchetto(t + i % 3, dns)
        a.chiudi(t + 5)
        self.assertEqual([(v["ip"], v["tipo"], v["nome"]) for v in scritti], [("93.184.216.34", "dns", "posta.esempio.it")])
        # un altro nome per lo stesso indirizzo: non prima di cinque minuti
        scritti.clear()
        altro = pacchetto([10, 4, 0, 1], [10, 4, 0, 10], 17, 53, 40000, risposta_dns(b"altro.esempio.it", [[93, 184, 216, 34]]))
        a.pacchetto(t + 60, altro)
        a.pacchetto(t + 400, altro)
        a.chiudi(t + 401)
        self.assertEqual([v["nome"] for v in scritti], ["altro.esempio.it"])


if __name__ == "__main__":
    unittest.main()
