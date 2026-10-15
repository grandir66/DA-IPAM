# ADR 0011 — NetBird al posto di Tailscale, a stella, con DA-Link che fa entrare gli oggetti da solo

**Stato:** Proposed (diventa Accepted con l'ok di Riccardo al documento di progetto)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Documento di progetto:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md)
**Completato da:** [ADR 0013](0013-licenza-e-segreto-degli-oggetti.md) (licenza, segreto degli oggetti, CA interna, custodia)

## Contesto

**I moduli centrali** stanno in sede: da-vulcan (hub VA) e DA-ZABBIX. DA-VA-OVH sta nel
cloud di Domarc, con la sua VPN diretta. DA-CRM sta in sede e deve vedere il quadro tecnico
dei clienti.

**Dai clienti** ci possono essere:
- un edge per le scansioni VA;
- un proxy Zabbix;
- un'istanza DA-IPAM, che può contenere edge, proxy, LibreNMS e altri applicativi;
- Wazuh, che resta isolato.

Oggi edge e bridge si collegano via Tailscale, con una tailnet intestata a un account
personale. Tailscale è cablato nell'installazione dell'edge, nell'agente Python e nella
procedura guidata di DA-IPAM.

Domarc ha già NetBird self-hosted (`netbird.domarc.it`), che usano i colleghi e su cui
DA-Zabbix fa già entrare i proxy dei clienti con chiavi per cliente e policy minime.

Non esiste ancora un punto centrale che sappia quali oggetti remoti ci sono: è la tappa 9 del
piano di miglioramento, «progetto separato, dopo».

## Decisione

**Gli oggetti dei clienti passano a NetBird in una rete a stella.**
- I gruppi sono per ruolo (`centro-*`, `remoto-*`, `zabbix-proxy`), più un gruppo per
  cliente (`cli-<codcli>`, codice del gestionale).
- Le policy sono a senso unico e per porta. Nessuna policy collega due remoti, il gruppo `All`
  non compare mai, e Wazuh non entra in NetBird.
- Nasce adesso **DA-Link**, progetto separato in sede e inizio della console centrale.
  - Ha un suo utente di servizio NetBird e crea da solo gruppi, chiavi monouso e policy al
    clic del tecnico.
  - Rimette com'erano le sue policy se qualcuno le modifica (col freno all'inizio).
  - Riceve dalle istanze IPAM il segnale di vita, e i numeri dell'inventario solo se
    l'istanza li condivide.
  - Dà a DA-CRM, in sola lettura, il quadro di ogni cliente.
- **Cosa esce da un'istanza IPAM lo decide l'istanza**, con due livelli: «solo stato» oppure
  «stato + inventario». Senza una scelta dichiarata esce solo lo stato, e dal centro non si
  cambia. Se il cliente toglie il consenso, DA-Link cancella anche i numeri già ricevuti.
- Da Domarc si raggiunge solo l'oggetto, mai la LAN del cliente.
- Il passaggio si fa a doppio binario cliente per cliente, partendo dal cliente A.
- Restano fuori: DA-VA-OVH, sulla sua VPN, e l'OSINT avviato dal CRM, che va dal CRM a
  DA-Vul-can.

Il motivo: una sola rete per persone e macchine, tenuta da Domarc e non da un account
personale. L'isolamento fra clienti è scritto in poche policy fisse e verificato da un
controllo automatico, invece di dipendere da tag assegnati a mano. La regia sta in un posto
che vive solo in sede, non nel codice che va a ogni cliente.

## Alternative scartate

- **Una policy per oggetto**: precisa, ma cresce a ogni installazione, e la console diventa
  illeggibile proprio dove un errore apre un varco fra clienti.
- **Chiave riusabile per cliente**: chi la trova aggiunge nodi finché non la si revoca.
- **Controlli di postura**: un client NetBird vecchio resterebbe fuori. Si possono
  aggiungere dopo.
- **Rotta verso la LAN del cliente**: un centrale compromesso vedrebbe le LAN di tutti i
  clienti.
- **DA-Link dentro DA-IPAM**: il ramo `main` di DA-IPAM arriva a ogni appliance, e la regia
  centrale finirebbe, spenta, in casa di ogni cliente.
- **DA-Link dentro l'hub DA-Vul-can**: mescola la sicurezza con l'inventario.
- **Uno strumento provvisorio, o la procedura guidata di DA-Zabbix estesa a tutto**: più
  rapido, ma la regia si sposterebbe due volte.
- **DA-Link che va a prendere i dati**: una porta in ingresso aperta su ogni istanza.
- **Iscrizione automatica al primo avvio**: DA-Link dovrebbe stare su Internet.
- **Oggetti preparati dal CRM**: si possono aggiungere dopo.
- **Livello di condivisione deciso dal centro, o inventario condiviso finché il cliente non
  lo blocca**: la privacy del cliente dipenderebbe da Domarc invece che da lui.
- **OSINT del CRM attraverso DA-Link**: DA-Link si allargherebbe oltre la rete e diventerebbe
  necessario anche per l'OSINT.
- **Restare su Tailscale passando a una tailnet aziendale**: due reti da tenere invece di una.

## Conseguenze

- Nasce un progetto nuovo prima del previsto, ma piccolo. Contiene la parte che serve
  comunque alla tappa 9: sapere quali oggetti esistono e se sono vivi.
- Il token dell'utente di servizio di DA-Link è il segreto più delicato: con quello si apre
  e si chiude la rete di tutti i clienti.
- Gli scrittori in NetBird sono due, DA-Link e DA-Zabbix: servono regole di nome comuni, e
  nessuno cancella ciò che non ha creato.
- `codcli` del gestionale diventa obbligatorio come codice delle istanze DA-IPAM.
- Le policy dei colleghi devono uscire dal gruppo `All` prima che entri il primo cliente.

**Cosa diventa difficile in futuro:**

- Raggiungere un dispositivo nella LAN di un cliente da Domarc richiede di passare
  dall'oggetto (SSH, salto), oppure una decisione nuova che riapra la rotta, per un cliente e
  solo per gli admin.
- Raggiungere Wazuh da Domarc non si può per costruzione. Servirebbe una decisione nuova.
- Un comando dal centro verso un'istanza IPAM non ha una porta su cui arrivare: deve
  viaggiare come risposta a una chiamata dell'istanza.
- Il CRM vede numeri, non l'inventario riga per riga. Il dettaglio richiederebbe una
  decisione nuova su dove vive il dato del cliente.
- Una policy cambiata a mano di proposito verrà rimessa com'era da DA-Link: si cambia nella
  sua descrizione, non nella console.
- Se `netbird.domarc.it` o DA-Link sono giù non entra nessun oggetto nuovo.
- Ogni dato nuovo che si vorrà far uscire da un'istanza dovrà passare dal livello di
  privacy dell'istanza, e un cliente a «solo stato» non lo darà: il quadro centrale
  avrà sempre dei buchi dichiarati.
