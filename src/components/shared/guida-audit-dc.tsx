"use client";

/**
 * Come configurare l'audit dei domain controller perché la pagina «Sicurezza del dominio» veda
 * gli eventi (Riccardo, 29/10/2026: «ho le policy in inglese, va scritto nella pagina di config
 * del dominio»). Ogni voce in inglese e in italiano, come appare nell'editor delle GPO.
 *
 * Usata dalla guida del DC (pagina Active Directory) e dalla pagina «Sicurezza del dominio».
 * Il testo esteso sta in docs/MANUALE-EVENTI-DC.md: le due cose vanno tenute allineate.
 */

import { Download } from "lucide-react";
import { Etichetta } from "@/components/shared/console";

interface VoceAudit {
  categoriaEn: string;
  categoriaIt: string;
  voceEn: string;
  voceIt: string;
  /** «S» riuscita, «F» non riuscita. */
  esiti: Array<"S" | "F">;
  eventi: string;
  /** Aggiunta con l'arricchimento del 29/10: chi aveva già la GPO deve aggiungerla. */
  nuova?: boolean;
}

export const VOCI_AUDIT_DC: readonly VoceAudit[] = [
  { categoriaEn: "Account Logon", categoriaIt: "Accesso account", voceEn: "Audit Credential Validation", voceIt: "Controlla convalida credenziali", esiti: ["S", "F"], eventi: "4776" },
  { categoriaEn: "Account Logon", categoriaIt: "Accesso account", voceEn: "Audit Kerberos Authentication Service", voceIt: "Controlla servizio di autenticazione Kerberos", esiti: ["S", "F"], eventi: "4768, 4771" },
  { categoriaEn: "Account Logon", categoriaIt: "Accesso account", voceEn: "Audit Kerberos Service Ticket Operations", voceIt: "Controlla operazioni ticket del servizio Kerberos", esiti: ["S"], eventi: "4769 (Kerberoasting)", nuova: true },
  { categoriaEn: "Account Management", categoriaIt: "Gestione account", voceEn: "Audit User Account Management", voceIt: "Controlla gestione account utente", esiti: ["S", "F"], eventi: "4720-4726, 4738, 4740, 4767, 4794" },
  { categoriaEn: "Account Management", categoriaIt: "Gestione account", voceEn: "Audit Security Group Management", voceIt: "Controlla gestione gruppi di sicurezza", esiti: ["S"], eventi: "4728-4757" },
  { categoriaEn: "Account Management", categoriaIt: "Gestione account", voceEn: "Audit Computer Account Management", voceIt: "Controlla gestione account computer", esiti: ["S"], eventi: "4741, 4743", nuova: true },
  { categoriaEn: "Logon/Logoff", categoriaIt: "Accesso/fine sessione", voceEn: "Audit Logon", voceIt: "Controlla accesso", esiti: ["S", "F"], eventi: "4624, 4625" },
  { categoriaEn: "Logon/Logoff", categoriaIt: "Accesso/fine sessione", voceEn: "Audit Logoff", voceIt: "Controlla fine sessione", esiti: ["S"], eventi: "4634, 4647" },
  { categoriaEn: "Logon/Logoff", categoriaIt: "Accesso/fine sessione", voceEn: "Audit Account Lockout", voceIt: "Controlla blocco account", esiti: ["F"], eventi: "4625 (bloccato)" },
  { categoriaEn: "Policy Change", categoriaIt: "Modifica criteri", voceEn: "Audit Audit Policy Change", voceIt: "Controlla modifica criteri di controllo", esiti: ["S"], eventi: "modifiche all'audit" },
  { categoriaEn: "Policy Change", categoriaIt: "Modifica criteri", voceEn: "Audit Authorization Policy Change", voceIt: "Controlla modifica criteri di autorizzazione", esiti: ["S"], eventi: "4704, 4705" },
  { categoriaEn: "Policy Change", categoriaIt: "Modifica criteri", voceEn: "Audit Authentication Policy Change", voceIt: "Controlla modifica criteri di autenticazione", esiti: ["S"], eventi: "4706, 4707, 4739", nuova: true },
  { categoriaEn: "System", categoriaIt: "Sistema", voceEn: "Audit Security System Extension", voceIt: "Controlla estensione sistema di sicurezza", esiti: ["S"], eventi: "4697 (servizi)", nuova: true },
  { categoriaEn: "DS Access", categoriaIt: "Accesso DS", voceEn: "Audit Directory Service Access", voceIt: "Controlla accesso al servizio directory", esiti: ["S", "F"], eventi: "4662 (DCSync)" },
  { categoriaEn: "DS Access", categoriaIt: "Accesso DS", voceEn: "Audit Directory Service Changes", voceIt: "Controlla modifiche al servizio directory", esiti: ["S"], eventi: "5136, 5137, 5141 (GPO)" },
];

const ESITO = { S: "Success · Operazione riuscita", F: "Failure · Operazione non riuscita" } as const;

function Percorso({ en, it }: { en: string; it: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-2.5 text-[13px]">
      <div className="font-mono">{en}</div>
      <div className="mt-0.5 text-muted-foreground">{it}</div>
    </div>
  );
}

function Titolo({ n, testo }: { n: number; testo: string }) {
  return (
    <h3 className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">
      {n}. {testo}
    </h3>
  );
}

export function GuidaAuditDc() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Si modifica la <strong className="text-foreground">Default Domain Controllers Policy</strong> (o una GPO collegata
        all&apos;OU Domain Controllers) e poi si lancia <code className="font-mono">gpupdate /force</code> su ogni DC. Le voci
        con «nuova» servono agli eventi aggiunti il 29/10: DCSync, Kerberoasting, GPO, servizi, account computer, trust.
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/10 p-3">
        <div className="min-w-[220px] flex-1">
          <p className="font-semibold">Script che fa tutto (punti 1-5)</p>
          <p className="text-[13px] text-muted-foreground">
            Su un DC, PowerShell come Domain Admin: <code className="font-mono">.\Configura-Audit-DC.ps1 -Account svc-ipam</code>.
            Crea la GPO «DA-IPAM - Audit DC» sull&apos;OU Domain Controllers (la Default Domain Controllers Policy non si
            tocca), aggiunge il controllo per DCSync e mette l&apos;account nei gruppi. Con <code className="font-mono">-Prova</code>{" "}
            dice cosa farebbe senza cambiare niente.
          </p>
        </div>
        <a
          href="/api/ad-setup/script-audit"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[13px] font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Configura-Audit-DC.ps1
        </a>
      </div>

      <section className="space-y-2">
        <Titolo n={1} testo="Criteri di controllo avanzati" />
        <Percorso
          en="Computer Configuration › Policies › Windows Settings › Security Settings › Advanced Audit Policy Configuration › Audit Policies"
          it="Configurazione computer › Criteri › Impostazioni di Windows › Impostazioni sicurezza › Configurazione avanzata dei criteri di controllo › Criteri di controllo"
        />
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2 font-semibold">Voce (inglese)</th>
                <th className="p-2 font-semibold">Voce (italiano)</th>
                <th className="p-2 font-semibold">Impostare</th>
                <th className="p-2 font-semibold">Eventi</th>
              </tr>
            </thead>
            <tbody>
              {VOCI_AUDIT_DC.map((v) => (
                <tr key={v.voceEn} className="border-t align-top">
                  <td className="p-2">
                    <div className="text-muted-foreground">{v.categoriaEn}</div>
                    <div className="font-semibold">
                      {v.voceEn} {v.nuova && <Etichetta tono="ruolo">nuova</Etichetta>}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="text-muted-foreground">{v.categoriaIt}</div>
                    <div>{v.voceIt}</div>
                  </td>
                  <td className="p-2">
                    {v.esiti.map((e) => (
                      <div key={e}>{ESITO[e]}</div>
                    ))}
                  </td>
                  <td className="p-2 font-mono">{v.eventi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <Titolo n={2} testo="Perché le voci avanzate valgano" />
        <Percorso
          en="Security Settings › Local Policies › Security Options › «Audit: Force audit policy subcategory settings (Windows Vista or later) to override audit policy category settings» = Enabled"
          it="Impostazioni sicurezza › Criteri locali › Opzioni di sicurezza › «Controllo: imponi impostazioni di sottocategoria dei criteri di controllo…» = Abilitato"
        />
      </section>

      <section className="space-y-2">
        <Titolo n={3} testo="Dimensione del registro Sicurezza" />
        <Percorso
          en="Security Settings › Event Log › «Maximum security log size» = 1048576 KB (1 GB) or more · «Retention method for security log» = Overwrite events as needed"
          it="Impostazioni sicurezza › Registro eventi › «Dimensione massima registro di protezione» = 1048576 KB o più · «Metodo di mantenimento del registro di protezione» = Sovrascrivi eventi se necessario"
        />
        <p className="text-[13px] text-muted-foreground">
          Con centinaia di utenti 2–4 GB. La pagina dice «eventi persi» quando il registro gira prima della lettura.
        </p>
      </section>

      <section className="space-y-2">
        <Titolo n={4} testo="Controllo sulla radice del dominio (per vedere DCSync)" />
        <Percorso
          en="AD Users and Computers › View › Advanced Features › domain properties › Security › Advanced › Auditing › Add: Principal Everyone, Type Success, Applies to This object only, «Replicating Directory Changes» + «Replicating Directory Changes All»"
          it="Utenti e computer di AD › Visualizza › Funzionalità avanzate › proprietà del dominio › Sicurezza › Avanzate › Controllo › Aggiungi: Everyone, Operazione riuscita, Solo questo oggetto, «Replica modifiche directory» + «Replica tutte le modifiche directory»"
        />
        <p className="text-[13px] text-muted-foreground">
          Per le GPO il controllo c&apos;è già di serie. Servizi installati (7045) e Defender non chiedono niente alla GPO.
        </p>
      </section>

      <section className="space-y-2">
        <Titolo n={5} testo="Account per la lettura e verifica" />
        <p className="text-[13px] text-muted-foreground">
          L&apos;account WinRM dell&apos;integrazione AD sta in <strong className="text-foreground">Event Log Readers</strong> e{" "}
          <strong className="text-foreground">Remote Management Users</strong> (va bene anche un Domain Admin). Dopo{" "}
          <code className="font-mono">gpupdate /force</code>, su ogni DC: <code className="font-mono">auditpol /get /category:*</code>{" "}
          deve mostrare le voci sopra accese.
        </p>
      </section>
    </div>
  );
}
