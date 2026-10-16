"use client";

/**
 * «Collega a…» (spec §11.3): porta di partenza e di arrivo scelte fra le porte
 * note (porte dello switch, schede dell'hypervisor: GET /api/topology/ports),
 * scritte a mano o «non nota»; tipo cavo/fibra/wireless; nota. Salva con
 * POST /api/topology/links, o con PATCH sulla correzione esistente
 * («Modifica porte»). Se le porte non si caricano lo dice (con «Riprova») e
 * lascia scrivere a mano: un errore non diventa «nessuna porta».
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PORT_MANUAL,
  buildLinkPatch,
  buildManualLink,
  initialPort,
  mediaDelDialogo,
  portChoices,
  type KnownPort,
  type LinkPatchBody,
  type ManualLinkBody,
  type PortPick,
} from "@/lib/topology/connect-form";
import type { LinkMedium } from "@/lib/topology/model-types";
import { fetchPorts, type LinkOverrideView } from "./api";

export interface ConnectRequest {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** Modifica di un collegamento a mano esistente: `a` e `b` sono i suoi a_node e b_node (per id canonico), nello stesso ordine. */
  edit: LinkOverrideView | null;
}

interface Props {
  request: ConnectRequest | null;
  onClose: () => void;
  /** Le scritture rispondono true se sono andate: solo allora il dialogo si chiude. */
  onCreate: (body: ManualLinkBody) => Promise<boolean>;
  onPatch: (id: number, body: LinkPatchBody) => Promise<boolean>;
  /** La mappa nuova è accesa (T3): fra i tipi c'è anche «tunnel». Spenta, il dialogo è quello di prima. */
  mappaNuova?: boolean;
}

const MEDIUM_NONE = "__non_indicato__";

export function ConnectDialog({ request, onClose, onCreate, onPatch, mappaNuova = false }: Props) {
  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        {/* Il modulo si rimonta a ogni apertura: porte e scelte ripartono da capo. */}
        {request && <ConnectForm request={request} onClose={onClose} onCreate={onCreate} onPatch={onPatch} mappaNuova={mappaNuova} />}
      </DialogContent>
    </Dialog>
  );
}

type PortsState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; ports: KnownPort[] };

function usePorts(nodeId: string): { state: PortsState; retry: () => void } {
  const [state, setState] = useState<PortsState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchPorts(nodeId, ctrl.signal)
      .then((r) => setState(r.ok ? { kind: "ok", ports: r.data.ports } : { kind: "error", message: r.message }))
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "AbortError")) setState({ kind: "error", message: "Server non raggiungibile" });
      });
    return () => ctrl.abort();
  }, [nodeId, round]);
  const retry = useCallback(() => setRound((x) => x + 1), []);
  return { state, retry };
}

function ConnectForm({ request, onClose, onCreate, onPatch, mappaNuova = false }: Props & { request: ConnectRequest }) {
  const { a, b, aName, bName, edit } = request;
  const MEDIA = mediaDelDialogo(mappaNuova);
  const aPorts = usePorts(a);
  const bPorts = usePorts(b);
  const [aPick, setAPick] = useState<PortPick | null>(null);
  const [bPick, setBPick] = useState<PortPick | null>(null);
  const [medium, setMedium] = useState<string>(edit?.medium && MEDIA.some((m) => m.value === edit.medium) ? edit.medium : MEDIUM_NONE);
  const [note, setNote] = useState(edit?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedA = edit?.a_port ?? "";
  const savedB = edit?.b_port ?? "";
  const known = (s: PortsState) => (s.kind === "ok" ? s.ports : []);
  const pickA = aPick ?? initialPort(known(aPorts.state), savedA);
  const pickB = bPick ?? initialPort(known(bPorts.state), savedB);

  async function save() {
    const m = medium === MEDIUM_NONE ? null : (medium as LinkMedium);
    setError(null);
    if (edit) {
      const built = buildLinkPatch({ aPort: pickA, bPort: pickB, medium: m, note });
      if (!built.ok) return setError(built.error);
      setBusy(true);
      const done = await onPatch(edit.id, built.body);
      setBusy(false);
      if (done) onClose();
      return;
    }
    const built = buildManualLink({ a, b, aPort: pickA, bPort: pickB, medium: m, note });
    if (!built.ok) return setError(built.error);
    setBusy(true);
    const done = await onCreate(built.body);
    setBusy(false);
    if (done) onClose();
  }

  return (
    <form className="grid gap-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); if (!busy) void save(); }}>
      <DialogHeader>
        <DialogTitle>{edit ? "Modifica il collegamento a mano" : "Collega a mano"}: {aName} ↔ {bName}</DialogTitle>
      </DialogHeader>
      <PortField label={`Porta di ${aName}`} which="partenza" ports={aPorts} pick={pickA} onPick={setAPick} />
      <PortField label={`Porta di ${bName}`} which="arrivo" ports={bPorts} pick={pickB} onPick={setBPick} />
      <label className="grid gap-1">
        <span className="font-semibold">Tipo</span>
        <Select value={medium} onValueChange={(v) => { if (typeof v === "string") setMedium(v); }}>
          <SelectTrigger className="w-full" aria-label="Tipo di collegamento"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={MEDIUM_NONE}>non indicato</SelectItem>
            {MEDIA.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Nota</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="es. cavo nell'armadio 2, presa 14" />
      </label>
      <p className="text-muted-foreground">
        Dopo il salvataggio la linea dice «✎ ✓» se le letture vedono il collegamento su quella porta, «✎ ?» se lo sai solo tu.
      </p>
      {error && <p role="alert" className="font-semibold text-destructive">▲ {error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
        <Button type="submit" disabled={busy}>Salva</Button>
      </DialogFooter>
    </form>
  );
}

function PortField(props: {
  label: string;
  which: "partenza" | "arrivo";
  ports: { state: PortsState; retry: () => void };
  pick: PortPick;
  onPick: (p: PortPick) => void;
}) {
  const { state, retry } = props.ports;
  const choices = portChoices(state.kind === "ok" ? state.ports : []);
  return (
    <div className="grid gap-1">
      <span className="font-semibold">{props.label}</span>
      {state.kind === "loading" && <span className="text-muted-foreground">Caricamento delle porte note…</span>}
      {state.kind === "error" && (
        <span role="alert" className="text-destructive">
          ▲ Porte non caricate: {state.message} ·{" "}
          <button type="button" className="underline" onClick={retry}>Riprova</button> — intanto puoi scriverla a mano.
        </span>
      )}
      {state.kind === "ok" && state.ports.length === 0 && <span className="text-muted-foreground">Nessuna porta nota per questo oggetto: scrivila a mano.</span>}
      <div className="flex gap-2">
        <Select value={props.pick.choice} onValueChange={(v) => { if (typeof v === "string") props.onPick({ choice: v, text: props.pick.text }); }}>
          <SelectTrigger className="min-w-0 flex-1" aria-label={`Porta di ${props.which}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {choices.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {props.pick.choice === PORT_MANUAL && (
          <Input
            autoFocus
            className="flex-1"
            value={props.pick.text}
            maxLength={100}
            onChange={(e) => props.onPick({ choice: PORT_MANUAL, text: e.target.value })}
            placeholder="es. Port 12, ether3, eno1"
            aria-label={`Porta di ${props.which}, scritta a mano`}
          />
        )}
      </div>
    </div>
  );
}
