"use client";

/**
 * Pannello Zabbix in sola lettura (passo 7.4): cosa il centro sa degli apparati di
 * questo cliente. Dati vecchi mostrati come vecchi, «non so» quando i dati non sono
 * affidabili, mai «tutto ok» su una fotografia di prima. Il proxy della macchina è
 * un componente locale: la pagina dice se gira, non lo comanda.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  Star,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import { ETICHETTA_OPZIONE } from "@/lib/modules/offerta";
import type { EsitoAbbinamento } from "@/lib/zabbix-lettura/abbinamento";
import type { ValoreDisponibilita } from "@/lib/zabbix-lettura/api";
import {
  ETICHETTA_DISPONIBILITA,
  ETICHETTA_GRAVITA,
  ETICHETTA_MISURA,
  ETICHETTA_STATO_PANNELLO,
  formattaMisura,
  type HostMostrato,
  type PannelloZabbix,
  type ProxyLocale,
} from "@/lib/zabbix-lettura/pannello";

type PannelloOk = Extract<PannelloZabbix, { stato: "ok" }>;

function quando(iso: string | null | undefined): string {
  if (!iso) return "mai";
  const d = parseDbDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT");
}

function minuti(s: number): string {
  const m = Math.round(s / 60);
  return m < 1 ? "meno di un minuto" : m === 1 ? "un minuto" : `${m} minuti`;
}

const STILE_STATO: Record<PannelloZabbix["stato"], string> = {
  ok: "bg-[#00A7E7] text-white",
  guasto: "bg-destructive text-white",
  spento: "bg-muted text-muted-foreground",
  da_configurare: "bg-[#FFD400] text-[#0D2537]",
  non_acquistato: "bg-muted text-muted-foreground",
};

function Disponibilita({ d, ultima }: { d: ValoreDisponibilita; ultima: ValoreDisponibilita }) {
  const icona =
    d === "si" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : d === "no" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <CircleHelp className="h-4 w-4 text-amber-600" />
    );
  return (
    <div className="flex flex-col">
      <span className="inline-flex items-center gap-1.5">
        {icona}
        {ETICHETTA_DISPONIBILITA[d]}
      </span>
      {d !== ultima && (
        <span className="text-xs text-muted-foreground">ultimo noto: {ETICHETTA_DISPONIBILITA[ultima].toLowerCase()}</span>
      )}
    </div>
  );
}

function Abbinamento({
  a,
  hostid,
  isAdmin,
  occupato,
  onConferma,
  onTogli,
}: {
  a: EsitoAbbinamento;
  hostid: string;
  isAdmin: boolean;
  occupato: boolean;
  onConferma: (hostid: string, hostId: number) => void;
  onTogli: (hostid: string) => void;
}) {
  switch (a.stato) {
    case "verificato":
      return (
        <div className="flex flex-col gap-1">
          <Link href={`/hosts/${a.hostId}`} className="text-sm underline underline-offset-2">
            {a.nomeIpam ?? a.ip}
          </Link>
          <Badge variant="secondary">Verificato</Badge>
        </div>
      );
    case "proposto":
      return (
        <div className="flex flex-col gap-1">
          <Link href={`/hosts/${a.hostId}`} className="text-sm underline underline-offset-2">
            {a.nomeIpam ?? a.ip}
          </Link>
          <span className="text-xs text-muted-foreground">
            Proposto per IP{a.nomeCoincide ? ", anche il nome coincide" : ""}
          </span>
          {isAdmin && (
            <Button size="sm" variant="outline" disabled={occupato} onClick={() => onConferma(hostid, a.hostId)}>
              Conferma
            </Button>
          )}
        </div>
      );
    case "ambiguo":
      return (
        <div className="flex flex-col gap-1 text-xs">
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Ambiguo
          </Badge>
          <span className="text-muted-foreground">
            {a.motivo === "ip_condiviso" ? "Stesso IP su più host del centro:" : "Stesso IP su più host di DA-IPAM:"}
          </span>
          {a.motivo === "ip_condiviso"
            ? a.candidatiCentro.map((c) => (
                <span key={c.hostid}>
                  {c.nome} <span className="text-muted-foreground">({c.proxy ?? "senza proxy"})</span>
                </span>
              ))
            : a.candidatiIpam.map((c) => (
                <Link key={c.id} href={`/hosts/${c.id}`} className="underline underline-offset-2">
                  {c.nome ?? c.ip}
                </Link>
              ))}
        </div>
      );
    case "perso":
      return (
        <div className="flex flex-col gap-1 text-xs">
          <Badge variant="destructive">Perso</Badge>
          <span className="text-muted-foreground">
            Verificato con {a.nomeIpam ?? a.ip}, ma l&apos;IP è cambiato
          </span>
          {isAdmin && (
            <Button size="sm" variant="ghost" disabled={occupato} onClick={() => onTogli(hostid)}>
              Togli l&apos;abbinamento
            </Button>
          )}
        </div>
      );
    default:
      return <span className="text-xs text-muted-foreground">Non in DA-IPAM</span>;
  }
}

function Misure({ h }: { h: HostMostrato }) {
  if (h.valori.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col text-xs">
      {h.valori.map((v) => (
        <span key={v.chiave} className={v.vecchio ? "text-muted-foreground" : undefined} title={`letto ${quando(v.clock)}`}>
          {ETICHETTA_MISURA[v.chiave] ?? v.chiave}: {formattaMisura(v.chiave, v.valore)}
          {v.vecchio && " (vecchio)"}
        </span>
      ))}
    </div>
  );
}

function ProxyDellaMacchina({ p, centro }: { p: ProxyLocale; centro?: PannelloOk["proxyCentro"] }) {
  const vistoDalCentro = centro?.find((x) => x.diQuestaMacchina);
  const testo =
    p.stato === "gira" ? "Gira" : p.stato === "fermo" ? "Installato ma fermo" : p.stato === "assente" ? "Non installato" : "Non so";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4" />
          Proxy Zabbix di questa macchina
        </CardTitle>
        <CardDescription>
          Componente locale: DA-IPAM lo guarda e basta, non lo avvia né lo riavvia (nemmeno quando si aggiorna).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <div>
          Sulla macchina: <span className="font-medium">{testo}</span>
          {p.nome && <span className="text-muted-foreground"> · {p.nome}</span>}
        </div>
        {vistoDalCentro ? (
          <div>
            Per il centro:{" "}
            <span className="font-medium">{vistoDalCentro.inLinea ? "in linea" : "fuori linea"}</span>
            <span className="text-muted-foreground"> · ultimo contatto {quando(vistoDalCentro.ultimoContatto)}</span>
          </div>
        ) : centro ? (
          <div className="text-muted-foreground">Il centro non elenca un proxy con questo nome.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ZabbixPanel() {
  const { data: session } = useSession();
  const ruolo = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = ruolo === "admin" || ruolo === "superadmin";

  const [pannello, setPannello] = useState<PannelloZabbix | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [pagina, setPagina] = useState(1);
  const [soloMacchina, setSoloMacchina] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const carica = useCallback(
    async (opz: { forza?: boolean } = {}) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setCaricamento(true);
      const q = new URLSearchParams({ pagina: String(pagina) });
      if (soloMacchina) q.set("solo", "macchina");
      try {
        const r = await fetchJson<PannelloZabbix>(`/api/zabbix/pannello?${q}`, {
          method: opz.forza ? "POST" : "GET",
          cache: "no-store",
          signal: ac.signal,
        });
        if (r.ok) {
          setPannello(r.data);
          setErrore(null);
        } else {
          setErrore(r.message);
        }
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) setErrore("Server non raggiungibile");
      } finally {
        if (abortRef.current === ac) setCaricamento(false);
      }
    },
    [pagina, soloMacchina],
  );

  useEffect(() => {
    void carica();
    return () => abortRef.current?.abort();
  }, [carica]);

  async function conferma(hostid: string, hostId: number) {
    setOccupato(true);
    try {
      const r = await fetchJson<{ ok: true }>("/api/zabbix/abbinamenti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostid, hostId }),
      });
      if (r.ok) toast.success("Abbinamento confermato");
      else toast.error(`Errore: ${r.message}`);
      await carica();
    } finally {
      setOccupato(false);
    }
  }

  async function togli(hostid: string) {
    if (!window.confirm("Togliere l'abbinamento verificato? L'host del centro tornerà da abbinare.")) return;
    setOccupato(true);
    try {
      const r = await fetchJson<{ ok: true }>(`/api/zabbix/abbinamenti?hostid=${encodeURIComponent(hostid)}`, {
        method: "DELETE",
      });
      if (r.ok) toast.success("Abbinamento tolto");
      else toast.error(`Errore: ${r.message}`);
      await carica();
    } finally {
      setOccupato(false);
    }
  }

  const intestazione = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="h-6 w-6 text-[#00A7E7]" />
          Zabbix
          <Badge variant="secondary" title="Modulo opzionale, potenzialmente a pagamento">
            {ETICHETTA_OPZIONE}
          </Badge>
          {pannello && <Badge className={STILE_STATO[pannello.stato]}>{ETICHETTA_STATO_PANNELLO[pannello.stato]}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">
          Cosa il centro di monitoraggio sa degli apparati di questo cliente. Sola lettura.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/settings?tab=moduli#module-zabbix" />}>
            <Settings className="h-4 w-4 mr-1.5" />
            Configura
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => void carica()} disabled={caricamento}>
          {caricamento ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Aggiorna
        </Button>
      </div>
    </div>
  );

  if (errore && !pannello) {
    return (
      <div className="space-y-4">
        {intestazione}
        <LoadError what="il pannello Zabbix" message={errore} onRetry={() => void carica()} />
      </div>
    );
  }
  if (!pannello) {
    return (
      <div className="space-y-4">
        {intestazione}
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (pannello.stato !== "ok") {
    return (
      <div className="space-y-4">
        {intestazione}
        {errore && <LoadError what="il pannello Zabbix" message={errore} onRetry={() => void carica()} />}
        <Card className={pannello.stato === "guasto" ? "ring-destructive/40 bg-destructive/5" : undefined}>
          <CardContent className="py-8 space-y-3">
            <p className="font-medium flex items-center gap-2">
              {pannello.stato === "guasto" && <AlertTriangle className="h-5 w-5 text-destructive" />}
              {pannello.stato === "guasto"
                ? pannello.clienteErrato
                  ? "Guasto: cliente errato"
                  : "Guasto"
                : ETICHETTA_STATO_PANNELLO[pannello.stato]}
            </p>
            <p className="text-sm text-muted-foreground">{pannello.messaggio}</p>
            {pannello.stato === "guasto" && (
              <div className="text-sm space-y-1">
                <p>Ultima lettura buona: {quando(pannello.ultimaLetturaOk)}</p>
                {pannello.prossimoTentativo && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Prossimo tentativo: {quando(pannello.prossimoTentativo)} ({pannello.fallimenti} tentativi falliti di
                    fila)
                  </p>
                )}
                <p className="text-muted-foreground">Nessun dato mostrato finché il centro non risponde di nuovo.</p>
                {isAdmin && (
                  <Button size="sm" variant="outline" disabled={caricamento} onClick={() => void carica({ forza: true })}>
                    Riprova adesso
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <ProxyDellaMacchina p={pannello.proxyLocale} />
      </div>
    );
  }

  const p = pannello;
  const pagine = Math.max(1, Math.ceil(p.totale / p.per));
  return (
    <div className="space-y-4">
      {intestazione}
      {errore && <LoadError what="il pannello Zabbix" message={errore} onRetry={() => void carica()} />}

      {p.vecchio && (
        <Card className="ring-amber-500/50 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="py-3 text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            Dati di {minuti(p.etaS)} fa: il centro non riesce a leggere Zabbix e serve l&apos;ultima lettura. La
            disponibilità è «non so».
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {p.riepilogo.tuttoOk ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )}
              {p.riepilogo.tuttoOk ? "Tutto ok" : "Da guardare"}
            </CardTitle>
            <CardDescription>
              {p.cliente} · letto {quando(p.lettoAlle)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-3">
              <span>{p.riepilogo.host} host</span>
              <span className="text-emerald-700">{p.riepilogo.disponibili} disponibili</span>
              <span className="text-destructive">{p.riepilogo.nonDisponibili} non disponibili</span>
              <span className="text-amber-700">{p.riepilogo.nonSo} non so</span>
              <span>{p.riepilogo.problemi} problemi aperti</span>
            </div>
            {p.riepilogo.motivi.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {p.riepilogo.motivi.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <ProxyDellaMacchina p={p.proxyLocale} centro={p.proxyCentro} />
      </div>

      {p.problemi.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Problemi aperti</CardTitle>
            {p.problemiTroncati > 0 && <CardDescription>Altri {p.problemiTroncati} non mostrati.</CardDescription>}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravità</TableHead>
                  <TableHead>Problema</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Dal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.problemi.map((pr) => (
                  <TableRow key={pr.eventid}>
                    <TableCell>
                      <Badge variant={pr.gravita >= 4 ? "destructive" : "outline"}>{ETICHETTA_GRAVITA[pr.gravita]}</Badge>
                    </TableCell>
                    <TableCell>
                      {pr.nome}
                      {pr.preso_in_carico && <span className="text-xs text-muted-foreground"> · preso in carico</span>}
                    </TableCell>
                    <TableCell>{pr.nomeHost}</TableCell>
                    <TableCell className="text-xs">{quando(pr.dal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Host del cliente sul centro</CardTitle>
            {p.proxyLocale.nome && (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={soloMacchina}
                  onCheckedChange={(v) => {
                    setSoloMacchina(v);
                    setPagina(1);
                  }}
                />
                Solo questa macchina
              </label>
            )}
          </div>
          {p.erroreValori && (
            <CardDescription className="text-destructive">Misure non lette: {p.erroreValori}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {p.host.length === 0 ? (
            <p className="text-sm text-muted-foreground">Il centro non ha host per questo cliente.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Proxy</TableHead>
                  <TableHead>Disponibilità</TableHead>
                  <TableHead>Misure</TableHead>
                  <TableHead>DA-IPAM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.host.map((h) => (
                  <TableRow key={h.hostid}>
                    <TableCell>
                      <div className="font-medium">{h.nome || h.host}</div>
                      <div className="text-xs text-muted-foreground">
                        {h.host}
                        {h.problemiAperti > 0 && ` · ${h.problemiAperti} problemi`}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{h.ip.join(", ") || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span className="inline-flex items-center gap-1">
                        {h.diQuestaMacchina && <Star className="h-3 w-3 fill-[#FFD400] text-[#FFD400]" aria-label="questa macchina" />}
                        {h.proxy ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Disponibilita d={h.disponibilita} ultima={h.disponibilitaUltimaNota} />
                    </TableCell>
                    <TableCell>
                      <Misure h={h} />
                    </TableCell>
                    <TableCell>
                      <Abbinamento
                        a={h.abbinamento}
                        hostid={h.hostid}
                        isAdmin={isAdmin}
                        occupato={occupato}
                        onConferma={(a, b) => void conferma(a, b)}
                        onTogli={(a) => void togli(a)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {pagine > 1 && (
            <div className="flex items-center justify-end gap-2 pt-3 text-sm">
              <Button size="sm" variant="outline" disabled={p.pagina <= 1 || caricamento} onClick={() => setPagina(p.pagina - 1)}>
                Precedente
              </Button>
              <span>
                Pagina {p.pagina} di {pagine} · {p.totale} host
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={p.pagina >= pagine || caricamento}
                onClick={() => setPagina(p.pagina + 1)}
              >
                Successiva
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {p.persi.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abbinamenti persi</CardTitle>
            <CardDescription>
              Host verificati che il centro non elenca più. Non si riabbinano da soli.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.persi.map((x) => (
              <div key={x.hostid} className="flex flex-wrap items-center gap-3">
                <Link href={`/hosts/${x.hostId}`} className="underline underline-offset-2">
                  {x.nome ?? x.ip}
                </Link>
                <span className="text-muted-foreground">
                  hostid {x.hostid} · {x.ip}
                </span>
                {isAdmin && (
                  <Button size="sm" variant="ghost" disabled={occupato} onClick={() => void togli(x.hostid)}>
                    Togli
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
