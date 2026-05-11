---
name: release
description: Bump patch version, commit `release: vX.Y.Z`, push verso origin
---

# Release

Workflow obbligatorio dopo OGNI modifica al codice. Senza push il server in produzione non vede la nuova versione.

## Comando standard

```bash
npm run version:release     # bump patch + git add -A + commit "release: vX.Y.Z"
git push origin "$(git branch --show-current)"
```

Se il bump è già stato fatto a mano (es. editando `package.json` o `VERSION`):

```bash
npm run version:commit      # === version:release --no-bump
git push origin "$(git branch --show-current)"
```

## Quando NON usare

- Modifiche solo a file `docs/`, `README.md`, `CLAUDE.md` o `.claude/**` senza toccare `src/` o `scripts/`: in quel caso un commit `docs:` o `chore:` separato è accettabile, senza bump.
- Su branch `main` direttamente: passare prima da un branch feature/bugfix e PR.

## Anti-regressione

- **MAI** `git commit --amend` su un commit `release:` già pushato.
- **MAI** saltare i hook git con `--no-verify` (CLAUDE.md richiede l'opposto).
- Se `npm run build` fallisce dopo il bump: fixare e fare un NUOVO commit `release:` con patch successiva. Non riusare la stessa versione.
- Verificare prima del push: `npm run lint && npx tsc --noEmit && npm run build` — tutti 0 errori.
- Allineare `package.json` ↔ `VERSION` ↔ tag git: lo script lo fa, ma in caso di merge conflict verificare a mano.
