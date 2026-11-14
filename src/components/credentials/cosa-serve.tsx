"use client";

/**
 * Cosa serve a DA-IPAM per WinRM, WMI, Active Directory e l'analisi degli eventi, in una pagina sola
 * (Riccardo, 04/11/2026: stava dentro due finestre di guida). Si apre dalla pagina Active Directory.
 * Niente dati del cliente: le voci vengono da `credentials/diritti.ts`, la configurazione da `GuidaAuditDc`.
 */

import Link from "next/link";
import { ArrowLeft, BookOpen, ClipboardCopy, Download } from "lucide-react";
import { toast } from "sonner";
import { Etichetta, IntestazionePagina, Pannello } from "@/components/shared/console";
import { GuidaAuditDc } from "@/components/shared/guida-audit-dc";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COMANDO_LEGGI_FALLIMENTI,
  COMANDO_VERIFICA_AUDIT,
  dirittiDi,
  FAMIGLIE_DIRITTI,
  REGOLE_DIRITTI,
  type FamigliaDiritti,
} from "@/lib/credentials/diritti";
import { copiaTesto } from "./diritti-account";

const COMANDO_PREPARA_DOMINIO = `# Sul DC, PowerShell come amministratore, utente Domain Admins. Prima la prova:
.\\Prepara-Dominio-DA-IPAM.ps1 -OuComputer "OU=Computer,DC=ditta,DC=local" -AllowFromIP <IP dell'appliance>
# Poi, con gli stessi parametri, si applica:
.\\Prepara-Dominio-DA-IPAM.ps1 -OuComputer "OU=Computer,DC=ditta,DC=local" -AllowFromIP <IP dell'appliance> -Applica`;

async function copia(testo: string) {
  if (await copiaTesto(testo)) toast.success("Copiato");
  else toast.error("Copia non riuscita: seleziona il testo a mano");
}

function Comando({ testo }: { testo: string }) {
  return (
    <div className="space-y-1.5">
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[13px] leading-snug whitespace-pre-wrap">{testo}</pre>
      <Button variant="outline" size="sm" onClick={() => void copia(testo)}>
        <ClipboardCopy className="h-4 w-4 mr-1.5" />
        Copia
      </Button>
    </div>
  );
}

function PannelloFamiglia({ famiglia }: { famiglia: FamigliaDiritti }) {
  const f = FAMIGLIE_DIRITTI[famiglia];
  const diritti = dirittiDi(famiglia);
  return (
    <Pannello titolo={`${f.nome} · ${f.accountEsempio}`} conteggio={diritti.length} sottotitolo={f.descrizione} corpoClassName="p-0">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[20%] text-[13px]">Cosa ottieni</TableHead>
            <TableHead className="w-[24%] text-[13px]">Cosa abilitare</TableHead>
            <TableHead className="w-[10%] text-[13px]">Dove</TableHead>
            <TableHead className="w-[46%] text-[13px]">Comando per l&apos;IT</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {diritti.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="align-top font-medium whitespace-normal">
                {d.funzione}
                {d.obbligatorio && <div className="mt-1"><Etichetta mono={false}>necessario</Etichetta></div>}
              </TableCell>
              <TableCell className="align-top whitespace-normal">{d.abilitare}</TableCell>
              <TableCell className="align-top whitespace-normal">{d.dove}</TableCell>
              <TableCell className="align-top whitespace-normal">{d.comandoIt ? <Comando testo={d.comandoIt} /> : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Pannello>
  );
}

export function CosaServe() {
  return (
    <div className="space-y-6 p-6">
      <IntestazionePagina
        titolo="Cosa serve per le analisi"
        sottotitolo="Diritti degli account per WinRM, WMI e Active Directory, script e configurazione per l'analisi degli eventi."
        azioni={
          <Button variant="outline" render={<Link href="/active-directory" />} nativeButton={false}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Active Directory
          </Button>
        }
      />

      {/* 08/11/2026 (Riccardo): uno script che costruisce tutto, col documento di cosa fa e dei passi a mano. */}
      <Pannello
        titolo="Preparare il dominio in un colpo solo"
        sottotitolo="Due account, gruppi, audit dei DC e la GPO che apre WMI e WinRM sui PC e server. Su un DC, PowerShell come amministratore, utente Domain Admins."
        corpoClassName="p-4 space-y-4"
      >
        <div className="flex flex-wrap gap-2">
          <Button render={<a href="/api/ad-setup/script-dominio" download />} nativeButton={false}>
            <Download className="h-4 w-4 mr-2" />
            Prepara-Dominio-DA-IPAM.ps1
          </Button>
          <Button variant="outline" render={<a href="/api/ad-setup/script-audit" download />} nativeButton={false}>
            <Download className="h-4 w-4 mr-2" />
            Configura-Audit-DC.ps1
          </Button>
          <Button variant="outline" render={<Link href="/manual?doc=prepara-dominio" />} nativeButton={false}>
            <BookOpen className="h-4 w-4 mr-2" />
            Cosa fa e passi a mano
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          I due script nella stessa cartella. Senza <code>-Applica</code> lo script dice cosa farebbe e non cambia niente;
          le OU sono quelle dei PC e dei server, mai Domain Controllers.
        </p>
        <Comando testo={COMANDO_PREPARA_DOMINIO} />
      </Pannello>

      <Pannello titolo="Regole" conteggio={REGOLE_DIRITTI.length + 1} corpoClassName="p-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {REGOLE_DIRITTI.map((r) => <li key={r}>{r}</li>)}
          <li>Per l&apos;inventario basta una strada fra WMI e WinRM: DA-IPAM le prova da sola, host per host.</li>
        </ul>
      </Pannello>

      <PannelloFamiglia famiglia="utente_scansioni" />
      <PannelloFamiglia famiglia="sicurezza_dominio" />

      <Pannello
        titolo="Leggere i fallimenti e controllare l'audit"
        conteggio={2}
        sottotitolo="Comandi di sola lettura da dare all'IT del cliente, da lanciare su un DC."
        corpoClassName="p-4"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Accessi falliti e account bloccati, ultime 24 ore</p>
            <Comando testo={COMANDO_LEGGI_FALLIMENTI} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Voci di audit accese e dimensione del registro</p>
            <Comando testo={COMANDO_VERIFICA_AUDIT} />
          </div>
        </div>
      </Pannello>

      <Pannello titolo="Configurazione per l'analisi degli eventi" corpoClassName="p-4">
        <GuidaAuditDc />
      </Pannello>
    </div>
  );
}
