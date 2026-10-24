/**
 * Un OpenBao finto in un PROCESSO A PARTE (per le prove della richiesta sincrona): chi chiama `putSync` ferma il suo
 * thread, quindi il server non può girare nello stesso processo. Scrive sullo stdout una riga JSON con url, role_id e
 * secret_id (valori di prova, mai veri) e resta in ascolto finché il padre non lo chiude. Con `LENTO=1` accetta le
 * connessioni e non risponde mai (per provare il timeout).
 */
import { createServer } from "node:http";
import { servaOpenBaoFinto } from "./openbao-finto";

async function main(): Promise<void> {
  if (process.env.LENTO === "1") {
    const server = createServer(() => {
      /* non risponde */
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const a = server.address();
    console.log(JSON.stringify({ url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, roleId: "r", secretId: "s" }));
    return;
  }
  const { finto, url } = await servaOpenBaoFinto({ ora: Date.now });
  console.log(JSON.stringify({ url, roleId: finto.roleId, secretId: finto.secretId }));
}

void main();
