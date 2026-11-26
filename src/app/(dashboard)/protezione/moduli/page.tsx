import { FilaNumeri, Pannello } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraProtezione, NonLetto, Segno, SoloAdmin } from "@/components/protezione/pezzi";
import { leggiProtezione } from "../leggi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moduli e container — DA-IPAM" };

export default async function ModuliContainerPage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  const c = quadro.container;
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Moduli e container</h1>
      <BarraProtezione quadro={quadro} />
      <FilaNumeri
        voci={[
          { titolo: "Container", valore: c?.length ?? null },
          { titolo: "Con porte pubblicate", valore: c?.filter((x) => x.pubblicate.length > 0).length ?? null },
          { titolo: "Sulla rete della macchina", valore: c?.filter((x) => x.rete === "host").length ?? null },
          { titolo: "Con permessi in più", valore: c?.filter((x) => x.privilegiato || x.permessi.length > 0).length ?? null },
        ]}
      />
      <Pannello
        titolo="Immagini e porte, modulo per modulo"
        conteggio={c?.length}
        sottotitolo="Le porte pubblicate rispondono alla rete; le interne solo agli altri container."
        corpoClassName="p-0"
        piede="▲ permessi in più: il container può toccare la rete della macchina. ■ privilegiato: ha i poteri pieni."
      >
        {c === null ? (
          <div className="p-3"><NonLetto cosa="Container" comando="docker" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modulo</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Immagine</TableHead>
                <TableHead>Porte pubblicate</TableHead>
                <TableHead>Solo interne</TableHead>
                <TableHead>Rete</TableHead>
                <TableHead>Permessi in più</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.map((x) => (
                <TableRow key={x.nome}>
                  <TableCell className="font-semibold">{x.modulo}</TableCell>
                  <TableCell>{x.nome}</TableCell>
                  <TableCell className="max-w-80 truncate font-mono text-[13px]" title={x.immagine}>{x.immagine}</TableCell>
                  <TableCell className="font-mono">{[...new Set(x.pubblicate.map((p) => `${p.suMacchina}/${p.proto}`))].join(" ") || "—"}</TableCell>
                  <TableCell className="font-mono">{x.interne.map((p) => `${p.porta}/${p.proto}`).join(" ") || "—"}</TableCell>
                  <TableCell>{x.rete === "host" ? <Segno tono="avviso" segno="▲">della macchina</Segno> : <span className="text-[13px] text-muted-foreground">{x.rete}</span>}</TableCell>
                  <TableCell>
                    {x.privilegiato ? <Segno tono="pieno" segno="■">privilegiato</Segno> : x.permessi.length > 0 ? <Segno tono="avviso" segno="▲">{x.permessi.join(", ")}</Segno> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
