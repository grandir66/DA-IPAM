# Credenziali e protocolli nei dispositivi

## Origine delle credenziali

Ogni dispositivo può usare credenziali in due modi:

### Da archivio (Impostazioni → Credenziali)

- **Credenziale SSH/API/Windows** (`credential_id`): se impostata, username e password vengono letti dalla credenziale registrata. I campi username/password inline nel dispositivo vengono ignorati.
- **Credenziale SNMP** (`snmp_credential_id`): se impostata, la community string (o i parametri v3) vengono letti dalla credenziale SNMP. Il campo `community_string` inline viene ignorato.

### Inline (direttamente nel dispositivo)

- **Username + Password**: usati solo se `credential_id` è vuoto. Salvati cifrati nel record del dispositivo.
- **Community string**: usata solo se `snmp_credential_id` è vuoto. Salvata cifrata nel record del dispositivo.

**Priorità**: archivio ha sempre precedenza su inline. Se selezioni una credenziale dall’archivio, i valori inline non vengono mai usati.

---

## Uso di più protocolli

Alcuni dispositivi usano **più protocolli** per ottenere dati completi:

| Scenario | Protocollo principale | Protocollo secondario | Quando |
|----------|------------------------|------------------------|--------|
| Router con SSH + SNMP | SSH (ARP via comandi) | SNMP | Se SSH fallisce o per porte/LLDP |
| Switch con SSH + SNMP | SSH (MAC table) | SNMP | Se SSH fallisce o per STP/LLDP |
| Switch con SNMP + SSH | SNMP (MAC table) | SSH | Se SNMP fallisce e ci sono credenziali SSH |
| UniFi | SNMP | SSH | MAC table da SNMP (Bridge MIB), STP da SNMP |

**Esempi**:
- Switch Cisco con `protocol=ssh`: usa SSH per MAC table; se hai anche `snmp_credential_id` o `community_string`, usa SNMP come fallback e per porte/LLDP/STP.
- Switch con `protocol=snmp_v2`: usa SNMP per MAC table; se hai anche username/password, può provare SSH come fallback.
- Router MikroTik con SSH: se hai community SNMP, può usare SNMP per porte e LLDP quando SSH non le fornisce.

**Regola**: configura entrambe le credenziali (SSH/API e SNMP) quando il dispositivo supporta più protocolli, per massimizzare i dati acquisiti.
