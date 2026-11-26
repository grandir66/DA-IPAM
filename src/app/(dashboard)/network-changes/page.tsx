import Link from "next/link";
import { ArrowLeftRight, DoorOpen, Fingerprint, Plug, Plus, Radio, Server, type LucideIcon } from "lucide-react";
import { Pannello, Vuoto } from "@/components/shared/console";
import { FILA_SCHEDE, SCHEDA_ACCESA, SCHEDA_BASE, SCHEDA_SPENTA } from "@/components/shared/forma-scheda";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PulsanteVisto } from "@/components/cambiamenti/pulsante-visto";
import { InterruttoreGiro } from "@/components/cambiamenti/interruttore-giro";
import { reteDelProssimoGiro } from "@/lib/cambiamenti/giro-notturno";
import { auth } from "@/lib/auth";
import { getServerTenantCode } from "@/lib/api-tenant";
import { getGiroCambiamentiSchedule, getTenantDb, withTenant } from "@/lib/db-tenant";
import { parseDbDate } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import { leggiCambiamenti, TIPI_CAMBIAMENTO, type TipoCambiamento } from "@/lib/cambiamenti/elenco";

// Riccardo, 14/11/2026: in questa scheda tutto ciò che cambia nel tempo, in un elenco solo. Il tipo si riconosce
// dall'icona e dal nome, mai dal colore (Riccardo è daltonico). Il rumore è nascosto di serie, col numero in vista.
const TIPI: Record<TipoCambiamento, { nome: string; plurale: string; icona: LucideIcon }> = {
  oggetto_nuovo: { nome: "Oggetto nuovo", plurale: "Oggetti nuovi", icona: Plus },
  apparato_nuovo: { nome: "Apparato nuovo", plurale: "Apparati nuovi", icona: Server },
  cambio_ip: { nome: "Cambio di IP", plurale: "Cambi di IP", icona: ArrowLeftRight },
  mac_cambiato: { nome: "MAC cambiato", plurale: "MAC cambiato", icona: Fingerprint },
  spostamento_porta: { nome: "Spostamento di porta", plurale: "Spostamenti di porta", icona: Plug },
  porta_nuova: { nome: "Porta nuova", plurale: "Porte nuove", icona: DoorOpen },
  sonda_trunk: { nome: "Dalla sonda trunk", plurale: "Dalla sonda trunk", icona: Radio },
};
const PERIODI = [1, 7, 30, 90] as const;
const STATI = { "da-vedere": "Da vedere", visti: "Visti", tutti: "Tutti" } as const;
type Stato = keyof typeof STATI;
const PER_PAGINA = 50;
const dataOra = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" });
const CAMPO = "h-8 rounded-md border border-input bg-background px-2 text-sm";

const una = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
function interoPositivo(valore: string | undefined): number | undefined {
  if (!valore || !/^\d+$/.test(valore)) return;
  const numero = Number(valore);
  if (Number.isSafeInteger(numero) && numero > 0) return numero;
}

export default async function CambiamentiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const rete = interoPositivo(una(p.rete));
  const giorni = PERIODI.find((g) => g === interoPositivo(una(p.giorni))) ?? 7;
  const tipo = TIPI_CAMBIAMENTO.find((t) => t === una(p.tipo));
  const stato: Stato = una(p.stato) === "visti" || una(p.stato) === "tutti" ? (una(p.stato) as Stato) : "da-vedere";
  const conRumore = una(p.rumore) === "1";
  const pagina = Math.min(interoPositivo(una(p.pagina)) ?? 1, 100_000);

  const session = await auth();
  const ruolo = (session?.user as { role?: string } | undefined)?.role;
  const puoSegnare = ruolo === "admin" || ruolo === "superadmin";
  const tenant = await getServerTenantCode();
  const db = getTenantDb(tenant);
  const giro = withTenant(tenant, () => getGiroCambiamentiSchedule());
  const reti = db.prepare("SELECT id, name, cidr FROM networks ORDER BY name, id").all() as
    Array<{ id: number; name: string; cidr: string }>;
  const nomeRete = new Map(reti.map((r) => [r.id, r.name]));

  const tutti = leggiCambiamenti(db, { giorni, reteId: rete });
  const perStato = tutti.filter((c) => stato === "tutti" || (stato === "visti" ? !!c.visto : !c.visto));
  const rumore = perStato.filter((c) => c.rumore).length;
  const inVista = perStato.filter((c) => conRumore || !c.rumore);
  const conta = (t: TipoCambiamento) => inVista.filter((c) => c.tipo === t).length;
  const scelti = tipo ? inVista.filter((c) => c.tipo === tipo) : inVista;
  const pagine = Math.max(1, Math.ceil(scelti.length / PER_PAGINA));
  const paginaVera = Math.min(pagina, pagine);
  const righe = scelti.slice((paginaVera - 1) * PER_PAGINA, paginaVera * PER_PAGINA);
  const daSegnare = scelti.filter((c) => !c.visto).map((c) => c.chiave);

  const indirizzo = (cambio: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const valori = { tipo, giorni: giorni === 7 ? undefined : giorni, rete, stato: stato === "da-vedere" ? undefined : stato,
      rumore: conRumore ? 1 : undefined, ...cambio };
    for (const [k, v] of Object.entries(valori)) if (v !== undefined) q.set(k, String(v));
    const testo = q.toString();
    return testo ? `/network-changes?${testo}` : "/network-changes";
  };

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Cambiamenti</h1>
      <nav aria-label="Tipo di cambiamento" className={FILA_SCHEDE}>
        <Link href={indirizzo({ tipo: undefined, pagina: undefined })} className={cn(SCHEDA_BASE, tipo ? SCHEDA_SPENTA : SCHEDA_ACCESA)}>
          Tutti <span className="tabular-nums">{inVista.length}</span>
        </Link>
        {TIPI_CAMBIAMENTO.map((t) => {
          const Icona = TIPI[t].icona;
          return (
            <Link key={t} href={indirizzo({ tipo: t, pagina: undefined })} className={cn(SCHEDA_BASE, tipo === t ? SCHEDA_ACCESA : SCHEDA_SPENTA)}>
              <Icona className="h-4 w-4" aria-hidden />
              {TIPI[t].plurale} <span className="tabular-nums">{conta(t)}</span>
            </Link>
          );
        })}
      </nav>

      {tipo === "porta_nuova" && puoSegnare && (
        <InterruttoreGiro
          acceso={giro.enabled}
          ultimo={giro.lastRun ? dataOra.format(parseDbDate(giro.lastRun)) : null}
          reteStanotte={reteDelProssimoGiro(reti)?.name ?? null}
        />
      )}
      <Pannello
        titolo={tipo ? TIPI[tipo].plurale : "Tutti i cambiamenti"}
        conteggio={scelti.length}
        corpoClassName="p-0"
        azioni={
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex flex-wrap items-center gap-2" action="/network-changes">
              {tipo && <input type="hidden" name="tipo" value={tipo} />}
              <select aria-label="Periodo" className={CAMPO} name="giorni" defaultValue={giorni}>
                {PERIODI.map((g) => <option key={g} value={g}>{g === 1 ? "Ultime 24 ore" : `Ultimi ${g} giorni`}</option>)}
              </select>
              <select aria-label="Subnet" className={cn(CAMPO, "max-w-64")} name="rete" defaultValue={rete ?? ""}>
                <option value="">Tutte le subnet</option>
                {reti.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.cidr}</option>)}
              </select>
              <select aria-label="Stato" className={CAMPO} name="stato" defaultValue={stato}>
                {Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="rumore" value="1" defaultChecked={conRumore} />
                Mostra anche il rumore ({rumore})
              </label>
              <Button type="submit" variant="outline" size="sm">Filtra</Button>
            </form>
            <Link className="text-sm text-cian-testo hover:underline" href="/analytics">Disponibilità e latenza anomale</Link>
            {puoSegnare && daSegnare.length > 1 && (
              <PulsanteVisto chiavi={daSegnare} etichetta={`Segna visti tutti (${daSegnare.length})`} />
            )}
          </div>
        }
        piede={pagine > 1 && (
          <nav className="flex items-center gap-3" aria-label="Paginazione dei cambiamenti">
            {paginaVera > 1 && <Link className="text-cian-testo hover:underline" href={indirizzo({ pagina: paginaVera - 1 })}>Precedente</Link>}
            <span>Pagina {paginaVera} di {pagine}</span>
            {paginaVera < pagine && <Link className="text-cian-testo hover:underline" href={indirizzo({ pagina: paginaVera + 1 })}>Successiva</Link>}
          </nav>
        )}
      >
        {righe.length > 0 ? (
          <Table fissa riserva={pagine > 1 ? 52 : 0}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">Quando</TableHead>
                <TableHead className="w-[210px]">Tipo</TableHead>
                <TableHead>Oggetto</TableHead>
                <TableHead className="w-[140px]">IP</TableHead>
                <TableHead className="w-[160px]">Subnet</TableHead>
                <TableHead>Prima</TableHead>
                <TableHead>Dopo</TableHead>
                <TableHead className="w-[190px]">Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((c) => {
                const Icona = TIPI[c.tipo].icona;
                return (
                  <TableRow key={c.chiave}>
                    <TableCell className="font-mono">{dataOra.format(c.quandoMs)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Icona className="h-4 w-4 shrink-0" aria-hidden />
                        {TIPI[c.tipo].nome}
                      </span>
                      {c.rumore && <div className="text-[13px] text-muted-foreground">Rumore: {c.rumore}</div>}
                    </TableCell>
                    <TableCell>
                      {c.hostId ? (
                        <Link className="text-cian-testo hover:underline" href={`/hosts/${c.hostId}`}>{c.oggetto}</Link>
                      ) : c.oggetto}
                    </TableCell>
                    <TableCell className="font-mono">{c.ip ?? "—"}</TableCell>
                    <TableCell>
                      {c.reteId && nomeRete.has(c.reteId) ? (
                        <Link className="text-cian-testo hover:underline" href={`/networks/${c.reteId}`}>{nomeRete.get(c.reteId)}</Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{c.prima ?? "—"}</TableCell>
                    <TableCell className="font-mono">{c.dopo ?? "—"}</TableCell>
                    <TableCell>
                      {c.visto ? (
                        <span className="text-muted-foreground">
                          Visto{c.visto.da ? ` · ${c.visto.da}` : ""} · {dataOra.format(parseDbDate(c.visto.il))}
                        </span>
                      ) : puoSegnare ? <PulsanteVisto chiavi={[c.chiave]} /> : "Da vedere"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Vuoto
            titolo={stato === "da-vedere" ? "Niente da vedere" : "Nessun cambiamento"}
            testo={rumore > 0 && !conRumore
              ? `Nel periodo ci sono ${rumore} righe di rumore nascoste: spunta «Mostra anche il rumore» per vederle.`
              : "Nel periodo scelto non è cambiato niente fra quello che le scansioni hanno visto."}
          />
        )}
      </Pannello>
    </div>
  );
}
