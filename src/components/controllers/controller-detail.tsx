"use client";

/**
 * Dettaglio di un controller (riga espansa): lettura dei client (casella ogni
 * ora 7-20 e ultimo giro, riga a sé), ultime 10 letture degli apparati, errori
 * e motivi dell'ultima, impronta del certificato. «Accetta il nuovo
 * certificato» compare solo se l'ultima prova ha detto `cert` con le due impronte.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { ControllerRunView, NetworkControllerView } from "@/lib/controllers/types";
import {
  clientRunLine,
  clientScheduleLabel,
  formatDuration,
  formatRome,
  parseControllerDetail,
  runOrigin,
  type ProbeResult,
} from "./controllers-model";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[13px] font-medium">{title}</p>
      <ul className="list-disc pl-5 text-[13px]">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export function ControllerDetail({
  controller,
  lastProbe,
  isAdmin,
  refreshKey,
  onChanged,
}: {
  controller: NetworkControllerView;
  /** Ultima «Prova» fatta da questa pagina su questo controller. */
  lastProbe: ProbeResult | null;
  isAdmin: boolean;
  /** Cambia dopo una sincronizzazione: rilegge le letture. */
  refreshKey: number;
  onChanged: () => void;
}) {
  const [runs, setRuns] = useState<ControllerRunView[] | null>(null);
  const [certPin, setCertPin] = useState<string | null>(controller.certPin);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const id = controller.id;

  const load = useCallback(async () => {
    const r = await fetchJson<unknown>(`/api/controllers/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setLoadError(r.message);
      return;
    }
    const d = parseControllerDetail(r.data);
    if (!d) {
      setLoadError("Risposta non valida dal server");
      return;
    }
    setLoadError(null);
    setRuns(d.runs);
    setCertPin(d.controller.certPin);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const acceptPin = async (pin: string, replaces: string | null) => {
    setPinBusy(true);
    try {
      const r = await fetchJson<unknown>(`/api/controllers/${id}/cert-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, replaces }),
      });
      if (!r.ok) {
        toast.error(`Impronta non cambiata: ${r.message}`);
        return;
      }
      toast.success("Nuova impronta accettata: riprova la connessione");
      await load();
      onChanged();
    } finally {
      setPinBusy(false);
    }
  };

  if (loadError) return <LoadError what="le letture del controller" message={loadError} onRetry={() => void load()} />;
  if (!runs) return <p className="text-sm text-muted-foreground">Caricamento…</p>;

  const last = runs[0];
  const certChanged = lastProbe && !lastProbe.ok && lastProbe.reason === "cert" && lastProbe.presentedPin;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-background px-3 py-2 space-y-1">
        <p className="text-sm font-medium">{clientScheduleLabel(controller)}</p>
        <p className="text-[13px]">{clientRunLine(controller)}</p>
        {/* Accendere e spegnere la lettura dei client si fa da Opzioni (22/10). */}
        <div className="pt-1">
          <RigheRimando ids={[`controller.${id}.client`]} mostraEsito={false} />
        </div>
      </div>

      <div>
        <p className="text-[13px] font-medium mb-1">Ultime letture degli apparati</p>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna lettura ancora.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>Origine</TableHead>
                  <TableHead>Esito</TableHead>
                  <TableHead className="text-right">Nuovi</TableHead>
                  <TableHead className="text-right">Aggiornati</TableHead>
                  <TableHead className="text-right">Saltati</TableHead>
                  <TableHead className="text-right">Porte</TableHead>
                  <TableHead className="text-right">Vicini</TableHead>
                  <TableHead className="text-right">Errori</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatRome(r.startedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDuration(r.startedAt, r.finishedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{runOrigin(r)}</TableCell>
                    <TableCell className="whitespace-nowrap" title={r.message ?? undefined}>
                      {r.ok ? "ok" : "▲ non riuscita"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.added}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.updated}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.skipped}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.ports}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.neighbors}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.errors.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {last && (
        <div className="space-y-2">
          {!last.ok && last.message && (
            <p className="text-[13px] text-destructive">Ultima lettura: {last.message}</p>
          )}
          <List title="Errori dell'ultima lettura" items={last.errors} />
          <List title="Saltati, con il motivo" items={last.skippedReasons} />
          <List
            title="Non connessi al controller: porte e vicini restano quelli dell'ultima sincronizzazione"
            items={last.offline}
          />
        </div>
      )}

      <div className="rounded-md border bg-background px-3 py-2 text-sm">
        {certPin ? (
          <>
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Certificato del controller fissato
            </p>
            <code className="block font-mono text-[13px] break-all">{certPin}</code>
          </>
        ) : (
          <p className="text-muted-foreground">
            Nessun certificato fissato: la prima prova riuscita fissa quello del controller.
          </p>
        )}
        {isAdmin && certChanged && lastProbe.presentedPin && (
          <div className="mt-2 space-y-1.5 border-t pt-2">
            <p className="text-[13px] text-destructive font-medium">
              La prova ha trovato un certificato diverso da quello fissato.
            </p>
            {lastProbe.expectedPin && (
              <div>
                <p className="text-[13px] text-muted-foreground">Impronta fissata</p>
                <code className="block font-mono text-[13px] break-all">{lastProbe.expectedPin}</code>
              </div>
            )}
            <div>
              <p className="text-[13px] text-muted-foreground">Impronta presentata adesso</p>
              <code className="block font-mono text-[13px] break-all">{lastProbe.presentedPin}</code>
            </div>
            <p className="text-[13px] text-muted-foreground">
              Accettala solo se sai che il certificato del controller è stato rinnovato: un certificato diverso può
              anche voler dire che qualcuno si è messo in mezzo.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={pinBusy}
              onClick={() => void acceptPin(lastProbe.presentedPin as string, lastProbe.expectedPin)}
            >
              {pinBusy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Accetta il nuovo certificato
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
