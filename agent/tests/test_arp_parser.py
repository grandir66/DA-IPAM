"""Test del parser MAC dell'ARP poll. Copre i tre formati visti in produzione."""

from __future__ import annotations

from da_invent_agent.exec.arp import _extract_ip_from_oid, _normalize_mac, parse_arp_rows
from da_invent_agent.exec.snmp import OID_IP_NET_TO_MEDIA_PHYS, SnmpRow


# ─────────────────────────────────────────────────────────────────────────────
# _normalize_mac — tre formati + edge case
# ─────────────────────────────────────────────────────────────────────────────


def test_mac_canonico_colon_lowercase() -> None:
    assert _normalize_mac("aa:bb:cc:dd:ee:ff") == "aa:bb:cc:dd:ee:ff"


def test_mac_canonico_colon_uppercase() -> None:
    assert _normalize_mac("AA:BB:CC:DD:EE:FF") == "aa:bb:cc:dd:ee:ff"


def test_mac_hex_string_space_separated_no_trailing() -> None:
    """Output ``snmpwalk -Oqn ... Hex-STRING:`` (dopo che il type prefix è rimosso)."""
    assert _normalize_mac("AA BB CC DD EE FF") == "aa:bb:cc:dd:ee:ff"


def test_mac_routeros_chr_space_separated_trailing_space() -> None:
    """Formato RouterOS CHR osservato in produzione, con trailing space:
    ``"BC 24 11 FA 41 40 "``."""
    assert _normalize_mac('"BC 24 11 FA 41 40 "') == "bc:24:11:fa:41:40"
    assert _normalize_mac("BC 24 11 FA 41 40 ") == "bc:24:11:fa:41:40"


def test_mac_vuoto_e_zero_sono_none() -> None:
    """ARP incomplete su MikroTik / placeholder pre-risoluzione."""
    assert _normalize_mac("") is None
    assert _normalize_mac("   ") is None
    assert _normalize_mac('""') is None
    assert _normalize_mac("00:00:00:00:00:00") is None


def test_mac_lunghezza_sbagliata_none() -> None:
    assert _normalize_mac("aa:bb:cc:dd:ee") is None
    assert _normalize_mac("aa:bb:cc:dd:ee:ff:11") is None


def test_mac_caratteri_non_hex_none() -> None:
    assert _normalize_mac("zz:bb:cc:dd:ee:ff") is None


# ─────────────────────────────────────────────────────────────────────────────
# _extract_ip_from_oid — gestione punto iniziale e ifIndex
# ─────────────────────────────────────────────────────────────────────────────


def test_extract_ip_oid_con_ifindex() -> None:
    # 5 = ifIndex, 10.0.0.1 = IP
    oid = f".{OID_IP_NET_TO_MEDIA_PHYS}.5.10.0.0.1"
    assert _extract_ip_from_oid(oid) == "10.0.0.1"


def test_extract_ip_oid_senza_punto_iniziale() -> None:
    oid = f"{OID_IP_NET_TO_MEDIA_PHYS}.1.192.168.1.254"
    assert _extract_ip_from_oid(oid) == "192.168.1.254"


def test_extract_ip_oid_troppo_corto_none() -> None:
    assert _extract_ip_from_oid(f".{OID_IP_NET_TO_MEDIA_PHYS}.5.10") is None


def test_extract_ip_oid_non_in_arp_table_none() -> None:
    # Un OID che non appartiene al subtree ARP
    assert _extract_ip_from_oid(".1.3.6.1.2.1.1.1.0") is None


# ─────────────────────────────────────────────────────────────────────────────
# parse_arp_rows — integrazione MAC + IP + filtro incomplete
# ─────────────────────────────────────────────────────────────────────────────


def _row(oid_suffix: str, value: str, type_name: str = "Hex-STRING") -> SnmpRow:
    return SnmpRow(oid=f"{OID_IP_NET_TO_MEDIA_PHYS}.{oid_suffix}", type=type_name, value=value)


def test_parse_arp_mix_di_formati() -> None:
    rows = [
        _row("1.192.168.1.1", "AA BB CC DD EE FF"),                  # canonical hex-string
        _row("1.192.168.1.2", '"BC 24 11 FA 41 40 "'),               # RouterOS CHR quoted
        _row("1.192.168.1.3", "11:22:33:44:55:66"),                  # canonical colon
        _row("1.192.168.1.4", ""),                                   # incomplete, da scartare
        _row("1.192.168.1.5", "00:00:00:00:00:00"),                  # zero MAC, da scartare
    ]
    entries, raw_lines = parse_arp_rows(rows)

    by_ip = {e["ip"]: e["mac"] for e in entries}
    assert by_ip == {
        "192.168.1.1": "aa:bb:cc:dd:ee:ff",
        "192.168.1.2": "bc:24:11:fa:41:40",
        "192.168.1.3": "11:22:33:44:55:66",
    }
    # raw_lines preserva TUTTE le righe, anche quelle scartate
    assert len(raw_lines) == 5


def test_parse_arp_dedup_per_ip() -> None:
    rows = [
        _row("1.10.0.0.1", "aa:bb:cc:dd:ee:ff"),
        _row("2.10.0.0.1", "11:22:33:44:55:66"),  # stesso IP, ifIndex diverso → primo vince
    ]
    entries, _ = parse_arp_rows(rows)
    assert len(entries) == 1
    assert entries[0]["mac"] == "aa:bb:cc:dd:ee:ff"
