import { NextResponse } from "next/server";
import { getDeviceFingerprintRules, createDeviceFingerprintRule, resetBuiltinFingerprintRules } from "@/lib/db";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    return NextResponse.json(getDeviceFingerprintRules());
  } catch (e) {
    console.error("Error fetching fingerprint rules:", e);
    return NextResponse.json({ error: "Errore nel recupero regole" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();

    if (body._action === "reset_builtin") {
      resetBuiltinFingerprintRules();
      return NextResponse.json({ success: true, message: "Regole built-in ripristinate" });
    }

    if (!body.name?.trim() || !body.device_label?.trim() || !body.classification?.trim()) {
      return NextResponse.json({ error: "name, device_label e classification sono obbligatori" }, { status: 400 });
    }
    const rule = createDeviceFingerprintRule(body);
    return NextResponse.json(rule, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Esiste già una regola con questo nome" }, { status: 409 });
    }
    console.error("Error creating fingerprint rule:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
