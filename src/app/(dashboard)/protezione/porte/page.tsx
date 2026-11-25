import { Etichetta, FilaNumeri, Pannello } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraProtezione, LEGENDA_SEGNI, NonLetto, Segno, SoloAdmin } from "@/components/protezione/pezzi";
import type { PortaPresentata } from "@/lib/protezione/porte";
import { leggiProtezione } from "../leggi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Porte presentate — DA-IPAM" };

function Raggiunge({ p }: { p: PortaPresentata }) {
  if (p.raggiunge === "macchina") return <Segno tono="vuoto" segno="○">Solo la macchina</Segno>;
  if (p.raggiunge === "netbird") return <Segno tono="vuoto" segno="◐">Solo NetBird</Segno>;
  return <Segno tono={p.gruppo === "Interna" || p.gruppo === "Non attribuita" ? "avviso" : "pieno"} segno={p.gruppo === "Interna" || p.gruppo === "Non attribuita" ? "▲" : "●"}>Tutti</Segno>;
}

export default async function PortePresentatePage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  const porte = quadro.porte;
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Porte presentate</h1>
      <BarraProtezione quadro={quadro} />
      <FilaNumeri
        voci={[
          { titolo: "Porte presentate", valore: porte?.length ?? null },
          { titolo: "Aperte a tutti", valore: porte?.filter((p) => p.raggiunge === "tutti").length ?? null },
          { titolo: "Anche in IPv6", valore: porte?.filter((p) => p.ipv6 && p.raggiunge === "tutti").length ?? null },
          { titolo: "Non attribuite", valore: porte?.filter((p) => p.gruppo === "Non attribuita").length ?? null, aiuto: "Porte in ascolto che DA-IPAM non sa di chi sono" },
        ]}
      />
      <div className="grid gap-3 xl:grid-cols-[22rem_1fr]">
        <Pannello numero={1} titolo="Schede di rete" conteggio={quadro.schede.length} sottotitolo="Gli indirizzi con cui la macchina si presenta.">
          <ul className="space-y-2">
            {quadro.schede.map((s) => (
              <li key={s.nome} className="rounded-lg border-2 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{s.nome}</span>
                  {s.netbird && <Etichetta tono="marca" mono={false}>NetBird · regole di DA-Link</Etichetta>}
                </div>
                {s.indirizzi.map((i) => (
                  <div key={i} className="font-mono text-[13px] text-muted-foreground">{i}</div>
                ))}
              </li>
            ))}
          </ul>
        </Pannello>
        <Pannello
          numero={2}
          titolo="Porte presentate"
          conteggio={porte?.length}
          sottotitolo="Cosa risponde su questa macchina e a chi. Per ora si guarda soltanto: da chi è raggiungibile si cambierà qui."
          corpoClassName="p-0"
          piede={LEGENDA_SEGNI}
        >
          {porte === null ? (
            <div className="p-3"><NonLetto cosa="Porte in ascolto" comando="ss" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Porta</TableHead>
                  <TableHead>Gruppo</TableHead>
                  <TableHead>Chi la tiene</TableHead>
                  <TableHead>Modulo</TableHead>
                  <TableHead>Ascolta su</TableHead>
                  <TableHead>Oggi la raggiunge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porte.map((p) => (
                  <TableRow key={`${p.proto}/${p.porta}`}>
                    <TableCell className="font-mono font-semibold">{p.porta}/{p.proto}</TableCell>
                    <TableCell>{p.gruppo}</TableCell>
                    <TableCell>
                      {p.tiene} {p.inContainer && <span className="text-[13px] text-muted-foreground">(container)</span>}
                    </TableCell>
                    <TableCell>{p.modulo}</TableCell>
                    <TableCell className="font-mono text-[13px]">{p.indirizzi.join("  ")}</TableCell>
                    <TableCell><Raggiunge p={p} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Pannello>
      </div>
    </div>
  );
}
