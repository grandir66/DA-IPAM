"""Un controllo, una fonte: nessun tipo esce due volte né sparisce, in nessun profilo (caso 5 del piano sonda avanzata)."""
import os
import re
import unittest

from collector import controlli, profili

ANOMALIE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "lib", "traffico", "anomalie.ts")


class Profili(unittest.TestCase):
    def test_tipi_uguali_a_ipam(self):
        with open(ANOMALIE, encoding="utf-8") as f:
            testo = f.read()
        blocco = re.search(r"export const TIPI_FATTO = \[(.*?)\] as const", testo, re.S).group(1)
        self.assertEqual(tuple(re.findall(r'"([a-z_0-9]+)"', blocco)), profili.TIPI)
        self.assertEqual(controlli.TIPI, profili.TIPI)

    def test_una_fonte_per_tipo(self):
        for profilo in profili.PROFILI:
            for tipo in profili.TIPI:
                self.assertIn(profili.fonte(tipo, profilo), ("zeek", "ascolto"))
                # chi lo fa davvero: ascolto (per intero) o zeek, mai tutti e due per la stessa parte
                da_zeek = profili.fonte(tipo, profilo) == "zeek"
                self.assertNotEqual(da_zeek, profili.ascolto_lo_fa(tipo, profilo), f"{tipo} in {profilo}")
        self.assertTrue(all(profili.fonte(t, "leggero") == "ascolto" for t in profili.TIPI))

    def test_tipo_diviso(self):
        self.assertTrue(profili.ascolto_lo_fa("impianto_scrittura", "avanzato", "s7"))
        self.assertFalse(profili.ascolto_lo_fa("impianto_scrittura", "avanzato", "modbus"))
        self.assertTrue(profili.ascolto_lo_fa("impianto_scrittura", "leggero", "modbus"))

    def test_ascolto_avanzato_lascia_a_zeek_i_suoi(self):
        """La cattura dei controlli del 20/11 (un accesso per controllo) letta dall'ascolto nei due profili."""
        import io
        from collector.ascolto import Ascolto, leggi_pcap
        from collector.piega import RETI_INTERNE_DI_SERIE
        with open(os.path.join(os.path.dirname(__file__), "dati", "controlli-banco.pcap"), "rb") as f:
            grezzo = f.read()
        visti = {}
        for profilo in profili.PROFILI:
            fatti, nomi = [], {}
            a = Ascolto(RETI_INTERNE_DI_SERIE, lambda *x: fatti.append(x), lambda v, c: nomi.update(c), profilo=profilo)
            ultimo = 0
            for t, p in leggi_pcap(io.BytesIO(grezzo)):
                a.pacchetto(t, p)
                ultimo = t
            a.chiudi(ultimo + 600)
            visti[profilo] = ({x[1] for x in fatti}, {x[5].get("protocollo") for x in fatti if x[1] == "impianto_scrittura"}, nomi)
        leggero, avanzato = visti["leggero"], visti["avanzato"]
        # nella cattura ci sono una scrittura Modbus e una S7 fra gli stessi due host: il leggero dice il fatto una
        # volta (esce la prima, Modbus); nell'avanzato Modbus lo fa Zeek e qui resta solo S7
        self.assertEqual(leggero[1], {"modbus"})
        self.assertEqual(avanzato[1], {"s7"})
        self.assertEqual(avanzato[0], leggero[0] - (profili.DA_ZEEK - {"impianto_scrittura"}))
        self.assertTrue(leggero[2])                    # nomi DNS e TLS: nel leggero dall'ascolto...
        self.assertFalse(any(k[1] in ("dns", "sni") for k in avanzato[2]))  # ...nell'avanzato da Zeek

    def test_tipo_sconosciuto(self):
        with self.assertRaises(ValueError):
            profili.fonte("inventato", "avanzato")


if __name__ == "__main__":
    unittest.main()
