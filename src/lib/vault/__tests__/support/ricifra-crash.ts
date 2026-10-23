/**
 * Processo figlio della prova del crash (ricifra.test.ts): apre la chiave degli slot passata dalla prova, lancia la
 * ricifra con `applica` e si uccide con SIGKILL al passo PROVA_CRASH_AL_PASSO, dentro la transazione. Niente gancio
 * nel codice dell'app: il passo lo osserva `alPasso`, come farebbe un guasto vero.
 */
import { ricifra } from "../../ricifra";
import { impostaChiaveDati } from "../../stato";

const chiave = Buffer.from(process.env.PROVA_CHIAVE_SLOT ?? "", "hex");
const passo = Number(process.env.PROVA_CRASH_AL_PASSO ?? "0");
// Crash dopo il COMMIT del database il cui nome finisce così e prima del suo VACUUM.
const dopoCommitDi = process.env.PROVA_CRASH_DOPO_COMMIT_DI ?? "";
impostaChiaveDati(chiave, "passphrase");
ricifra({
  dataDir: process.env.DA_INVENT_DATA_DIR ?? "",
  chiaveNuova: chiave,
  applica: true,
  alPasso: (n) => {
    if (passo > 0 && n === passo) process.kill(process.pid, "SIGKILL");
  },
  dopoCommit: (file) => {
    if (dopoCommitDi && file.endsWith(dopoCommitDi)) process.kill(process.pid, "SIGKILL");
  },
});
