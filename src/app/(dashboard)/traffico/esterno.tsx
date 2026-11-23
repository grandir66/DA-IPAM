"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { Pannello, TempoRelativo, TesseraNumero, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte, nomePaese, protoPorta } from "@/lib/traffico/frasi";
import type { EsternoTraffico, Per, RigaVista, Servizio } from "@/lib/traffico/esterno";
import { Indirizzo } from "./pezzi";
import { DaiUnNome } from "./reti-viste";

const PERIODI: { giorni: number; testo: string }[] = [
  { giorni: 1, testo: "Oggi" },
  { giorni: 7, testo: "7 giorni" },
  { giorni: 30, testo: "30 giorni" },
];
const NOME_PER: Record<Per, string> = { destinazione: "Per destinazione", paese: "Per paese", fornitore: "Per fornitore", host: "Per host" };
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const numero = (n: number): string => n.toLocaleString("it-IT");

function Servizi({ servizi }: { servizi: Servizio[] }) {
  if (servizi.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {servizi.map((s) => (
        <span key={`${s.proto}/${s.porta}`} className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[13px]" title={formattaByte(s.byte)}>{protoPorta(s.proto, s.porta)}</span>
      ))}
    </span>
  );
}

function Volume({ r }: { r: RigaVista }) {
  return (
    <>
      <span className="block font-mono tabular-nums">{formattaByte(r.byte)}</span>
      {r.byte_dentro > 0 && <span className="block text-[13px] text-muted-foreground">di cui {formattaByte(r.byte_dentro)} aperti da fuori</span>}
    </>
  );
}

const Trattino = () => <span className="text-muted-foreground">—</span>;

/** Con chi fuori parlano gli host: per destinazione, paese, fornitore o host. */
export function Esterno({ admin }: { admin: boolean }) {
  const [dati, setDati] = useState<EsternoTraffico | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorni, setGiorni] = useState(1);
  const [per, setPer] = useState<Per>("destinazione");
  const [cerca, setCerca] = useState("");
  const [scritto, setScritto] = useState("");
  const [pagina, setPagina] = useState(1);
  const [daNominare, setDaNominare] = useState<RigaVista | null>(null);
  const [scarico, setScarico] = useState(false);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ giorni: String(giorni), per, pagina: String(pagina) });
    if (cerca) q.set("cerca", cerca);
    const r = await fetchJson<EsternoTraffico>(`/api/traffico/esterno?${q.toString()}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [giorni, per, cerca, pagina]);

  useEffect(() => { void carica(); }, [carica]);

  const cambia = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };
  const cercaOra = (e: FormEvent) => { e.preventDefault(); setCerca(scritto.trim()); setPagina(1); };
  const scarica = async () => {
    setScarico(true);
    const r = await fetchJson<{ presente: boolean }>("/api/traffico/geo", { method: "POST" });
    setScarico(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success("Archivio dei paesi scaricato");
    await carica();
  };

  const t = dati?.tessere;
  const archivio = dati?.archivio;
  const pagine = dati ? Math.max(1, Math.ceil(dati.totale / dati.perPagina)) : 1;
  const meseArchivio = archivio?.mese ? `${MESI[Number(archivio.mese.slice(5, 7)) - 1] ?? ""} ${archivio.mese.slice(0, 4)}` : "";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <TesseraNumero titolo="Destinazioni" valore={t?.destinazioni ?? null} nota="indirizzi esterni con cui si è parlato" />
        <TesseraNumero titolo="Paesi" valore={archivio?.presente ? t?.paesi ?? null : null} nota={archivio && !archivio.presente ? "serve l'archivio dei paesi" : "dove stanno quegli indirizzi"} />
        <TesseraNumero titolo="Fornitori" valore={archivio?.presente ? t?.fornitori ?? null : null} nota={archivio && !archivio.presente ? "serve l'archivio dei paesi" : "le reti che li ospitano"} />
        <TesseraNumero titolo="Volume" valore={t ? formattaByte(t.byte) : null} nota={t ? `${numero(t.host)} host interni` : undefined} />
      </div>

      {archivio && !archivio.presente && (
        <Vuoto
          titolo="Archivio dei paesi non scaricato"
          testo="Senza archivio le destinazioni si vedono lo stesso, ma senza paese e fornitore. Si scarica il file intero da db-ip.com e si cerca qui: nessun indirizzo esce dall'installazione."
          azione={admin ? <Button size="sm" disabled={scarico} onClick={() => void scarica()}>{scarico ? "Scarico…" : "Scarica l'archivio"}</Button> : undefined}
        />
      )}

      <Pannello
        titolo="Verso l'esterno"
        conteggio={dati?.totale}
        sottotitolo={
          per === "destinazione" ? "Una riga per indirizzo esterno, i più pesanti in alto."
            : per === "paese" ? "Una riga per paese."
              : per === "fornitore" ? "Una riga per fornitore: la rete che ospita quegli indirizzi."
                : "Una riga per host interno: con quante destinazioni parla."
        }
        corpoClassName="p-0"
        azioni={
          <>
            {PERIODI.map((p) => (
              <Button key={p.giorni} size="sm" variant={giorni === p.giorni ? "default" : "outline"} onClick={() => cambia(setGiorni)(p.giorni)}>{p.testo}</Button>
            ))}
            <span aria-hidden className="h-6 w-px bg-border" />
            {(Object.keys(NOME_PER) as Per[]).map((v) => (
              <Button key={v} size="sm" variant={per === v ? "default" : "outline"} onClick={() => cambia(setPer)(v)}>{NOME_PER[v]}</Button>
            ))}
            <span aria-hidden className="h-6 w-px bg-border" />
            <form onSubmit={cercaOra} className="flex items-center gap-1.5">
              <Input value={scritto} onChange={(e) => setScritto(e.target.value)} placeholder="Nome, indirizzo, paese, fornitore" aria-label="Cerca un nome, un indirizzo, un paese o un fornitore" className="h-7 w-56" />
              <Button type="submit" size="sm" variant="outline">Cerca</Button>
              {cerca && <Button type="button" size="sm" variant="outline" onClick={() => { setCerca(""); setScritto(""); setPagina(1); }}>Togli</Button>}
            </form>
            <Pagination inTesta page={pagina} totalPages={pagine} onPageChange={setPagina} total={dati?.totale ?? 0} />
          </>
        }
        piede={!archivio?.presente && !dati?.troncato ? undefined : (
          <>
            {archivio?.presente && (
              <span>Paese e fornitore: <a href={archivio.attribuzione_url} target="_blank" rel="noreferrer" className="font-semibold text-cian-testo underline-offset-2 hover:underline">{archivio.attribuzione}</a>, archivio di {meseArchivio}.{" "}
                {admin && <button type="button" className="font-semibold text-cian-testo underline-offset-2 hover:underline" disabled={scarico} onClick={() => void scarica()}>{scarico ? "Scarico…" : "Scarica quello nuovo"}</button>}
              </span>
            )}
            {dati?.troncato && <span className="block">Le righe del periodo sono moltissime: i numeri sono calcolati sulle 100.000 più pesanti.</span>}
          </>
        )}
      >
        {dati?.altri && (
          <div className="flex items-center gap-2 border-b border-[#C9A800] bg-[#FFD400] px-3.5 py-2 text-sm font-semibold text-[#0D2537]" role="status">
            <span aria-hidden>▲</span>
            <span>
              {numero(dati.altri.host)} host hanno superato i 50 indirizzi per finestra: {formattaByte(dati.altri.byte)} verso altri indirizzi restano senza nome
              (fino a {numero(dati.altri.indirizzi)} in una finestra).
            </span>
          </div>
        )}
        {errore !== null ? (
          <div className="p-3"><LoadError what="le destinazioni esterne" message={errore} onRetry={() => void carica()} /></div>
        ) : dati === null ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">Carico le destinazioni…</p>
        ) : dati.totale === 0 ? (
          <div className="p-3">
            <Vuoto titolo={cerca ? "Niente con questa ricerca" : "Nessuna destinazione esterna nel periodo"} testo="Le destinazioni arrivano dai collector aggiornati: uno non ancora aggiornato conta il traffico verso fuori ma non dice verso chi." />
          </div>
        ) : per === "destinazione" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destinazione</TableHead><TableHead>Paese</TableHead><TableHead>Fornitore</TableHead>
                <TableHead className="text-right">Host interni</TableHead><TableHead className="text-right">Volume</TableHead>
                <TableHead>Servizi principali</TableHead><TableHead>Ultima volta</TableHead>
                {admin && <TableHead className="text-right">Nome</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.righe.map((r) => (
                <TableRow key={r.chiave}>
                  <TableCell className="max-w-sm whitespace-normal">
                    {r.nome && <span className="block font-semibold">{r.nome}{r.a_mano && <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">nome dato a mano</span>}</span>}
                    <span className={r.nome ? "font-mono text-[13px] text-muted-foreground" : "font-mono font-semibold"}>{r.chiave}</span>
                  </TableCell>
                  <TableCell>{r.paese ? <>{nomePaese(r.paese)} <span className="font-mono text-[13px] text-muted-foreground">{r.paese}</span></> : <Trattino />}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">{r.fornitore ?? <Trattino />}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.host}</TableCell>
                  <TableCell className="text-right"><Volume r={r} /></TableCell>
                  <TableCell><Servizi servizi={r.servizi} /></TableCell>
                  <TableCell><TempoRelativo data={r.ultima_vista} /></TableCell>
                  {admin && (
                    <TableCell className="text-right">
                      {r.chiave.includes(":") ? <Trattino /> : <Button size="sm" variant="outline" onClick={() => setDaNominare(r)}>{r.a_mano ? "Cambia nome" : "Dai un nome"}</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : per === "host" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead><TableHead className="text-right">Destinazioni</TableHead><TableHead className="text-right">Volume</TableHead>
                <TableHead>Servizi principali</TableHead><TableHead>Ultima volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.righe.map((r) => (
                <TableRow key={r.chiave}>
                  <TableCell><Indirizzo ip={r.chiave} nomi={dati.nomi_host} /></TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.destinazioni}</TableCell>
                  <TableCell className="text-right"><Volume r={r} /></TableCell>
                  <TableCell><Servizi servizi={r.servizi} /></TableCell>
                  <TableCell><TempoRelativo data={r.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{per === "paese" ? "Paese" : "Fornitore"}</TableHead>
                <TableHead className="text-right">Destinazioni</TableHead><TableHead className="text-right">Host interni</TableHead>
                <TableHead className="text-right">Volume</TableHead><TableHead>Servizi principali</TableHead><TableHead>Ultima volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.righe.map((r) => (
                <TableRow key={r.chiave || "ignoto"}>
                  <TableCell className="max-w-sm whitespace-normal">
                    {r.chiave === "" ? <span className="text-muted-foreground">{per === "paese" ? "Paese non noto" : "Fornitore non noto"}</span>
                      : per === "paese" ? <><span className="font-semibold">{nomePaese(r.chiave)}</span> <span className="font-mono text-[13px] text-muted-foreground">{r.chiave}</span></>
                        : <><span className="block font-semibold">{r.nome ?? "Senza nome"}</span><span className="font-mono text-[13px] text-muted-foreground">AS{r.chiave}</span></>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.destinazioni}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.host}</TableCell>
                  <TableCell className="text-right"><Volume r={r} /></TableCell>
                  <TableCell><Servizi servizi={r.servizi} /></TableCell>
                  <TableCell><TempoRelativo data={r.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
      {daNominare && (
        <DaiUnNome
          rete={{ chiave: `${daNominare.chiave}/32`, nome: daNominare.a_mano ? daNominare.nome : null, nota: "" }}
          onChiudi={() => setDaNominare(null)}
          onFatto={() => { setDaNominare(null); void carica(); }}
        />
      )}
    </div>
  );
}
