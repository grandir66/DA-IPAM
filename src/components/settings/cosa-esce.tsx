"use client";

/**
 * Pagina «Cosa esce da questa istanza» (tappa C1 NetBird/DA-Link, spec §5.3).
 *
 * Mostra tutto ciò che esce verso Domarc e fa scegliere all'amministratore il livello
 * del segnale verso DA-Link. La scelta vale all'origine: un dato bloccato non parte.
 * Dopo un abbassamento la pagina dice «in attesa di conferma» finché DA-Link non
 * conferma la cancellazione dei numeri, e intanto si rilegge da sola.
 *
 * Badge con doppio segnale (fondo e bordo, più il simbolo): verde tenue con bordo
 * pieno, ambra tenue con bordo tratteggiato, rosso pieno solo per un errore, bianco con
 * bordo grigio per «non so» o spento. Testo ≥13 px.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { QuadroCosaEsce } from "@/lib/dalink/quadro";
import type { Livello } from "@/lib/dalink/stato";

type Tono = "ok" | "attesa" | "errore" | "neutro" | "spento";

const TONI: Record<Tono, { classe: string; simbolo: string }> = {
  ok: { classe: "bg-emerald-50 border-emerald-700 text-emerald-900", simbolo: "✓" },
  attesa: { classe: "bg-amber-50 border-amber-700 border-dashed text-amber-950", simbolo: "…" },
  errore: { classe: "bg-red-700 border-red-800 text-white", simbolo: "✕" },
  neutro: { classe: "bg-white border-gray-400 text-gray-700", simbolo: "?" },
  spento: { classe: "bg-white border-gray-400 text-gray-700", simbolo: "–" },
};

function Stato({ tono, children }: { tono: Tono; children: React.ReactNode }) {
  const t = TONI[tono];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border-2 px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap ${t.classe}`}>
      <span aria-hidden="true">{t.simbolo}</span>
      {children}
    </span>
  );
}

function quando(v: string | null | undefined): string {
  if (!v) return "—";
  const d = parseDbDate(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("it-IT", {
    timeZone: FUSO_UTENTI,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NOMI_LIVELLO: Record<Livello, string> = {
  solo_stato: "Solo stato",
  stato_inventario: "Stato + numeri dell'inventario",
};

const NOMI_MODULO: Record<string, string> = {
  edge: "Scanner-Edge",
  patch_management: "Patch management",
  network_services: "Servizi di rete",
  librenms: "LibreNMS",
  graylog: "Graylog",
  wazuh: "Wazuh",
  meshcentral: "Controllo remoto",
  inventory_agent: "Agente inventario",
  nis2_inventory: "Inventario NIS2",
  unifi: "UniFi",
  appliance: "Sistema",
  cliente: "Cliente",
  firewall_wt0: "Firewall NetBird",
  interfaccia_wt0: "Interfaccia NetBird",
  moduli: "Moduli",
};

const NOMI_SALUTE: Record<string, string> = {
  ok: "ok",
  degraded: "degradato",
  fail: "in errore",
  trovato: "trovato",
  non_trovato: "codice non trovato fra i clienti",
  attivo: "attivo, solo dai centrali dichiarati",
  attivo_sorgenti_aperte: "attivo, porte limitate",
  assente: "assente",
  presente: "presente",
  non_so: "non so",
};

function tonoSalute(v: string): Tono {
  if (["ok", "trovato", "attivo", "presente"].includes(v)) return "ok";
  if (["fail", "non_trovato"].includes(v)) return "errore";
  if (["degraded", "attivo_sorgenti_aperte", "assente"].includes(v)) return "attesa";
  return "neutro";
}

function Riga({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[13rem_1fr] gap-4 py-2.5 border-b last:border-b-0 text-sm">
      <div className="font-medium text-muted-foreground">{etichetta}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function CosaEsce() {
  const [quadro, setQuadro] = useState<QuadroCosaEsce | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [scelta, setScelta] = useState<Livello | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [invio, setInvio] = useState(false);
  const sceltaToccata = useRef(false);
  const rilettura = useRef<ReturnType<typeof setInterval> | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<QuadroCosaEsce>("/api/dalink/cosa-esce", { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setQuadro(r.data);
    if (!sceltaToccata.current) setScelta(r.data.livello?.livello ?? null);
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  // In attesa di conferma: si rilegge ogni 5 secondi finché arriva (pulizia obbligatoria).
  const inAttesa = quadro?.conferma.stato === "in_attesa";
  useEffect(() => {
    if (!inAttesa) return;
    rilettura.current = setInterval(() => void carica(), 5000);
    return () => {
      if (rilettura.current) clearInterval(rilettura.current);
      rilettura.current = null;
    };
  }, [inAttesa, carica]);

  async function salva() {
    if (!scelta) return;
    setSalvo(true);
    const r = await fetchJson<{ livello: unknown }>("/api/dalink/livello", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ livello: scelta }),
    });
    setSalvo(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    sceltaToccata.current = false;
    toast.success(`Livello salvato: ${NOMI_LIVELLO[scelta]}`);
    await carica();
  }

  async function inviaAdesso() {
    setInvio(true);
    const r = await fetchJson<{ esito: string; dettaglio: string }>("/api/dalink/segnale", { method: "POST" });
    setInvio(false);
    if (!r.ok) toast.error(r.message);
    else if (r.data.esito === "ok") toast.success("Segnale ricevuto da DA-Link");
    else toast.error(r.data.dettaglio);
    await carica();
  }

  if (errore && !quadro) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Cosa esce da questa istanza verso Domarc</h1>
        <LoadError what="cosa esce da questa istanza" message={errore} onRetry={() => void carica()} />
      </div>
    );
  }
  if (!quadro) return <p className="text-sm text-muted-foreground">Caricamento…</p>;

  const cfg = quadro.configurazione;
  const seg = quadro.segnale;
  const ant = quadro.anteprima;
  const attuale = quadro.livello?.livello ?? null;
  const modificato = scelta !== null && scelta !== attuale;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Cosa esce da questa istanza verso Domarc</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lo decide l&apos;amministratore di questa istanza: da Domarc non si può cambiare.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>DA-Link — segnale di vita</CardTitle>
            <CardDescription className="text-sm">
              Ogni {quadro.ogni_minuti} minuti l&apos;istanza dice a Domarc che è viva e com&apos;è messa.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => void inviaAdesso()} disabled={invio || cfg.stato !== "pronta"}>
            <Send className="h-4 w-4 mr-1.5" />
            {invio ? "Invio…" : "Invia adesso"}
          </Button>
        </CardHeader>
        <CardContent>
          <Riga etichetta="Collegamento">
            {cfg.stato === "pronta" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stato tono="ok">Configurato</Stato>
                <span>
                  nodo <span className="font-mono">{cfg.nodo}</span> · cliente <span className="font-mono">{cfg.codcli}</span> · verso{" "}
                  <span className="font-mono">{cfg.destinazione}</span> · token presente
                </span>
              </div>
            )}
            {cfg.stato === "assente" && (
              <div className="flex flex-wrap items-center gap-3">
                <Stato tono="spento">Non configurato</Stato>
                <span>Questa istanza non manda niente a DA-Link.</span>
              </div>
            )}
            {cfg.stato === "non_valida" && (
              <div className="flex flex-wrap items-center gap-3">
                <Stato tono="errore">Configurazione non valida</Stato>
                <span>{cfg.motivo}. Non parte niente.</span>
              </div>
            )}
          </Riga>

          {cfg.stato !== "assente" && (
            <Riga etichetta="Ultimo invio">
              {!seg?.tentato_il && <Stato tono="neutro">Mai inviato</Stato>}
              {seg?.tentato_il && (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    {seg.esito === "ok" ? (
                      <Stato tono="ok">Ricevuto</Stato>
                    ) : (
                      <Stato tono="errore">{seg.esito === "rifiutato" ? "Rifiutato" : "Non arrivato"}</Stato>
                    )}
                    <span>{quando(seg.tentato_il)}</span>
                    {seg.esito !== "ok" && <span>{seg.dettaglio}</span>}
                  </div>
                  {seg.esito !== "ok" && seg.ok_il && (
                    <div className="text-muted-foreground">Ultimo ricevuto: {quando(seg.ok_il)}</div>
                  )}
                </div>
              )}
            </Riga>
          )}

          <Riga etichetta="Cosa può uscire">
            <fieldset className="space-y-3">
              <legend className="sr-only">Livello del segnale verso DA-Link</legend>
              {attuale === null && (
                <p>
                  <Stato tono="neutro">Nessuna scelta dichiarata</Stato>{" "}
                  <span className="ml-2">finché non si sceglie esce solo lo stato.</span>
                </p>
              )}
              <label className="flex gap-3 items-start cursor-pointer">
                <input
                  type="radio"
                  name="livello"
                  className="mt-1 h-4 w-4"
                  checked={scelta === "solo_stato"}
                  onChange={() => {
                    sceltaToccata.current = true;
                    setScelta("solo_stato");
                  }}
                />
                <span>
                  <span className="font-semibold">Solo stato</span>
                  <span className="block text-muted-foreground">
                    Versione, moduli accesi, salute dei moduli, ultimo errore, porte aperte su NetBird e il livello scelto.
                  </span>
                </span>
              </label>
              <label className="flex gap-3 items-start cursor-pointer">
                <input
                  type="radio"
                  name="livello"
                  className="mt-1 h-4 w-4"
                  checked={scelta === "stato_inventario"}
                  onChange={() => {
                    sceltaToccata.current = true;
                    setScelta("stato_inventario");
                  }}
                />
                <span>
                  <span className="font-semibold">Stato + numeri dell&apos;inventario</span>
                  <span className="block text-muted-foreground">
                    In più: quanti dispositivi e quante reti, l&apos;ultima scansione e il suo esito. Mai l&apos;inventario riga per riga.
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-3">
                <Button onClick={() => void salva()} disabled={!modificato || salvo}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {salvo ? "Salvataggio…" : "Salva"}
                </Button>
                {quadro.livello && (
                  <span className="text-muted-foreground">
                    Scelto da {quadro.livello.scelto_da} il {quando(quadro.livello.scelto_il)}
                  </span>
                )}
              </div>
            </fieldset>
          </Riga>

          {quadro.conferma.stato !== "nessuna_richiesta" && (
            <Riga etichetta="Cancellazione a Domarc">
              {quadro.conferma.stato === "in_attesa" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Stato tono="attesa">In attesa di conferma</Stato>
                  <span>
                    Livello abbassato il {quando(quadro.conferma.dal)}: DA-Link deve ancora confermare di aver cancellato i
                    numeri ricevuti.
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Stato tono="ok">Confermata</Stato>
                  <span>DA-Link ha cancellato i numeri dell&apos;inventario il {quando(quadro.conferma.cancellato_il)}.</span>
                </div>
              )}
            </Riga>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{cfg.stato === "pronta" ? "Cosa contiene il prossimo segnale" : "Cosa conterrebbe il segnale"}</CardTitle>
          <CardDescription className="text-sm">Letto adesso da questa istanza, con il livello salvato.</CardDescription>
        </CardHeader>
        <CardContent>
          {!ant && (
            <p className="text-sm text-muted-foreground">
              {quadro.anteprima_errore ?? "Nessun cliente unico su questa istanza: l'anteprima si vede quando DA-Link è configurato."}
            </p>
          )}
          {ant && (
            <>
              <Riga etichetta="Cliente e nodo">
                <span className="font-mono">{ant.codcli}</span> · <span className="font-mono">{ant.nodo}</span>
              </Riga>
              <Riga etichetta="Versione">
                <span className="font-mono">{ant.versione}</span>
              </Riga>
              <Riga etichetta="Moduli accesi">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ant.moduli).filter(([, acceso]) => acceso).length === 0 && <span>nessuno</span>}
                  {Object.entries(ant.moduli)
                    .filter(([, acceso]) => acceso)
                    .map(([k]) => (
                      <span key={k} className="rounded-md border px-2 py-0.5 text-[13px]">
                        {NOMI_MODULO[k] ?? k}
                      </span>
                    ))}
                </div>
              </Riga>
              <Riga etichetta="Salute">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ant.salute).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span>{NOMI_MODULO[k] ?? k}:</span>
                      <Stato tono={tonoSalute(v)}>{NOMI_SALUTE[v] ?? v}</Stato>
                    </span>
                  ))}
                </div>
              </Riga>
              <Riga etichetta="Porte aperte su NetBird">
                {ant.porte_netbird.length > 0 ? (
                  <span className="font-mono">{ant.porte_netbird.join(", ")}</span>
                ) : (
                  <span>nessuna rilevata</span>
                )}
              </Riga>
              <Riga etichetta="Ultimo errore">{ant.ultimo_errore ?? "nessuno"}</Riga>
              <Riga etichetta="Numeri dell'inventario">
                {ant.inventario ? (
                  <span>
                    {ant.inventario.dispositivi} dispositivi · {ant.inventario.reti} reti · ultima scansione{" "}
                    {quando(ant.inventario.ultima_scansione)}
                    {ant.inventario.esito_scansione ? ` (${ant.inventario.esito_scansione})` : ""}
                  </span>
                ) : (
                  <span>
                    <Stato tono="spento">Non escono</Stato>{" "}
                    <span className="ml-2">
                      {attuale === "stato_inventario" ? "numeri non leggibili su questa istanza" : "il livello è «solo stato»"}
                    </span>
                  </span>
                )}
              </Riga>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Altri flussi verso Domarc</CardTitle>
          <CardDescription className="text-sm">
            Sono il servizio che il cliente ha chiesto: si fermano spegnendo il modulo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Riga etichetta="Scanner-Edge → da-vulcan">
            <div className="flex flex-wrap items-center gap-3">
              {quadro.altri_flussi.edge === "acceso" && <Stato tono="ok">Acceso</Stato>}
              {quadro.altri_flussi.edge === "spento" && <Stato tono="spento">Spento</Stato>}
              {quadro.altri_flussi.edge === "non_so" && <Stato tono="neutro">Non so</Stato>}
              <span>risultati delle scansioni di vulnerabilità</span>
            </div>
          </Riga>
          <Riga etichetta="Proxy Zabbix → DA-ZABBIX">
            <div className="flex flex-wrap items-center gap-3">
              {quadro.altri_flussi.zabbix_proxy === "presente" ? (
                <Stato tono="ok">Presente</Stato>
              ) : (
                <Stato tono="neutro">Non rilevato su questa macchina</Stato>
              )}
              <span>dati del monitoraggio</span>
            </div>
          </Riga>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registro delle scelte</CardTitle>
          <CardDescription className="text-sm">Ogni cambio di livello, con chi e quando (ultimi 20).</CardDescription>
        </CardHeader>
        <CardContent>
          {quadro.registro.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna scelta registrata.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 font-medium w-48">Quando</th>
                  <th className="py-2 font-medium w-64">Chi</th>
                  <th className="py-2 font-medium">Livello</th>
                </tr>
              </thead>
              <tbody>
                {quadro.registro.map((r) => (
                  <tr key={`${r.scelto_il}-${r.scelto_da}-${r.livello}`} className="border-b last:border-b-0">
                    <td className="py-2">{quando(r.scelto_il)}</td>
                    <td className="py-2">{r.scelto_da}</td>
                    <td className="py-2">{NOMI_LIVELLO[r.livello]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
