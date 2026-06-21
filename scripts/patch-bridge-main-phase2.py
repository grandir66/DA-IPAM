"""Append Phase 2 routes to net-services-bridge main.py."""
from pathlib import Path

ROUTES = '''

# --- Phase 2: cache, upstream, reverse, chain ------------------------------


@app.get(f"/api/{API_VERSION}/dns/chain", dependencies=[Depends(require_token)])
def dns_chain() -> dict[str, Any]:
    """Catena DNS appliance: AdGuard → Unbound → PowerDNS / upstream."""
    ag = adguard.get_upstream()
    ub = unbound.get_root_upstream()
    return {
        "listen": {
            "adblock": "0.0.0.0:53 (AdGuard)",
            "resolver": "127.0.0.1:5335 (Unbound)",
            "authoritative": "127.0.0.1:5400 (PowerDNS)",
        },
        "adblock": {
            "running": ag.get("running", False),
            "upstream_dns": ag.get("upstream_dns", []),
        },
        "resolver": {
            "running": unbound._systemctl_active() if hasattr(unbound, "_systemctl_active") else False,
            "root_forwarders": ub.get("targets", []),
            "forward_zones": unbound._list_forward_zones() if hasattr(unbound, "_list_forward_zones") else [],
        },
        "hint": "Client LAN → AdGuard :53 → Unbound :5335 → forward-zone interne → PowerDNS :5400",
    }


@app.post(f"/api/{API_VERSION}/resolver/cache/flush", dependencies=[Depends(require_token)])
def resolver_flush_cache() -> dict[str, Any]:
    return unbound.flush_cache()


@app.get(f"/api/{API_VERSION}/resolver/upstream", dependencies=[Depends(require_token)])
def resolver_get_upstream() -> dict[str, Any]:
    return unbound.get_root_upstream()


@app.put(f"/api/{API_VERSION}/resolver/upstream", dependencies=[Depends(require_token)])
def resolver_set_upstream(payload: dict[str, Any]) -> dict[str, Any]:
    targets = (payload or {}).get("targets") or []
    if not isinstance(targets, list):
        raise HTTPException(status_code=400, detail="expected {targets:[str,...]}")
    return unbound.set_root_upstream([str(t).strip() for t in targets if str(t).strip()])


@app.post(f"/api/{API_VERSION}/adblock/cache/flush", dependencies=[Depends(require_token)])
def adblock_flush_cache() -> dict[str, Any]:
    return adguard.flush_cache()


@app.get(f"/api/{API_VERSION}/adblock/upstream", dependencies=[Depends(require_token)])
def adblock_get_upstream() -> dict[str, Any]:
    return adguard.get_upstream()


@app.put(f"/api/{API_VERSION}/adblock/upstream", dependencies=[Depends(require_token)])
def adblock_set_upstream(payload: dict[str, Any]) -> dict[str, Any]:
    upstream = (payload or {}).get("upstream_dns") or []
    bootstrap = (payload or {}).get("bootstrap_dns")
    if not isinstance(upstream, list) or not upstream:
        raise HTTPException(status_code=400, detail="expected {upstream_dns:[str,...]}")
    bs = [str(b).strip() for b in bootstrap] if isinstance(bootstrap, list) else None
    return adguard.set_upstream([str(u).strip() for u in upstream], bs)


@app.post(f"/api/{API_VERSION}/zones/reverse", dependencies=[Depends(require_token)])
def create_reverse_zone(payload: dict[str, Any]) -> dict[str, Any]:
    cidr = (payload or {}).get("cidr", "").strip()
    if not cidr:
        raise HTTPException(status_code=400, detail="missing 'cidr' field")
    return powerdns.create_reverse_zone(cidr)
'''

p = Path("/opt/net-services-bridge/main.py")
src = p.read_text()
if "/dns/chain" in src:
    print("main already has phase2 routes")
else:
    marker = "\n# --- root: redirect health for convenience"
    if marker not in src:
        marker = '\n@app.get("/")'
    src = src.replace(marker, ROUTES + marker, 1)
    p.write_text(src)
    print("main patched phase2")
