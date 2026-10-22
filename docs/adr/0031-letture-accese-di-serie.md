# ADR 0031 — Le letture in più degli apparati sono accese di serie

**Stato:** Accepted
**Data:** 2026-10-22
**Autore:** Riccardo Grandi, con Claude
**Sostituisce:** la decisione D4 della spec topologia (§13.5.6, «un ambiente che non dichiara niente non legge») e la
parte «spenta di default» degli ADR 0027 (lettura `mikrotik_scheda`) e 0029 (lettura `switch_vlan`).

## Contesto

Il 22/10, sull'appliance appena installata di 70151, il router MikroTik era raggiungibile in SSH con la credenziale giusta
ma la sua scheda non aveva le VLAN: la lettura «VLAN, DNS e utenti dei MikroTik» nasce spenta, e le altre cinque letture
(spanning tree e bridge dei MikroTik, campi del controller, LLDP via SNMP, LLDP degli hypervisor, VLAN degli switch) pure.
Ogni appliance nuova andava quindi accesa a mano, lettura per lettura, in «Dati della mappa», e chi non lo sapeva vedeva
schede vuote senza un perché. Riccardo: «deve essere automatica la lettura, non dovrei dover aprire finestre da tutte le
parti e sempre diverse per avere dei dati coerenti». Le sei letture sono tutte in sola lettura (`print`, `monitor once`,
walk SNMP, API del controller) e hanno già la cadenza propria di un'ora per apparato.

## Decisione

1. **Chiave assente o valore rovinato = accesa.** `leggiInterruttore` (`src/lib/topology/letture/interruttori.ts`) vale
   spenta solo con `acceso: false` scritto da un admin; lo stato senza chiave è `{ acceso: true, da: null, il: null }` e la
   pagina lo dice «accesa di serie».
2. **Lo spegnimento resta**, cliente per cliente, da «Dati della mappa», con chi e quando, come prima.
3. **La mappa nuova (`topologia.mappa.cavi`) non cambia**: usa `leggiStatoChiave` e resta spenta di serie, perché cambia
   ciò che si vede sulla mappa, non solo cosa si legge.
4. Le prove che partono «a letture spente» lo dichiarano (`__tests__/letture-spente.ts`); una prova nuova fissa
   «assente/rovinata = accesa, `false` = spenta».

## Conseguenze

- Al primo giro dopo l'aggiornamento ogni appliance legge da sola gli apparati che ha le credenziali per leggere: più
  comandi SSH/SNMP verso gli apparati dei clienti, al più uno per lettura e apparato all'ora.
- Gli utenti dei router MikroTik (solo i nomi) entrano nel DB del cliente senza un'azione esplicita; la scheda li mostra
  solo agli admin, come prima.
- Un'appliance dove un admin aveva spento una lettura la tiene spenta (la chiave c'è, con `acceso: false`).

**Cosa diventa difficile in futuro:** una lettura nuova che non è innocua (che scrive sull'apparato o pesa) non può
appoggiarsi a questo interruttore così com'è: nascerebbe accesa. Va dichiarata con un interruttore suo, spento di serie,
e messa nella pagina unica delle opzioni chiesta da Riccardo lo stesso giorno.
