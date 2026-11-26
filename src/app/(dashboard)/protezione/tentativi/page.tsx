import { auth } from "@/lib/auth";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant, getNomiHostPerIp } from "@/lib/db-tenant";
import { FilaNumeri, Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AzioniBlocco } from "@/components/protezione/azioni-blocco";
import { Segno, SoloAdmin } from "@/components/protezione/pezzi";
import { inElenco } from "@/lib/protezione/anteprima";
import { DURATE_BLOCCO } from "@/lib/protezione/blocco";
import { bloccati as leggiBloccatiOra } from "@/lib/protezione/esecutore";
import { maiBloccati } from "@/lib/protezione/mai-bloccati";
import { getNotificationConfig } from "@/lib/notifications/config";
import { eAdmin } from "@/lib/permessi/ruolo";
import { indirizziNostri } from "@/lib/protezione/tentativi-job";
import { FINESTRA_MS, NOME_FONTE, SOGLIA, aggrega, leggiTentativi } from "@/lib/protezione/tentativi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tentativi di accesso — DA-IPAM" };

const GIORNI = 7;

export default async function TentativiPage() {
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  if (!eAdmin(ruolo)) return <SoloAdmin />;
  const adesso = new Date();
  const tentativi = leggiTentativi(GIORNI, adesso);
  const righe = aggrega(tentativi).slice(0, 300);
  const nostri = indirizziNostri();
  const daDieci = new Date(adesso.getTime() - FINESTRA_MS).toISOString();
  const caldi = new Set(
    aggrega(tentativi.filter((t) => t.il >= daDieci))
      .filter((a) => (a.fonte === "filtro" ? a.porte.length : a.quanti) >= SOGLIA[a.fonte])
      .map((a) => `${a.fonte}|${a.indirizzo ?? ""}`),
  );
  let nomi = new Map<string, string | null>();
  try {
    const tenant = await getServerTenantCode();
    nomi = new Map(withTenant(tenant, () => getNomiHostPerIp([...new Set(righe.map((r) => r.indirizzo).filter((x): x is string => Boolean(x)))])).map((h) => [h.ip, h.nome]));
  } catch (e) {
    console.error("[protezione] nomi degli host non letti:", e);
  }
  const notifiche = getNotificationConfig();
  const canali = notifiche.enabled ? [notifiche.smtpEnabled ? "email" : null, notifiche.webhookEnabled ? "webhook" : null].filter(Boolean).join(" + ") : "";
  const oggi = adesso.toISOString().slice(0, 10);
  const bloccatiOra = await leggiBloccatiOra();
  const bloccato = new Set(bloccatiOra.map((b) => b.indirizzo));
  const mai = maiBloccati();
  const durate = Object.keys(DURATE_BLOCCO);
  const tempo = (s: number | null): string => (s === null ? "" : s >= 86400 ? `${Math.round(s / 86400)} g` : s >= 3600 ? `${Math.round(s / 3600)} h` : `${Math.max(1, Math.round(s / 60))} min`);

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Tentativi di accesso</h1>
      <FilaNumeri
        voci={[
          { titolo: "Tentativi (7 giorni)", valore: tentativi.length },
          { titolo: "Oggi", valore: tentativi.filter((t) => t.il.startsWith(oggi)).length },
          { titolo: "Bloccati adesso", valore: bloccatiOra.length },
          { titolo: "Sopra soglia adesso", valore: caldi.size, aiuto: "Chi negli ultimi 10 minuti ha superato la soglia di avviso" },
        ]}
      />
      {(bloccatiOra.length > 0 || mai.length > 0) && (
        <div className="grid gap-3 xl:grid-cols-2">
          <Pannello titolo="Bloccati adesso" conteggio={bloccatiOra.length} sottotitolo="Tutto ciò che arriva da questi indirizzi viene scartato fino alla scadenza. Un riavvio della macchina li libera.">
            {bloccatiOra.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
              <ul className="space-y-1.5">
                {bloccatiOra.map((b) => (
                  <li key={b.indirizzo} className="flex flex-wrap items-center justify-between gap-2">
                    <span><Segno tono="pieno" segno="■">{b.indirizzo}</Segno> <span className="text-[13px] text-muted-foreground">{b.restano !== null ? `ancora ${tempo(b.restano)}` : ""}</span></span>
                    <AzioniBlocco indirizzo={b.indirizzo} bloccato mai={false} durate={durate} />
                  </li>
                ))}
              </ul>
            )}
          </Pannello>
          <Pannello titolo="Mai bloccati" conteggio={mai.length} sottotitolo="Oltre a NetBird/DA-Link, a questa macchina e ai «sempre ammessi» del filtro.">
            {mai.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
              <ul className="space-y-1.5">
                {mai.map((m) => (
                  <li key={m} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono">{m}</span>
                    <AzioniBlocco indirizzo={m} bloccato={false} mai durate={durate} />
                  </li>
                ))}
              </ul>
            )}
          </Pannello>
        </div>
      )}
      <Pannello
        titolo="Chi ha provato a entrare"
        conteggio={righe.length}
        sottotitolo="Una riga per strada e indirizzo, negli ultimi 7 giorni. Mai una password: solo il nome provato."
        corpoClassName="p-0"
        piede={`Avviso quando in 10 minuti: ${SOGLIA.pagina} login falliti · ${SOGLIA.ssh} tentativi SSH · ${SOGLIA.filtro} porte diverse scartate dal filtro · ${SOGLIA.esca} contatti con le esche. Il blocco lo decide una persona. Avvisi: ${canali || "spenti (si accendono in Impostazioni › Notifiche)"}.`}
      >
        {righe.length === 0 ? (
          <div className="p-3">
            <Vuoto titolo="Nessun tentativo negli ultimi 7 giorni" testo="Qui compaiono i login falliti della pagina, i tentativi su SSH e, a filtro acceso, gli indirizzi scartati. La raccolta gira ogni due minuti." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indirizzo</TableHead>
                <TableHead>In inventario</TableHead>
                <TableHead>Strada</TableHead>
                <TableHead>Tentativi</TableHead>
                <TableHead>Nomi provati</TableHead>
                <TableHead>Porte</TableHead>
                <TableHead>Primo</TableHead>
                <TableHead>Ultimo</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((r) => {
                const nostro = r.indirizzo !== null && nostri.has(r.indirizzo);
                const nome = r.indirizzo ? nomi.get(r.indirizzo) : undefined;
                return (
                  <TableRow key={`${r.fonte}|${r.indirizzo ?? ""}`}>
                    <TableCell className="font-mono">{r.indirizzo ?? <span className="font-sans text-muted-foreground">non noto</span>}</TableCell>
                    <TableCell>{nostro ? "questa macchina" : nome !== undefined ? nome ?? "sì, senza nome" : <span className="text-muted-foreground">sconosciuto</span>}</TableCell>
                    <TableCell>{NOME_FONTE[r.fonte]}</TableCell>
                    <TableCell className="font-mono font-semibold">{r.quanti}</TableCell>
                    <TableCell className="font-mono text-[13px]">{r.utenti.join(", ") || "—"}</TableCell>
                    <TableCell className="font-mono text-[13px]">{r.porte.slice(0, 8).join(" ") || "—"}{r.porte.length > 8 ? " …" : ""}</TableCell>
                    <TableCell><TempoRelativo data={r.primo} /></TableCell>
                    <TableCell><TempoRelativo data={r.ultimo} /></TableCell>
                    <TableCell>
                      {nostro ? <Segno tono="vuoto" segno="●">nostro, non conta</Segno> : r.indirizzo && bloccato.has(r.indirizzo) ? <Segno tono="pieno" segno="■">bloccato</Segno> : caldi.has(`${r.fonte}|${r.indirizzo ?? ""}`) ? <Segno tono="avviso" segno="▲">sopra soglia</Segno> : <Segno tono="vuoto" segno="○">sotto soglia</Segno>}
                    </TableCell>
                    <TableCell>
                      {r.indirizzo && !nostro && <AzioniBlocco indirizzo={r.indirizzo} bloccato={bloccato.has(r.indirizzo)} mai={inElenco(r.indirizzo, mai)} durate={durate} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
