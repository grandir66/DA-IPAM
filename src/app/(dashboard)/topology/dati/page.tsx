import { DatiClient } from "./dati-client";

export default function DatiMappaPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Dati della mappa</h1>
      <DatiClient />
    </div>
  );
}
