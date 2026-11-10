"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, ChevronRight, Radar, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { BadgeGravita, DatoDettaglio, Etichetta, InCorso, IntestazionePagina, Legenda, Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { BottoneCopia } from "@/components/shared/copia";
import { BadgeTriage, EditorTriage } from "@/components/shared/triage-riga";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";
import { SEVERITIES } from "@/lib/severity-style";
import type { ServizioRete } from "@/lib/servizi-rete/db";
import type { ElencoServiziRete } from "@/lib/servizi-rete/elenco";
import type { StatoGiro } from "@/lib/servizi-rete/giro";
import type { ConteggiIdentita, PropostaIdentita } from "@/lib/servizi-rete/identita";
import type { InfoHttp, InfoNtlm, InfoSsh, InfoTls } from "@/lib/servizi-rete/sonde";
import type { GruppoServizi, IndicatoriServizi, RaggruppamentoServizi, Segnale, ServizioVista, TipoServizio } from "@/lib/servizi-rete/viste";
import { IdentitaClient } from "./identita-client";

type Dati = ElencoServiziRete & { giro: StatoGiro | null };

interface Rete {
  id: number;
  nome: string;
  cidr: string;
}

const PER_PAGINA = 100;
/** Quanti servizi si leggono aprendo un gruppo: il resto si vede con «Apri l'elenco». */
const PER_GRUPPO = 25;

type Vista = "servizio" | RaggruppamentoServizi;
const VISTE: Array<[Vista, string]> = [
  ["servizio", "Servizio"],
  ["porta", "Porta"],
  ["prodotto", "Prodotto"],
  ["host", "Host"],
  ["rete", "Rete"],
];
const NOME_GRUPPO: Record<RaggruppamentoServizi, string> = { porta: "Porta · servizio", prodotto: "Prodotto", host: "Host", rete: "Rete" };

/** I filtri della pagina: valgono in ogni raggruppamento, cambiando vista non si perdono. */
interface Filtri {
  q: string;
  rete: { id: number; nome: string } | null;
  ospite: { id: number; nome: string } | null;
  porta: number | null;
  prodotto: string | null;
  tipo: TipoServizio | null;
  segnale: Segnale | null;
  conRilievi: boolean;
}
const NESSUN_FILTRO: Filtri = { q: "", rete: null, ospite: null, porta: null, prodotto: null, tipo: null, segnale: null, conRilievi: false };

const NOME_SEGNALE: Record<Segnale, string> = {
  chiaro: "Accessi in chiaro",
  certificati: "Certificati da sistemare",
  "non-identificati": "Non identificati",
  "non-rivisti": "Non rivisti da 7 giorni",
};

function parametri(f: Filtri): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.rete) sp.set("network_id", String(f.rete.id));
  if (f.ospite) sp.set("host_id", String(f.ospite.id));
  if (f.porta) sp.set("porta", String(f.porta));
  if (f.prodotto) sp.set("prodotto", f.prodotto);
  if (f.tipo) sp.set("tipo", f.tipo);
  if (f.segnale) sp.set("segnale", f.segnale);
  if (f.conRilievi) sp.set("rilievi", "1");
  return sp;
}

/** Come è stato riconosciuto: segno + parola, mai il solo colore (Riccardo è daltonico). */
const METODI: Record<string, { segno: string; testo: string; classe: string; spiega: string }> = {
  "tls-http": { segno: "◆", testo: "TLS + HTTP", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "stretta di mano TLS e risposta HTTP lette" },
  tls: { segno: "◆", testo: "TLS", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "stretta di mano TLS letta" },
  http: { segno: "●", testo: "HTTP", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "risposta HTTP letta" },
  ssh: { segno: "■", testo: "SSH", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "versione e algoritmi SSH letti" },
  ntlm: { segno: "◇", testo: "NTLM", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "nome e dominio dalla CHALLENGE NTLM, senza autenticarsi" },
  banner: { segno: "▲", testo: "banner", classe: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]", spiega: "il servizio si presenta da solo" },
  udp: { segno: "▼", testo: "UDP", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "ha risposto a una domanda UDP di protocollo (DNS, NTP, NetBIOS, SQL Browser)" },
  silenzio: { segno: "○", testo: "tace", classe: "border-border bg-muted text-muted-foreground", spiega: "aperta, ma non risponde alle sonde" },
  aperta: { segno: "–", testo: "aperta", classe: "border-dashed border-border bg-transparent text-muted-foreground", spiega: "trovata aperta dal giro leggero, non ancora sondata" },
  nmap: { segno: "–", testo: "solo nmap", classe: "border-dashed border-border bg-transparent text-muted-foreground", spiega: "nome dalla scansione, non ancora sondata" },
};

const TIPI: Array<{ valore: TipoServizio; segno: string; testo: string }> = [
  { valore: "http", segno: "●", testo: "HTTP" },
  { valore: "tls", segno: "◆", testo: "TLS" },
  { valore: "ssh", segno: "■", testo: "SSH" },
  { valore: "ntlm", segno: "◇", testo: "NTLM" },
  { valore: "banner", segno: "▲", testo: "banner" },
  { valore: "silenzio", segno: "○", testo: "muti" },
  { valore: "da-sondare", segno: "–", testo: "da sondare" },
];

function leggiJson<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** «gg/mm hh:mm» dalla data UTC del database. */
function quando(s: string | null): string {
  if (!s) return "—";
  const d = parseDbDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** La cosa più utile da leggere in riga: titolo HTTP, nome del certificato, identità SSH, banner. */
function riassunto(r: ServizioRete): string {
  const http = leggiJson<InfoHttp>(r.http_json);
  const tls = leggiJson<InfoTls>(r.tls_json);
  const ntlm = leggiJson<InfoNtlm>(r.ntlm_json);
  const parti: string[] = [];
  if (http) parti.push(`${http.status_code}${http.title ? ` · ${http.title}` : http.location ? ` → ${http.location}` : ""}`);
  if (tls?.subject_cn) parti.push(`CN=${tls.subject_cn}${tls.self_signed ? " (autofirmato)" : ""}`);
  if (ntlm) {
    const nome = ntlm.dns_computer ?? (ntlm.dominio_netbios && ntlm.netbios ? `${ntlm.dominio_netbios}\\${ntlm.netbios}` : ntlm.netbios);
    if (nome) parti.push(nome);
  }
  if (!http && !tls && !ntlm && r.banner) parti.push(r.banner.split("\\r\\n")[0].split("\\n")[0]);
  return parti.join(" · ") || "—";
}

function Metodo({ metodo }: { metodo: string | null }) {
  const m = METODI[metodo ?? "nmap"] ?? METODI.nmap;
  return (
    <span title={m.spiega} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", m.classe)}>
      <span aria-hidden>{m.segno}</span>
      {m.testo}
    </span>
  );
}

function Blocco({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2 rounded-lg border bg-card p-3">
      <p className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">{titolo}</p>
      {children}
    </div>
  );
}

function Elenco({ voci }: { voci: string[] }) {
  if (voci.length === 0) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono text-[13px] break-all">{voci.join(", ")}</span>;
}

function DettaglioServizio({ r }: { r: ServizioRete }) {
  const tls = leggiJson<InfoTls>(r.tls_json);
  const http = leggiJson<InfoHttp>(r.http_json);
  const ssh = leggiJson<InfoSsh>(r.ssh_json);
  const ntlm = leggiJson<InfoNtlm>(r.ntlm_json);
  return (
    <div className="grid gap-3 bg-muted/40 p-3 md:grid-cols-2 xl:grid-cols-3">
      <Blocco titolo="Servizio">
        <DatoDettaglio nome="Indirizzo" valore={<BottoneCopia valore={r.ip}><span className="font-mono">{`${r.ip}:${r.porta}/${r.protocollo}`}</span></BottoneCopia>} />
        <DatoDettaglio nome="Come lo sappiamo" valore={<Metodo metodo={r.metodo} />} />
        <DatoDettaglio nome="Prima vista · ultima vista" valore={`${quando(r.primo_visto)} · ${quando(r.ultimo_visto)}`} mono />
        <DatoDettaglio nome="Ultima sonda" valore={quando(r.ultima_sonda)} mono />
      </Blocco>
      {tls && (
        <Blocco titolo="Certificato TLS">
          <DatoDettaglio nome="Protocollo · cifrario" valore={`${tls.version ?? "—"} · ${tls.cipher ?? "—"}${tls.alpn ? ` · ${tls.alpn}` : ""}`} mono />
          <DatoDettaglio nome="Intestato a" valore={tls.subject ?? "—"} mono />
          <DatoDettaglio nome="Emesso da" valore={tls.self_signed ? "autofirmato" : tls.issuer ?? "—"} mono />
          <DatoDettaglio nome="Nomi" valore={<Elenco voci={tls.sans} />} />
          <DatoDettaglio
            nome="Validità"
            valore={`${tls.not_before ?? "—"} → ${tls.not_after ?? "—"}${tls.expired ? " ✕ scaduto" : ""}`}
            mono
          />
          <DatoDettaglio nome="Chiave · impronta SHA-256" valore={`${tls.key_bits ? `${tls.key_bits} bit` : "—"} · ${tls.sha256?.slice(0, 16) ?? "—"}…`} mono />
        </Blocco>
      )}
      {http && (
        <Blocco titolo={`Risposta ${http.scheme.toUpperCase()}`}>
          <DatoDettaglio nome="Stato" valore={`${http.status_code} ${http.status_text}`} mono />
          <DatoDettaglio nome="Titolo" valore={http.title ?? "—"} />
          <DatoDettaglio nome="Server" valore={http.server ?? "—"} mono />
          {http.location && <DatoDettaglio nome="Rimanda a" valore={http.location} mono />}
          <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/50 p-2 font-mono text-[13px]">
            {Object.entries(http.headers).map(([k, v]) => (
              <div key={k} className="break-all">
                <span className="font-semibold">{k}:</span> {v}
              </div>
            ))}
          </div>
        </Blocco>
      )}
      {ntlm && (
        <Blocco titolo="Nome Windows (NTLM)">
          <DatoDettaglio nome="Computer DNS" valore={ntlm.dns_computer ?? "—"} mono />
          <DatoDettaglio nome="NetBIOS" valore={ntlm.netbios ?? "—"} mono />
          <DatoDettaglio nome="Dominio" valore={ntlm.dominio_dns ?? ntlm.dominio_netbios ?? "—"} mono />
          <DatoDettaglio nome="Versione OS" valore={ntlm.versione_os ?? "—"} mono />
          <DatoDettaglio nome="Letto da" valore={ntlm.fonte === "http" ? "HTTP" : ntlm.fonte === "rdp" ? "RDP" : "SMB"} />
        </Blocco>
      )}
      {ssh && (
        <Blocco titolo="SSH">
          <DatoDettaglio nome="Si presenta come" valore={ssh.ident} mono />
          {ssh.fingerprint && <DatoDettaglio nome="Impronta host key SHA-256" valore={ssh.fingerprint} mono />}
          <DatoDettaglio nome="Scambio chiavi" valore={<Elenco voci={ssh.kex} />} />
          <DatoDettaglio nome="Chiavi dell'host" valore={<Elenco voci={ssh.hostkey} />} />
          <DatoDettaglio nome="Cifrari" valore={<Elenco voci={ssh.cifrari} />} />
          <DatoDettaglio nome="MAC" valore={<Elenco voci={ssh.mac} />} />
        </Blocco>
      )}
      {r.banner && r.metodo !== "ssh" && (
        <Blocco titolo="Banner">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 font-mono text-[13px]">
            {r.banner.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n")}
          </pre>
        </Blocco>
      )}
    </div>
  );
}

/** I rilievi nati da questa porta: gli stessi di Findings, con lo stesso stato di revisione. */
function RilieviServizio({ r, admin, onCambio }: { r: ServizioVista; admin: boolean; onCambio: () => void }) {
  return (
    <div className="space-y-2 border-b bg-card p-3">
      <p className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">
        Rilievi di questa porta <span className="font-mono font-normal text-muted-foreground">{r.rilievi.length}</span>
      </p>
      {r.rilievi.map((x) => (
        <div key={x.chiave} className="grid gap-x-4 gap-y-2 rounded-lg border p-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeGravita gravita={x.gravita} />
              <span className="font-medium">{x.titolo}</span>
            </div>
            <DatoDettaglio nome="Prova" valore={x.prova} mono />
            <DatoDettaglio nome="Rimedio" valore={x.rimedio} />
          </div>
          <EditorTriage
            chiave={x.chiave}
            iniziale={x.triage ? { stato: x.triage.stato, nota: x.triage.nota, aggiornato_il: x.triage.aggiornato_il, aggiornato_da: x.triage.aggiornato_da } : undefined}
            admin={admin}
            onCambio={onCambio}
          />
        </div>
      ))}
    </div>
  );
}

/** Cosa c'è da guardare su una riga: la gravità più alta dei rilievi e i segnali, con segno e parola. */
function DaGuardare({ r }: { r: ServizioVista }) {
  const peggiore = r.rilievi[0];
  const aperti = r.rilievi.filter((x) => (x.triage?.stato ?? "da_fare") === "da_fare").length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {peggiore && <BadgeGravita gravita={peggiore.gravita} conteggio={r.rilievi.length} />}
      {peggiore && aperti === 0 && <BadgeTriage stato="fatto" />}
      {r.segnali.includes("chiaro") && <Etichetta tono="ruolo" mono={false}>▲ in chiaro</Etichetta>}
      {r.certificato && <Etichetta mono={false}>◆ {r.certificato}</Etichetta>}
      {r.segnali.includes("non-rivisti") && <Etichetta mono={false}>– non rivisto</Etichetta>}
      {!peggiore && r.segnali.length === 0 && <span className="text-muted-foreground">—</span>}
    </span>
  );
}

/** Le righe dei servizi: stesse colonne nell'elenco e dentro un gruppo aperto. */
function RigheServizi({ righe, admin, onCambio }: { righe: ServizioVista[]; admin: boolean; onCambio: () => void }) {
  const [aperte, setAperte] = useState<Set<number>>(new Set());
  const apriChiudi = (id: number) =>
    setAperte((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Indirizzo</TableHead>
          <TableHead>Porta</TableHead>
          <TableHead>Servizio</TableHead>
          <TableHead>Prodotto · versione</TableHead>
          <TableHead>Cosa risponde</TableHead>
          <TableHead>Come</TableHead>
          <TableHead>Da guardare</TableHead>
          <TableHead>Rete</TableHead>
          <TableHead>Ultima vista</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {righe.map((r) => {
          const aperta = aperte.has(r.id);
          return (
            <Fragment key={r.id}>
              <TableRow className="cursor-pointer" onClick={() => apriChiudi(r.id)} aria-expanded={aperta}>
                <TableCell>{aperta ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                <TableCell>
                  <BottoneCopia valore={r.ip}><span className="font-mono font-semibold">{r.ip}</span></BottoneCopia>
                  {r.hostname && <div className="text-[13px] text-muted-foreground">{r.hostname}</div>}
                </TableCell>
                <TableCell className="font-mono">{r.porta}/{r.protocollo}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {r.nome ?? "—"}
                    {r.tls_json !== null && <Etichetta tono="marca">TLS</Etichetta>}
                  </span>
                </TableCell>
                <TableCell>{[r.prodotto, r.versione].filter(Boolean).join(" ") || "—"}</TableCell>
                <TableCell className="max-w-[24rem] truncate" title={riassunto(r)}>{riassunto(r)}</TableCell>
                <TableCell><Metodo metodo={r.metodo} /></TableCell>
                <TableCell><DaGuardare r={r} /></TableCell>
                <TableCell className="text-[13px]">{r.rete ?? "—"}</TableCell>
                <TableCell className="text-[13px]"><TempoRelativo data={r.ultimo_visto} /></TableCell>
              </TableRow>
              {aperta && (
                <TableRow>
                  <TableCell colSpan={10} className="p-0">
                    {r.rilievi.length > 0 && <RilieviServizio r={r} admin={admin} onCambio={onCambio} />}
                    <DettaglioServizio r={r} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Un gruppo aperto: i suoi primi servizi, letti quando lo si apre. */
function ServiziDelGruppo({ g, filtri, admin, onApri }: { g: GruppoServizi; filtri: Filtri; admin: boolean; onApri: () => void }) {
  const [dati, setDati] = useState<{ righe: ServizioVista[]; totale: number } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const carica = useCallback(async () => {
    const sp = parametri(filtri);
    sp.set("limit", String(PER_GRUPPO));
    if (g.filtro.porta) sp.set("porta", String(g.filtro.porta));
    if (g.filtro.prodotto) sp.set("prodotto", g.filtro.prodotto);
    if (g.filtro.ospite) sp.set("host_id", String(g.filtro.ospite));
    if (g.filtro.rete) sp.set("network_id", String(g.filtro.rete));
    const r = await fetchJson<Dati>(`/api/servizi-rete?${sp}`, { cache: "no-store" });
    if (r.ok) {
      setDati({ righe: r.data.righe, totale: r.data.totale });
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, [g.filtro, filtri]);
  useEffect(() => {
    void carica();
  }, [carica]);
  if (errore) return <LoadError what="i servizi del gruppo" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="p-3 text-[13px] text-muted-foreground">Carico i servizi…</p>;
  return (
    <div className="border-l-4 border-foreground/70 bg-muted/30">
      <RigheServizi righe={dati.righe} admin={admin} onCambio={() => void carica()} />
      {dati.totale > dati.righe.length && (
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[13px] text-muted-foreground">
          I primi {dati.righe.length} di {dati.totale}.
          <Button size="sm" variant="outline" onClick={onApri}>Apri l&apos;elenco</Button>
        </div>
      )}
    </div>
  );
}

function GruppiServizi({
  per,
  gruppi,
  filtri,
  admin,
  onApri,
}: {
  per: RaggruppamentoServizi;
  gruppi: GruppoServizi[];
  filtri: Filtri;
  admin: boolean;
  onApri: (g: GruppoServizi) => void;
}) {
  const [aperti, setAperti] = useState<Set<string>>(new Set());
  const conRilievi = gruppi.filter((g) => g.rilievi > 0).length;
  return (
    <>
      <p className="px-3 py-2 text-[13px] text-muted-foreground">
        <strong className="font-mono text-foreground">{gruppi.length}</strong> gruppi, {conRilievi} con rilievi. In cima quelli coi rilievi più
        gravi, poi i più numerosi.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{NOME_GRUPPO[per]}</TableHead>
            <TableHead className="w-24">Servizi</TableHead>
            {per !== "host" && <TableHead className="w-24" title="Host distinti del gruppo">Host</TableHead>}
            <TableHead>Cosa risponde</TableHead>
            <TableHead>Da guardare</TableHead>
            <TableHead className="w-36" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {gruppi.map((g) => {
            const aperto = aperti.has(g.chiave);
            const alterna = () =>
              setAperti((prev) => {
                const n = new Set(prev);
                if (n.has(g.chiave)) n.delete(g.chiave);
                else n.add(g.chiave);
                return n;
              });
            return (
              <Fragment key={g.chiave}>
                <TableRow className="cursor-pointer" onClick={alterna} aria-expanded={aperto}>
                  <TableCell>{aperto ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                  <TableCell>
                    <span className={cn("font-semibold", per === "porta" && "font-mono")}>{g.nome}</span>
                    {g.dettaglio && <span className="ml-2 text-[13px] text-muted-foreground">{g.dettaglio}</span>}
                  </TableCell>
                  <TableCell className="font-mono">{g.servizi}</TableCell>
                  {per !== "host" && <TableCell className="font-mono">{g.host}</TableCell>}
                  <TableCell className="max-w-[32rem] truncate text-[13px]" title={g.sintesi}>{g.sintesi}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      {SEVERITIES.filter((s) => g.gravita[s] > 0).map((s) => (
                        <BadgeGravita key={s} gravita={s} conteggio={g.gravita[s]} />
                      ))}
                      {g.chiaro > 0 && <Etichetta tono="ruolo" mono={false}>▲ {g.chiaro} in chiaro</Etichetta>}
                      {g.scaduti > 0 && <Etichetta mono={false}>◆ {g.scaduti} {g.scaduti === 1 ? "scaduto" : "scaduti"}</Etichetta>}
                      {g.autofirmati > 0 && <Etichetta mono={false}>◆ {g.autofirmati} {g.autofirmati === 1 ? "autofirmato" : "autofirmati"}</Etichetta>}
                      {g.nonIdentificati > 0 && <Etichetta mono={false}>○ {g.nonIdentificati} non {g.nonIdentificati === 1 ? "identificato" : "identificati"}</Etichetta>}
                      {g.rilievi === 0 && g.chiaro + g.scaduti + g.autofirmati + g.nonIdentificati === 0 && <span className="text-muted-foreground">—</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onApri(g); }}>Apri l&apos;elenco</Button>
                  </TableCell>
                </TableRow>
                {aperto && (
                  <TableRow>
                    <TableCell colSpan={per === "host" ? 6 : 7} className="p-0">
                      <ServiziDelGruppo g={g} filtri={filtri} admin={admin} onApri={() => onApri(g)} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

const BARRA_IDENTIFICATI = "bg-[#0D2537] dark:bg-primary";
const BARRA_NON_IDENTIFICATI = "bg-muted-foreground/30";

/** «Dove guardare»: quattro segnali cliccabili e i servizi per rete. Segue i filtri dell'elenco. */
function FasciaSegnali({
  chiusa,
  onAlterna,
  n,
  reti,
  filtrata,
  segnale,
  reteScelta,
  onSegnale,
  onRete,
}: {
  chiusa: boolean;
  onAlterna: () => void;
  n: IndicatoriServizi;
  reti: ElencoServiziRete["perRete"];
  filtrata: boolean;
  segnale: Segnale | null;
  reteScelta: number | null;
  onSegnale: (s: Segnale) => void;
  onRete: (r: { id: number; nome: string }) => void;
}) {
  const caselle: Array<{ segnale: Segnale; segno: string; valore: number; nota: string }> = [
    { segnale: "chiaro", segno: "▲", valore: n.chiaro.totale, nota: n.chiaro.voci.map((v) => `${v.nome} ${v.n}`).join(" · ") || "nessun Telnet, FTP o VNC" },
    { segnale: "certificati", segno: "◆", valore: n.certificati.totale, nota: `${n.certificati.scaduti} scaduti · ${n.certificati.autofirmati} autofirmati` },
    { segnale: "non-identificati", segno: "○", valore: n.nonIdentificati.totale, nota: `${n.nonIdentificati.muti} aperti ma muti · ${n.nonIdentificati.daSondare} da sondare` },
    { segnale: "non-rivisti", segno: "–", valore: n.nonRivisti, nota: "forse non ci sono più" },
  ];
  const massimo = Math.max(1, ...reti.map((r) => r.totale));
  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={onAlterna} aria-expanded={!chiusa} className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-muted-foreground">
        {chiusa ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        Dove guardare{filtrata ? " · con i filtri scelti" : ""}
        {chiusa && (
          <span className="text-foreground">
            · <strong className="font-mono">{n.chiaro.totale}</strong> in chiaro · <strong className="font-mono">{n.certificati.scaduti}</strong> certificati scaduti ·{" "}
            <strong className="font-mono">{n.nonIdentificati.totale}</strong> non identificati
          </span>
        )}
      </button>
      {!chiusa && (
        <div className="grid gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="grid grid-cols-2 gap-2">
            {caselle.map((c) => (
              <button
                key={c.segnale}
                type="button"
                aria-pressed={segnale === c.segnale}
                disabled={c.valore === 0 && segnale !== c.segnale}
                onClick={() => onSegnale(c.segnale)}
                className={cn(
                  "rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted disabled:hover:bg-card",
                  segnale === c.segnale && "bg-muted ring-1 ring-foreground",
                )}
              >
                <span className="block text-[13px] text-muted-foreground"><span aria-hidden>{c.segno}</span> {NOME_SEGNALE[c.segnale]}</span>
                <span className="block font-mono text-xl font-semibold">{c.valore}</span>
                <span className="block truncate text-[13px] text-muted-foreground" title={c.nota}>{c.nota}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
              <span>Servizi per rete, un clic filtra l&apos;elenco</span>
              <Legenda voci={[{ classe: BARRA_IDENTIFICATI, testo: "identificati" }, { classe: BARRA_NON_IDENTIFICATI, testo: "non identificati" }]} />
            </div>
            {reti.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nessun servizio sulle reti con questi filtri.</p>
            ) : (
              reti.slice(0, 7).map((r) => (
                <button
                  key={r.network_id}
                  type="button"
                  aria-pressed={reteScelta === r.network_id}
                  onClick={() => onRete({ id: r.network_id, nome: r.nome })}
                  title={`${r.identificati} identificati, ${r.nonIdentificati} non identificati, ${r.host} host`}
                  className={cn("flex w-full items-center gap-3 rounded-md px-1 text-left hover:bg-muted", reteScelta === r.network_id && "bg-muted ring-1 ring-foreground")}
                >
                  <span className="w-40 shrink-0 truncate text-[13px] font-medium">{r.nome}</span>
                  <span className="flex h-4 flex-1 overflow-hidden rounded-sm">
                    <span className={BARRA_IDENTIFICATI} style={{ width: `${(r.identificati / massimo) * 100}%` }} />
                    <span className={BARRA_NON_IDENTIFICATI} style={{ width: `${(r.nonIdentificati / massimo) * 100}%` }} />
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-[13px] tabular-nums">{r.totale} · {r.host} host</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CHIAVE_FASCIA = "servizi-rete:fascia-chiusa";

export function ServiziReteClient({
  iniziale,
  reti,
  identita,
  admin,
}: {
  iniziale: Dati;
  reti: Rete[];
  identita: { righe: PropostaIdentita[]; conteggi: ConteggiIdentita };
  admin: boolean;
}) {
  const [dati, setDati] = useState<Dati>(iniziale);
  const [errore, setErrore] = useState<string | null>(null);
  const [apparati, setApparati] = useState(false);
  const [vista, setVista] = useState<Vista>("servizio");
  const [filtri, setFiltri] = useState<Filtri>(NESSUN_FILTRO);
  const [cerca, setCerca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [fasciaChiusa, setFasciaChiusa] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      setFasciaChiusa(window.localStorage.getItem(CHIAVE_FASCIA) === "1");
    } catch {
      /* senza memoria del browser la fascia resta aperta */
    }
  }, []);
  const alternaFascia = () =>
    setFasciaChiusa((c) => {
      try {
        window.localStorage.setItem(CHIAVE_FASCIA, c ? "0" : "1");
      } catch {
        /* come sopra */
      }
      return !c;
    });

  const cambia = (parte: Partial<Filtri>) => {
    setPagina(1);
    setFiltri((f) => ({ ...f, ...parte }));
  };

  const carica = useCallback(async () => {
    const sp = parametri(filtri);
    sp.set("page", String(pagina));
    sp.set("limit", String(PER_PAGINA));
    if (vista !== "servizio") sp.set("raggruppa", vista);
    const r = await fetchJson<Dati>(`/api/servizi-rete?${sp}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, [filtri, pagina, vista]);

  const primo = useRef(true);
  useEffect(() => {
    if (primo.current) {
      primo.current = false;
      return;
    }
    void carica();
  }, [carica]);

  // Mentre il giro va avanti si rilegge ogni 3 secondi: i risultati entrano man mano.
  const inCorso = dati.giro?.inCorso === true;
  useEffect(() => {
    if (!inCorso) return;
    timer.current = setInterval(() => void carica(), 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [inCorso, carica]);

  async function avvia() {
    const r = await fetchJson<{ avviato: boolean }>("/api/servizi-rete/giro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: filtri.rete?.id ?? null }),
    });
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success("Sonde avviate: i risultati compaiono man mano");
    await carica();
  }

  /** Dal gruppo all'elenco dei suoi servizi: il gruppo diventa un filtro. */
  const apriGruppo = (g: GruppoServizi) => {
    const nomeRete = reti.find((x) => x.id === g.filtro.rete)?.nome ?? g.nome;
    setVista("servizio");
    cambia({
      ...(g.filtro.porta ? { porta: g.filtro.porta } : {}),
      ...(g.filtro.prodotto ? { prodotto: g.filtro.prodotto } : {}),
      ...(g.filtro.ospite ? { ospite: { id: g.filtro.ospite, nome: g.nome } } : {}),
      ...(g.filtro.rete ? { rete: { id: g.filtro.rete, nome: nomeRete } } : {}),
    });
  };

  const giro = dati.giro;
  const n = dati.indicatori;
  const reteScelta = filtri.rete ? reti.find((x) => x.id === filtri.rete?.id) : undefined;
  const filtrata = parametri(filtri).toString() !== "";
  const proposte = identita.conteggi.proposte;

  const intestazione = (
    <IntestazionePagina
      titolo="Servizi di rete"
      sottotitolo={
        apparati
          ? "Due IP con la stessa impronta SSH o TLS si propongono come stesso apparato, da confermare."
          : `${dati.conteggi.servizi} servizi su ${dati.conteggi.host} host, ${dati.conteggi.sondati} letti dalla risposta. Cosa risponde su ogni porta aperta e come lo sappiamo.`
      }
      azioni={
        apparati ? (
          <Button size="sm" variant="outline" onClick={() => setApparati(false)}>
            <ArrowLeft className="size-4" />
            Porte e servizi
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setApparati(true)} title="Due IP con la stessa impronta, da confermare">
              Stesso apparato
              {proposte > 0 && <span className="rounded-full bg-[#0D2537] px-2 font-mono text-[13px] font-bold text-white dark:bg-primary">{proposte}</span>}
            </Button>
            {admin && (
              <Button
                size="sm"
                onClick={() => void avvia()}
                disabled={giro?.inCorso === true}
                title={giro?.inCorso ? "Un giro è già in corso" : "Banner, HTTP, TLS e SSH sulle porte già trovate, senza credenziali"}
              >
                <Radar className="size-4" />
                {reteScelta ? `Sonda ${reteScelta.cidr}` : "Sonda tutte le porte"}
              </Button>
            )}
          </>
        )
      }
    />
  );

  if (apparati) {
    return (
      <div className="space-y-4">
        {intestazione}
        <IdentitaClient iniziale={identita} admin={admin} />
      </div>
    );
  }

  const scelti: Array<{ testo: string; togli: Partial<Filtri> }> = [
    ...(filtri.segnale ? [{ testo: NOME_SEGNALE[filtri.segnale], togli: { segnale: null } }] : []),
    ...(filtri.rete ? [{ testo: `Rete ${filtri.rete.nome}`, togli: { rete: null } }] : []),
    ...(filtri.ospite ? [{ testo: `Host ${filtri.ospite.nome}`, togli: { ospite: null } }] : []),
    ...(filtri.porta ? [{ testo: `Porta ${filtri.porta}`, togli: { porta: null } }] : []),
    ...(filtri.prodotto ? [{ testo: filtri.prodotto === "(senza)" ? "Prodotto non riconosciuto" : filtri.prodotto, togli: { prodotto: null } }] : []),
    ...(filtri.q ? [{ testo: `«${filtri.q}»`, togli: { q: "" } }] : []),
  ];

  return (
    <div className="space-y-3">
      {intestazione}

      {giro?.inCorso && (
        <InCorso
          titolo={`${giro.fase === "porte" ? "Porte comuni in prova" : "Sonde in corso"}${reteScelta ? ` su ${reteScelta.cidr}` : ""}`}
          percentuale={giro.totale ? (giro.fatte / giro.totale) * 100 : 0}
          dettaglio={`${giro.fatte} di ${giro.totale} ${giro.fase === "porte" ? "prove" : "porte"}`}
        />
      )}
      {giro && !giro.inCorso && giro.errore && <LoadError what="il giro delle sonde" message={giro.errore} />}
      {dati.parziale && <LoadError what="tutti i servizi" message="Sono più di 20.000: i numeri di questa pagina sono per difetto. Restringi con un filtro." />}

      <FasciaSegnali
        chiusa={fasciaChiusa}
        onAlterna={alternaFascia}
        n={n}
        reti={dati.perRete}
        filtrata={filtrata}
        segnale={filtri.segnale}
        reteScelta={filtri.rete?.id ?? null}
        onSegnale={(s) => cambia({ segnale: filtri.segnale === s ? null : s })}
        onRete={(r) => cambia({ rete: filtri.rete?.id === r.id ? null : r })}
      />

      <Pannello
        titolo={vista === "servizio" ? "Porte e servizi" : `Per ${NOME_GRUPPO[vista].split(" ")[0].toLowerCase()}`}
        conteggio={dati.totale}
        corpoClassName="p-0"
        azioni={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-72 pl-8"
              placeholder="IP, CIDR, nome, prodotto, titolo, certificato"
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") cambia({ q: cerca.trim() });
              }}
            />
          </div>
        }
        piede={<Legenda voci={Object.entries(METODI).map(([, m]) => ({ classe: m.classe, testo: `${m.segno} ${m.testo}: ${m.spiega}` }))} />}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Raggruppa per</span>
            <div role="group" aria-label="Raggruppa per" className="inline-flex overflow-hidden rounded-lg border border-foreground/70">
              {VISTE.map(([v, nome], i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={vista === v}
                  onClick={() => { setVista(v); setPagina(1); }}
                  className={cn("h-8 px-3 text-sm", i > 0 && "border-l border-foreground/70", vista === v ? "bg-foreground font-medium text-background" : "bg-card hover:bg-muted")}
                >
                  {nome}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Come risponde" className="flex flex-wrap items-center gap-1.5">
            {TIPI.map((t) => (
              <button
                key={t.valore}
                type="button"
                aria-pressed={filtri.tipo === t.valore}
                onClick={() => cambia({ tipo: filtri.tipo === t.valore ? null : t.valore })}
                className={cn("h-8 rounded-lg border px-2.5 text-sm", filtri.tipo === t.valore ? "border-foreground bg-foreground font-medium text-background" : "bg-card hover:bg-muted")}
              >
                <span aria-hidden>{t.segno}</span> {t.testo} <span className="font-mono">{dati.perTipo[t.valore]}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={filtri.conRilievi}
              onClick={() => cambia({ conRilievi: !filtri.conRilievi })}
              className={cn("h-8 rounded-lg border px-2.5 text-sm", filtri.conRilievi ? "border-foreground bg-foreground font-medium text-background" : "bg-card hover:bg-muted")}
            >
              Solo con rilievi
            </button>
          </div>
          {scelti.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {scelti.map((s) => (
                <button
                  key={s.testo}
                  type="button"
                  onClick={() => { if ("q" in s.togli) setCerca(""); cambia(s.togli); }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-foreground/70 bg-muted px-2 text-sm"
                  title="Togli questo filtro"
                >
                  {s.testo}
                  <X className="size-3.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        {errore ? (
          <div className="p-3"><LoadError what="i servizi di rete" message={errore} onRetry={() => void carica()} /></div>
        ) : dati.totale === 0 ? (
          <Vuoto
            titolo={filtrata ? "Nessun servizio con questi filtri" : "Nessuna porta aperta finora"}
            testo={filtrata ? "Togli un filtro o cerca un'altra cosa." : "Le porte entrano qui dopo la prima scansione delle reti, poi le sonde leggono cosa rispondono."}
          />
        ) : vista !== "servizio" ? (
          <GruppiServizi per={vista} gruppi={dati.gruppi ?? []} filtri={filtri} admin={admin} onApri={apriGruppo} />
        ) : (
          <>
            <RigheServizi righe={dati.righe} admin={admin} onCambio={() => void carica()} />
            <Pagination page={pagina} totalPages={Math.max(1, Math.ceil(dati.totale / PER_PAGINA))} onPageChange={setPagina} total={dati.totale} pageSize={PER_PAGINA} />
          </>
        )}
      </Pannello>
    </div>
  );
}
