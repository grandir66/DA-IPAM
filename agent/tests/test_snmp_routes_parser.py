"""Test dei parser per ``snmp_routes``: ipAddrTable e ipCidrRouteTable."""

from __future__ import annotations

import ipaddress

from da_invent_agent.exec.snmp import (
    OID_IP_ADDR_NETMASK,
    OID_IP_CIDR_ROUTE_DEST,
    OID_IP_CIDR_ROUTE_MASK,
    SnmpRow,
    _is_filterable_cidr,
    _parse_ip_addr_table,
    _parse_ip_cidr_route,
)


# ─────────────────────────────────────────────────────────────────────────────
# _is_filterable_cidr — scarta /32, /0, link-local, multicast, loopback
# ─────────────────────────────────────────────────────────────────────────────


def test_filterable_default_route() -> None:
    assert _is_filterable_cidr(ipaddress.IPv4Network("0.0.0.0/0")) is True


def test_filterable_host_route() -> None:
    assert _is_filterable_cidr(ipaddress.IPv4Network("192.168.1.5/32")) is True


def test_filterable_loopback() -> None:
    assert _is_filterable_cidr(ipaddress.IPv4Network("127.0.0.0/8")) is True


def test_filterable_link_local() -> None:
    assert _is_filterable_cidr(ipaddress.IPv4Network("169.254.0.0/16")) is True


def test_filterable_multicast() -> None:
    assert _is_filterable_cidr(ipaddress.IPv4Network("224.0.0.0/4")) is True


def test_filterable_normale_rete_passa() -> None:
    assert _is_filterable_cidr(ipaddress.IPv4Network("10.0.0.0/24")) is False
    assert _is_filterable_cidr(ipaddress.IPv4Network("192.168.0.0/16")) is False


# ─────────────────────────────────────────────────────────────────────────────
# _parse_ip_addr_table — interface CIDRs da netmask
# ─────────────────────────────────────────────────────────────────────────────


def _row(oid: str, value: str) -> SnmpRow:
    return SnmpRow(oid=oid, type="IpAddress", value=value)


def test_parse_addr_table_singola_interfaccia() -> None:
    rows = [_row(f"{OID_IP_ADDR_NETMASK}.10.0.0.1", "255.255.255.0")]
    assert _parse_ip_addr_table(rows) == {"10.0.0.0/24"}


def test_parse_addr_table_filtra_loopback() -> None:
    rows = [_row(f"{OID_IP_ADDR_NETMASK}.127.0.0.1", "255.0.0.0")]
    assert _parse_ip_addr_table(rows) == set()


def test_parse_addr_table_ignora_oid_non_pertinenti() -> None:
    rows = [
        _row(".1.3.6.1.2.1.1.5.0", "router1"),  # sysName, va ignorato
        _row(f"{OID_IP_ADDR_NETMASK}.192.168.1.1", "255.255.255.0"),
    ]
    assert _parse_ip_addr_table(rows) == {"192.168.1.0/24"}


# ─────────────────────────────────────────────────────────────────────────────
# _parse_ip_cidr_route — pair dest + mask per index
# ─────────────────────────────────────────────────────────────────────────────


def test_parse_cidr_route_pair() -> None:
    # index esempio: dest.mask.tos.nexthop = 192.168.1.0.255.255.255.0.0.10.0.0.1
    idx = "192.168.1.0.255.255.255.0.0.10.0.0.1"
    dest_rows = [_row(f"{OID_IP_CIDR_ROUTE_DEST}.{idx}", "192.168.1.0")]
    mask_rows = [_row(f"{OID_IP_CIDR_ROUTE_MASK}.{idx}", "255.255.255.0")]
    assert _parse_ip_cidr_route(dest_rows, mask_rows) == {"192.168.1.0/24"}


def test_parse_cidr_route_dest_orfana_senza_mask() -> None:
    """Se la riga dest non ha mask corrispondente: scartata silenziosamente."""
    dest_rows = [_row(f"{OID_IP_CIDR_ROUTE_DEST}.1.2.3.4.255.255.255.0.0.0.0.0.0", "1.2.3.0")]
    mask_rows: list[SnmpRow] = []
    assert _parse_ip_cidr_route(dest_rows, mask_rows) == set()


def test_parse_cidr_route_default_route_filtrata() -> None:
    idx = "0.0.0.0.0.0.0.0.0.10.0.0.1"
    dest_rows = [_row(f"{OID_IP_CIDR_ROUTE_DEST}.{idx}", "0.0.0.0")]
    mask_rows = [_row(f"{OID_IP_CIDR_ROUTE_MASK}.{idx}", "0.0.0.0")]
    assert _parse_ip_cidr_route(dest_rows, mask_rows) == set()


def test_parse_cidr_route_host_route_filtrata() -> None:
    idx = "1.2.3.4.255.255.255.255.0.0.0.0.0"
    dest_rows = [_row(f"{OID_IP_CIDR_ROUTE_DEST}.{idx}", "1.2.3.4")]
    mask_rows = [_row(f"{OID_IP_CIDR_ROUTE_MASK}.{idx}", "255.255.255.255")]
    assert _parse_ip_cidr_route(dest_rows, mask_rows) == set()
