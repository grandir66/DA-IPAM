/**
 * Solo per le prove delle righe di comando (`--import` del processo figlio): il server HTTP di Node rifiuta il metodo
 * `LIST` (400, il parser non lo conosce) che OpenBao invece accetta, e `OpenBaoStore` lo usa per elencare le cartelle.
 * Qui `LIST` diventa `GET …?list=true`, l'altra forma ufficiale dell'API KV, che il finto (`openbao-finto.ts`) capisce.
 * Il codice di produzione non cambia e non vede questo file.
 */
const fetchVero = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if ((init?.method ?? "").toUpperCase() !== "LIST") return fetchVero(input, init);
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  u.searchParams.set("list", "true");
  return fetchVero(u, { ...init, method: "GET" });
}) as typeof fetch;
