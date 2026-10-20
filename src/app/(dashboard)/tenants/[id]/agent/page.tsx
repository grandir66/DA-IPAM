import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Pagina dell'agente Python remoto del cliente: l'agente è tolto il 20/10/2026 (decisione
 * 26 della spec NetBird: nessuno lo usava). La pagina resta, ferma, per un giro: il
 * controllo dei tipi della build nuova legge anche i tipi della build ancora attiva, che
 * la citano (stessa ragione di `/api/search`, v0.9.804). Da togliere quando tutte le
 * installazioni girano con un `update.sh` che svuota quei tipi (dalla v0.9.805).
 */
export default function AgenteRemotoToltoPage() {
  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Agente remoto tolto</CardTitle>
          <CardDescription>
            L&apos;agente Python remoto non esiste più (20/10/2026): le scansioni girano su questa
            istanza. Un cliente rimasto in modalità remota non scansiona finché non torna in
            modalità locale. <Link href="/tenants" className="underline">Torna ai clienti</Link>
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
