import Link from "next/link";
import { FilaNumeri, Pannello } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraProtezione, NonLetto, Segno, SoloAdmin } from "@/components/protezione/pezzi";
import { leggiProtezione } from "../leggi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sistemi remoti — DA-IPAM" };

export default async function SistemiRemotiPage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  const s = quadro.sistemi;
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Sistemi remoti</h1>
      <BarraProtezione quadro={quadro} />
      <FilaNumeri
        voci={[
          { titolo: "Collegati adesso", valore: s ? new Set(s.map((x) => x.indirizzo)).size : null },
          { titolo: "Entrano", valore: s?.filter((x) => x.verso === "entra").length ?? null },
          { titolo: "Escono", valore: s?.filter((x) => x.verso === "esce").length ?? null },
          { titolo: "Non riconosciuti", valore: s?.filter((x) => x.nome === null).length ?? null, aiuto: "Indirizzi che non sono in inventario né su NetBird" },
        ]}
      />
      <Pannello
        titolo="Chi ci parla e a chi parliamo"
        conteggio={s?.length}
        sottotitolo="Le connessioni aperte in questo momento: una fotografia, chi parla ogni tanto può non esserci."
        corpoClassName="p-0"
        azioni={
          <Link href="/settings/cosa-esce" className="inline-flex h-9 items-center rounded-lg border-2 border-foreground/60 px-3 text-sm font-semibold hover:bg-muted">
            Cosa esce verso Domarc
          </Link>
        }
        piede="● riconosciuto · ▲ non riconosciuto: non è in inventario e non arriva da NetBird."
      >
        {s === null ? (
          <div className="p-3"><NonLetto cosa="Connessioni aperte" comando="ss" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sistema</TableHead>
                <TableHead>Verso</TableHead>
                <TableHead>Indirizzo</TableHead>
                <TableHead>Porta</TableHead>
                <TableHead>Connessioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.map((x) => (
                <TableRow key={`${x.indirizzo}-${x.verso}-${x.porta}`}>
                  <TableCell>{x.nome ? <span className="font-semibold">● {x.nome}</span> : <Segno tono="avviso" segno="▲">Non riconosciuto</Segno>}</TableCell>
                  <TableCell>{x.verso === "entra" ? "← entra" : "→ esce"}</TableCell>
                  <TableCell className="font-mono">{x.indirizzo}</TableCell>
                  <TableCell className="font-mono">{x.porta}</TableCell>
                  <TableCell className="font-mono">{x.connessioni}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
