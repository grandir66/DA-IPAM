import Link from "next/link";
import { BadgeGravita, FilaNumeri, Pannello } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraProtezione, Segno, SoloAdmin } from "@/components/protezione/pezzi";
import { NON_CONTROLLATI, type RigaStato } from "@/lib/protezione/stato";
import { leggiProtezione } from "./leggi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stato della protezione — DA-IPAM" };

const GRAVITA = { alta: "high", media: "medium", bassa: "low" } as const;

function Esito({ r }: { r: RigaStato }) {
  if (r.esito === "a_posto") return <Segno tono="vuoto" segno="○">{r.stato}</Segno>;
  if (r.esito === "non_so") return <Segno tono="vuoto" segno="?">{r.stato}</Segno>;
  return <Segno tono={r.gravita === "alta" ? "pieno" : "avviso"} segno={r.gravita === "alta" ? "■" : "▲"}>{r.stato}</Segno>;
}

export default async function StatoProtezionePage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  const conta = (e: RigaStato["esito"]) => quadro.stato.filter((r) => r.esito === e).length;
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Stato della protezione</h1>
      <BarraProtezione quadro={quadro} />
      <FilaNumeri
        voci={[
          { titolo: "Da sistemare", valore: conta("da_sistemare"), qualifica: `${quadro.stato.filter((r) => r.gravita === "alta").length} gravi` },
          { titolo: "A posto", valore: conta("a_posto") },
          { titolo: "Non letti", valore: conta("non_so"), aiuto: "Controlli che su questa macchina non si sono potuti fare" },
          { titolo: "Porte aperte a tutti", valore: quadro.porte?.filter((p) => p.raggiunge === "tutti").length ?? null },
        ]}
      />
      <Pannello
        titolo="Cosa è chiuso e cosa resta debole"
        conteggio={quadro.stato.length}
        sottotitolo="Ogni riga è calcolata su questa macchina adesso. Mai un valore segreto a schermo."
        corpoClassName="p-0"
        piede={`Non ancora controllati da questa pagina: ${NON_CONTROLLATI.join(" · ")}.`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Strato</TableHead>
              <TableHead className="w-60">Stato</TableHead>
              <TableHead>Cosa vuol dire</TableHead>
              <TableHead className="w-28">Gravità</TableHead>
              <TableHead className="w-96">Rimedio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quadro.stato.map((r) => (
              <TableRow key={r.chiave}>
                <TableCell className="font-semibold">{r.strato}</TableCell>
                <TableCell><Esito r={r} /></TableCell>
                <TableCell className="whitespace-normal">{r.parole}</TableCell>
                <TableCell>{r.gravita ? <BadgeGravita gravita={GRAVITA[r.gravita]} /> : "—"}</TableCell>
                <TableCell className="whitespace-normal text-[13px]">
                  {r.rimedio?.href ? (
                    <Link href={r.rimedio.href} className="inline-flex h-9 items-center rounded-lg border-2 border-foreground/60 px-3 font-semibold hover:bg-muted">
                      {r.rimedio.testo}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{r.rimedio?.testo ?? ""}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Pannello>
    </div>
  );
}
