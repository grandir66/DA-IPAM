# ADR 0013 — Licenza, segreto degli oggetti e CA interna, custoditi da DA-Link

**Stato:** Proposed (diventa Accepted con l'ok di Riccardo al documento di progetto)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Completa:** [ADR 0011](0011-netbird-rete-a-stella.md)
**Superata in parte da:** [ADR 0014](0014-chiavi-in-file-cifrati-ca-un-livello.md) — custodia nelle YubiKey e CA a due livelli (14/10 sera)
**Documento di progetto:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md), §8 e §9

## Contesto

Con l'ADR 0011 DA-Link fa entrare gli oggetti dei clienti in NetBird e ne riceve lo stato.
Riccardo (14/10) aggiunge quattro richieste:

- DA-Link deve poter **spegnere un oggetto remoto se la licenza futura scade**;
- serve un **segreto rinnovato ogni poche settimane**, generato da DA-Link e scambiato con gli
  oggetti, che faccia da chiave della licenza, da chiave dei dati archiviati e da chiave
  degli scambi;
- ogni installazione deve avere un **certificato emesso da una CA interna**, riconosciuto in
  automatico dagli applicativi;
- l'accesso a DA-Link deve essere molto limitato, e i suoi segreti custoditi in modo
  estremamente sicuro.

Oggi gli edge si fanno certificati auto-firmati, e DA-IPAM si fida del primo che vede. Non
esiste una licenza.

## Decisione

**Ogni istanza IPAM ed edge riceve da DA-Link un pacchetto che si rinnova da solo ogni 4
settimane**, con 2 settimane di tolleranza se l'oggetto resta scollegato. Il pacchetto
contiene:

- un **segreto** da cui si ricavano tre chiavi distinte (rinnovo, firma degli scambi,
  protezione dei dati archiviati);
- una **licenza firmata**, verificabile anche senza rete;
- un **certificato** della CA interna.

**Licenza e certificato**
- **A licenza scaduta** l'oggetto smette di lavorare ma i dati restano leggibili ed
  esportabili. «Spegnere» vuol dire non rinnovare: non esiste un comando di spegnimento.
- **L'arresto per licenza nasce col freno**: per un primo periodo l'oggetto segnala soltanto.
- **I dati archiviati sono cifrati a busta.** La chiave dei dati è fissa sull'istanza ed è
  protetta due volte: dalla chiave ricavata dal segreto e dalla chiave pubblica di recupero.
- **La CA ha due livelli e gira su `step-ca`.** Le radici sono due, ciascuna dentro una
  YubiKey in cassaforte;
  l'intermedia sta in DA-Link, limitata ai nomi interni. La chiave privata del certificato
  nasce sull'oggetto e non lo lascia.

**Accesso a DA-Link**
- VM dedicata, raggiungibile solo dal gruppo NetBird `link-admin`.
- Poche persone nominate, con MFA.
- API per le macchine separate dall'interfaccia.
- Registro di audit copiato fuori da DA-Link.

**Custodia dei segreti**
- Il portachiavi di DA-Link si sblocca a mano a ogni avvio; più avanti con una YubiKey.
- Le chiavi di recupero dei dati e le radici della CA nascono e restano **dentro due
  YubiKey in cassaforte**, una radice e una chiave di recupero per ciascuna, e **non
  toccano mai DA-Link**. Niente macchina scollegata dedicata: quando servono si inseriscono
  in DA-Link o nel Mac di una persona di `link-admin`, con la procedura scritta.

**Resilienza della flotta** (Riccardo, 14/10: non compromettere la flotta dei servizi
rivenduti)
- Un rinnovo non accorcia mai la licenza in corso: una più restrittiva vale dalla fine di
  quella attuale. Nessuna risposta di DA-Link cambia la configurazione di un'istanza.
- Il firewall locale accetta solo i centrali, e la verifica dell'isolamento la fa anche
  DA-ZABBIX.
- Sulle YubiKey c'è anche una **chiave di emergenza**, più forte della firma di DA-Link.
  Firma bollettini che ritirano la fiducia a un DA-Link compromesso, fanno lavorare la
  flotta in modalità autonoma fino a una data e presentano il DA-Link nuovo.
- I bollettini arrivano da un canale di riserva o si incollano a mano. La flotta si
  riconfigura senza reinstallarla: ogni oggetto rientra con la chiave privata del proprio
  certificato, che non è mai stata su DA-Link.

Il motivo: la licenza si applica senza aprire porte verso i clienti e senza un comando di
spegnimento che qualcuno potrebbe abusare. Un oggetto fuori regola si ferma da solo. I dati
del cliente non diventano ostaggio della licenza. Un attacco a DA-Link non dà né i dati dei
clienti né una radice con cui impersonare siti veri.

## Alternative scartate

- **Dati cifrati direttamente con la chiave della licenza**: a scadenza, o col segreto perso,
  il cliente perde i suoi dati.
- **Busta senza copia di recupero**: un segreto perso vuol dire dati persi.
- **Spegnimento totale a licenza scaduta**: blocca l'accesso del cliente ai suoi dati.
- **Un comando di spegnimento dal centro**: serve una porta verso l'oggetto (contro
  l'ADR 0011), ed è un'arma per chi entra in DA-Link.
- **Un segreto unico usato per tre scopi**: una chiave esposta per uno scopo aprirebbe gli
  altri due.
- **Validità 2+1 settimane**: un guasto di una settimana fermerebbe un cliente in regola.
- **Validità 12+4 settimane**: una chiave rubata resterebbe buona quattro mesi.
- **Modulo hardware subito**: rimandato. Si parte con lo sblocco a mano, e la YubiKey si
  valuta dopo.
- **TPM virtuale**: chi è root sulla VM accesa userebbe le chiavi.
- **CA a un livello in DA-Link**: compromessa quella, si rifà la fiducia in tutti i computer.
- **CA scritta a mano**: si usa un componente esistente e collaudato.
- **Una macchina scollegata dedicata alla CA** (Riccardo, 14/10: da evitare): le YubiKey
  tengono le chiavi fuori dai computer senza una macchina in più.
- **Radice in un file cifrato in cassaforte**: per firmare passerebbe da una macchina accesa.
- **Reinstallare ogni oggetto dopo una compromissione di DA-Link**: settimane di lavoro e
  clienti fermi.
- **Un DA-Link di riserva sempre acceso**: un secondo bersaglio con le stesse chiavi.
- **Quattro occhi sulle azioni gravi**: non ora. Pochi nomi e MFA bastano; tutto resta nel
  registro.

## Conseguenze

- DA-Link custodisce le chiavi più delicate del parco: la firma delle licenze, l'intermedia
  della CA, il token NetBird e i segreti degli oggetti.
- Dopo ogni riavvio DA-Link resta fermo finché qualcuno non lo sblocca. Gli oggetti reggono
  sei settimane, e DA-ZABBIX lo deve segnalare subito.
- Serve una **cerimonia delle chiavi** iniziale (due YubiKey: radici e recupero) con
  procedura scritta,
  provata una volta all'anno.
- La radice della CA va in tutti gli applicativi e nei computer dei tecnici. Finché non c'è,
  quell'applicativo non si collega: la verifica del certificato non si spegne.

**Cosa diventa difficile in futuro:**

- La chiave di emergenza è la più potente di tutte: prolunga licenze e indica il DA-Link a
  tutta la flotta. Sta solo nelle YubiKey, e ogni bollettino resta nel registro con quale
  YubiKey l'ha firmato.
- Il canale di riserva va tenuto vivo anche quando non serve. Un canale mai usato è un
  canale che il giorno dell'emergenza non funziona: per questo c'è la prova annuale.

- Perdere insieme la frase di sblocco e la sua copia in cassaforte ferma tutti i clienti
  entro sei settimane. Perdere entrambe le YubiKey costringe a rifare la fiducia in ogni
  applicativo e
  computer.
- Recuperare i dati di un'istanza senza segreto richiede la procedura scritta, con una
  persona fisicamente alla cassaforte: non è un'operazione da fare di notte da remoto.
- Ogni applicativo nuovo dell'ecosistema deve nascere con la radice nel suo archivio di
  fiducia.
- Cambiare la durata del segreto o della tolleranza tocca tutti gli oggetti al rinnovo
  successivo. Va annunciato, non improvvisato.
- La protezione dei dati archiviati non vale contro chi è root sull'istanza accesa. Per
  quello serve il TPM, che è una decisione futura.
