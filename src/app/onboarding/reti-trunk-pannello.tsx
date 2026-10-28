"use client";

/**
 * Le reti viste sul trunk, nel passo «Subnet» del wizard (Riccardo, 28/10):
 * sotto la rete nativa, ogni rete che la sonda ha visto, con la casella per
 * aggiungerla e, se scelta, nome, rete e gateway da correggere. Le reti già
 * in DA-IPAM restano in elenco, segnate, senza casella.
 *
 * Solo disegno: lo stato e la creazione stanno nel wizard.
 */
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Etichetta, Pannello, Vuoto } from "@/components/shared/console";
import type { PropostaTrunk } from "@/lib/onboarding/reti-trunk";
import type { TrunkMaschera } from "@/lib/trunk/reti";

export interface RigaTrunk {
  aggiungi: boolean;
  nome: string;
  cidr: string;
  gateway: string;
}

export type StatoTrunk =
  | { fase: "caricamento" }
  | { fase: "errore"; messaggio: string }
  | { fase: "pronto"; attiva: boolean; aggiornato: string | null; nota: string | null };

const MASCHERA: Record<TrunkMaschera, string> = {
  dhcp: "maschera dal DHCP",
  dedotta: "maschera dedotta",
  incerta: "▲ maschera da verificare",
  config: "maschera corretta a mano",
};

function quando(iso: string | null): string {
  if (!iso) return "mai";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function RetiDalTrunk({
  stato,
  proposte,
  righe,
  errori,
  onCambia,
  onTutte,
  onRileggi,
  rileggendo,
  disabled,
}: {
  stato: StatoTrunk;
  proposte: PropostaTrunk[];
  righe: Record<string, RigaTrunk>;
  /** Errore per chiave, dalla validazione del wizard o dalla creazione. */
  errori: Record<string, string>;
  onCambia: (chiave: string, campi: Partial<RigaTrunk>) => void;
  onTutte: (aggiungi: boolean) => void;
  onRileggi: () => void;
  rileggendo: boolean;
  disabled: boolean;
}) {
  const nuove = proposte.filter((p) => !p.esistente);
  const scelte = nuove.filter((p) => righe[p.chiave]?.aggiungi).length;
  const rileggi = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onRileggi}
      disabled={disabled || rileggendo || stato.fase === "caricamento" || (stato.fase === "pronto" && !stato.attiva)}
      title={stato.fase === "pronto" && !stato.attiva ? "La sonda trunk non c'è su questa appliance" : "Legge subito la sonda"}
    >
      {rileggendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Rileggi il trunk
    </Button>
  );

  let corpo: React.ReactNode;
  if (stato.fase === "caricamento") {
    corpo = (
      <p className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lettura della sonda trunk…
      </p>
    );
  } else if (stato.fase === "errore") {
    corpo = <Vuoto titolo="Reti del trunk non lette" testo={stato.messaggio} />;
  } else if (!stato.attiva) {
    corpo = (
      <Vuoto
        titolo="Nessuna sonda trunk su questa appliance"
        testo="Si accende dal profilo in DA-Link (sonda trunk). Le altre reti si aggiungono poi dal menu Reti."
      />
    );
  } else if (proposte.length === 0) {
    corpo = (
      <Vuoto
        titolo="Nessun'altra rete vista finora"
        testo={`La sonda ascolta da poco: le reti che parlano poco compaiono dopo qualche minuto. Ultima lettura: ${quando(stato.aggiornato)}.${stato.nota ? ` ${stato.nota}.` : ""}`}
      />
    );
  } else {
    corpo = (
      <div className="space-y-2">
        {stato.nota ? <p className="text-[13px] text-muted-foreground">{stato.nota}</p> : null}
        {proposte.map((p) => {
          const r = righe[p.chiave];
          const errore = errori[p.chiave];
          const id = `trunk-${p.chiave.replace(/[^0-9a-z]/gi, "-")}`;
          return (
            <div
              key={p.chiave}
              className={`rounded-lg border p-3 ${r?.aggiungi ? "border-primary bg-selezione" : p.esistente ? "bg-muted/40" : "bg-card"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {p.esistente ? null : (
                  <Checkbox
                    id={id}
                    checked={!!r?.aggiungi}
                    onCheckedChange={(c) => onCambia(p.chiave, { aggiungi: !!c })}
                    disabled={disabled}
                    aria-label={`Aggiungi ${p.cidr}`}
                  />
                )}
                <Etichetta tono="marca">{p.vid === 0 ? "senza tag" : `VLAN ${p.vid}`}</Etichetta>
                <label htmlFor={p.esistente ? undefined : id} className="font-mono text-sm font-semibold">
                  {p.cidr}
                </label>
                {p.gateway && p.gatewayCerto ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[13px]">
                    <Etichetta tono="ruolo">GW</Etichetta>
                    {p.gateway}
                  </span>
                ) : p.gateway ? (
                  <span
                    className="whitespace-nowrap font-mono text-[13px] text-muted-foreground"
                    title="L'indirizzo più cercato in ARP: può non essere il router, e cambiare fra una lettura e l'altra"
                  >
                    gw? {p.gateway}
                  </span>
                ) : null}
                <span className="ml-auto whitespace-nowrap text-[13px] text-muted-foreground">
                  {p.dispositivi} {p.dispositivi === 1 ? "dispositivo" : "dispositivi"} · {MASCHERA[p.maschera]}
                </span>
              </div>
              {p.esistente ? (
                <p className="mt-1 text-[13px] text-muted-foreground">Già in DA-IPAM come «{p.esistente.name}».</p>
              ) : null}
              {p.doppione && !p.esistente ? (
                <p className="mt-1 text-[13px]">
                  <Etichetta tono="ruolo" mono={false}>▲ dubbia</Etichetta>{" "}
                  La stessa rete è sulla {p.doppione.vid === 0 ? "parte senza tag" : `VLAN ${p.doppione.vid}`} con {p.doppione.dispositivi} dispositivi: di
                  solito è un apparato con due indirizzi, non una rete in più.
                </p>
              ) : null}
              {r?.aggiungi ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-nome`} className="text-[13px]">Nome</Label>
                    <Input id={`${id}-nome`} value={r.nome} onChange={(e) => onCambia(p.chiave, { nome: e.target.value })} disabled={disabled} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-cidr`} className="text-[13px]">Rete</Label>
                    <Input id={`${id}-cidr`} className="font-mono" value={r.cidr} onChange={(e) => onCambia(p.chiave, { cidr: e.target.value })} disabled={disabled} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-gw`} className="text-[13px]">Gateway (opz.)</Label>
                    <Input id={`${id}-gw`} className="font-mono" value={r.gateway} onChange={(e) => onCambia(p.chiave, { gateway: e.target.value })} disabled={disabled} />
                  </div>
                </div>
              ) : null}
              {errore ? (
                <p role="alert" className="mt-2 rounded-md border border-destructive bg-destructive/10 px-2 py-1 text-[13px]">
                  ✕ {errore}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Pannello
      titolo="Reti viste sul trunk"
      conteggio={stato.fase === "pronto" && stato.attiva ? (scelte > 0 ? `${scelte} di ${nuove.length}` : nuove.length) : undefined}
      sottotitolo="Spunta quelle da aggiungere: nome, rete e gateway si correggono qui"
      azioni={
        <>
          {nuove.length > 1 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onTutte(scelte < nuove.length)} disabled={disabled}>
              {scelte < nuove.length ? "Scegli tutte" : "Togli tutte"}
            </Button>
          ) : null}
          {rileggi}
        </>
      }
      piede={
        nuove.length > 0
          ? "Prendono router, DNS e credenziali della rete qui sopra; gli host già visti sul trunk entrano da soli."
          : undefined
      }
    >
      {corpo}
    </Pannello>
  );
}
