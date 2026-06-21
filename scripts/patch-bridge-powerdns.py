"""Patch powerdns.py with reverse zone from CIDR."""
from pathlib import Path

ADDITIONS = '''

def reverse_zone_from_cidr(cidr: str) -> str:
    """Calcola nome zona reverse IPv4 (/8, /16, /24)."""
    import ipaddress

    net = ipaddress.ip_network(cidr.strip(), strict=False)
    if net.version != 4:
        raise ValueError("solo IPv4 supportato")
    p = net.prefixlen
    if p not in (8, 16, 24):
        raise ValueError("prefix supportati: /8, /16, /24")
    parts = str(net.network_address).split(".")
    if p == 24:
        return f"{'.'.join(reversed(parts[:3]))}.in-addr.arpa"
    if p == 16:
        return f"{'.'.join(reversed(parts[:2]))}.in-addr.arpa"
    return f"{'.'.join(reversed(parts))}.in-addr.arpa"


def create_reverse_zone(cidr: str) -> dict[str, Any]:
    """Crea zona PTR authoritative + forward stub Unbound verso PowerDNS."""
    try:
        zone = reverse_zone_from_cidr(cidr)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    res = create_zone(zone)
    if not res.get("ok"):
        return res
    # Stub forward verso PowerDNS per la zona reverse
    try:
        from adapters import unbound

        unbound.add_forward_zone(zone.rstrip("."), ["127.0.0.1@5400"])
    except Exception as e:  # noqa: BLE001
        res["forward_warning"] = str(e)
    res["reverse_zone"] = zone
    res["cidr"] = cidr
    return res
'''

p = Path("/opt/net-services-bridge/adapters/powerdns.py")
if "create_reverse_zone" in p.read_text():
    print("powerdns already patched")
else:
    p.write_text(p.read_text().rstrip() + ADDITIONS + "\n")
    print("powerdns patched")
