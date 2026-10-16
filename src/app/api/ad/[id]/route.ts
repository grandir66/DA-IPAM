import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getAdIntegrationById,
  deleteAdIntegration,
  clearAdData,
} from "@/lib/db";
import { aggiornaIntegrazioneAd, VoceNonValePerProtocollo } from "@/lib/credentials/lega-voce";
import { accountDalCorpo } from "@/lib/ad/account-ldap";
import { AccountLdapNonValido, vistaIntegrazioneAd } from "@/lib/ad/credenziale-ldap";
import { z } from "zod/v4";

type Params = { params: Promise<{ id: string }> };

const AdIntegrationUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  dc_host: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  base_dn: z.string().min(1).optional(),
  // Account LDAP (tappa 2f, T24): la voce scelta, o un account nuovo (utente
  // e password insieme) che diventa una voce; niente dei due = resta com'è.
  credential_id: z.number().int().positive().nullable().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  use_ssl: z.boolean().optional(),
  port: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  winrm_credential_id: z.number().int().positive().nullable().optional(),
});

export async function GET(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const integration = getAdIntegrationById(numId);
    if (!integration) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }

    return NextResponse.json(vistaIntegrazioneAd(integration));
  });
}

export async function PUT(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const existing = getAdIntegrationById(numId);
    if (!existing) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }

    try {
      const body = await request.json();
      const parsed = AdIntegrationUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Dati non validi", details: parsed.error.issues }, { status: 400 });
      }

      const account = accountDalCorpo(parsed.data, false);
      if (!account.ok) return NextResponse.json({ error: account.errore }, { status: 400 });

      const updates: Parameters<typeof aggiornaIntegrazioneAd>[1] = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.dc_host !== undefined) updates.dc_host = parsed.data.dc_host;
      if (parsed.data.domain !== undefined) updates.domain = parsed.data.domain;
      if (parsed.data.base_dn !== undefined) updates.base_dn = parsed.data.base_dn;
      if (parsed.data.use_ssl !== undefined) updates.use_ssl = parsed.data.use_ssl ? 1 : 0;
      if (parsed.data.port !== undefined) updates.port = parsed.data.port;
      if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled ? 1 : 0;
      if (parsed.data.winrm_credential_id !== undefined) updates.winrm_credential_id = parsed.data.winrm_credential_id ?? null;

      // WinRM/DHCP dell'AD: solo voci Windows, mai l'account AD (D7 = (a), T13);
      // l'account LDAP: una voce Active Directory, e un DC diverso la scollega
      // se la richiesta non la sceglie di nuovo (D12 = (a), T24). I controlli
      // stanno in aggiornaIntegrazioneAd, qui il rifiuto è un 400.
      const updated = aggiornaIntegrazioneAd(numId, updates, account.account);
      if (!updated) return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });

      return NextResponse.json(vistaIntegrazioneAd(updated));
    } catch (err) {
      if (err instanceof VoceNonValePerProtocollo || err instanceof AccountLdapNonValido) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    clearAdData(numId);
    const deleted = deleteAdIntegration(numId);
    if (!deleted) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  });
}
