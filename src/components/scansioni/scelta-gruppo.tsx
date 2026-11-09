"use client";

/**
 * Scelta per gruppo nel pannello «2. Famiglie» (09/11/2026, tavola oggetti 45-46 approvata). Greenbone, nuclei e moduli
 * diventano menu per l'amministratore; un valore scelto da una persona ha il bordo tratteggiato e la firma sotto. Una
 * scelta che alza il rischio si conferma con una nota (riquadro 46). Le regole stanno in `scelte-gruppo-regole.ts`,
 * le ricontrolla la rotta.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import type { RigaFamiglia } from "@/lib/vuln/proposta/quadro";
import { rischioDellaScelta, type ModuliScelta, type NucleiScelta, type ValoriScelta } from "@/lib/vuln/proposta/scelte-gruppo-regole";
import type { EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";
import { Stato } from "./stato-va";

const campo = "h-8 rounded-md border bg-background px-2 text-sm";
const scelto = "border-2 border-dashed border-foreground font-semibold";

const PROFILI: Array<[EdgeScanProfile, string]> = [["fast", "Veloce"], ["balanced", "Bilanciato"], ["deep", "Profondo"]];
const NUCLEI: Array<[NucleiScelta, string]> = [["nessuno", "Nessuno"], ["gestione", "Solo web di gestione"], ["quick", "Rapido"], ["standard", "Standard"]];
const MODULI: Array<[ModuliScelta, string]> = [["nessuno", "Nessuno"], ["base", "Giro minimo"], ["completi", "Giro completo"]];

export type CampoScelta = "profile" | "nuclei" | "moduli";

function firma(f: RigaFamiglia): string | null {
  const s = f.scelta;
  if (!s) return null;
  const quando = parseDbDate(s.il).toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" });
  return `${s.chi}, ${quando}${s.nota ? ` · «${s.nota}»` : ""}`;
}

/** Le tre celle Greenbone, Nuclei, Moduli di una famiglia che si può scegliere. */
export function CelleSceltaGruppo({ f, amministratore, occupato, onCambia }: {
  f: RigaFamiglia;
  amministratore: boolean;
  occupato: boolean;
  onCambia: (campo: CampoScelta, valore: string) => void;
}) {
  const v = f.valori;
  if (!v || !amministratore) {
    return (
      <>
        <td className="whitespace-nowrap px-3 py-1.5">{f.greenbone}{f.scesa ? " ▼" : ""}</td>
        <td className="whitespace-nowrap px-3 py-1.5">{f.nuclei}</td>
        <td className="whitespace-nowrap px-3 py-1.5">{f.moduli}</td>
      </>
    );
  }
  const chiarire = f.famiglia === "da_chiarire";
  const s = f.scelta;
  const sotto = firma(f);
  const menu = (c: CampoScelta, valore: string, voci: Array<[string, string]>, nome: string) => (
    <td className="px-3 py-1.5 align-top" onClick={(e) => e.stopPropagation()}>
      <select
        aria-label={`${nome} di ${f.nome}`}
        className={cn(campo, s && s[c] !== null && scelto)}
        disabled={occupato}
        value={valore}
        onChange={(e) => onCambia(c, e.target.value)}
      >
        {voci.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
      {c === "profile" && f.scesa && <span className="ml-1.5 text-[13px] text-muted-foreground" title="Un device ha una profondità più bassa: il gruppo scende">▼ {f.greenbone}</span>}
      {s && s[c] !== null && sotto && <span className="mt-0.5 block text-[13px] text-muted-foreground">{sotto}</span>}
    </td>
  );
  return (
    <>
      {menu("profile", v.profile, chiarire ? PROFILI.slice(0, 2) : PROFILI, "Greenbone")}
      {chiarire ? <td className="px-3 py-1.5 text-muted-foreground">Nessuno, fisso</td> : menu("nuclei", v.nuclei, NUCLEI, "Nuclei")}
      {chiarire ? <td className="px-3 py-1.5 text-muted-foreground">Nessuno, fisso</td> : menu("moduli", v.moduli, MODULI, "Moduli")}
    </>
  );
}

/** I valori da salvare dopo il cambio di un campo: quelli già scelti restano, gli altri seguono la tabella. */
export function valoriDopo(f: RigaFamiglia, campo: CampoScelta, valore: string): ValoriScelta {
  const s = f.scelta;
  const base: ValoriScelta = { profile: s?.profile ?? null, nuclei: s?.nuclei ?? null, moduli: s?.moduli ?? null };
  return { ...base, [campo]: valore } as ValoriScelta;
}

export function rischioDi(f: RigaFamiglia, v: ValoriScelta): string | null {
  return rischioDellaScelta(f.famiglia, v);
}

/** Riquadro 46: la scelta alza il rischio, si conferma con una nota che resta con la firma. */
export function RiquadroRischio({ nome, rischio, notaIniziale, occupato, onConferma, onChiudi }: {
  nome: string;
  rischio: string;
  notaIniziale: string;
  occupato: boolean;
  onConferma: (nota: string) => void;
  onChiudi: () => void;
}) {
  const [nota, setNota] = useState(notaIniziale);
  return (
    <Dialog open onOpenChange={(o) => !o && onChiudi()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scelta che alza il rischio: {nome}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-start gap-2.5 rounded-md border-2 border-foreground bg-[#FFF6CC] px-3 py-2.5 text-[#0D2537]">
            <Stato tono="avviso">▲ {nome}</Stato>
            <span>{rischio}</span>
          </div>
          <label className="flex flex-col gap-1">
            Perché (resta con la firma)
            <Input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder="Chi l'ha deciso e perché" />
          </label>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={onChiudi}>Annulla</Button>
            <Button disabled={occupato || nota.trim().length < 3} onClick={() => onConferma(nota.trim())}>Conferma la scelta</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
