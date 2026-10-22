# Pulizia degli host assenti e dei cambi di IP — design (20/10/2026)

Richiesta di Riccardo (20/10): «un sistema per rimuovere gli oggetti offline da oltre N
giorni, perché realisticamente non più presenti, e quelli che hanno cambiato IP mantenendo
il MAC». **Zona rossa** (dati del cliente, cancellazioni): livello di controllo completo.

## Decisioni di Riccardo (20/10, non riaprire)

1. Host offline da oltre **60 giorni** → **archiviati** (spariscono da liste, conteggi e mappa,
   recuperabili con un clic); **cancellati davvero dopo altri 90 giorni** d'archivio.
2. Esclusi dall'archiviazione: apparati (`network_devices.host_id`), host monitorati
   (`known_host = 1`), con nome scritto a mano (`custom_name`), legati a un asset
   (`inventory_assets.host_id`), con credenziali assegnate (`host_credentials`), dentro
   un'unione a mano (`topology_unioni`) o un gruppo multihomed.
3. **Stesso MAC, IP cambiato** → il vecchio IP si archivia **subito** (non aspetta i 60 giorni)
   e la scheda dell'host nuovo mostra «IP precedenti». Solo quando nel gruppo dello stesso MAC
   c'è **un solo** host online, visto dopo l'ultima volta del vecchio. Esclusi i MAC presenti
   su più host online (router/firewall che rispondono per più IP, macchine multihomed).
4. **Esecuzione**: nasce spenta. In Impostazioni un'**anteprima a mano** con l'elenco degli host
   (nomi e motivo, non totali) e «Applica»; il **job notturno** si accende solo dopo, con un
   interruttore. Prova a vuoto di default, come ogni automatismo nuovo (standard Domarc).

## Numeri misurati sull'hub (tenant 70791, 20/10, sola lettura)

| Caso | Quanti |
|---|---|
| Host offline totali | 178 |
| non visti 7-30 g / 30-90 g / oltre 90 g / mai visti | 65 / 19 / 29 / 2 |
| Oltre 30 g: legati ad apparati / con credenziali / monitorati / nome a mano | 2 / 3 / 0 / 0 |
| Stesso MAC su più host | 25 gruppi, 76 host |
| … con 1 online e gli altri offline (cambio IP) | 4 gruppi |
| … tutti offline | 14 gruppi |
| … più host online (router, firewall, multihomed: NON doppioni) | 7 gruppi |

Il campo `notes` è pieno su tutti gli assenti (testo automatico con la data): non è un
legame scritto da una persona e non esclude.

## La scelta tecnica da confermare con Riccardo prima del codice

Oggi **252 query in 34 file** leggono `hosts`, e **21 tabelle** hanno una chiave verso `hosts`.

- **A. Tabella d'archivio (raccomandata).** Archiviare = copiare la riga dell'host e le sue
  informazioni d'identità (IP, MAC, nomi, classificazione, note, ultime viste, dal
  `mac_ip_history` gli IP precedenti) in `hosts_archivio` come istantanea JSON, poi
  cancellare l'host (le tabelle figlie seguono le loro regole ON DELETE). Recupero =
  ricreare l'host dall'istantanea: torna con identità e note, **non** con lo storico dei
  controlli. Nessuna delle 252 query va toccata. Dopo 90 giorni si cancella la riga d'archivio.
- **B. Campo `archived_at` su `hosts`.** Recupero completo (storico compreso), ma ognuna delle
  252 query va filtrata: una dimenticata fa ricomparire gli archiviati senza dirlo. Va
  costruita una vista o una funzione unica e una prova che controlli tutte le query.

Riccardo ha chiesto «recuperabile con un clic»: con A si recupera l'host, non il suo storico.
Va detto con queste parole e confermato.

## Cosa costruire (dopo la conferma)

1. Selezione dei candidati in un modulo puro e provato (`lib/hosts/pulizia.ts`): regole 1-3,
   con il motivo per ciascun host. Le date: `last_seen` è formato SQLite (sicuro con
   `datetime('now')`); `mac` va normalizzato (maiuscole, senza `:`/`-`) come nelle misure.
2. Anteprima in Impostazioni → Sistema: tabella con IP, nome, MAC, ultima vista, motivo;
   «Applica» con conferma scritta del numero. Prova a vuoto = anteprima.
3. Archiviazione e recupero (A o B), audit di ogni operazione (canale audit JSONL del progetto).
4. Job notturno in `scheduled_jobs`, spento di default; interruttore in Impostazioni.
5. «IP precedenti» nella scheda host (da `mac_ip_history` e dall'archivio).
6. Contatore degli archiviati in dashboard accanto ad «Assenti» (oggi: offline non visti da
   oltre 7 giorni, `lib/hosts/assenti.ts`).

## Prove richieste (zona rossa)

- Ogni regola e ogni esclusione con una prova vista fallire, dati con la forma vera.
- Prova a vuoto sul DB dell'hub (copia in sola lettura), **elenco dei nomi** letto prima di
  applicare; backup delle righe toccate (`.bak-YYYYMMDD-HHMMSS`) prima del primo «Applica»
  sul vero, con conferma di Riccardo.
- Recupero provato: archiviare e recuperare un host di prova, confrontare i campi.
