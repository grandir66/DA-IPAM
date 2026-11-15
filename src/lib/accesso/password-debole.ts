/**
 * Password deboli (piano di sicurezza 14/11). Prima bastavano 8 caratteri. Qui niente regole di maiuscole e simboli
 * (spingono a «Password1!»): si rifiutano le più comuni, quelle fatte di un carattere o di una sequenza, e quelle
 * che contengono il nome utente. Vale per creazione, cambio e reimpostazione dalla pagina; **non** per il primo
 * avvio (`/api/setup`), che lo chiama anche l'installatore con la password che ha scelto.
 */
const COMUNI = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "pa55word",
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234",
  "qwertyui", "qwertyuiop", "qwerty123", "asdfghjk", "asdfghjkl", "1q2w3e4r", "1qaz2wsx", "zaq12wsx",
  "admin123", "admin1234", "administrator", "amministratore", "root1234", "letmein1", "welcome1", "benvenuto",
  "cambiami", "changeme", "changeme1", "default1", "iloveyou", "abc12345", "abcd1234", "test1234", "prova123",
  "domarc123", "domarc2026", "daipam123", "da-ipam123", "segreto1", "nessuna1",
]);

const SEQUENZE = ["abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm", "01234567890123456789"];

function eSequenza(p: string): boolean {
  const rovescio = [...p].reverse().join("");
  return SEQUENZE.some((s) => s.includes(p) || s.includes(rovescio));
}

/** null = va bene; altrimenti la frase da mostrare a chi la sta scegliendo. */
export function motivoPasswordDebole(password: string, username?: string | null): string | null {
  if (password.length < 8) return "La password deve avere almeno 8 caratteri";
  const p = password.toLowerCase();
  const nome = (username ?? "").trim().toLowerCase();
  if (nome.length >= 3 && p.includes(nome)) return "La password non può contenere il nome utente";
  if (COMUNI.has(p)) return "Questa password è fra le più usate: scegline un'altra";
  if (new Set(p).size <= 2) return "La password ripete sempre gli stessi caratteri: scegline un'altra";
  if (eSequenza(p)) return "La password è una sequenza di tasti o di numeri: scegline un'altra";
  return null;
}
