/**
 * GET/POST /api/eset — i dati ESET letti da DA-Link per il cliente in sessione (17/11/2026).
 *
 * GET: se la lettura è accesa, l'ultimo giro, quante macchine e l'elenco di quelle «da abbinare»
 * (viste da ESET ma non agganciate a un host: finché restano lì non danno rilievi né software).
 * POST (solo amministratore): accendere o spegnere la lettura per il cliente, leggere adesso,
 * agganciare a mano una macchina a un host o dichiarare che non è fra gli host.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { assicuraSchemaEset, esetDaDalinkAcceso, impostaEsetDaDalink } from "@/lib/integrations/eset-dalink";
import { abbinaAMano, riabbinaEset, togliAbbinamentoAMano } from "@/lib/integrations/eset-abbina";
import { leggiEsetAdesso } from "@/lib/integrations/eset-dalink-job";

const MOTIVI: Record<string, string> = {
  nessuno: "nessun host con lo stesso MAC, seriale o nome",
  ambiguo: "più di un host possibile",
  mano: "segnata a mano come non presente fra gli host",
};

function stato() {
  const tenant = getCurrentTenantCode();
  if (!tenant) return null;
  const db = getTenantDb(tenant);
  assicuraSchemaEset(db);
  const giro = db.prepare("SELECT iniziato, finito, esito, macchine, vulnerabilita, software, dettaglio FROM eset_giro ORDER BY id DESC LIMIT 1").get() ?? null;
  const macchine = (db.prepare("SELECT COUNT(*) AS n FROM eset_macchina").get() as { n: number }).n;
  const daAbbinare = db
    .prepare(
      `SELECT m.uuid, m.nome, m.hostname, m.ip_locale, m.seriale, m.console, m.ultimo_contatto, COALESCE(a.per, 'nessuno') AS per, COALESCE(a.a_mano, 0) AS a_mano
         FROM eset_macchina m LEFT JOIN eset_abbinamento a ON a.macchina_uuid = m.uuid
        WHERE a.host_id IS NULL ORDER BY m.nome COLLATE NOCASE LIMIT 500`,
    )
    .all() as Array<{ uuid: string; nome: string; hostname: string | null; ip_locale: string | null; seriale: string | null; console: string | null; ultimo_contatto: string | null; per: string; a_mano: number }>;
  const perMotivo = db.prepare("SELECT per, COUNT(*) AS n FROM eset_abbinamento WHERE host_id IS NOT NULL GROUP BY per").all() as Array<{ per: string; n: number }>;
  return {
    acceso: esetDaDalinkAcceso(db),
    giro,
    macchine,
    agganciate: perMotivo.reduce((a, x) => a + x.n, 0),
    agganciate_per: Object.fromEntries(perMotivo.map((x) => [x.per, x.n])),
    da_abbinare: daAbbinare.map((m) => ({ ...m, a_mano: m.a_mano === 1, motivo: MOTIVI[m.per] ?? m.per })),
  };
}

export async function GET() {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => {
    const s = stato();
    return s ? NextResponse.json(s) : NextResponse.json({ error: "nessun cliente in sessione" }, { status: 400 });
  });
}

const Corpo = z.discriminatedUnion("azione", [
  z.object({ azione: z.literal("accendi") }),
  z.object({ azione: z.literal("spegni") }),
  z.object({ azione: z.literal("leggi") }),
  z.object({ azione: z.literal("abbina"), uuid: z.string().min(1).max(64), host: z.string().trim().min(1).max(255) }),
  z.object({ azione: z.literal("non_presente"), uuid: z.string().min(1).max(64) }),
  z.object({ azione: z.literal("automatico"), uuid: z.string().min(1).max(64) }),
]);

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  let corpo: z.infer<typeof Corpo>;
  try {
    corpo = Corpo.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "richiesta non valida" }, { status: 400 });
  }
  if (corpo.azione === "leggi") {
    const esito = await leggiEsetAdesso();
    return withTenantFromSession(() => NextResponse.json({ esito, ...stato() }, { status: esito.esito === "errore" ? 502 : 200 }));
  }
  return withTenantFromSession(() => {
    const tenant = getCurrentTenantCode();
    if (!tenant) return NextResponse.json({ error: "nessun cliente in sessione" }, { status: 400 });
    const db = getTenantDb(tenant);
    assicuraSchemaEset(db);
    if (corpo.azione === "accendi" || corpo.azione === "spegni") {
      impostaEsetDaDalink(db, corpo.azione === "accendi");
    } else if (corpo.azione === "abbina") {
      // L'host si indica con l'IP o col nome: deve essercene uno solo, altrimenti non si sceglie a caso.
      const candidati = db
        .prepare("SELECT id FROM hosts WHERE ip = ? OR lower(hostname) = lower(?) OR lower(custom_name) = lower(?) LIMIT 3")
        .all(corpo.host, corpo.host, corpo.host) as Array<{ id: number }>;
      if (candidati.length !== 1) {
        return NextResponse.json({ error: candidati.length === 0 ? "nessun host con quell'IP o quel nome" : "più host con quel nome: indica l'IP" }, { status: 422 });
      }
      if (!abbinaAMano(db, corpo.uuid, candidati[0].id)) return NextResponse.json({ error: "macchina ESET non trovata" }, { status: 404 });
      riabbinaEset(db);
    } else if (corpo.azione === "non_presente") {
      if (!abbinaAMano(db, corpo.uuid, null)) return NextResponse.json({ error: "macchina ESET non trovata" }, { status: 404 });
    } else {
      togliAbbinamentoAMano(db, corpo.uuid);
    }
    return NextResponse.json(stato());
  });
}
