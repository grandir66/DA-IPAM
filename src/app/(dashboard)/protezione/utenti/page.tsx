import Link from "next/link";
import { FilaNumeri, Pannello, TempoRelativo } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraProtezione, Segno, SoloAdmin } from "@/components/protezione/pezzi";
import { eAdmin } from "@/lib/permessi/ruolo";
import { leggiProtezione } from "../leggi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utenti che possono entrare — DA-IPAM" };

export default async function UtentiProtezionePage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  const u = quadro.utenti;
  const admin = u.filter((x) => eAdmin(x.ruolo));
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Utenti che possono entrare</h1>
      <BarraProtezione quadro={quadro} />
      <FilaNumeri
        voci={[
          { titolo: "Utenti", valore: u.length },
          { titolo: "Amministratori", valore: admin.length },
          { titolo: "Admin senza seconda verifica", valore: admin.filter((x) => !x.secondaVerifica).length },
          { titolo: "Mai entrati", valore: u.filter((x) => !x.ultimoAccesso).length },
        ]}
      />
      <Pannello
        titolo="Chi può entrare"
        conteggio={u.length}
        sottotitolo="Da dove entra ognuno non è ancora registrato: arriva con gli avvisi sui tentativi."
        corpoClassName="p-0"
        azioni={
          <Link href="/settings?tab=utenti" className="inline-flex h-9 items-center rounded-lg border-2 border-foreground/60 px-3 text-sm font-semibold hover:bg-muted">
            Gestisci utenti (Impostazioni › Utenti)
          </Link>
        }
        piede="Creare un utente, cambiare ruolo e password si fa in Impostazioni › Utenti: un posto solo."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utente</TableHead>
              <TableHead>Ruolo</TableHead>
              <TableHead>Seconda verifica</TableHead>
              <TableHead>Ultimo accesso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {u.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="font-semibold">{x.nome}</TableCell>
                <TableCell>{x.ruolo}</TableCell>
                <TableCell>
                  {x.secondaVerifica ? <Segno tono="vuoto" segno="○">accesa</Segno> : eAdmin(x.ruolo) ? <Segno tono="avviso" segno="▲">spenta</Segno> : <Segno tono="vuoto" segno="–">spenta</Segno>}
                </TableCell>
                <TableCell>{x.ultimoAccesso ? <TempoRelativo data={x.ultimoAccesso} /> : <span className="text-muted-foreground">mai</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Pannello>
    </div>
  );
}
