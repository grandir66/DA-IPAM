"use client";

import { useRef, useState } from "react";
import { ClipboardCopy, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Etichetta, Pannello } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dirittiDi, FAMIGLIE_DIRITTI, type FamigliaDiritti } from "@/lib/credentials/diritti";
import type { AspettoSegno } from "@/lib/credentials/motivi-accesso";
import { dirittiMancanti, testoConteggioMancanti, testoRichiestaIt } from "@/lib/credentials/richiesta-it";
import type { RigaControllo, RisultatoControllo, StatoDiritto } from "@/lib/credentials/controllo-account";
import { fetchJson } from "@/lib/fetch-json";
import { AccessoWindowsPerHost, formattaTentativo } from "./accesso-windows-per-host";
import { LegendaSegni, Segno } from "./segno-stato";

type Controllo = { fase: "da_fare" } | { fase: "in_corso" } | { fase: "errore"; messaggio: string } | ({ fase: "fatto" } & RisultatoControllo);

const ASPETTO_DEL_DIRITTO: Record<StatoDiritto, AspettoSegno> = {
  si: { segno: "si", forma: "spunta" },
  in_parte: { segno: "attenzione", forma: "meta" },
  no: { segno: "no", forma: "croce" },
  non_verificato: { segno: "non_provato", forma: "trattino" },
};
const PAROLA_DEL_DIRITTO: Record<StatoDiritto, string> = { si: "Sì", in_parte: "In parte", no: "No", non_verificato: "Non provato" };

/** Copia negli appunti; fuori da un contesto sicuro (http) `navigator.clipboard` non c'è e si ripiega su `execCommand`. */
export async function copiaTesto(testo: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(testo);
      return true;
    }
  } catch {
    /* si prova il ripiego */
  }
  const area = document.createElement("textarea");
  area.value = testo;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

function PannelloDiritti({ famiglia, righe }: { famiglia: FamigliaDiritti; righe: ReadonlyMap<string, RigaControllo> }) {
  const f = FAMIGLIE_DIRITTI[famiglia];
  const diritti = dirittiDi(famiglia);
  return (
    <Pannello titolo={f.nome} conteggio={diritti.length} sottotitolo={f.descrizione} corpoClassName="p-0">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[26%] text-[13px]">Cosa ottieni</TableHead>
            <TableHead className="w-[38%] text-[13px]">Cosa abilitare</TableHead>
            <TableHead className="w-[36%] text-[13px]">Stato</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {diritti.map((d) => {
            const r = righe.get(d.id);
            const stato: StatoDiritto = r?.stato ?? "non_verificato";
            return (
              <TableRow key={d.id}>
                <TableCell className="align-top font-medium whitespace-normal">{d.funzione}</TableCell>
                <TableCell className="align-top whitespace-normal">
                  <span>{d.abilitare}</span> <Etichetta mono={false}>{d.dove}</Etichetta>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <Segno {...ASPETTO_DEL_DIRITTO[stato]}>{PAROLA_DEL_DIRITTO[stato]}</Segno>
                  {r?.base && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{r.base}</p>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Pannello>
  );
}

/**
 * Cosa può fare un account Windows (piano accesso Windows, Task 8): testata con l'esito della password, i due pannelli dei
 * diritti (utente delle scansioni, sicurezza del dominio), la riga che dice quanti ne mancano e il testo per l'IT del
 * cliente, poi l'accesso per host. Si apre dalla voce di tipo Windows dell'elenco; il controllo parte solo al clic, perché
 * fa un bind sul DC con la password della voce. Della voce si mostra il nome, mai l'utente.
 */
export function DirittiAccount({ voce, onChiudi }: { voce: { id: number; name: string; etichetta: string }; onChiudi: () => void }) {
  const [controllo, setControllo] = useState<Controllo>({ fase: "da_fare" });
  const [testoManuale, setTestoManuale] = useState<string | null>(null);
  const inCorso = useRef(false);

  const controlla = async () => {
    if (inCorso.current) return;
    inCorso.current = true;
    setControllo({ fase: "in_corso" });
    setTestoManuale(null);
    try {
      const esito = await fetchJson<RisultatoControllo>(`/api/credentials/${voce.id}/controllo`, { method: "POST" });
      setControllo(esito.ok ? { fase: "fatto", ...esito.data } : { fase: "errore", messaggio: esito.message });
    } finally {
      inCorso.current = false;
    }
  };

  const righe: ReadonlyMap<string, RigaControllo> = new Map(controllo.fase === "fatto" ? controllo.righe.map((r) => [r.dirittoId, r]) : []);
  const mancanti = controllo.fase === "fatto" ? dirittiMancanti(controllo.righe) : [];

  const copia = async () => {
    const testo = testoRichiestaIt(mancanti);
    if (await copiaTesto(testo)) {
      toast.success("Richiesta per l'IT copiata");
      setTestoManuale(null);
    } else {
      toast.error("Copia non riuscita: seleziona il testo qui sotto e copialo a mano");
      setTestoManuale(testo);
    }
  };

  const password =
    controllo.fase !== "fatto"
      ? ({ segno: "non_provato", testo: "Password non controllata" } as const)
      : controllo.password === "valida"
        ? ({ segno: "si", testo: "Password valida" } as const)
        : controllo.password === "errata"
          ? ({ segno: "no", testo: "Password errata" } as const)
          : ({ segno: "non_provato", testo: "Non verificabile" } as const);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold">{voce.name}</h2>
          <Etichetta mono={false}>{voce.etichetta}</Etichetta>
          <Segno segno={password.segno}>{password.testo}</Segno>
          {controllo.fase === "fatto" && (
            <span className="font-mono text-[13px] text-muted-foreground">{formattaTentativo(controllo.controllatoIl)}</span>
          )}
          {controllo.fase === "da_fare" && <span className="text-[13px] text-muted-foreground">Controlla l&apos;account per vedere cosa può fare.</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void controlla()} disabled={controllo.fase === "in_corso"} title="Legge i gruppi dal controller di dominio e gli esiti delle scansioni: sui PC non prova niente">
            <ShieldCheck className="h-4 w-4 mr-2" />
            {controllo.fase === "in_corso" ? "Controllo in corso…" : "Controlla account"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onChiudi} title="Chiudi" aria-label="Chiudi">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {controllo.fase === "errore" && <LoadError what="il controllo dell'account" message={controllo.messaggio} onRetry={() => void controlla()} />}

      <PannelloDiritti famiglia="utente_scansioni" righe={righe} />
      <PannelloDiritti famiglia="sicurezza_dominio" righe={righe} />
      <LegendaSegni />

      {controllo.fase === "fatto" && (
        <div className="space-y-2 rounded-xl border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {mancanti.length > 0 ? (
              <>
                <p className="text-sm font-semibold">{testoConteggioMancanti(mancanti)}</p>
                <Button onClick={() => void copia()}>
                  <ClipboardCopy className="h-4 w-4 mr-2" />
                  Copia richiesta per l&apos;IT
                </Button>
              </>
            ) : (
              <p className="text-sm font-semibold">Nessun diritto risulta mancante tra quelli verificati.</p>
            )}
          </div>
          {testoManuale && (
            <textarea
              readOnly
              value={testoManuale}
              rows={10}
              className="w-full rounded-lg border bg-muted/40 p-2 font-mono text-[13px]"
              aria-label="Testo della richiesta per l'IT"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </div>
      )}

      <AccessoWindowsPerHost voceId={voce.id} senzaLegenda />
    </div>
  );
}
