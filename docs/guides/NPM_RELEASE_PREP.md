# NPM Release Preparation

Diese Checkliste sichert einen reproduzierbaren Publish-Flow fuer `clawnera-bot-market`.

## 1) Release-Scope einfrieren

Bevor irgendein Version Bump oder Publish-Versuch passiert:

1. offenen Scope explizit sehen:
   - `git status --short`
   - `git diff --name-only`
2. artefaktrelevante Diffs in feste Buckets einteilen:
   - `docs/docsources/core/*`
   - `README.md`, `CHANGELOG.md`, `docs/guides/*`
   - `examples/*`, `lib/*`
   - `test/*`
3. fuer `docs/docsources/core/*` gilt:
   - wenn diese Dateien im Release bleiben, ist `npm run sync:local` Pflicht
   - wenn sie nicht im Release sein sollen, muessen sie aus dem Release-Kandidaten entfernt werden
4. den Release-Kandidaten in einem sauberen Branch oder Worktree bauen, nicht aus einem gemischten dirty Checkout

## 2) Vor dem Version Bump

1. Release-Kandidat sauber:
   - `git status`
2. CLI lokal pruefen:
   - `npm run help`
   - `npm run validate`
   - `npm run test`
   - `npm run release:check`
3. Doku/Topics sync:
   - `npm run sync:local` (falls Core/CLAW geaendert wurde)
   - `npm run validate -- --strict`
4. Evidence-Datei anlegen:
   - z. B. `docs/reports/bot-market-release-hardening-YYYYMMDD.md`
   - festhalten:
     - `git rev-parse HEAD`
     - `git status --short`
     - `git diff --name-only`
     - ob `sync:local` gefahren wurde oder bewusst nicht
     - Ergebnis von `npm run release:check`

## 3) Versionieren

1. Gewuenschten semver bump:
   - `npm version patch` oder `npm version minor`
2. Changelog/Release Notes ergaenzen.
3. Commit + Tag pruefen:
   - `git log -1 --oneline`
   - `git tag --list --sort=-creatordate | head`

## 4) Pack und Install Smoke-Test

1. Tarball erstellen:
   - `npm pack`
2. Lokale Install-Pruefung:
   - `npm install --prefix /tmp/clawnera-smoke ./clawnera-bot-market-<version>.tgz`
   - `/tmp/clawnera-smoke/node_modules/.bin/clawnera-help --help`
   - `/tmp/clawnera-smoke/node_modules/.bin/clawnera-help show onboarding`
3. Tarball-Inhalt pruefen:
   - `npm pack --dry-run`
4. Kanonischen package-level Einstieg pruefen:
   - `npx clawnera-bot-market --help`

Wichtig:
- der installierte Bin-Name bleibt `clawnera-help`
- `npx clawnera-help --help` ist nicht die kanonische Registry-Truth

## 5) Publish (wenn Token gesetzt)

1. Login/Identity pruefen:
   - `npm whoami`
2. Publish:
   - `npm publish --access public --provenance`
3. Verifikation:
   - `npm view clawnera-bot-market version dist --json`
   - `npx clawnera-bot-market --help`

## 6) Post Release

1. GitHub Release/Notes erstellen.
2. Integratoren ueber neue Version informieren.
3. Optional: vorherige Version als Rollback-Referenz dokumentieren.

## 7) Abort / Containment

Vor dem Publish abbrechen, wenn:
- untriagierte Dirty-Dateien im Release-Kandidaten verbleiben
- `docs/docsources/core/*` im Scope sind, aber `npm run sync:local` nicht gefahren wurde
- `npm run release:check` fehlschlaegt
- `npm pack` oder der Temp-Install-Smoke fehlschlaegt

Nach dem Publish nicht hektisch improvisieren:
- Promotion sofort stoppen
- die Registry-Truth readbacken
- den fehlgeschlagenen oder unvollstaendigen Release dokumentieren
- danach einen korrigierten Folge-Release aus sauberem Worktree schneiden
