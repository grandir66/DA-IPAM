---
percorso: /dns
titolo: DNS — zone, filtro e resolver
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Gestisce il **DNS** erogato dalla VM Network Services dell'appliance: le **zone** interne (i nomi della rete del
cliente e la risoluzione inversa), il **filtro DNS** che blocca pubblicità e siti malevoli (AdGuard Home) e il
**resolver** che risolve i nomi verso Internet e inoltra i domini interni ai server giusti (Unbound). Si arriva da
**Network Services › DNS** nel menu, o da **Apri hub** nella [panoramica](pagine/network-services.md). Il gruppo di
menu c'è solo se il modulo Network Services è acceso.

Nessuna schermata: sull'istanza usata per le immagini del manuale il modulo non è installato.

## Le voci della pagina

In cima: il titolo, l'indirizzo della VM e il pulsante **Aggiorna**, che rilegge lo stato di tutti i servizi. Se la VM
non risponde, un riquadro rosso riporta l'errore. Sotto ci sono quattro schede; la scheda scelta resta nell'indirizzo
della pagina, così si può mandare il collegamento diretto.

### Panorama

- Per gli amministratori, tre riquadri **DNS autoritativo**, **Filtro DNS**, **Resolver** con il segno **Attivo** o
  **Off** e il pulsante **Abilita** / **Disabilita**.
- Lo **schema della catena**: come viaggia una domanda DNS dai client al filtro (porta 53), al resolver e alle zone.
- **Filtro DNS**: Query, Bloccate, % blocco, Latenza media.
- **Resolver**: Query, Cache hit, Cache miss, Hit ratio (verde sopra il 70%, giallo sotto il 40%) e l'elenco delle
  **Forward zone** (dominio → server a cui viene inoltrato).

### Zone DNS

Il riquadro **DNS autoritativo**:

- **Zona**: sceglie la zona da vedere; sotto compaiono i suoi record.
- Per creare una zona: **Zona forward** (es. il dominio interno del cliente) e, con la casella accanto, anche la **Zona
  reverse (CIDR)** della rete, per la risoluzione inversa.
- Per aggiungere un record: **Nome (FQDN)**, **Tipo** (A, AAAA, CNAME, PTR, MX, TXT…), **Valore**, **TTL**. Ogni record
  si modifica o si elimina dalla sua riga.
- Quando si crea un record **A** verso un indirizzo che non ha il record inverso, compare la finestra **Record PTR
  coerente**: propone di registrare anche il PTR.

### Filtro DNS

- **Statistiche filtro**, con **Flush cache DNS** per svuotare la memoria del filtro.
- **Upstream resolver**: **Upstream DNS** (a chi il filtro gira le domande, di solito il resolver locale) e **Bootstrap
  DNS**. **Salva upstream** li scrive.
- **Regole custom**: le regole di blocco o di permesso scritte a mano. **Nuova regola** + **Aggiungi** ne aggiunge una
  (nella sintassi di AdGuard, es. `||ads.example.com^`); ogni regola si toglie dalla sua riga.

### Resolver

- **Cache e statistiche**, con **Flush cache**.
- **Upstream default (zona root)**: i resolver a cui mandare tutto quello che non è coperto da una forward zone
  (separati da virgola). **Salva** li scrive.
- **Forward zone / conditional forwarders**: per un dominio (es. il dominio di Active Directory) si indica a quale
  server inoltrare le domande, nella forma IP@porta. **Aggiungi** la crea; ogni zona si toglie dalla sua riga.

Le modifiche le fa solo un amministratore; se un servizio è spento, la sua scheda dice di abilitarlo dal Panorama.

## Come si usa

1. Nel **Panorama** controlla che i tre servizi siano **Attivo**.
2. Per far risolvere i nomi del dominio Active Directory, aggiungi in **Resolver** una forward zone verso i domain
   controller.
3. Per un nome interno nuovo, in **Zone DNS** scegli la zona e aggiungi il record A (accetta la proposta del PTR).
4. Se un sito utile viene bloccato, aggiungi una regola di permesso in **Filtro DNS › Regole custom**.

## Da dove arrivano i dati

Dal bridge della VM Network Services: PowerDNS per le zone, AdGuard Home per il filtro, Unbound per il resolver.

## Se la pagina è vuota

«Modulo non disponibile» vuol dire che la VM Network Services non è configurata su questa appliance; gli amministratori
hanno il collegamento **Impostazioni moduli**. «Nessuna zona configurata» vuol dire che non è ancora stata creata
nessuna zona.
