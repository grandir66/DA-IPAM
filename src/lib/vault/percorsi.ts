/**
 * I percorsi delle credenziali dei device in OpenBao (piano da-vault 2026-10-23, passo 6): `clienti/<codcli>/da-ipam/<nome>-<id>`.
 *
 * Un modulo a sé, senza dipendenze, perché lo usano la migrazione, lo svuotamento e la scrittura dalla pagina
 * (`credentials/archivio.ts`, che `db-tenant.ts` importa: qui non si può importare il database).
 */

function slug(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** La cartella di un cliente in OpenBao: `clienti/<codcli>/da-ipam`. */
export function prefissoCliente(codiceCliente: string): string {
  return `clienti/${slug(codiceCliente) || "cliente"}/da-ipam`;
}

/** Il percorso di una voce in OpenBao: `clienti/<codcli>/da-ipam/<nome>-<id>`, minuscolo con trattini. */
export function percorsoCredenziale(codiceCliente: string, credentialId: number, nome: string): string {
  return `clienti/${slug(codiceCliente) || "cliente"}/da-ipam/${slug(nome) || "credenziale"}-${credentialId}`;
}
