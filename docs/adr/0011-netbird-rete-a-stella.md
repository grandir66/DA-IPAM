# ADR 0011 — NetBird al posto di Tailscale, a stella, con DA-IPAM che emette le chiavi

**Stato:** Proposed (diventa Accepted con l'ok di Riccardo al documento di progetto)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Documento di progetto:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md)

## Contesto

I centrali Domarc (DA-IPAM, DA-Vul-can, DA-VA-OVH) e gli oggetti presso i clienti (appliance
DA-IPAM, Scanner-Edge, bridge) si collegano via Tailscale. La tailnet è intestata a un account
personale. Tailscale è cablato nell'installazione dell'edge, nell'agente Python e nella
procedura guidata di DA-IPAM.

Domarc ha già NetBird self-hosted (`netbird.domarc.it`), che usano i colleghi e su cui
DA-Zabbix fa già entrare i proxy dei clienti con chiavi per cliente e policy minime.

## Decisione

**Gli oggetti remoti passano a NetBird in una rete a stella.** Ci sono gruppi per ruolo
(`centro-*`, `remoto-*`, `zabbix-proxy`) più un gruppo per cliente (`cli-<codice>`), e
policy a senso unico per porta. Nessuna policy collega due remoti. Il gruppo `All` non
compare in nessuna policy, rotta o nameserver.

Ogni oggetto entra con una **setup key monouso emessa da DA-IPAM centrale via API**. Da
Domarc si raggiunge solo l'oggetto, mai la LAN del cliente. Il passaggio si fa a doppio
binario cliente per cliente, partendo da DTS.

Il motivo: una sola rete per persone e macchine, tenuta da Domarc e non da un account
personale. L'isolamento fra clienti è scritto in poche policy fisse e verificato da un
controllo automatico, invece di dipendere da tag assegnati a mano.

## Alternative scartate

- **Una policy per oggetto**: precisa, ma cresce a ogni installazione, e la console diventa
  illeggibile proprio dove un errore apre un varco fra clienti.
- **Centrali come «risorse» dietro un nodo d'instradamento**: complica senza bisogno, perché
  i centrali possono stare direttamente in NetBird.
- **Chiave riusabile per cliente**: chi la trova aggiunge nodi finché non la si revoca.
- **Controlli di postura**: un client NetBird vecchio resterebbe fuori. Si possono
  aggiungere dopo.
- **Rotta verso la LAN del cliente**: un centrale compromesso vedrebbe le LAN di tutti i
  clienti.
- **Restare su Tailscale passando a una tailnet aziendale**: due reti da tenere invece di una.

## Conseguenze

- DA-IPAM centrale diventa il punto che apre e chiude l'accesso degli oggetti remoti, con
  un token API NetBird da custodire e rinnovare.
- Gli scrittori in NetBird sono due, DA-IPAM e DA-Zabbix: servono regole di nome comuni,
  e nessuno cancella ciò che non ha creato.
- Le policy dei colleghi devono uscire dal gruppo `All` prima che entri il primo cliente.

**Cosa diventa difficile in futuro:**

- Raggiungere un dispositivo nella LAN di un cliente da Domarc richiede di passare
  dall'appliance (SSH, salto), oppure una decisione nuova che riapra la rotta, per un
  cliente e solo per gli admin.
- Ogni nuova policy NetBird scritta a mano rischia di rompere R1–R4. La verifica la segnala,
  ma solo dopo che è stata scritta.
- Se `netbird.domarc.it` è giù non entra nessun oggetto nuovo: il server NetBird diventa
  infrastruttura critica quanto gli hub.
