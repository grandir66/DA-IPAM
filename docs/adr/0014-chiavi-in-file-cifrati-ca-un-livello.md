# ADR 0014 — Niente YubiKey per ora: chiavi in file cifrati, CA a un livello

**Stato:** Accepted (Riccardo, 2026-10-14 sera)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Supera in parte:** [ADR 0013](0013-licenza-e-segreto-degli-oggetti.md): la custodia nelle due YubiKey e la CA a due livelli
**Documento di progetto:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md), decisione 28, §8.4, §9.3, §9.4, §9.5

## Contesto

L'ADR 0013 metteva tre chiavi dentro due YubiKey in cassaforte: le radici della CA, le chiavi
di recupero dei dati e la chiave di emergenza. Sopra le radici c'era un'intermedia in
DA-Link. Il 14/10 sera Riccardo ha deciso di non installare YubiKey per ora, accettando un
sistema «anche meno sicuro».

## Decisione

**Le chiavi che non devono vivere in DA-Link stanno in file cifrati con `age` e una frase
lunga, in due copie; la CA ha un livello solo, con la chiave nel portachiavi di DA-Link.**

- **File cifrati.** Uno per la chiave di recupero, uno per la chiave di emergenza, uno per la
  copia della chiave della CA.
- **Due copie.** Una nel vault delle credenziali, una su chiavetta USB in cassaforte.
- **La frase** la conoscono due persone; una copia scritta sta in busta in cassaforte, mai
  sulla chiavetta.
- **Uso.** Le chiavi si decifrano solo in memoria, sul Mac di una persona di `link-admin`,
  con la procedura scritta.
- **La CA a un livello** firma direttamente i certificati degli oggetti e porta i limiti sui
  nomi interni.

Il motivo: niente hardware da comprare e gestire adesso, con una strada aperta per tornare
alle YubiKey senza toccare gli oggetti.

## Alternative scartate

- **Due YubiKey in cassaforte** (ADR 0013): rimandate, non escluse.
- **Solo il vault**: se il Mac o il vault vengono compromessi si perde tutto, emergenza
  compresa, e non c'è copia.
- **Tutto dentro DA-Link**: la chiave di emergenza serve proprio quando DA-Link è
  compromesso; dentro DA-Link non protegge niente.
- **CA a due livelli con la radice nel file cifrato**: scartata da Riccardo per semplicità.

## Conseguenze

- Niente cerimonia con hardware. La «sessione delle chiavi» si fa nella tappa B, sul Mac di
  una persona di `link-admin`.
- La fase 0 non ha più il Task 6, e la tappa B non dipende più da un acquisto.

**Cosa diventa difficile in futuro:**

- **Compromissione di DA-Link = radice nuova.** Agli oggetti la porta il bollettino di
  emergenza. Ai centrali (da-vulcan, DA-ZABBIX, DA-CRM, DA-Link) e ai computer dei tecnici
  va ridistribuita a mano. Con due livelli sarebbe bastato rifare l'intermedia.
- **I file cifrati si possono attaccare senza limiti di tentativi.** Una YubiKey si blocca
  dopo pochi PIN sbagliati; un file no. Tutta la difesa sta nella lunghezza della frase e
  nel non fare copie fuori dai due posti.
- **Le chiavi passano in chiaro nella memoria di un Mac** quando si usano. Una YubiKey non le
  fa mai uscire.
- **I limiti sui nomi stanno sulla radice.** I client principali li rispettano, ma la norma
  non li impone: ogni applicativo si prova una volta con un certificato fuori dai limiti.
- **Tornare alle YubiKey** vuol dire due operazioni:
  - aggiungere una chiave di recupero nuova alle buste al rinnovo;
  - presentare una chiave di emergenza nuova con un bollettino firmato dalla vecchia.

  Per passare a due livelli bisogna distribuire una radice nuova: conviene farlo prima che
  la flotta cresca.
