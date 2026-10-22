# ADR 0029 — VLAN degli switch in tabelle proprie, lette via SNMP da una lettura spenta

**Stato:** Accepted
**Data:** 2026-10-22
**Autore:** Riccardo Grandi, con Claude

## Contesto

La tab VLAN della scheda di uno switch deve mostrare la matrice porte × VLAN (U/T) come quella dei MikroTik, per qualunque
marca. Piano `plans/2026-10-22-accorpamento-ip-e-vlan-switch.md`, parte C (decisione C di Riccardo, 22/10). Il lettore
Q-BRIDGE-MIB (`src/lib/devices/snmp-vlan.ts`, Task 7) dà VLAN con il nome, egress e untagged di ogni VLAN per ifIndex,
PVID di ogni porta, e come è andata (`tabella` static/current, `mappa_porte`, `ordine_bit`, tre esiti). Oggi l'unico dato
di VLAN per porta è `switch_ports.vlan`, scritto dal giro ARP e letto dalla mappa: un numero solo per porta, senza tagged.

## Decisione

1. **Quattro tabelle proprie** nel DB del cliente: `switch_vlan` (device, VLAN, nome), `switch_vlan_porte` (device, VLAN,
   ifIndex, egress, untagged; untagged NULL = lo switch non lo dichiara, la U si deduce dal PVID), `switch_porta_pvid`
   (device, ifIndex, PVID), `switch_vlan_lettura` (una riga per apparato: data, tabella, mappa delle porte, numero di VLAN,
   ordine dei bit, porte senza mappa). Chiavi che cominciano da `device_id`, `ON DELETE CASCADE` verso `network_devices`,
   nessun CHECK, nessun indice in più. La scheda legge queste; la mappa no; `switch_ports.vlan` resta com'è.
2. **Fotografia per apparato, non storia**: `scriviVlanSwitch` cancella le righe dell'apparato nelle quattro tabelle e
   scrive quelle lette, in UNA transazione. Una lettura riuscita ma vuota è un fatto (fotografia vuota, con la sua data).
3. **«Non so» non scrive mai**: `scriviVlanSwitch` lancia su un esito diverso da `letto`. La regola sta nella funzione che
   scrive, non solo in chi la chiama: un chiamante nuovo che se ne dimentica fallisce, non cancella la matrice buona.
4. **Migrazione additiva `switch_vlan_v21`** (segno `done:<data>:v1`), all'apertura del tenant, in una transazione: le
   CREATE stanno solo nella migrazione (`migrateSwitchVlan`), senza `IF NOT EXISTS`, come la scheda MikroTik (ADR 0027):
   il journal dice quando sono nate (`switch vlan, aggiunto …`), e un oggetto con lo stesso nome fa fallire invece di
   passare muto. Migrazione fallita → il tenant si apre lo stesso, `scriviVlanSwitch` non scrive (un avviso per
   connessione), la scheda mostra «mai lette». Esportazione e importazione le trattano come storico (`table-registry.ts`).
5. **Lettura spenta di default** (Task 9, schema di ADR 0018): interruttore `topologia.lettura.switch_vlan`, chiave assente
   = spenta, al più una volta l'ora per apparato, sette walk in sola lettura. Sono letture SNMP nuove sugli switch dei
   clienti: si accendono per cliente, da chi le guarda.
6. **Chi legge e quando** (Task 9, `letturaVlanSwitch` e `vlanSwitchDaLeggere` in `src/lib/cron/jobs.ts`): gli switch
   (`device_type = 'switch'`) con una sessione SNMP, anche quelli del controller UniFi; non i MikroTik letti via SSH, non AP,
   NAS, server, router. Nel giro ARP, ramo degli switch, accanto alle letture SNMP della topologia, interruttore guardato
   per primo (spenta: nemmeno la credenziale si cerca; il giro è quello di prima, provato contando le walk). 10 s per walk
   (`TEMPO_WALK_MS`), sessione da `creaWalkSnmp`; uno switch muto costa una walk sola. «Non so» e «non riuscito» sono un
   errore col codice nell'esito (non «letta in parte»): niente scrittura. Caso peggiore: uno switch lento che risponde a
   ogni walk appena sotto il limite costa 7 walk × 10 s = 70 s per apparato, in serie, prima della tabella MAC.
7. **«Interroga» sullo switch con la lettura spenta non legge le VLAN.** Un admin che preme «Interroga» chiede di rileggere
   quello che l'apparato già dà (MAC, porte, STP), non acconsente a letture nuove: l'interruttore resta l'unico posto in cui
   si decide, per cliente, se lo switch riceve le walk Q-BRIDGE. Accesa, «Interroga» la fa **senza aspettare l'ora**
   (`conCadenza` con `ignoraCadenza`), col lucchetto e l'esito del giro (il giro dopo la salta per un'ora).
   Gli switch L3 con «Usa per polling ARP» passano dal ramo dei router (e da «Interroga» come router): lì la lettura non c'è.

## Alternative scartate

- **Colonne in più su `switch_ports`**: una porta ha molte VLAN tagged; servirebbe una lista in una colonna, e ogni
  scrittura del giro ARP dovrebbe preservarla.
- **Riusare le tabelle `mikrotik_*`**: sono scritte da RouterOS con i nomi delle interfacce; qui la chiave è l'ifIndex e
  la provenienza (Static/Current, ordine dei bit) va detta.

## Cosa diventa difficile in futuro

- **Due fonti della VLAN di una porta**: `switch_ports.vlan` del giro ARP (la mappa) e `switch_porta_pvid` di questa
  lettura (la scheda). Hanno età diverse e possono dire cose diverse; chi le unisce deve scegliere quale vince e dirlo.
- Le tabelle si riempiono solo con la lettura accesa: su un cliente che la tiene spenta la tab VLAN dello switch è vuota.
- Le porte sono per ifIndex: se lo switch rinumera gli ifIndex (aggiornamento del firmware), la fotografia vecchia resta
  coerente con sé stessa ma non con `switch_ports` finché la lettura non rigira.
- Una colonna nuova (per esempio il completamento dal controller UniFi, Task 13) chiede un livello nuovo della migrazione.
