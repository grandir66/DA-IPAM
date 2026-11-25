import Link from "next/link";
import { FilaNumeri, Pannello, TempoRelativo } from "@/components/shared/console";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraProtezione, Segno, SoloAdmin } from "@/components/protezione/pezzi";
import { SoloDa } from "@/components/protezione/solo-da";
import { indirizziUtenti } from "@/lib/accesso/indirizzi-utente";
import { eAdmin } from "@/lib/permessi/ruolo";
import { ultimiAccessi } from "@/lib/protezione/utenti-accessi";
import { leggiProtezione } from "../leggi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utenti che possono entrare — DA-IPAM" };

export default async function UtentiProtezionePage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  const u = quadro.utenti;
  const admin = u.filter((x) => eAdmin(x.ruolo));
  const elenchi = indirizziUtenti();
  const accessi = ultimiAccessi();
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Utenti che possono entrare</h1>
      <BarraProtezione quadro={quadro} />
      <FilaNumeri
        voci={[
          { titolo: "Utenti", valore: u.length },
          { titolo: "Amministratori", valore: admin.length },
          { titolo: "Admin senza seconda verifica", valore: admin.filter((x) => !x.secondaVerifica).length },
          { titolo: "Con «Solo da»", valore: u.filter((x) => (elenchi[String(x.id)] ?? []).length > 0).length, aiuto: "Utenti che possono entrare solo da un elenco di indirizzi" },
        ]}
      />
      <Pannello
        titolo="Chi può entrare"
        conteggio={u.length}
        sottotitolo="«Solo da» limita gli indirizzi da cui un utente entra; NetBird/DA-Link passa sempre. Vale con le porte interne chiuse."
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
              <TableHead>Da dove</TableHead>
              <TableHead>Solo da</TableHead>
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
                <TableCell className="font-mono text-[13px]">{accessi.get(x.nome)?.ip ?? <span className="font-sans text-muted-foreground">non registrato</span>}</TableCell>
                <TableCell><SoloDa utenteId={x.id} nome={x.nome} indirizzi={elenchi[String(x.id)] ?? []} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Pannello>
    </div>
  );
}
