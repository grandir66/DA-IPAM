---
percorso: /devices/[id], /routers, /switches
titolo: Switch, Router e gli altri tipi — gli apparati di un tipo solo
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Questo indirizzo mostra due cose diverse secondo quello che c'è dopo `/devices/`:

- **un tipo di apparato** (`/devices/switch`, `/devices/router`, `/devices/server`, `/devices/firewall`,
  `/devices/access_point`, `/devices/hypervisor`, `/devices/storage`, `/devices/stampante`, `/devices/telecamera`,
  `/devices/voip`, `/devices/workstation`, `/devices/notebook`, `/devices/vm`, `/devices/iot`): l'elenco degli
  apparati di quel tipo, con i pulsanti per provarne le credenziali e leggerli. È la pagina descritta qui sotto.
  I vecchi indirizzi **/switches** e **/routers** portano a `/devices/switch` e `/devices/router`.
- **un numero**: la scheda di un apparato. Se l'apparato corrisponde a un host, si apre subito la
  [scheda dell'oggetto](pagine/objects-id.md), che è la scheda di tutti. Resta la vecchia scheda solo per i rari
  apparati creati a mano senza un host.

![L'elenco degli switch](/manuale/devices-id/pagina.png)

## Le voci della pagina

In cima c'è il nome del tipo (per esempio **Switch**) con una riga che dice a cosa servono quegli apparati. La freccia
a sinistra porta all'elenco di tutti i [Dispositivi](pagine/devices.md).

1. **Aggiungi Switch** (o Router, Server…): registra a mano un apparato di questo tipo indicando indirizzo, protocollo,
   vendor e credenziale. Di solito non serve: gli apparati si promuovono dall'elenco degli host.
2. **DNS**: com'è l'apparato nel DNS di Active Directory: **✓** c'è, **∅** manca, **≠** il nome è diverso. La colonna
   compare solo se il DNS è letto.
3. **Protocollo**: come DA-IPAM entra nell'apparato (**SNMP_V2**, **SSH**, **API**, **WinRM**…).
4. **Stato**: **Attivo** se l'apparato viene letto, **Disabilitato** se è stato fermato.
5. **Azioni**, da sinistra:
   - la **matita**: **Modifica / Assegna credenziali**: classificazione, protocollo, vendor, credenziale;
   - lo **scudo**: **Testa credenziali**, prova l'accesso senza leggere niente;
   - le **due frecce**: **Scansiona**, prova le credenziali e legge l'apparato (porte, MAC, ARP, sistema);
   - il **cestino**: **Elimina**, dopo una conferma.
   Sugli hypervisor ci sono anche **Scan Proxmox**, **Visualizza dati** (host, VM e container, hardware e licenza
   letti dal cluster) e l'abbinamento delle VM agli host; sui router il pulsante per **Acquisisci lease DHCP**.

Le altre colonne: **Nome**, **Classificazione**, **IP**, **Vendor**, **Profilo** (per esempio «Switch base»),
**Credenziali** (il risultato dell'ultimo test). Un clic sull'intestazione di una colonna con le frecce la ordina.

## Le azioni sulle righe spuntate

Spuntando le caselle a sinistra compaiono in alto:

- **Rendi apparato (N)**, per le righe che sono ancora semplici host: si sceglie cosa sono, come ci si arriva e quale
  credenziale usare (al massimo 50 per volta).
- **Assegna caratteristiche / credenziali**: classificazione, protocollo, vendor e credenziale uguali per tutte.
- **Testa credenziali** e **Scansiona** su tutte le righe spuntate.
- **Annulla selezione**.

Tutte le azioni che cambiano qualcosa o interrogano gli apparati spettano a chi ha il ruolo di amministratore.

## Come si usa

1. Apri il tipo che ti serve (per esempio dagli switch della [Topologia](pagine/topology.md) o da questo indirizzo).
2. Se un apparato non ha credenziali, premi la **matita** e scegline una.
3. Premi lo **scudo** per provarla, poi le **due frecce** per leggere l'apparato.
4. Per lavorare su più apparati insieme spunta le righe e usa i pulsanti in alto.

## Cosa vogliono dire i segni

- **Attivo** con il bordo, **Disabilitato** su fondo grigio: lo stato è scritto.
- Nella colonna DNS: **✓**, **∅**, **≠**.

## Da dove arrivano i dati

Dagli apparati resi gestiti e dalle loro letture con SNMP, SSH, WinRM o API. Gli switch letti danno la tabella MAC che
serve alla [Mappa porte](pagine/port-map.md) e alla [Topologia](pagine/topology.md).

## Se la pagina è vuota

Non c'è nessun apparato di quel tipo. Si aggiungono con **Rendi apparato** dalla
[pagina di una subnet](pagine/networks-id.md) o dalla [scheda dell'oggetto](pagine/objects-id.md). «Pagina non trovata»
vuol dire che dopo `/devices/` c'è una parola che non è un tipo né un numero.
