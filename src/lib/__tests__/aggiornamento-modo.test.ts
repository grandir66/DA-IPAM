/**
 * Come si aggiorna questa installazione (09/11/2026, Mac del tecnico, ADR 0037).
 *
 * Sul Mac l'aggiornamento dall'interfaccia non c'è: passa dal servizio d'aggiornamento di systemd.
 * «Installa aggiornamento» rispondeva con un errore che parlava di server e di scripts/update.sh.
 * Ora la pagina sa che lì non si applica e mostra il comando giusto (`da-ipam-tecnico`, installato
 * da installa-tecnico-mac.sh). Su Linux (appliance, Debian del tecnico) resta tutto come prima.
 *
 * Run: node --import tsx --test src/lib/__tests__/aggiornamento-modo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { modoAggiornamento } from "@/lib/aggiornamento-modo";

test("macOS: non si applica dall'interfaccia, c'è il comando del Mac", () => {
  const m = modoAggiornamento("darwin");
  assert.equal(m.applicabile, false);
  assert.match(m.istruzione ?? "", /sudo da-ipam-tecnico --aggiorna/);
});

test("Linux: come prima, si applica e niente istruzione in più", () => {
  assert.deepEqual(modoAggiornamento("linux"), { applicabile: true, istruzione: null });
});
