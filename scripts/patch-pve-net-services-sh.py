#!/usr/bin/env python3
from pathlib import Path

PVE_SCRIPT = Path("/opt/da-vulcan/Deploy-Security-Platform/services/net-services.sh")

src = PVE_SCRIPT.read_text()
if "net_services_render_adguard_config" in src:
    print("already patched")
    raise SystemExit(0)

func = '''
net_services_render_adguard_config() {
  log "[net-services] Render AdGuard systemd + Unbound :5335"
  local prov="${DA_ROOT:-/opt/da-vulcan/Deploy-Security-Platform}/scripts/net-services-adguard-provision.sh"
  if [ -f "${prov}" ]; then
    on_node "${NODE}" "install -m 755 /dev/stdin /usr/local/bin/net-services-adguard-provision.sh" < "${prov}"
  fi
  on_node "${NODE}" "NET_SERVICES_LAN_IP=${DA_NODE_NET_SERVICES_IP:-} /usr/local/bin/net-services-adguard-provision.sh" \
    || warn "[net-services] AdGuard provision skipped"
}

'''

idx = src.find("net_services_finalize() {")
src = src[:idx] + func + src[idx:]

src = src.replace(
    "    net_services_render_kea_config\n    net_services_finalize",
    "    net_services_render_kea_config\n    net_services_render_adguard_config\n    net_services_finalize",
    1,
)
src = src.replace(
    "  net_services_render_kea_config\n}",
    "  net_services_render_kea_config\n  net_services_render_adguard_config\n}",
    1,
)

PVE_SCRIPT.write_text(src)
print("patched", PVE_SCRIPT)
