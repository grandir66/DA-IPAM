# Moduli DA-IPAM — Indice

Documentazione per modulo di DA-IPAM. La sorgente di verità dei 6 moduli base è
`src/lib/modules/registry.ts`, che marca ogni modulo con `access`:

- **`native` (interni)** — UI gestita dentro DA-IPAM (route interna).
- **`external` (esterni)** — sistemi terzi lanciati come dashboard esterna.

> Runtime: **DA-IPAM gira in systemd** (non Docker). Lo Scanner-Edge e LibreNMS
> girano in **Docker**; Wazuh e Graylog sono **server esterni** (Wazuh
> singolo per il deployment Domarc, Graylog stack Docker provisionato).

## Interni (UI nativa dentro DA-IPAM)

| Modulo | Pagina | Doc |
| --- | --- | --- |
| Vulnerabilities (Scanner-Edge) | `/vulnerabilities` | [interni/vulnerabilities-edge.md](interni/vulnerabilities-edge.md) |
| Patch Management | `/patch-management` | [interni/patch-management.md](interni/patch-management.md) |
| Network Services (DNS/DHCP/AdGuard/Unbound) | `/network-services` | [interni/network-services.md](interni/network-services.md) |
| MDM Mobile (Headwind) | `/settings/mdm` | [interni/mdm-mobile.md](interni/mdm-mobile.md) |
| Core IPAM (networks/hosts/discovery/software) | `/networks`, `/hosts`, ... | [interni/core-ipam.md](interni/core-ipam.md) |
| Agents Remoti / Bridge | `/agents` | [interni/agents-remote-bridge.md](interni/agents-remote-bridge.md) |

I moduli del registry con `access: "native"` sono `edge`, `patch_management`,
`network_services`. Core IPAM, Agents/Bridge e MDM non sono nel set dei 6 moduli
base ma sono funzionalità native interne documentate qui.

## Esterni (sistemi terzi integrati)

| Modulo | Tipo | Doc |
| --- | --- | --- |
| LibreNMS | NMS SNMP (Docker) | [esterni/librenms.md](esterni/librenms.md) |
| Graylog | Log management (stack Docker) | [esterni/graylog.md](esterni/graylog.md) |
| Wazuh SIEM | XDR/SIEM (server esterno) | [esterni/wazuh.md](esterni/wazuh.md) |

I moduli del registry con `access: "external"` sono `librenms`, `graylog`,
`wazuh`. LibreNMS e Wazuh importano dati nel DB tenant (correlati agli host);
Graylog è solo provisioning + launch.
