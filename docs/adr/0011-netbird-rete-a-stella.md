# ADR 0011 — NetBird al posto di Tailscale, a stella, con un concentratore che emette le chiavi

**Stato:** Proposed (diventa Accepted con l'ok di Riccardo al documento di progetto)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Documento di progetto:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md)

## Contesto

**I moduli centrali** stanno in sede: da-vulcan (hub VA) e DA-ZABBIX. DA-VA-OVH sta nel
cloud di Domarc, con la sua VPN diretta.

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
  cliente (`cli-<codice>`).
- Le policy sono a senso unico e per porta. Nessuna policy collega due remoti, il gruppo `All`
  non compare mai, e Wazuh non entra in NetBird.
- Ogni oggetto entra con una **setup key monouso emessa da un concentratore**: un progetto
  nuovo, in sede, che nasce adesso con questo solo compito ed è l'inizio della console
  centrale della tappa 9.
- Le istanze IPAM mandano i loro dati al concentratore; lui non apre porte verso di loro.
- Da Domarc si raggiunge solo l'oggetto, mai la LAN del cliente.
- Il passaggio si fa a doppio binario cliente per cliente, partendo da DTS. DA-VA-OVH resta
  sulla sua VPN.

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
- **Il concentratore dentro DA-IPAM**: il ramo `main` di DA-IPAM arriva a ogni appliance,
  e la regia centrale finirebbe, spenta, in casa di ogni cliente.
- **Il concentratore dentro l'hub DA-Vul-can**: mescola la sicurezza con l'inventario.
- **Uno strumento provvisorio, o la procedura guidata di DA-Zabbix estesa a tutto**: più
  rapido, ma la regia si sposterebbe due volte.
- **Il concentratore che va a prendere i dati**: una porta in ingresso aperta su ogni
  istanza.
- **Restare su Tailscale passando a una tailnet aziendale**: due reti da tenere invece di una.

## Conseguenze

- Nasce un progetto nuovo prima del previsto, ma piccolo. Contiene la parte che serve
  comunque alla tappa 9: sapere quali oggetti esistono e se sono vivi.
- Gli scrittori in NetBird sono due, il concentratore e DA-Zabbix: servono regole di nome
  comuni, e nessuno cancella ciò che non ha creato.
- Le policy dei colleghi devono uscire dal gruppo `All` prima che entri il primo cliente.

**Cosa diventa difficile in futuro:**

- Raggiungere un dispositivo nella LAN di un cliente da Domarc richiede di passare
  dall'oggetto (SSH, salto), oppure una decisione nuova che riapra la rotta, per un cliente e
  solo per gli admin.
- Raggiungere Wazuh da Domarc non si può per costruzione. Servirebbe una decisione nuova.
- Un comando dal centro verso un'istanza IPAM non ha una porta su cui arrivare: deve
  viaggiare come risposta a una chiamata dell'istanza.
- Ogni nuova policy NetBird scritta a mano rischia di rompere R1–R5. La verifica la segnala,
  ma solo dopo che è stata scritta.
- Se `netbird.domarc.it` o il concentratore sono giù non entra nessun oggetto nuovo.
