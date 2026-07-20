# Moduli DA-IPAM — Indice

Documentazione per modulo di DA-IPAM. La sorgente di verità è
`src/lib/modules/registry.ts`, che marca ogni modulo con `access`:

- **`native` (interni)** — UI gestita dentro DA-IPAM (route interna).
- **`external` (esterni)** — sistemi terzi lanciati come dashboard esterna.

> Runtime: **DA-IPAM gira in systemd** (non Docker). Scanner-Edge, LibreNMS e
> **MeshCentral** girano in **Docker** co-locati sull'appliance; Wazuh e Graylog
> sono **server esterni** (Wazuh singolo per il deployment Domarc, Graylog stack
> Docker provisionato).

## Interni (UI nativa dentro DA-IPAM)

| Modulo | Chiave registry | Pagina | Doc |
| --- | --- | --- | --- |
| Vulnerabilities (Scanner-Edge) | `edge` | `/vulnerabilities` | [interni/vulnerabilities-edge.md](interni/vulnerabilities-edge.md) |
| Patch Management | `patch_management` | `/patch-management` | [interni/patch-management.md](interni/patch-management.md) |
| Network Services (DNS/DHCP/AdGuard/Unbound) | `network_services` | `/network-services` | [interni/network-services.md](interni/network-services.md) |
| MeshCentral (Controllo remoto / RMM) | `meshcentral` | `/rmm` | [interni/meshcentral-rmm.md](interni/meshcentral-rmm.md) |
| Inventory Agent (GLPI) | `inventory_agent` | `/settings?tab=moduli` | [interni/inventory-agent.md](interni/inventory-agent.md) |
| Inventario NIS2 | `nis2_inventory` | `/services` | [interni/nis2-inventory.md](interni/nis2-inventory.md) |
| MDM Mobile (Headwind) | — (feature nativa) | `/settings/mdm` | [interni/mdm-mobile.md](interni/mdm-mobile.md) |
| Core IPAM (networks/hosts/discovery/software) | — (feature nativa) | `/networks`, `/hosts`, ... | [interni/core-ipam.md](interni/core-ipam.md) |
| Agents Remoti / Bridge | — (feature nativa) | `/agents` | [interni/agents-remote-bridge.md](interni/agents-remote-bridge.md) |

I moduli del registry con `access: "native"` sono `edge`, `patch_management`,
`network_services`, `meshcentral`, `inventory_agent`, `nis2_inventory`. Core IPAM,
Agents/Bridge e MDM non sono nel registry ma sono funzionalità native interne
documentate qui.

## Esterni (sistemi terzi integrati)

| Modulo | Chiave registry | Tipo | Doc |
| --- | --- | --- | --- |
| LibreNMS | `librenms` | NMS SNMP (Docker) | [esterni/librenms.md](esterni/librenms.md) |
| Graylog | `graylog` | Log management (stack Docker) | [esterni/graylog.md](esterni/graylog.md) |
| Wazuh SIEM | `wazuh` | XDR/SIEM (server esterno) | [esterni/wazuh.md](esterni/wazuh.md) |

I moduli del registry con `access: "external"` sono `librenms`, `graylog`,
`wazuh`. LibreNMS e Wazuh importano dati nel DB tenant (correlati agli host);
Graylog è solo provisioning + launch.

## Nota sulla visibilità nei menu

Ogni voce di menu è **gated** dallo stato del modulo (`/api/modules` ←
`resolveModules`): compare solo se il modulo è abilitato/installato per il tenant.
`meshcentral`, `inventory_agent` e `nis2_inventory` sono stati aggiunti al
registry a luglio 2026; `nis2_inventory` è un toggle (default ON) che governa la
voce **Servizi**.
