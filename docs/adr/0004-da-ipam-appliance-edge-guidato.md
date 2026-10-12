# ADR 0004 — DA-IPAM è l'appliance: catalogo dei moduli, edge guidato, installazione da dentro

**Stato:** Accepted
**Data:** 2026-10-12
**Autore:** riccardo.grandi@domarc.it
**Supera in parte:** DA-Vul-can ADR-0008 (edge stand-alone presso il cliente, con
interfaccia propria) e la spec dell'edge unificato del 2026-07-21 (DA-IPAM come
"integrazione opzionale"). **Rivede:** DA-Vul-can ADR-0009 (agente root sull'host
Proxmox). **Non tocca:** DA-Vul-can ADR-0001 (cifratura dei risultati edge → hub).

## Contesto

L'appliance del cliente oggi è fatta di tre prodotti che si parlano via HTTP:
DA-IPAM (inventario e nove moduli), Scanner-Edge (FastAPI + Greenbone, con la sua
interfaccia) e Deploy-Appliance (installatore Bash). Il 16/06 (ADR-0008 di
DA-Vul-can) si era deciso di tenerli separati, ciascuno installabile da solo.

L'analisi del 12/10 (`docs/analisi-sistema.md` §14, solo locale) misura il costo di
quella scelta:

- ogni modulo si gestisce a modo suo: sei schemi d'interazione nella stessa pagina,
  sette modi di disinstallare, cinque vocabolari di stato;
- l'edge si collega copiando a mano un token generato nella sua interfaccia, e metà
  delle sue funzioni (motore, feed, VLAN, moduli, aggiornamenti) stanno solo lì;
- l'installazione ha due padroni (Deploy-Appliance e DA-IPAM) che installano gli
  stessi componenti con versioni diverse;
- non esiste un'immagine dell'appliance: tutto si compila sul posto.

Vincoli: il repo DA-IPAM è **pubblico per scelta** (12/10), l'edge è codice privato
in DA-Vul-can; l'edge dialoga con l'hub DA-Vul-can (invio cifrato dei risultati,
segnale di vita, aggiornamenti, comandi) e **quel dialogo non deve cambiare**
(Riccardo, 12/10); un'installazione = un cliente (12/10).

## Decisione

**DA-IPAM diventa l'appliance**: si installa una cosa sola, e ogni componente si
accende, si configura e si aggiorna da DA-IPAM con un modello unico di modulo.
Decisioni di Riccardo del 12/10:

1. **Catalogo.** Ogni modulo è descritto una volta, in un manifesto dentro DA-IPAM:
   dove gira, requisiti, versione fissata, installazione, configurazione, salute,
   voci di menu, aggiornamento, cosa si perde disattivandolo. Registry, menu,
   salute e pagine leggono da lì.
2. **Edge = motore guidato da DA-IPAM.** Resta un container separato; DA-IPAM lo
   installa da un'immagine pronta, lo abbina da solo, lo aggiorna e ne mostra tutte
   le funzioni. Per le scansioni interne non ha più un'interfaccia propria per
   l'utente. Lo scanner esterno dal cloud (profilo `external_va`) resta stand-alone.
   Il dialogo edge ↔ hub DA-Vul-can resta com'è.
3. **Installazione.** Prima l'appliance che si completa da sola: un'immagine pronta
   (o uno script da una riga) installa solo DA-IPAM, il resto si accende dal
   catalogo. La console centrale Domarc per la flotta viene dopo, come progetto
   separato.
4. **Servizi pesanti.** Wazuh server, Graylog completo e DNS/DHCP restano su
   macchine proprie; DA-IPAM li collega con una procedura guidata e li apre con
   accesso unico. DA-IPAM **non** riceve diritti sull'host Proxmox.
5. **Controller UniFi e Omada** sono una fonte che crea oggetti: access point,
   switch, router e client (Wi-Fi compresi), con collegamenti LLDP, porta o access
   point, SSID e segnale.

Perché: i difetti misurati non stanno in un modulo ma nell'assenza di un modello, e
si chiudono solo dandone uno. Tenere il motore dell'edge in un processo separato
conserva la separazione fra applicazione web e scanner root (il motivo di ADR-0007)
togliendo la seconda interfaccia. Niente diritti sull'hypervisor tiene limitato il
danno se DA-IPAM viene compromesso. Partire dall'immagine elimina i percorsi
d'installazione divergenti e rende le appliance tutte uguali, che è la condizione
per una console centrale.

## Alternative scartate

- **Status quo (prodotti separati, ADR-0008)** — scartata: il costo cresce con ogni
  modulo, e i difetti di §14 sono la sua conseguenza diretta.
- **Interfaccia dell'edge aperta da DA-IPAM via proxy, con accesso unico** —
  scartata: veloce, ma le interfacce restano due e l'abbinamento resta a mano.
- **Edge riscritto dentro DA-IPAM** — scartata: mesi di lavoro, si perde la
  separazione fra app web e scanner root, e si riscrive un prodotto che funziona.
- **DA-IPAM che crea macchine su Proxmox con un agente sull'host (ADR-0009)** —
  scartata: comodo, ma un DA-IPAM compromesso comprometterebbe l'hypervisor.
- **Console centrale per prima** — scartata: presuppone appliance omogenee, che oggi
  non ci sono.
- **Codice di Deploy-Appliance o dell'edge dentro il repo DA-IPAM** — scartata: il
  repo è pubblico; il motivo di ADR-0008 (CI e segreti del bundle) resta valido.

## Conseguenze

### Positive

- Un gesto solo per accendere, vedere, aggiornare e spegnere qualunque modulo.
- Niente token da copiare: chi installa un componente genera le credenziali e lo
  abbina.
- Un ciclo d'aggiornamento per tutto quello che gira sull'appliance.
- Appliance riproducibili da un'immagine; la nuova PX-NAS è la prima prova.

### Negative

- DA-IPAM, che gira root sulla VM, comanda anche l'edge: i suoi permessi contano di
  più, quindi il blocco dei permessi va prima dell'edge guidato.
- Il lavoro sull'edge si fa in due repo: API in DA-Vul-can, pagine in DA-IPAM.
- Per un periodo convivono vecchio e nuovo (pagina Moduli, Deploy-Appliance,
  interfaccia dell'edge), finché il nuovo non è provato.

### Cosa diventa difficile in futuro

- **L'edge interno non si usa più da solo**: un cliente che vuole solo la VA interna
  riceve comunque DA-IPAM. Lo stand-alone resta per lo scanner esterno.
- **L'API dell'edge è un contratto fra due repo**: ogni cambio richiede versioni
  compatibili, e DA-IPAM deve sapere quale versione di edge sta guidando.
- **Un modulo fuori dal manifesto non esiste**: aggiungerne uno costa un manifesto
  completo (installazione, salute, disattivazione), non una card.
- **Le operazioni root passano da un esecutore con un elenco chiuso**: un'operazione
  nuova va aggiunta lì, non lanciata dall'applicazione.
- **I client letti dai controller fanno crescere il database**: retention e fusione
  per MAC sono obbligatorie, non un'ottimizzazione.

## Riferimenti

- Piano: [`../superpowers/specs/2026-10-12-piano-miglioramento-design.md`](../superpowers/specs/2026-10-12-piano-miglioramento-design.md)
- Analisi: `docs/analisi-sistema.md` §14 — solo locale, contiene dettagli di sicurezza.
- DA-IPAM: [ADR 0003](0003-topology-map.md) (mappa topologia).
- DA-Vul-can (`~/Progetti/Domarc/DA-Vul-can/docs/adr/`): ADR-0001, ADR-0007,
  ADR-0008, ADR-0009, ADR-0011; spec `docs/superpowers/specs/2026-07-21-unified-edge-profiles-design.md`.
