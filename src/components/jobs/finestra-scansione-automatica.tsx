"use client";

/**
 * Finestra «Scansione automatica di N apparati» (tavola J2, piano 2026-10-22): scelti da Discovery gli host, mostra
 * per ognuno se entra nel giro (idoneità calcolata dal server, `valutaApparato`) e raccoglie frequenza, letture e nome.
 * Modo `crea`: l'anteprima è `POST /api/jobs/apparati-scelti/anteprima`, il piede crea il job. Modo `modifica`: stessa
 * finestra sul job che c'è (`GET/PUT /api/jobs/apparati-scelti/[id]`); gli apparati si possono solo togliere.
 * Il server ricontrolla tutto alla creazione: la finestra non decide chi entra.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle,
} from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { FUSO_UTENTI } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import { etichettaFrequenza, prossimaEsecuzione, MAX_APPARATI, type Frequenza, type Lettura } from "@/lib/apparati-scelti/regole";
import { PastigliaStato } from "./pastiglia-stato";

type Credenziale = "provata" | "non_provata" | "nessuna";
type LinkRiga = { testo: string; href?: string; azione?: string };

/** Una riga della finestra, qualunque sia il modo (anteprima o job esistente). */
interface Riga {
  chiave: string;
  host_id: number | null;
  device_id: number | null;
  nome: string | null;
  ip?: string | null;
  tipo_scheda?: string | null;
  credenziale: Credenziale;
  incluso: boolean;
  testo_motivo?: string;
  link?: LinkRiga;
  letture_valide: Lettura[];
  /** Due host dello stesso apparato: il secondo non conta. */
  doppione: boolean;
}

interface Interruttori { switch_vlan: boolean; mikrotik_scheda: boolean }
interface Cosa { info: boolean; porte_mac: boolean; vlan: boolean }

interface RispostaAnteprima {
  righe: Array<Omit<Riga, "chiave" | "doppione"> & { host_id: number; stesso_apparato_di?: number }>;
  inclusi: number;
  esclusi: number;
  interruttori: Interruttori;
}

interface RispostaJob {
  id: number;
  nome: string;
  attivo: boolean;
  frequenza: Frequenza | null;
  cosa: Cosa;
  apparati: Array<Omit<Riga, "chiave" | "doppione" | "ip" | "tipo_scheda"> & { device_id: number }>;
  interruttori: Interruttori;
}

export type ProprietaFinestraScansione = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dopo un job creato o modificato. */
  onFatto?: () => void;
} & (
  | {
      modo: "crea";
      hostIds: number[];
      /** Quanti host erano selezionati: con più di 50 la finestra lavora sui primi 50 e lo dice. */
      selezionati: number;
      /** «Rendi apparato ›» di una riga: chiude questa finestra e apre quella degli apparati. */
      onRendiApparato: () => void;
    }
  | { modo: "modifica"; jobId: number }
);

const TIPI: Record<string, string> = {
  switch: "Switch", router: "Router", hypervisor: "Hypervisor", firewall: "Firewall", server: "Server",
  storage: "Storage", ap: "Access point", access_point: "Access point",
};
const etichettaTipo = (t: string | null | undefined): string => (t ? (TIPI[t] ?? t) : "");

const LETTURE: Array<{ chiave: Lettura; titolo: string }> = [
  { chiave: "info", titolo: "Informazioni apparato" },
  { chiave: "porte_mac", titolo: "Porte e MAC" },
  { chiave: "vlan", titolo: "VLAN" },
];

const oraItaliana = (d: Date): string =>
  new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" }).format(d);

/** «A, B, C +2»: i primi nomi, il resto in numero. */
function elencoNomi(nomi: string[]): string {
  return nomi.length <= 3 ? nomi.join(", ") : `${nomi.slice(0, 3).join(", ")} +${nomi.length - 3}`;
}

const PASTIGLIA_CRED: Record<Credenziale, { tono: "ok" | "attenzione"; testo: string }> = {
  provata: { tono: "ok", testo: "credenziale provata" },
  non_provata: { tono: "attenzione", testo: "credenziale non provata" },
  nessuna: { tono: "attenzione", testo: "nessuna credenziale memorizzata" },
};

export function FinestraScansioneAutomatica(props: ProprietaFinestraScansione) {
  const { open, onOpenChange, onFatto } = props;
  const router = useRouter();
  const [righe, setRighe] = useState<Riga[]>([]);
  const [interruttori, setInterruttori] = useState<Interruttori>({ switch_vlan: true, mikrotik_scheda: true });
  const [caricamento, setCaricamento] = useState(true);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [frequenza, setFrequenza] = useState<"ora" | "4ore" | "giorno">("4ore");
  const [ora, setOra] = useState("02:00");
  const [cosa, setCosa] = useState<Cosa>({ info: true, porte_mac: true, vlan: true });
  const [nome, setNome] = useState("Apparati scelti");
  const [tolti, setTolti] = useState<Set<number>>(new Set());
  const [invio, setInvio] = useState(false);

  const idModifica = props.modo === "modifica" ? props.jobId : null;
  const hostIdsChiave = props.modo === "crea" ? props.hostIds.join(",") : "";

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErroreCaricamento(null);
    if (idModifica != null) {
      const r = await fetchJson<RispostaJob>(`/api/jobs/apparati-scelti/${idModifica}`);
      if (!r.ok) { setErroreCaricamento(r.message); setCaricamento(false); return; }
      const d = r.data;
      setRighe(d.apparati.map((a) => ({ ...a, chiave: `d${a.device_id}`, ip: null, tipo_scheda: null, doppione: false })));
      setInterruttori(d.interruttori);
      setNome(d.nome);
      setCosa(d.cosa);
      if (d.frequenza) {
        setFrequenza(d.frequenza.tipo);
        if (d.frequenza.tipo === "giorno") setOra(d.frequenza.ora);
      }
    } else {
      const ids = hostIdsChiave.split(",").filter(Boolean).map(Number);
      const r = await fetchJson<RispostaAnteprima>("/api/jobs/apparati-scelti/anteprima", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: ids }),
      });
      if (!r.ok) { setErroreCaricamento(r.message); setCaricamento(false); return; }
      setRighe(r.data.righe.map((x) => ({ ...x, chiave: `h${x.host_id}`, doppione: x.stesso_apparato_di != null })));
      setInterruttori(r.data.interruttori);
    }
    setCaricamento(false);
  }, [idModifica, hostIdsChiave]);

  useEffect(() => {
    if (open) void carica();
  }, [open, carica]);

  // Gli inclusi che restano: nel modo modifica si possono togliere, un doppione non conta.
  const attive = useMemo(
    () => righe.filter((r) => r.incluso && !r.doppione && !(r.device_id != null && tolti.has(r.device_id))),
    [righe, tolti],
  );
  const esclusi = righe.filter((r) => !r.incluso).length;

  /** Per ogni lettura, gli apparati a cui vale (e il cui interruttore è acceso). */
  const applicabili = useMemo(() => {
    const per = (l: Lettura): Riga[] => attive.filter((r) => r.letture_valide.includes(l));
    const vlanAcceso = (r: Riga): boolean => (r.tipo_scheda === "switch" ? interruttori.switch_vlan : interruttori.mikrotik_scheda);
    const vlanTutte = per("vlan");
    return {
      info: per("info"),
      porte_mac: per("porte_mac"),
      vlan: vlanTutte.filter(vlanAcceso),
      vlanSpenta: vlanTutte.length > 0 && vlanTutte.every((r) => !vlanAcceso(r)),
    };
  }, [attive, interruttori]);

  const cosaEffettiva: Cosa = {
    info: cosa.info && applicabili.info.length > 0,
    porte_mac: cosa.porte_mac && applicabili.porte_mac.length > 0,
    vlan: cosa.vlan && applicabili.vlan.length > 0,
  };
  const nessunaLettura = !cosaEffettiva.info && !cosaEffettiva.porte_mac && !cosaEffettiva.vlan;

  const f: Frequenza = frequenza === "giorno" ? { tipo: "giorno", ora } : { tipo: frequenza };
  const oraValida = /^([01]\d|2[0-3]):[0-5]\d$/.test(ora);
  const prossima = frequenza !== "giorno" || oraValida ? oraItaliana(prossimaEsecuzione(f, new Date())) : null;

  const nInclusi = attive.length;
  const puoSalvare = nInclusi > 0 && !nessunaLettura && (frequenza !== "giorno" || oraValida) && !invio;

  async function salva() {
    setInvio(true);
    const frequenzaCorpo = frequenza === "giorno" ? { tipo: "giorno", ora } : { tipo: frequenza };
    let r;
    if (props.modo === "crea") {
      r = await fetchJson<{ id: number; inclusi: number }>("/api/jobs/apparati-scelti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, host_ids: props.hostIds, frequenza: frequenzaCorpo, cosa: cosaEffettiva }),
      });
    } else {
      r = await fetchJson<{ ok: true }>(`/api/jobs/apparati-scelti/${props.jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          device_ids: attive.map((x) => x.device_id),
          frequenza: frequenzaCorpo,
          cosa: cosaEffettiva,
        }),
      });
    }
    setInvio(false);
    if (!r.ok) { toast.error(r.message); return; }
    if (props.modo === "crea") {
      const n = (r.data as { inclusi: number }).inclusi;
      toast.success(`Job creato: ${n} apparat${n === 1 ? "o" : "i"}, ${etichettaFrequenza(f)}`, {
        action: { label: "Apri i job", onClick: () => router.push("/settings?tab=jobs") },
      });
    } else {
      toast.success("Job aggiornato");
    }
    onOpenChange(false);
    onFatto?.();
  }

  const titolo = props.modo === "crea"
    ? `Scansione automatica di ${Math.min(props.hostIds.length, MAX_APPARATI)} apparati`
    : `Modifica la scansione automatica`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-border px-5 pt-5 pb-3">
          <DialogTitle className="text-lg">{titolo}</DialogTitle>
          <DialogDescription className="text-[13px]">
            Si leggono solo gli apparati con una credenziale memorizzata e provata.
            {props.modo === "crea" && props.selezionati > MAX_APPARATI && ` Ne propongo ${MAX_APPARATI} su ${props.selezionati}: gli altri restano selezionati per il giro dopo.`}
            {props.modo === "modifica" && " Qui si possono togliere apparati; per aggiungerne si crea un job nuovo da Discovery."}
          </DialogDescription>
        </DialogHeader>

        <DialogScrollableArea className="max-h-[70vh] space-y-5 px-5 py-4">
          {caricamento ? (
            <p className="py-10 text-center text-muted-foreground">Caricamento…</p>
          ) : erroreCaricamento ? (
            <LoadError what="gli apparati scelti" message={erroreCaricamento} onRetry={() => void carica()} />
          ) : (
            <>
              <ul className="divide-y rounded-md border" data-testid="scansione-righe">
                {righe.map((r) => {
                  const tolto = r.device_id != null && tolti.has(r.device_id);
                  const cred = r.device_id != null ? PASTIGLIA_CRED[r.credenziale] : null;
                  return (
                    <li key={r.chiave} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", (!r.incluso || tolto) && "bg-muted/60")}>
                      <div className={cn("min-w-0 flex-1 text-sm", tolto && "line-through opacity-60")}>
                        <span className="font-medium">{r.nome ?? r.ip ?? "apparato tolto"}</span>
                        {r.device_id != null && r.tipo_scheda ? <span className="text-muted-foreground"> · {etichettaTipo(r.tipo_scheda)}</span> : null}
                        {r.device_id == null && r.ip && r.nome ? <span className="text-muted-foreground"> · {r.ip}</span> : null}
                        {r.doppione ? <span className="text-muted-foreground"> · stesso apparato di un altro host scelto</span> : null}
                      </div>
                      {!r.incluso && r.link && (
                        r.link.azione === "rendi_apparato" && props.modo === "crea" ? (
                          <button type="button" className="text-[13px] font-medium text-primary underline-offset-2 hover:underline" onClick={props.onRendiApparato}>
                            {r.link.testo}
                          </button>
                        ) : r.link.href ? (
                          <a className="text-[13px] font-medium text-primary underline-offset-2 hover:underline" href={r.link.href} target="_blank" rel="noreferrer">
                            {r.link.testo}
                          </a>
                        ) : null
                      )}
                      {r.device_id == null ? (
                        <PastigliaStato tono="da_verificare">{r.testo_motivo ?? "non è un apparato"}</PastigliaStato>
                      ) : cred ? (
                        <PastigliaStato tono={cred.tono}>{cred.testo}</PastigliaStato>
                      ) : null}
                      {r.incluso && !r.doppione ? (
                        <PastigliaStato tono="ok">{tolto ? "tolto" : "incluso"}</PastigliaStato>
                      ) : r.incluso ? (
                        <PastigliaStato tono="da_verificare">già contato</PastigliaStato>
                      ) : (
                        <PastigliaStato tono="guasto" title={r.testo_motivo}>escluso</PastigliaStato>
                      )}
                      {/* La riga in più solo se la pastiglia della credenziale non spiega già il motivo (apparato disattivato, lettura non disponibile). */}
                      {!r.incluso && r.device_id != null && r.testo_motivo && r.credenziale === "provata" && (
                        <span className="basis-full text-[13px] text-muted-foreground">{r.testo_motivo}</span>
                      )}
                      {props.modo === "modifica" && r.device_id != null && (
                        <Button
                          type="button" size="sm" variant="ghost" className="h-7 text-[13px]"
                          onClick={() => setTolti((prec) => { const n = new Set(prec); if (n.has(r.device_id!)) n.delete(r.device_id!); else n.add(r.device_id!); return n; })}
                        >
                          {tolto ? "Rimetti" : "Togli"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">Frequenza</legend>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  {(["ora", "4ore"] as const).map((v) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="scansione-frequenza" className="h-4 w-4 accent-[#0D2537]" checked={frequenza === v} onChange={() => setFrequenza(v)} />
                      {v === "ora" ? "ogni ora" : "ogni 4 ore"}
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="scansione-frequenza" className="h-4 w-4 accent-[#0D2537]" checked={frequenza === "giorno"} onChange={() => setFrequenza("giorno")} />
                    ogni giorno alle
                    <Input type="time" value={ora} onChange={(e) => setOra(e.target.value)} onFocus={() => setFrequenza("giorno")} className="h-8 w-28 text-sm" aria-label="Ora del giro giornaliero" />
                  </label>
                  {prossima && <span className="text-[13px] text-muted-foreground">· prossima {prossima}</span>}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">Cosa legge</legend>
                <div className="space-y-1.5">
                  {LETTURE.map(({ chiave, titolo: t }) => {
                    const chi = applicabili[chiave];
                    const spenta = chiave === "vlan" && applicabili.vlanSpenta;
                    if (chi.length === 0 && !spenta) return null;
                    return (
                      <label key={chiave} className={cn("flex items-start gap-2 text-sm", spenta ? "opacity-70" : "cursor-pointer")}>
                        <Checkbox
                          className="mt-0.5" disabled={spenta}
                          checked={!spenta && cosa[chiave]}
                          onCheckedChange={(v) => setCosa((prec) => ({ ...prec, [chiave]: v === true }))}
                        />
                        <span>
                          <span className="font-medium">{t}</span>
                          <span className="text-muted-foreground">
                            {spenta
                              ? " · lettura VLAN spenta in Impostazioni"
                              : chi.length === nInclusi && nInclusi > 2
                                ? ` · tutti e ${nInclusi}`
                                : ` · ${elencoNomi(chi.map((x) => x.nome ?? "apparato"))}`}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[13px] text-muted-foreground">Si mostrano solo le letture che valgono per i tipi scelti.</p>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="scansione-nome" className="text-sm font-semibold">Nome del job</Label>
                <Input id="scansione-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} className="max-w-sm" />
              </div>
            </>
          )}
        </DialogScrollableArea>

        <DialogFooter className="items-center border-t border-border px-5 py-3 sm:justify-between">
          <span className="text-[13px] text-muted-foreground">
            {nInclusi} inclus{nInclusi === 1 ? "o" : "i"} · {esclusi} esclus{esclusi === 1 ? "o" : "i"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {!caricamento && !erroreCaricamento && nInclusi === 0 && (
              <span className="text-[13px] font-medium">▲ nessun apparato con credenziale provata</span>
            )}
            {!caricamento && !erroreCaricamento && nInclusi > 0 && nessunaLettura && (
              <span className="text-[13px] font-medium">▲ scegli almeno una lettura</span>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
            <Button onClick={() => void salva()} disabled={!puoSalvare || caricamento || !!erroreCaricamento}>
              {props.modo === "crea" ? `Crea job (${nInclusi} apparat${nInclusi === 1 ? "o" : "i"})` : "Salva"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
