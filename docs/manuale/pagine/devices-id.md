---
percorso: /devices/[id], /routers, /switches
titolo: Switch, Router e gli altri tipi — gli apparati di un tipo solo
versione: 0.9.1367
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

Le tabelle e la selezione funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md).

## Il titolo

![Il titolo dell'elenco degli switch](/manuale/devices-id/testata.png)

In cima `icona:arrow-left` porta all'elenco di tutti i [Dispositivi](pagine/devices.md); poi il nome del tipo (per
esempio **Switch**) con una riga che dice a cosa servono quegli apparati.

1. `tasto:plus` **Aggiungi Switch** (o Router, Server…; per gli hypervisor **Aggiungi Proxmox**): registra a mano un
   apparato di questo tipo indicando nome, indirizzo, protocollo, vendor e credenziale. Di solito non serve: gli
   apparati si promuovono dall'elenco degli host. Compare solo per i tipi che si possono leggere.

## La tabella

![La tabella degli switch](/manuale/devices-id/tabella.png)

1. **DNS**: com'è l'apparato nel DNS di Active Directory: **✓** c'è, **∅** manca, **≠** il nome è diverso. La colonna
   compare solo se il DNS è letto.
2. **Protocollo**: come DA-IPAM entra nell'apparato (**SNMP_V2**, **SSH**, **API**, **WinRM**…).
3. **Credenziali**: il risultato dell'ultimo **Testa credenziali**: `icona:check` funzionanti, **Fallito**, oppure un
   trattino se non sono ancora state provate.
4. **Stato**: **Attivo** se l'apparato viene letto, **Disabilitato** se è stato fermato.
5. **Azioni**, da sinistra:
   - `icona:pencil` **Modifica / Assegna credenziali**: classificazione, protocollo, vendor, credenziale;
   - `icona:shield-check` **Testa credenziali**: prova l'accesso senza leggere niente;
   - `icona:refresh` **Scansiona**: prova le credenziali e legge l'apparato (porte, MAC, ARP, sistema);
   - `icona:trash` **Elimina**, dopo una conferma.

Sugli **hypervisor** ci sono anche `icona:refresh` **Scan Proxmox**, `icona:server` **Visualizza dati** (apre una
finestra con host, VM e container, e la scheda **Hardware e licenza**: kernel, uptime, produttore, modello, seriale,
licenza e scadenza) e `icona:link` **Abbina inventario** (abbina le VM agli host); un hypervisor non ancora impostato
ha **Imposta come Proxmox per abilitare lo scan**. Sui **router** c'è `icona:database` **Acquisisci lease DHCP**.
Le righe che sono ancora semplici host hanno **Configura** (rendi apparato) e `icona:external-link` **Dettagli host**.

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome dell'apparato. |
| **Classificazione** | Il tipo. |
| **IP** | L'indirizzo con cui viene letto. |
| **DNS** | ✓, ∅ o ≠ (se il DNS è letto). |
| **Rete**, **Ultimo scan** | Compaiono in alcuni tipi: la subnet e l'ultima lettura. |
| **Vendor** | Il produttore. |
| **Profilo** | Il profilo di prodotto (per esempio «Switch base»). |
| **Protocollo**, **Credenziali**, **Stato** | Vedi sopra. |

Ogni intestazione con `icona:arrow-up-down` ordina con un clic. I pulsanti si vedono anche in sola lettura, ma le
azioni che cambiano qualcosa o interrogano gli apparati le esegue solo un **amministratore**.

## Le azioni sulle righe spuntate

![La barra della selezione](/manuale/devices-id/selezione.png)

Spuntando le caselle a sinistra compaiono in alto:

- `tasto:plus` **Rendi apparato (N)**, per le righe che sono ancora semplici host: si sceglie cosa sono, come ci si
  arriva e quale credenziale usare (al massimo 50 per volta);
- `tasto:settings-2` **Assegna caratteristiche / credenziali**: apre **Assegna caratteristiche a N elementi**, con
  **Classificazione / Gruppo**, **Protocollo**, **Vendor** e credenziale uguali per tutte («Non modificare» lascia
  com'è);
- `tasto:shield-check` **Testa credenziali** e `tasto:refresh` **Scansiona** su tutte le righe spuntate;
- **Annulla selezione**.

## Come si fa

- **Dare la credenziale a uno switch nuovo**: `icona:pencil`, scegli la credenziale, salva; poi `icona:shield-check`
  per provarla e `icona:refresh` per leggerlo.
- **Rileggere tutti gli switch dopo un cambio di community**: spunta tutte le righe dalla casella dell'intestazione,
  **Assegna caratteristiche / credenziali** con la credenziale nuova, poi **Scansiona**.
- **Vedere le VM di un hypervisor Proxmox**: apri `/devices/hypervisor`, `icona:refresh` **Scan Proxmox**, poi
  `icona:server` **Visualizza dati**.
- **Prendere i lease DHCP da un router**: apri `/devices/router` e premi `icona:database` sulla sua riga.
- **Trovare gli switch con credenziali che non vanno**: guarda **Fallito** nella colonna **Credenziali**.

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
