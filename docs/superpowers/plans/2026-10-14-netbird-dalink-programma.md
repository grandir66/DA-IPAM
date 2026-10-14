# NetBird a stella e DA-Link — piano generale (programma delle tappe)

> **Per gli agenti:** questo è il piano **generale**: dice le tappe, l'ordine, le dipendenze,
> chi le esegue e dove ci si ferma per una conferma. Ogni tappa di codice ha il **suo** piano
> dettagliato (TDD, file per file), scritto all'inizio della tappa nella sessione che la
> esegue, con la skill superpowers:writing-plans, e salvato **nel repo che la tappa tocca**.
> Il piano dettagliato della fase 0 è già scritto:
> [`2026-10-14-netbird-fase0-preparazione.md`](2026-10-14-netbird-fase0-preparazione.md).

**Obiettivo:** portare gli oggetti dei clienti da Tailscale a NetBird in una rete a stella
governata da DA-Link, con licenza, CA interna e resilienza della flotta.

**Architettura:** DA-Link, un progetto nuovo in sede, fa entrare gli oggetti in NetBird da
solo. Emette e rinnova licenza, segreto e certificato. Riceve lo stato delle istanze e lo dà
al CRM. Le istanze DA-IPAM e gli edge cambiano rete, mandano lo stato e applicano licenza e
privacy.

**Spec:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../specs/2026-10-14-netbird-rete-a-stella-design.md),
ADR [0011](../../adr/0011-netbird-rete-a-stella.md) e [0013](../../adr/0013-licenza-e-segreto-degli-oggetti.md).

## Vincoli globali (valgono per ogni tappa)

- Livello di controllo **completo** (spec, intestazione). Il cancello completo precede ogni
  commit nelle zone rosse: licenza, chiavi, firewall, NetBird.
- Il cliente si identifica con **`codcli`** del gestionale (decisione 12). Gruppi
  `cli-<codcli>`, nodi `<codcli>-edge|-zbx|-ipam`.
- **Nessun segreto in chiaro**, né in git, né nei log, né a schermo dopo la prima consegna.
  I segreti si passano solo da stdin, mai come argomento (lezione del parco 13/10).
- **Verifica TLS sempre accesa** verso NetBird e fra i servizi. Il client NetBird di
  DA-Zabbix la spegne (`CERT_NONE`): non si copia così.
- **Ogni automatismo che ferma o scrive nasce col freno**: riallineamento delle policy
  (§6.1) e arresto per licenza (§8.2). Prima segnala soltanto, poi si accende contando.
- **Dal centro non si cambia mai la configurazione di un'istanza** (§5.3, §9.5), e un
  rinnovo non accorcia la licenza in corso (§8.2).
- **`dev` di DA-IPAM arriva a DTS ogni 15 minuti con build e riavvio.** Su `dev` solo codice
  pronto per la produzione. Le tappe di DA-IPAM lavorano in un ramo proprio e arrivano su
  `dev` a tappa finita e verde.
- Ogni scrittura su NetBird di produzione, su macchine dei clienti o sui centrali in
  esercizio **chiede conferma**. Le conferme di una fase si chiedono **tutte insieme**
  all'inizio della fase.

## Le tappe

| Tappa | Cosa | Repo | Dipende da | Conferme |
|---|---|---|---|---|
| **0** | Preparazione: censimento, prova di convivenza, `All` fuori dalle policy dei colleghi, centrali in NetBird, YubiKey ordinate | nessun codice | — | sì: NetBird, da-vulcan, VM di prova |
| **A** | DA-Link nucleo: progetto, client NetBird, oggetti per `codcli`, setup key, revoca, R1–R5, riallineamento col freno, interfaccia ristretta, segnale di vita, lettura per il CRM | **DA-Link** (nuovo) | 0 | sì: deploy della VM, utente di servizio NetBird |
| **C1** | DA-IPAM, rete e privacy: segnale di vita con i due livelli, pagina «Cosa esce», installatore con setup key, firewall su `wt0` | DA-IPAM | A (contratto del segnale) | no, fino al pilota |
| **D1** | Scanner-Edge, rete: heartbeat `overlay`, installatore NetBird, firewall per porta, SAN; hub D15 | DA-Vul-can | 0 | no, fino al pilota |
| **E** | DA-Zabbix: nomi `cli-<codcli>`, nessuna seconda chiave sulle appliance, verifica R1–R5 indipendente | DA-Zabbix | A (regole di nome) | no |
| **G1** | Deploy-Appliance: setup key e token DA-Link, livello di privacy al `/setup`, Wazuh mai in NetBird | Deploy-Appliance | C1 | no |
| **F** | DA-CRM: riquadro «quadro DA-Link» nella linguetta Tecnica (interfaccia proposta prima) | DA-CRM | A (lettura §7.3) | no |
| **2** | **Pilota DTS, rete** (doppio binario) | — | A, C1, D1, E | **sì, ogni passo** |
| **B** | DA-Link licenza e chiavi: portachiavi con sblocco, cerimonia YubiKey, `step-ca` a due radici, licenze firmate, segreti, rinnovo, bollettini di emergenza | DA-Link | A, YubiKey arrivate | sì: cerimonia |
| **C2** | DA-IPAM, licenza: rinnovo, licenza col freno, sola lettura a scadenza, busta dei dati, certificato della CA, bollettini, modalità autonoma | DA-IPAM | B | no, fino al pilota |
| **D2** | Scanner-Edge, licenza: rinnovo via P7, licenza col freno, certificato della CA, bollettini | DA-Vul-can | B | no, fino al pilota |
| **G2** | Deploy-Appliance e centrali: radici della CA, chiave di emergenza, chiave di recupero all'installazione | Deploy-Appliance + centrali | B | sì: deploy sui centrali |
| **2b** | **Pilota DTS, licenza** (col freno: solo segnalazioni) e **prova di compromissione** sulla VM di prova | — | C2, D2, G2 | **sì** |
| **3** | Gli altri clienti, uno per volta (lista dalla fase 0) | — | 2 (e 2b per la licenza) | **sì, per cliente** |
| **4** | Spegnimento di Tailscale e pulizia del codice | tutti | 3 | **sì** |

## Ordine e parallelo, per andare veloci

```
0 ──► A ──┬──► C1 ──► G1 ─┐
          ├──► D1 (può partire già dopo 0) ──┤
          ├──► E ──────────┼──► 2 (pilota rete DTS) ──► 3 (clienti, rete)
          └──► F           │
          A ──► B ──┬──► C2 ─┐
                    ├──► D2 ─┼──► 2b (pilota licenza) ──► licenza accesa contando
                    └──► G2 ─┘
                                                     3 + 2b ──► 4
```

- **La rete non aspetta la licenza.** Il passaggio a NetBird (A, C1, D1, E, G1, poi 2 e 3)
  procede da solo. La licenza (B, C2, D2, G2) arriva in parallelo e si accende col freno.
- **Dopo A, cinque tappe in parallelo** su repo diversi: C1, D1, E, F, B. Si eseguono con un
  agente a contesto pulito **per repo** (memoria del parco), **solo con l'ok di Riccardo**
  (REGOLA #2: niente agenti a raffica senza ok).
- **D1 può partire subito dopo la fase 0**: non dipende da DA-Link.

## Come parte ogni tappa

1. **Sessione nuova**, nel repo della tappa. Per A, prima `bin/nuovo-progetto DA-Link`
   sotto `~/Progetti/Domarc/`, poi la procedura di `AVVIO-PROGETTO.md`.
2. Si leggono questo piano, la spec (le sezioni indicate sotto) e il `CONTEXT.md` del repo.
3. Si scrive il **piano dettagliato della tappa** con superpowers:writing-plans, nel repo
   della tappa, e lo si fa approvare.
4. Si esegue. A tappa finita: CHANGELOG, CONTEXT, scheda nel censimento; una riga di stato
   qui sotto, in «Avanzamento».

| Tappa | Sezioni della spec da leggere |
|---|---|
| A | §1, §2, §4, §5 (tranne licenza), §6, §7, §9.1, §12 «DA-Link» |
| B | §8, §9 |
| C1 | §4.3 (R5), §5.2, §5.3, §12 «DA-IPAM» |
| C2 | §8, §9.5, §12 «DA-IPAM» |
| D1, D2 | §4.2, §8, §9.5, §12 «DA-Vul-can» |
| E | §4.2 (P4, P4b), §5.5, §6.1, §12 «DA-Zabbix» |
| F | §6.3, §7.3, §12 «DA-CRM» |
| G1, G2 | §5.1, §5.3, §8.4, §12 «Deploy-Appliance» |

## Avanzamento

- 2026-10-14: spec, ADR 0011 e 0013, questo piano e il piano della fase 0 scritti.
  Nessuna tappa iniziata.
