"use client";

/**
 * Il riquadro «Assegnatario proposto» della scheda asset e la tabella di chi si collega al PC (piano
 * 2026-10-23-assegnatari-da-ad, tavola ⑫-⑱). Legge da `/api/inventory/[id]/assegnatario-proposto`; scrive solo coi
 * pulsanti («Accetta», «Assegna a …», «PC condiviso»), poi avvisa la scheda perché aggiorni il menu dell'assegnatario.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/fetch-json";
import type { PropostaAsset, RigaAccessoAsset } from "@/lib/assegnatari/asset";
import type { MotivoFuori } from "@/lib/assegnatari/proposta";
import { BadgeFonte, BadgeSegno, giornoBreve, quando } from "./segni";

const MOTIVO: Record<MotivoFuori, string> = {
  amministrativo: "amministrativo",
  servizio: "di servizio",
  non_in_ad: "non è in AD",
  disattivato: "disattivato in AD",
  senza_nome: "senza nome e cognome",
};

function Fonti({ f }: { f: RigaAccessoAsset["perFonte"] }) {
  const voci: Array<[string, number]> = [["Wazuh", f.wazuh_tastiera], ["Wazuh rete", f.wazuh_rete], ["WinRM", f.winrm], ["GLPI", f.glpi]];
  return <>{voci.filter(([, n]) => n > 0).map(([nome, n]) => <BadgeFonte key={nome}>{nome} {n}</BadgeFonte>)}</>;
}

function tipo(r: RigaAccessoAsset): string {
  if (r.tastiera > 0 && r.rete > 0) return "alla tastiera e di rete";
  return r.tastiera > 0 ? "alla tastiera" : "di rete";
}

const riquadro = "rounded-lg border px-4 py-3 text-sm";

export function PropostaAssegnatario({
  assetId,
  onAssegnato,
  onScegliAltro,
}: {
  assetId: number;
  /** Dopo «Accetta»: l'id dell'assegnatario ora sull'asset. */
  onAssegnato: (assegnatarioId: number) => void;
  /** «Scegli un altro»: la scheda porta l'attenzione sul menu. */
  onScegliAltro?: () => void;
}) {
  const [giorni, setGiorni] = useState<number | null>(null);
  const [p, setP] = useState<PropostaAsset | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<PropostaAsset>(`/api/inventory/${assetId}/assegnatario-proposto${giorni ? `?giorni=${giorni}` : ""}`, { cache: "no-store" });
    if (r.ok) {
      setP(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, [assetId, giorni]);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function scrivi(corpo: Record<string, unknown>, ok: string) {
    setOccupato(true);
    const r = await fetchJson<{ assegnatarioId?: number }>(`/api/inventory/${assetId}/assegnatario-proposto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    setOccupato(false);
    if (!r.ok) {
      toast.error(`Errore: ${r.message}`);
      void carica();
      return;
    }
    toast.success(ok);
    if (typeof r.data.assegnatarioId === "number") onAssegnato(r.data.assegnatarioId);
    void carica();
  }

  if (errore && !p) return <p className="text-sm text-destructive">Proposta non disponibile: {errore}</p>;
  if (!p) return <p className="text-sm text-muted-foreground">Calcolo della proposta…</p>;

  const pr = p.prevalente;
  const accetta = (nome: string) => scrivi({ azione: "accetta", account: pr!.account }, `Assegnato a ${nome}`);
  const altroCheSiCollega = p.assegnato && pr && p.esito === "proposta" && pr.assegnatarioId !== p.assegnato.id;

  return (
    <div className="space-y-4">
      {p.assegnato?.adDisattivatoIl && (
        <div className={`${riquadro} border-2 border-[#8A6D00] bg-[#FFF6C2] text-[#0D2537]`}>
          <BadgeSegno tipo="attenzione">Assegnatario uscito</BadgeSegno>{" "}
          <strong className="font-semibold">{p.assegnato.nome}</strong> è disattivato in AD dal {giornoBreve(p.assegnato.adDisattivatoIl)}. Il PC va riassegnato.
        </div>
      )}

      {!p.assegnato && p.esito === "proposta" && pr && (
        <div className="space-y-2 rounded-lg border-2 border-[#006C96] bg-[#E6F6FD] px-4 py-3 text-[#0D2537] dark:bg-[#10314A] dark:text-[#E6EEF4]">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-[#006C96] dark:text-[#3FBBF0]">Assegnatario proposto</div>
          <div className="text-lg font-semibold">
            {pr.nome}{" "}
            <span className="text-sm font-normal text-muted-foreground">· {[pr.reparto, pr.ruolo, pr.account].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="text-sm">
            Ha fatto <strong className="font-semibold">{pr.accessi} accessi su {pr.totale}</strong> {p.base === "rete" ? "di rete" : "alla tastiera"} a questo PC negli
            ultimi {p.giorni} giorni, l&apos;ultimo {quando(pr.ultimo)}.
          </div>
          <div className="text-[13px] text-muted-foreground">Fonti: <Fonti f={pr.perFonte} /></div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="min-h-11 text-[#0D2537]" disabled={occupato} onClick={() => void accetta(pr.nome)}>Accetta</Button>
            <Button variant="outline" className="min-h-11" disabled={occupato} onClick={() => onScegliAltro?.()}>Scegli un altro</Button>
            <Button variant="outline" className="min-h-11" disabled={occupato} onClick={() => void scrivi({ azione: "condiviso", condiviso: true }, "Segnato come PC condiviso: niente proposte")}>
              PC condiviso, non proporre
            </Button>
          </div>
        </div>
      )}

      {altroCheSiCollega && (
        <div className={`${riquadro} border-[#5B6B77] bg-[#F3F5F6] text-[#0D2537] dark:bg-[#22313D] dark:text-[#E6EEF4]`}>
          ● Negli ultimi {p.giorni} giorni si collega soprattutto <strong className="font-semibold">{pr!.nome}</strong> ({pr!.accessi} su {pr!.totale}). L&apos;assegnazione resta com&apos;è.
          <div className="mt-1">
            <Button variant="link" className="h-auto p-0 font-semibold text-[#006C96]" disabled={occupato} onClick={() => void accetta(pr!.nome)}>Assegna a {pr!.nome}</Button>
          </div>
        </div>
      )}

      {!p.assegnato && p.esito === "condiviso" && (
        <div className={`${riquadro} bg-card`}>
          <strong className="font-semibold">PC condiviso:</strong> {p.righe.filter((r) => r.nelCalcolo).length} utenti diversi, nessuno sopra il {p.soglia}% degli accessi:
          nessuna proposta. Si assegna a mano o al responsabile del reparto.
        </div>
      )}
      {!p.assegnato && p.esito === "pochi_dati" && (
        <div className={`${riquadro} bg-card text-muted-foreground`}>
          Pochi dati: meno di {p.minimo} accessi di persone negli ultimi {p.giorni} giorni. Nessuna proposta per ora.
        </div>
      )}
      {!p.assegnato && p.esito === "nessuna_fonte" && (
        <div className={`${riquadro} bg-card text-muted-foreground`}>
          Non sappiamo chi lo usa: nessun accesso da Wazuh, WinRM o dall&apos;agente{p.hostId === null ? " (l'asset non è collegato a un host della scoperta)" : ""}.{" "}
          {p.hostId !== null && <Link href={`/hosts/${p.hostId}`} className="font-semibold text-[#006C96] underline">Configura WinRM sull&apos;host</Link>}
        </div>
      )}
      {p.esito === "esclusa" && p.perche === "segnato_condiviso" && (
        <div className={`${riquadro} bg-card text-muted-foreground`}>
          Segnato come PC condiviso: nessuna proposta.{" "}
          <Button variant="link" className="h-auto p-0 font-semibold text-[#006C96]" disabled={occupato} onClick={() => void scrivi({ azione: "condiviso", condiviso: false }, "Proposte riattivate")}>
            Riprendi le proposte
          </Button>
        </div>
      )}
      {p.esito === "esclusa" && p.perche === "categoria" && !p.assegnato && (
        <div className={`${riquadro} bg-card text-muted-foreground`}>{p.categoria}: server e apparati di rete non ricevono proposte.</div>
      )}

      {p.righe.length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-3 px-4 py-3">
            <h3 className="flex-1 text-[15px] font-semibold">Chi si è collegato a questo PC — ultimi {p.giorni} giorni</h3>
            <select aria-label="Periodo" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={p.giorni} onChange={(e) => setGiorni(Number(e.target.value))}>
              {[...new Set([p.giorni, 30, 90])].sort((x, y) => x - y).map((g) => <option key={g} value={g}>{g} giorni</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utente</TableHead>
                  <TableHead>Assegnatario</TableHead>
                  <TableHead className="text-right">Accessi</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Ultima volta</TableHead>
                  <TableHead>Fonti</TableHead>
                  <TableHead>Nel calcolo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.righe.map((r) => (
                  <TableRow key={r.account} className={r.nelCalcolo ? undefined : "text-muted-foreground"}>
                    <TableCell className={r.nelCalcolo ? "font-semibold" : undefined}>{r.account}</TableCell>
                    <TableCell>{r.assegnatario ?? r.persona ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.accessi}</TableCell>
                    <TableCell>{tipo(r)}</TableCell>
                    <TableCell>{quando(r.ultimo)}</TableCell>
                    <TableCell><Fonti f={r.perFonte} /></TableCell>
                    <TableCell>
                      {r.nelCalcolo ? <BadgeSegno tipo="ok">Sì</BadgeSegno> : <BadgeSegno tipo="neutro">No: {r.motivo ? MOTIVO[r.motivo] : "—"}</BadgeSegno>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
