import os
import struct
import tempfile
import unittest

from collector import archivio
from collector.ascolto import FILTRO, Ascolto
from collector.identita import osserva
from collector.piega import RETI_INTERNE_DI_SERIE as RETI

MAC_A = bytes.fromhex("3c5282aabb01")
MAC_B = bytes.fromhex("3c5282aabb02")
TUTTI = b"\xff" * 6


def eth(dst, src, tipo, corpo, vlan=0):
    tag = struct.pack(">HH", 0x8100, vlan) if vlan else b""
    return dst + src + tag + struct.pack(">H", tipo) + corpo


def arp(mac, ip, op=1):
    return struct.pack(">HHBBH", 1, 0x0800, 6, 4, op) + mac + bytes(ip) + b"\x00" * 6 + bytes([10, 0, 0, 1])


def udp(src_ip, dst_ip, sport, dport, carico):
    ip = bytes([0x45, 0]) + struct.pack(">H", 28 + len(carico)) + b"\x00\x00\x00\x00" + bytes([64, 17]) + b"\x00\x00" + bytes(src_ip) + bytes(dst_ip)
    return ip + struct.pack(">HHHH", sport, dport, 8 + len(carico), 0) + carico


def dhcp(op, mac, opzioni, ciaddr=(0, 0, 0, 0), yiaddr=(0, 0, 0, 0)):
    testa = bytes([op, 1, 6, 0]) + b"\x00" * 8 + bytes(ciaddr) + bytes(yiaddr) + b"\x00" * 8 + mac + b"\x00" * 10 + b"\x00" * 192
    corpo = b"".join(bytes([k, len(v)]) + v for k, v in opzioni)
    return testa + b"\x63\x82\x53\x63" + corpo + b"\xff"


def nome_dns(nome):
    return b"".join(bytes([len(x)]) + x for x in nome.split(b".")) + b"\x00"


class Identita(unittest.TestCase):
    def test_arp_anche_con_tag_e_non_la_prova_d_indirizzo(self):
        v = osserva(eth(TUTTI, MAC_A, 0x0806, arp(MAC_A, [10, 4, 0, 10]), vlan=30))
        self.assertEqual(v, [{"mac": "3c:52:82:aa:bb:01", "ip": "10.4.0.10", "vlan": 30, "fonte": "arp", "nome": "", "tipo": ""}])
        self.assertEqual(osserva(eth(TUTTI, MAC_A, 0x0806, arp(MAC_A, [0, 0, 0, 0]))), [])

    def test_dhcp_richiesta_e_conferma(self):
        richiesta = dhcp(1, MAC_A, [(53, b"\x03"), (50, bytes([10, 4, 0, 77])), (12, b"PC-Contabile"), (60, b"MSFT 5.0"), (55, bytes([1, 3, 6, 15]))])
        v = osserva(eth(TUTTI, MAC_A, 0x0800, udp([0, 0, 0, 0], [255, 255, 255, 255], 68, 67, richiesta)))
        self.assertEqual((v[0]["mac"], v[0]["ip"], v[0]["fonte"], v[0]["nome"], v[0]["tipo"]), ("3c:52:82:aa:bb:01", "10.4.0.77", "dhcp", "pc-contabile", "MSFT 5.0 [1,3,6,15]"))
        # la conferma passa dal server (o da un relay): il MAC è quello scritto nel messaggio, non di chi la porta
        conferma = dhcp(2, MAC_A, [(53, b"\x05")], yiaddr=(10, 4, 0, 77))
        v = osserva(eth(MAC_A, MAC_B, 0x0800, udp([10, 4, 0, 1], [10, 4, 0, 77], 67, 68, conferma)))
        self.assertEqual((v[0]["mac"], v[0]["ip"], v[0]["nome"]), ("3c:52:82:aa:bb:01", "10.4.0.77", ""))
        # un'offerta (non conferma) non dice ancora di chi è l'indirizzo
        self.assertEqual(osserva(eth(MAC_A, MAC_B, 0x0800, udp([10, 4, 0, 1], [10, 4, 0, 77], 67, 68, dhcp(2, MAC_A, [(53, b"\x02")], yiaddr=(10, 4, 0, 77))))), [])
        # cattura tagliata a metà delle opzioni: nessun errore
        tagliato = eth(TUTTI, MAC_A, 0x0800, udp([0, 0, 0, 0], [255, 255, 255, 255], 68, 67, richiesta))[:300]
        self.assertIsInstance(osserva(tagliato), list)

    def test_mdns_netbios_ssdp_solo_se_per_tutti(self):
        risposta = b"\x00\x00\x84\x00\x00\x00\x00\x01\x00\x00\x00\x00" + nome_dns(b"stampante-atrio.local") + struct.pack(">HHIH", 1, 0x8001, 120, 4) + bytes([10, 4, 0, 50])
        multicast = bytes.fromhex("01005e0000fb")
        v = osserva(eth(multicast, MAC_A, 0x0800, udp([10, 4, 0, 50], [224, 0, 0, 251], 5353, 5353, risposta)))
        self.assertEqual((v[0]["fonte"], v[0]["ip"], v[0]["nome"]), ("mdns", "10.4.0.50", "stampante-atrio.local"))
        # lo stesso pacchetto arrivato a un solo destinatario può essere passato da un router: il MAC non vale
        self.assertEqual(osserva(eth(MAC_B, MAC_A, 0x0800, udp([10, 4, 0, 50], [10, 4, 0, 9], 5353, 5353, risposta))), [])
        # il record A di un altro indirizzo non è il nome di chi manda
        altrui = risposta[:-4] + bytes([10, 4, 0, 51])
        self.assertEqual(osserva(eth(multicast, MAC_A, 0x0800, udp([10, 4, 0, 50], [224, 0, 0, 251], 5353, 5353, altrui))), [])

        codificato = b"".join(bytes([65 + (b >> 4), 65 + (b & 15)]) for b in b"SRV-FILE".ljust(15) + b"\x00")
        registra = b"\x12\x34\x29\x10\x00\x01\x00\x00\x00\x00\x00\x01\x20" + codificato + b"\x00\x00\x20\x00\x01"
        v = osserva(eth(TUTTI, MAC_A, 0x0800, udp([10, 4, 0, 20], [10, 4, 0, 255], 137, 137, registra)))
        self.assertEqual((v[0]["fonte"], v[0]["nome"]), ("netbios", "srv-file"))
        domanda = b"\x12\x34\x01\x10" + registra[4:]
        self.assertEqual(osserva(eth(TUTTI, MAC_A, 0x0800, udp([10, 4, 0, 20], [10, 4, 0, 255], 137, 137, domanda))), [])

        annuncio = b"NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nServer: Linux/5.4 UPnP/1.0 NAS/2.1\r\n\r\n"
        v = osserva(eth(bytes.fromhex("01005e7ffffa"), MAC_A, 0x0800, udp([10, 4, 0, 60], [239, 255, 255, 250], 50000, 1900, annuncio)))
        self.assertEqual((v[0]["fonte"], v[0]["tipo"]), ("ssdp", "Linux/5.4 UPnP/1.0 NAS/2.1"))

    def test_lldp_e_cdp(self):
        def tlv(t, v):
            return struct.pack(">H", (t << 9) | len(v)) + v
        lldp = tlv(1, b"\x04" + MAC_B) + tlv(2, b"\x05Gi1/0/12") + tlv(3, b"\x00\x78") + tlv(5, b"SW-PIANO1") + tlv(0, b"")
        v = osserva(eth(bytes.fromhex("0180c200000e"), MAC_A, 0x88CC, lldp))
        self.assertEqual(v, [{"mac": "3c:52:82:aa:bb:02", "ip": "", "vlan": 0, "fonte": "lldp", "nome": "SW-PIANO1", "tipo": "porta Gi1/0/12"}])

        def campo(t, v):
            return struct.pack(">HH", t, 4 + len(v)) + v
        cdp = b"\xaa\xaa\x03\x00\x00\x0c\x20\x00" + b"\x02\xb4\x00\x00" + campo(1, b"SW-CORE") + campo(3, b"GigabitEthernet0/1") + campo(6, b"cisco WS-C2960")
        telaio = bytes.fromhex("01000ccccccc") + MAC_A + struct.pack(">H", len(cdp)) + cdp
        v = osserva(telaio)
        self.assertEqual((v[0]["fonte"], v[0]["nome"], v[0]["tipo"]), ("cdp", "SW-CORE", "porta GigabitEthernet0/1 · cisco WS-C2960"))

    def test_pacchetti_storti_non_rompono(self):
        for p in (b"", b"\x00" * 13, eth(TUTTI, MAC_A, 0x0806, b"\x00\x01"), eth(TUTTI, MAC_A, 0x88CC, b"\xff\xff\x01"), eth(TUTTI, MAC_A, 0x0800, b"\x45" + b"\x00" * 30)):
            self.assertEqual(osserva(p), [])


class NellAscolto(unittest.TestCase):
    def test_una_riga_per_coppia_non_una_per_pacchetto_e_il_nome_resta(self):
        scritte = []
        a = Ascolto(RETI, lambda *x: None, lambda *x: None, scritte.extend)
        richiesta = eth(TUTTI, MAC_A, 0x0800, udp([0, 0, 0, 0], [255, 255, 255, 255], 68, 67, dhcp(1, MAC_A, [(53, b"\x03"), (50, bytes([10, 4, 0, 77])), (12, b"pc-uno")])))
        conferma = eth(MAC_A, MAC_B, 0x0800, udp([10, 4, 0, 1], [10, 4, 0, 77], 67, 68, dhcp(2, MAC_A, [(53, b"\x05")], yiaddr=(10, 4, 0, 77))))
        t = 1_800_000_000
        for i in range(50):
            a.pacchetto(t + i % 5, eth(TUTTI, MAC_A, 0x0806, arp(MAC_A, [10, 4, 0, 77])))
        a.pacchetto(t + 5, richiesta)
        a.pacchetto(t + 6, conferma)
        a.chiudi(t + 7)
        self.assertEqual(sorted((v["fonte"], v["nome"]) for v in scritte), [("arp", ""), ("dhcp", "pc-uno")])
        # dopo un'ora la stessa coppia si riscrive (aggiorna «visto»); se cambia il nome, subito
        scritte.clear()
        a.pacchetto(t + 100, eth(TUTTI, MAC_A, 0x0806, arp(MAC_A, [10, 4, 0, 77])))
        a.pacchetto(t + 3700, eth(TUTTI, MAC_A, 0x0806, arp(MAC_A, [10, 4, 0, 77])))
        a.chiudi(t + 3701)
        self.assertEqual(len(scritte), 1)

    def test_archivio_riscrive_la_riga_con_un_numero_nuovo(self):
        with tempfile.TemporaryDirectory() as d:
            db = archivio.apri(os.path.join(d, "c.db"))
            voce = {"visto": "2026-11-23 10:00:00", "mac": "3c:52:82:aa:bb:01", "ip": "10.4.0.77", "vlan": 0, "fonte": "arp", "nome": "", "tipo": ""}
            archivio.scrivi_identita(db, [voce])
            righe, ultimo, altri, buco = archivio.leggi_identita(db, 0, 100)
            self.assertEqual((len(righe), ultimo, altri, buco), (1, 1, False, False))
            archivio.scrivi_identita(db, [{**voce, "visto": "2026-11-23 11:00:00"}])
            righe, ultimo, _, buco = archivio.leggi_identita(db, 1, 100)
            self.assertEqual((len(righe), ultimo, righe[0]["visto"], buco), (1, 2, "2026-11-23 11:00:00", False))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM identita").fetchone()[0], 1)
            db.close()

    def test_il_filtro_chiede_arp_e_dhcp_anche_dietro_vlan(self):
        self.assertIn("arp", FILTRO)
        self.assertEqual(FILTRO.count("udp port 67"), 2)


if __name__ == "__main__":
    unittest.main()
