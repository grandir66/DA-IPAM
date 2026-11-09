"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Radar, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { DatoDettaglio, Etichetta, InCorso, Legenda, Pannello, TempoRelativo, TesseraNumero, Vuoto } from "@/components/shared/console";
import { BottoneCopia } from "@/components/shared/copia";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";
import type { ConteggiServiziRete, ServizioRete } from "@/lib/servizi-rete/db";
import type { StatoGiro } from "@/lib/servizi-rete/giro";
import type { InfoHttp, InfoNtlm, InfoSsh, InfoTls } from "@/lib/servizi-rete/sonde";

interface Dati {
  righe: ServizioRete[];
  totale: number;
  conteggi: ConteggiServiziRete;
  giro: StatoGiro | null;
}

interface Rete {
  id: number;
  nome: string;
  cidr: string;
}

const PER_PAGINA = 100;

/** Come è stato riconosciuto: segno + parola, mai il solo colore (Riccardo è daltonico). */
const METODI: Record<string, { segno: string; testo: string; classe: string; spiega: string }> = {
  "tls-http": { segno: "◆", testo: "TLS + HTTP", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "stretta di mano TLS e risposta HTTP lette" },
  tls: { segno: "◆", testo: "TLS", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "stretta di mano TLS letta" },
  http: { segno: "●", testo: "HTTP", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "risposta HTTP letta" },
  ssh: { segno: "■", testo: "SSH", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "versione e algoritmi SSH letti" },
  ntlm: { segno: "◇", testo: "NTLM", classe: "border-primary/40 bg-primary/10 text-cian-testo", spiega: "nome e dominio dalla CHALLENGE NTLM, senza autenticarsi" },
  banner: { segno: "▲", testo: "banner", classe: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]", spiega: "il servizio si presenta da solo" },
  silenzio: { segno: "○", testo: "tace", classe: "border-border bg-muted text-muted-foreground", spiega: "aperta, ma non risponde alle sonde" },
  aperta: { segno: "–", testo: "aperta", classe: "border-dashed border-border bg-transparent text-muted-foreground", spiega: "trovata aperta dal giro leggero, non ancora sondata" },
  nmap: { segno: "–", testo: "solo nmap", classe: "border-dashed border-border bg-transparent text-muted-foreground", spiega: "nome dalla scansione, non ancora sondata" },
};

const TIPI: Array<{ valore: string; testo: string }> = [
  { valore: "", testo: "Tutti i servizi" },
  { valore: "http", testo: "Con risposta HTTP" },
  { valore: "tls", testo: "Con certificato TLS" },
  { valore: "ssh", testo: "SSH" },
  { valore: "ntlm", testo: "Con nome Windows" },
  { valore: "banner", testo: "Con banner" },
  { valore: "silenzio", testo: "Aperte ma mute" },
  { valore: "da-sondare", testo: "Non ancora sondate" },
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
          <DatoDettaglio nome="Letto da" valore={ntlm.fonte === "http" ? "HTTP" : "SMB"} />
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

export function ServiziReteClient({ iniziale, admin }: { iniziale: Dati & { reti: Rete[] }; admin: boolean }) {
  const [dati, setDati] = useState<Dati>(iniziale);
  const [errore, setErrore] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [cerca, setCerca] = useState("");
  const [q, setQ] = useState("");
  const [rete, setRete] = useState("");
  const [tipo, setTipo] = useState("");
  const [porta, setPorta] = useState("");
  const [aperte, setAperte] = useState<Set<number>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const carica = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(pagina), limit: String(PER_PAGINA) });
    if (q) sp.set("q", q);
    if (rete) sp.set("network_id", rete);
    if (tipo) sp.set("tipo", tipo);
    if (porta) sp.set("porta", porta);
    const r = await fetchJson<Dati>(`/api/servizi-rete?${sp}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, [pagina, q, rete, tipo, porta]);

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
      body: JSON.stringify({ network_id: rete ? Number(rete) : null }),
    });
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success("Sonde avviate: i risultati compaiono man mano");
    await carica();
  }

  const apriChiudi = (id: number) =>
    setAperte((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const c = dati.conteggi;
  const reteScelta = iniziale.reti.find((x) => String(x.id) === rete);
  const giro = dati.giro;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Servizi" valore={c.servizi} qualifica={`su ${c.host} host`} nota="porte aperte trovate dalle scansioni" />
        <TesseraNumero titolo="Sondati" valore={c.sondati} qualifica={c.servizi ? `${Math.round((c.sondati / c.servizi) * 100)}%` : undefined} nota="letti dalla risposta, non dalla tabella delle porte" />
        <TesseraNumero titolo="Risposte HTTP" valore={c.conHttp} nota="stato, titolo, server, intestazioni" />
        <TesseraNumero titolo="Certificati TLS" valore={c.conTls} nota="intestatario, emittente, scadenza" />
      </div>

      {giro?.inCorso && (
        <InCorso
          titolo={`${giro.fase === "porte" ? "Porte comuni in prova" : "Sonde in corso"}${reteScelta ? ` su ${reteScelta.cidr}` : ""}`}
          percentuale={giro.totale ? (giro.fatte / giro.totale) * 100 : 0}
          dettaglio={`${giro.fatte} di ${giro.totale} ${giro.fase === "porte" ? "prove" : "porte"}`}
        />
      )}
      {giro && !giro.inCorso && giro.errore && <LoadError what="il giro delle sonde" message={giro.errore} />}

      <Pannello
        titolo="Porte e servizi"
        conteggio={dati.totale}
        sottotitolo="Apri una riga per banner, risposta HTTP, certificato e algoritmi SSH"
        azioni={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-56 pl-8 sm:w-64"
                placeholder="Cerca IP, nome, prodotto, titolo, certificato"
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPagina(1);
                    setQ(cerca.trim());
                  }
                }}
              />
            </div>
            <Input
              className="w-24 font-mono"
              placeholder="Porta"
              inputMode="numeric"
              value={porta}
              onChange={(e) => {
                setPagina(1);
                setPorta(e.target.value.replace(/\D/g, "").slice(0, 5));
              }}
            />
            <Select value={rete} onValueChange={(v) => { setPagina(1); setRete(v ?? ""); }}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Tutte le reti" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tutte le reti</SelectItem>
                {iniziale.reti.map((n) => (
                  <SelectItem key={n.id} value={String(n.id)}>
                    {n.nome} · {n.cidr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tipo} onValueChange={(v) => { setPagina(1); setTipo(v ?? ""); }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Tutti i servizi" />
              </SelectTrigger>
              <SelectContent>
                {TIPI.map((t) => (
                  <SelectItem key={t.valore} value={t.valore}>
                    {t.testo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        }
        piede={<Legenda voci={Object.entries(METODI).map(([, m]) => ({ classe: m.classe, testo: `${m.segno} ${m.testo}: ${m.spiega}` }))} />}
      >
        {errore ? (
          <LoadError what="i servizi di rete" message={errore} onRetry={() => void carica()} />
        ) : dati.righe.length === 0 ? (
          <Vuoto
            titolo={q || rete || tipo || porta ? "Nessun servizio con questi filtri" : "Nessuna porta aperta finora"}
            testo={q || rete || tipo || porta ? "Togli un filtro o cerca un'altra cosa." : "Le porte entrano qui dopo la prima scansione delle reti, poi le sonde leggono cosa rispondono."}
          />
        ) : (
          <>
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
                  <TableHead>Rete</TableHead>
                  <TableHead>Ultima vista</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dati.righe.map((r) => {
                  const aperta = aperte.has(r.id);
                  const tls = r.tls_json !== null;
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
                            {tls && <Etichetta tono="marca">TLS</Etichetta>}
                          </span>
                        </TableCell>
                        <TableCell>{[r.prodotto, r.versione].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="max-w-[28rem] truncate" title={riassunto(r)}>{riassunto(r)}</TableCell>
                        <TableCell><Metodo metodo={r.metodo} /></TableCell>
                        <TableCell className="text-[13px]">{r.rete ?? "—"}</TableCell>
                        <TableCell className="text-[13px]"><TempoRelativo data={r.ultimo_visto} /></TableCell>
                      </TableRow>
                      {aperta && (
                        <TableRow>
                          <TableCell colSpan={9} className="p-0">
                            <DettaglioServizio r={r} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination page={pagina} totalPages={Math.max(1, Math.ceil(dati.totale / PER_PAGINA))} onPageChange={setPagina} total={dati.totale} pageSize={PER_PAGINA} />
          </>
        )}
      </Pannello>
    </div>
  );
}
