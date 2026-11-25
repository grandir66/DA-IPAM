/**
 * I testi di «Come si usa» (Riccardo, 24/11/2026: «un modale di spiegazioni con un pulsante per attivarlo»). Una guida
 * per scheda, sempre con le stesse cinque parti; le pagine con schede interne ne hanno una per parte. La chiave è
 * l'indirizzo della scheda (`/pagina`, `/pagina#ancora`) più `>parte`. Modulo puro: le sezioni senza guida non mostrano
 * il pulsante. I nomi dei pulsanti citati sono quelli della pagina: se cambiano là, cambiano qui.
 */
export interface Guida {
  serve: string;
  passi: readonly string[];
  segni?: readonly string[];
  fonte: string;
  vuota: string;
}

const SENZA_COLLECTOR = "Serve un collector acceso: si controlla in «Collector e controlli». Con un periodo più lungo possono comparire dati più vecchi.";

export const GUIDE: Readonly<Record<string, Guida>> = {
  "/servizi-rete": {
    serve: "Elenca ogni porta aperta trovata sulle reti, cosa risponde e se c'è qualcosa da sistemare.",
    passi: [
      "Parti da «Dove guardare»: un clic su un riquadro o su una rete filtra l'elenco.",
      "Cambia «Raggruppa per» per vedere le stesse porte per prodotto, host o rete.",
      "Apri una riga: trovi la risposta letta e i rilievi, con prova e rimedio.",
      "Nel rilievo segna a che punto sei e scrivi una nota: è lo stesso stato dei Findings.",
      "«Sonda tutte le porte» rifà subito le letture; con un filtro di rete sonda solo quella.",
    ],
    segni: ["▲ accesso in chiaro o banner", "◆ TLS o certificato da sistemare", "○ aperta ma non risponde", "– non ancora sondata o non rivista"],
    fonte: "Le porte vengono dalle scansioni; le sonde leggono le risposte ogni 6 ore, per i clienti che non le hanno spente.",
    vuota: "Serve almeno una scansione delle reti. Se ci sono filtri scelti, toglili con la ✕.",
  },
  "/servizi-rete>identita": {
    serve: "Propone le coppie di indirizzi che sembrano lo stesso apparato, perché hanno la stessa impronta.",
    passi: [
      "Guarda «Prova» e «Impronta» per capire perché sono proposti insieme.",
      "«Collega» li unisce; «Non è lo stesso» scarta la proposta, che non torna da sola.",
      "«Raccogli le prove» rilegge le impronte già note. Niente si unisce da solo.",
    ],
    fonte: "Impronte SSH e TLS, SNMP, nomi Windows e nomi sentiti dalla sonda trunk.",
    vuota: "Nessuna impronta uguale su due indirizzi: è il caso normale.",
  },
  "/segmentazione>matrice": {
    serve: "Dice se da una rete si arriva ai servizi delle altre: serve a controllare che firewall e VLAN separino davvero.",
    passi: [
      "Leggi la riga come «da questa rete» e la colonna come «verso quella».",
      "Clicca una cella per vedere i servizi provati e il loro esito.",
      "Dopo aver cambiato una regola del firewall premi «Misura ora» e confronta.",
    ],
    segni: ["● raggiunto: la porta ha accettato la connessione", "■ chiuso: il servizio c'è e rifiuta", "▲ filtrato: nessuna risposta", "○ senza rotta", "La diagonale è vuota: una rete non si misura verso sé stessa"],
    fonte: "La sonda prova da ogni VLAN i servizi già noti delle altre reti. Di serie una volta a settimana.",
    vuota: "Serve la sonda trunk, almeno due reti con VLAN e gateway e i servizi già noti. Poi «Misura ora».",
  },
  "/segmentazione>servizi": {
    serve: "Parte dal servizio: da quali reti si riesce a toccarlo.",
    passi: ["Cerca i servizi delicati (desktop remoto, database, pannelli di gestione).", "Controlla «Da dove»: una rete che non dovrebbe arrivarci è una regola da chiudere."],
    segni: ["● raggiunto", "■ chiuso", "▲ filtrato", "○ senza rotta"],
    fonte: "Lo stesso giro di «Rete × rete».",
    vuota: "Si riempie dopo il primo giro della matrice.",
  },
  "/traffico>insieme": {
    serve: "Mostra chi parla con chi: fra reti, per host e per coppia di indirizzi.",
    passi: [
      "Scegli il periodo e il modo di guardare: reti, host o coppie.",
      "Da una riga fra reti, «Vedi le coppie» apre i singoli indirizzi.",
      "Su un host, «Andamento» disegna il suo volume nelle ultime 24 ore.",
    ],
    fonte: "La copia del traffico che lo switch manda ai collector. IPAM li legge ogni 5 minuti.",
    vuota: SENZA_COLLECTOR,
  },
  "/traffico>esterno": {
    serve: "Dice con chi, fuori dalla rete, parlano gli host: nome, paese e fornitore.",
    passi: ["Raggruppa e cerca per nome, indirizzo, paese o fornitore.", "Con «Dai un nome» una destinazione conosciuta diventa riconoscibile."],
    fonte: "I collector, con l'archivio di paesi e fornitori scaricato sull'appliance.",
    vuota: "Se mancano paesi e fornitori premi «Scarica l'archivio». Se manca tutto, i collector non mandano ancora questo dato.",
  },
  "/traffico>nonva": {
    serve: "Raccoglie le connessioni che non funzionano: chi bussa a vuoto, i servizi che non rispondono e quelli lenti.",
    passi: ["«Chi bussa a vuoto»: un host in cima cerca qualcosa che non c'è più, o sta esplorando la rete.", "«Servizi che non rispondono»: guarda se sono spenti o chiusi da una regola.", "«Servizi lenti»: oltre 200 ms per accettare una connessione, con almeno 5 aperture."],
    segni: ["✕ mai risposto", "◐ risponde a volte"],
    fonte: "I collector. Sono indizi, non misure esatte; le scansioni di IPAM non contano.",
    vuota: "Se la pagina dice che il dato non arriva, il collector va aggiornato.",
  },
  "/traffico>anomalie": {
    serve: "Mette in fila quello che esce dall'abitudine o passa in chiaro, dal più grave.",
    passi: ["Guarda prima le «Nuove» di gravità alta.", "«Vista»: l'hai controllata, resta in elenco fra le viste.", "Se quel traffico è voluto segnalo come normale: non verrà più segnalato."],
    fonte: "I collector, letti ogni 5 minuti. Nei primi 14 giorni di una rete si impara: collegamenti e porte nuove non vengono segnalati, il resto sì.",
    vuota: "Nessuna anomalia con i filtri scelti: prova «Tutte». Senza collector non arriva niente.",
  },
  "/traffico>reti": {
    serve: "Trova gli indirizzi interni che parlano ma non stanno in nessuna rete censita.",
    passi: ["«Dai un nome» alle reti che riconosci.", "Con un nome, la rete diventa un filtro di «Chi parla con chi»."],
    fonte: "I collector, nel periodo scelto.",
    vuota: "Tutti gli indirizzi interni visti stanno in una rete censita: è il caso giusto.",
  },
  "/traffico>accessi": {
    serve: "Mostra chi si è presentato con quale nome utente, da dove e verso quale server. Solo amministratori.",
    passi: ["Cerca un utente, un dominio o un indirizzo.", "Guarda «Falliti»: molti tentativi falliti sono da chiarire."],
    fonte: "I collector leggono il nome utente di Kerberos, SMB e LDAP, mai le password. Sono dati personali: spento di serie.",
    vuota: "Si accende in «Collector e controlli», e il collector va configurato per gli accessi.",
  },
  "/traffico>collector": {
    serve: "Gestisce le macchine che ascoltano il traffico e i controlli sul contenuto, rete per rete. Solo amministratori.",
    passi: ["«Registra un collector» con i dati che stampa la sua installazione.", "Guarda «Ultimo contatto», «Copertura» e «Ultimo errore»: dicono se sta ascoltando bene.", "Spegni un controllo solo per le reti dove quel traffico è voluto."],
    fonte: "IPAM legge i collector ogni 5 minuti. Del contenuto si salva il fatto, mai il valore.",
    vuota: "Un collector si installa su una macchina che riceve la copia del traffico dallo switch.",
  },
  "/arp-table/trunk#sicurezza": {
    serve: "Mostra i problemi che la sonda trunk sente sulla rete, senza interrogare nessun apparato.",
    passi: ["Parti dagli allarmi gravi.", "Scegli un tipo di rilievo: l'elenco si filtra e in fondo compare «Cosa fare».", "«Prendi in carico» dice ai colleghi che te ne occupi; «Riapri» lo rimette in lista.", "Con «Da prendere in carico» restano solo quelli senza nessuno."],
    segni: ["Gravità alta: conta nel numero rosso del menu", "Gravità media: da controllare", "Gravità bassa: da sapere"],
    fonte: "La sonda trunk, in ascolto sulla porta con tutte le VLAN. Si calcola a ogni lettura, ogni 2 minuti.",
    vuota: "Guarda la riga della sonda in alto: se è spenta o la lettura non è attiva, lì c'è scritto perché.",
  },
  "/arp-table/trunk#reti": {
    serve: "Elenca le VLAN, le reti e gli indirizzi che esistono davvero sul trunk, senza leggere il router.",
    passi: ["Scegli una VLAN: sotto compaiono le sue reti.", "Scegli una rete per il dettaglio; se la maschera è sbagliata si corregge lì.", "«Porta in DA-IPAM» aggiunge una rete che non c'è ancora.", "In fondo trovi ogni indirizzo IP e MAC, con i filtri."],
    segni: ["● visto in ascolto", "▲ silenzioso, trovato solo col giro ARP", "◆ visto e confermato", "GW? è l'IP più cercato"],
    fonte: "La sonda trunk, letta ogni 2 minuti. Le scansioni restano sull'IP ufficiale dell'appliance.",
    vuota: "La porta dello switch deve essere un trunk con tutte le VLAN: guarda la riga della sonda in alto.",
  },
  "/arp-table/trunk#annunci": {
    serve: "Elenca gli apparati che si presentano da soli sulla rete, con nome, modello e versione.",
    passi: ["Filtra «Non in DA-IPAM» per trovare apparati che mancano nell'inventario.", "Filtra «Non registrati come apparato» per completare quelli già noti come host.", "Apri una riga per vedere da quali porte si annuncia."],
    fonte: "I messaggi che MikroTik, Ubiquiti e Cisco mandano da soli, sentiti dalla sonda trunk.",
    vuota: "Gli annunci arrivano entro un paio di minuti. Alcuni apparati non si annunciano o hanno la funzione spenta.",
  },
  "/protezione": {
    serve: "Dice in una riga per strato cosa protegge questa installazione e cosa resta debole, col rimedio.",
    passi: ["Leggi dall'alto: le righe gravi stanno in cima.", "Dove c'è un pulsante, porta alla pagina in cui si rimedia.", "Ricarica la pagina per rifare i controlli."],
    segni: ["■ grave", "▲ da sistemare", "○ a posto", "? non letto su questa macchina"],
    fonte: "Controlli fatti in questo momento sulla macchina: porte in ascolto, firewall, utenti, file della chiave. Mai un valore segreto.",
    vuota: "«Non letto» vuol dire che il controllo non si è potuto fare, non che va bene. In fondo c'è l'elenco di ciò che la pagina non controlla ancora.",
  },
  "/protezione/porte": {
    serve: "Elenca ogni porta su cui la macchina risponde, chi la tiene e chi oggi la può raggiungere.",
    passi: ["Guarda prima le righe «Tutti»: sono le porte aperte a chiunque arrivi alla macchina.", "Una porta «Interna» aperta a tutti è da chiudere.", "Una porta «Non attribuita» è un servizio che DA-IPAM non conosce: va capito di chi è."],
    segni: ["● aperta a tutti", "◐ solo NetBird", "○ solo la macchina", "▲ da guardare"],
    fonte: "Le porte in ascolto della macchina e quelle pubblicate dai container, lette adesso.",
    vuota: "Senza l'elenco delle porte la pagina dice «non letto»: succede solo fuori da un'appliance.",
  },
  "/protezione/utenti": {
    serve: "Mostra chi può entrare in DA-IPAM, con quale ruolo e se usa la seconda verifica.",
    passi: ["Controlla gli amministratori con la seconda verifica spenta.", "Guarda chi non entra da molto: un'utenza che non serve si toglie.", "«Gestisci utenti» porta dove si creano e si cambiano."],
    segni: ["▲ amministratore senza seconda verifica", "○ accesa", "– spenta, utente senza diritti di amministratore"],
    fonte: "Gli utenti di questa installazione e la data dell'ultimo accesso.",
    vuota: "C'è sempre almeno l'utente con cui stai guardando.",
  },
  "/protezione/sistemi": {
    serve: "Mostra i sistemi che in questo momento hanno una connessione aperta con la macchina, nei due versi.",
    passi: ["Guarda le righe «Non riconosciuto»: sono indirizzi fuori dall'inventario.", "«← entra» è chi ha chiamato una nostra porta; «→ esce» chi abbiamo chiamato noi.", "«Cosa esce verso Domarc» spiega le uscite verso DA-Link, Vulcan e Zabbix."],
    segni: ["● riconosciuto", "▲ non riconosciuto"],
    fonte: "Le connessioni aperte adesso; i nomi vengono dall'inventario.",
    vuota: "È una fotografia: ricarica per rifarla. Chi parla ogni tanto può non comparire.",
  },
  "/protezione/moduli": {
    serve: "Elenca i container dei moduli con l'immagine, le porte e i permessi che hanno.",
    passi: ["«Porte pubblicate» rispondono alla rete: sono le stesse di Porte presentate.", "«Solo interne» le vedono solo gli altri container.", "Guarda chi ha permessi in più o usa la rete della macchina."],
    segni: ["■ privilegiato", "▲ permessi in più o rete della macchina"],
    fonte: "Docker, letto adesso. Le variabili d'ambiente dei container non si leggono mai.",
    vuota: "Senza Docker la pagina dice «non letto».",
  },
};

/** La guida di una scheda; con `parte` quella della parte aperta, se c'è, altrimenti quella della scheda. */
export function guidaDi(href: string, ancora?: string, parte?: string | null): Guida | null {
  const base = ancora ? `${href}#${ancora}` : href;
  return (parte ? GUIDE[`${base}>${parte}`] : undefined) ?? GUIDE[base] ?? null;
}
