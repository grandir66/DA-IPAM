import type { AttributionDimension, AttributionSource } from "./types";

export const ATTR_SOURCE_WEIGHTS: Record<AttributionSource, number> = {
  manual: 1, ad: 1, wazuh: 1, inv_agent: 0.95, winrm: 0.95,
  snmp_sysobj: 0.95, snmp_sysdescr: 0.85, lldp: 0.9, cdp: 0.9, mndp: 0.9, ubnt: 0.9,
  oui: 0.9, mac_product: 0.85, http_banner: 0.9, tls_cert: 0.85,
  wsd: 0.9, mdns: 0.8, ssdp: 0.75, smb: 0.75, ssh: 0.6, redfish: 0.95, onvif: 0.95,
  fingerbank: 0.6, netbios: 0.5,
  /* nmap_service 0.5 -> 0.85 (05/11/2026): dal 05/11 questa sorgente non porta piu'
   * solo «c'e' un servizio», ma il NOME del prodotto letto nella stringa di versione
   * di `-sV` («Proxmox Virtual Environment REST API 3.0», «Microsoft Windows RPC»).
   * Con 0.5 non avrebbe mai superato MIN_CLAIM_SCORE da sola (stesso conto di
   * nmap_os): la regola nuova sarebbe nata inerte. A 0.85 il punteggio e' 0.68,
   * sotto ad/wazuh/manual e alla pari di snmp_sysdescr. */
  nmap_service: 0.85,
  /* nmap_os 0.5 -> 0.8 (05/11/2026, difetto misurato sul 72729 e sull'hub).
   * L'emettitore manda l'impronta di `-O` con confidenza 0.7: con peso 0.5 il
   * punteggio era 0.5x0.7 = 0.35, sotto MIN_CLAIM_SCORE (0.56). Quindi un host
   * di cui nmap conosce il sistema operativo — e solo nmap, come ogni Linux
   * senza SMB — **non poteva mai** avere una famiglia OS: nemmeno con confidenza
   * 1 (0.5 < 0.56). Sul 72729 nove host avevano l'evidenza `linux` e la colonna
   * vuota; sull'hub sono 31 su 378.
   * 0.8 NON basta: `0.8 * 0.7` in virgola mobile fa 0.5599999999999999, cioe'
   * **sotto** la soglia — una prova scritta prima del codice l'ha preso. Quindi
   * 0.85: punteggio 0.595, con margine. Resta **sotto** chi parla col sistema
   * operativo: smb 0.75x0.9 = 0.675, rdp_ntlm 0.9x0.9 = 0.81, ad 1x0.95 = 0.95.
   * Se nmap dice «linux» e SMB dice «windows», vince windows. */
  nmap_os: 0.85,
  hostname: 0.35, ports: 0.3, dhcp: 0.3, ttl: 0.25, ai: 0.5,
  /* rdp_ntlm: come smb/http_banner, parla col sistema operativo e da' il nome
   * vero. ot_probe: una risposta s7-info/enip-info/bacnet-info identifica il
   * protocollo di campo, non lo suggerisce. */
  rdp_ntlm: 0.9, ot_probe: 0.95,
  /* 0.85 x 0.7 = 0.595: sopra soglia da sola, sotto ogni fonte che parla con l'apparato. */
  mac_gemello: 0.85,
};

/**
 * Sorgenti dichiarative (spec §4.3 punto 4): saltano la somma pesata.
 * Fase 1: lldp/cdp NON sono qui perché device_neighbors non persiste i
 * capability bits — l'evidenza LLDP odierna è testuale (remote_platform)
 * e resta probabilistica. Entreranno quando i collector le raccoglieranno.
 */
export const AUTHORITATIVE_SOURCES: Record<AttributionDimension, readonly AttributionSource[]> = {
  vendor: ["manual"],
  // redfish: un BMC che risponde con credenziali valide E' un server (dichiarativo,
  // spec §7.4 Task 1) — a 0.95 supera AUTHORITY_MIN_CONFIDENCE (0.9), quindi salta
  // davvero la somma pesata come wsd (vedi commento AUTHORITY_MIN_CONFIDENCE sopra).
  // onvif: stessa logica — GetDeviceInformation risolto è la definizione stessa
  // del servizio ONVIF (Fase 4b Task 3, spec §7.4), a 0.95 dichiarativa su av.camera.
  // ot_probe: stessa logica di redfish/onvif — uno script di campo che risolve
  // (s7-info, enip-info, bacnet-info, omron-info) E' la definizione del
  // protocollo industriale; a 0.95 supera AUTHORITY_MIN_CONFIDENCE (0.9).
  category: ["manual", "wsd", "redfish", "onvif", "ot_probe"],
  os: ["manual", "ad", "wazuh", "inv_agent", "winrm"],
};
