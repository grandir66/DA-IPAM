import { auth } from "@/lib/auth";
import { SoloAdmin } from "@/components/protezione/pezzi";
import { eAdmin } from "@/lib/permessi/ruolo";
import { contattiEsche } from "@/lib/protezione/tentativi";
import { EscheClient } from "./esche-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Esche — DA-IPAM" };

export default async function EschePage() {
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  if (!eAdmin(ruolo)) return <SoloAdmin />;
  const contatti = contattiEsche();
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Esche</h1>
      <EscheClient contatti={contatti} />
    </div>
  );
}
