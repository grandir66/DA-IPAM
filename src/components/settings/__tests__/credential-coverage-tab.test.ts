/**
 * Il pannello «Accesso Windows per host» della Copertura si offre solo agli admin (revisione finale, piano accesso Windows).
 *
 * La sua rotta è solo admin: un viewer vedeva il pannello e subito sotto «Richiesti privilegi di amministratore». La
 * tabella per categoria invece è per tutti, e resta.
 *
 * Run: node --import tsx --test src/components/settings/__tests__/credential-coverage-tab.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { CredentialCoverageTab } from "../credential-coverage-tab";

function resa(ruolo: string | null): string {
  const session = ruolo ? ({ user: { role: ruolo }, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session) : null;
  return renderToStaticMarkup(h(SessionProvider, { session, refetchOnWindowFocus: false, children: h(CredentialCoverageTab) }));
}

describe("CredentialCoverageTab", () => {
  for (const ruolo of ["admin", "superadmin"]) {
    it(`${ruolo}: il pannello c'è`, () => {
      assert.match(resa(ruolo), /Accesso Windows per host/);
    });
  }

  it("viewer: il pannello non c'è, la tabella per categoria sì", () => {
    const html = resa("viewer");
    assert.doesNotMatch(html, /Accesso Windows per host/);
    assert.match(html, /Copertura credenziali per categoria/);
  });

  it("sessione non ancora caricata: non si offre", () => {
    assert.doesNotMatch(resa(null), /Accesso Windows per host/);
  });
});
