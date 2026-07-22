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
   - `MARKETPLACE_SOURCE_ROOT=/path/to/clawdex MARKETPLACE_SOURCE_COMMIT=<reviewed-full-40-char-sha> npm run sync:local` (falls Core/SDK geaendert wurde)
   - `npm run validate -- --strict`
   - Der IOTA-Fresh-Sync fuer die neue Fuenf-Paket-Topologie ist in diesem Helper-Commit bewusst noch nicht ausgefuehrt. Er darf erst gegen den final gepushten und reviewten Clawdex-Commit laufen; siehe den Abschnitt "Ausstehender IOTA-Fresh-Source-Sync".
4. Evidence-Datei anlegen:
   - z. B. `docs/reports/bot-market-release-hardening-YYYYMMDD.md`
   - festhalten:
     - `git rev-parse HEAD`
     - `git status --short`
     - `git diff --name-only`
     - welcher saubere Clawdex-Commit mit `MARKETPLACE_SOURCE_ROOT=/path/to/clawdex MARKETPLACE_SOURCE_COMMIT=<reviewed-full-40-char-sha> npm run sync:local` synchronisiert wurde
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

## 5) Publish

1. Bevorzugter offizieller Publish-Pfad:
   - GitHub Actions Trusted Publish ueber `.github/workflows/publish.yml`
   - Trigger: ausschliesslich ein veroeffentlichtes GitHub Release mit Tag `v<package-version>`
   - geschuetztes GitHub Environment: `npm-publish`
   - wichtig:
     - `publish.yml` bleibt bewusst auf GitHub-hosted Actions
     - Pull-Request-, CI-, Nightly- und Publish-Workflows laufen nur auf literal konfigurierten GitHub-hosted Runnern
2. Der Workflow prueft vor dem Publish:
   - Tag entspricht exakt der Package-Version
   - Checkout-Commit entspricht exakt dem Tag-Commit
   - Tag-Commit liegt auf `origin/main`
   - der Source-Checkout ist nach Install und Tests weiterhin sauber; Tag/Main-Bindung wird unmittelbar vor dem Pack erneut geprueft
   - Registry-Version existiert noch nicht
   - Build/Test/Pack laufen in einem separaten Job mit ausschliesslich `contents: read`; dort ist kein OIDC-Token-Scope vorhanden
   - der Environment-geschuetzte Publish-Job hat als einziger `id-token: write`, fuehrt weder Checkout noch Repo-Code, Installationen oder Nachtests aus und akzeptiert nur das heruntergeladene, inline erneut gepruefte Evidence-Artefakt
3. Publish:
   - genau ein Tarball wird mit `npm pack --json --ignore-scripts` erzeugt
   - Tarball, SHA-256-Manifest und Source-Commit-Evidence werden als Workflow-Artefakt gespeichert
   - ausschliesslich dieser bereits gehashte Tarball wird als letzter OIDC-Schritt mit `npm publish <artifact.tgz> --access public --provenance --ignore-scripts` publiziert
4. Wichtiger Hinweis:
   - npm Trusted Publishing verlangt aktuell `npm CLI 11.5.1+` und einen GitHub-hosted Runner
   - lokale oder tokenbasierte Publishes sowie `--provenance=false` sind kein erlaubter Fallback; bei Ausfall bleibt das Release blockiert
5. Registry-Truth verifizieren:
   - `npm view clawnera-bot-market version dist --json`
   - ein separater GitHub-hosted Folgejob ohne OIDC vergleicht `dist.shasum` (SHA-1) und `dist.integrity` (SHA-512) zwingend mit den lokal vor dem Publish berechneten Digests desselben Tarballs
   - ein vorhandener Versionsstring ohne passenden Digest ist kein erfolgreicher Readback
   - `npx clawnera-bot-market --help`
6. Release-Paritaet pruefen:
   - `bash ./scripts/release/verify-release-parity.sh <version>`
   - Pflichtnachweise:
     - npm-Registry fuehrt genau diese Version
     - lokaler und entfernter Git-Tag `v<version>` existieren
     - GitHub Release zu `v<version>` existiert
     - globaler `clawnera-help` ist auf Operator-Hosts auf derselben Version
7. Pflicht auf jedem Operator-Host, der `clawnera-help` direkt nutzt:
   - `npm run release:sync-global`
   - danach verifizieren:
     - `clawnera-help --help --all --json`
   - Ziel:
     - die global genutzte Helper-Version muss exakt der frisch veroeffentlichten npm-Version entsprechen

## 5a) Externe Pflicht-Config fuer npm Trusted Publishing

**Live-Blocker (Read-only-Stand 2026-07-10):** `main` liefert fuer Branch Protection `404`, und die Environment-Liste enthaelt kein `npm-publish`. Der Workflow-Code ist repo-seitig vorbereitet, aber ein Publish ist absichtlich durch `check:release-live-prerequisites` blockiert. Der Environment-Name im YAML ist fuer sich allein kein Schutz und darf nicht als konfigurierte Freigabe gewertet werden.

**IOTA-Fresh-Blocker (Repo-Stand 2026-07-11):** Die eingecheckte Version `0.1.104` ist ein ungepublizierter Kandidat fuer die Governance-gebundene Fresh-ABI. Sie darf nicht publiziert werden, solange Clawdex den Fresh-Runtime- und ABI-Release nicht explizit freigegeben und per Readback belegt hat. npm `latest` bleibt bis dahin `0.1.103`; ein Legacy-ABI-Fallback wird nicht eingebaut.

### Ausstehender IOTA-Fresh-Source-Sync

Dieser Helper-Stand enthaelt die lokale fail-closed Bindung an Foundation -> Governance -> Settlement -> Fulfillment -> Ops und `orderMailboxRegistryObjectId`, aber noch nicht den automatisch erzeugten Clawdex-Mirror. Nach dem finalen Clawdex-Push:

1. Einen sauberen Clawdex-Checkout exakt auf dem finalen, gepushten, vollstaendigen 40-Zeichen-SHA verwenden. Der Commit muss auf `origin` liegen und auf `origin/main` basieren.
   - Vor dem Sync muessen `README.md`, `contracts/README.md` und `docs/SMART_CONTRACT_ARCHITECTURE_MAP.md` im Clawdex-Commit ebenfalls die fuenf aktiven Fresh-Roots nennen. Ein Stand, der nur `claw_foundation` + `claw_settlement_core` als aktive Wahrheit ausweist, ist nicht sync-faehig.
   - `docs/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md` bleibt als veraltete Monolith-Erklaerung ausserhalb des freigegebenen Public-Mirrors.
2. Im Helper-Repo genau einmal ausfuehren:
   - `MARKETPLACE_SOURCE_ROOT=/path/to/clean/clawdex MARKETPLACE_SOURCE_COMMIT=<final-pushed-full-40-char-sha> bash ./scripts/sync-local-sources.sh`
3. Den gesamten v4-Mirror mit 27 Dateien und `docs/docsources/SYNC_MANIFEST.txt` als eine Rotation reviewen. Fuer diese Aenderung insbesondere pruefen:
   - `docs/docsources/core/openapi.yaml`
   - `docs/docsources/core/openapi.public.yaml`
   - `docs/docsources/core/openapi.advanced.yaml`
   - `docs/docsources/core/apiContract.json`
   - `docs/docsources/core/callable-surfaces/iota/{foundation,governance,settlement,fulfillment,ops}.snapshot`
   - `lib/vendor/clawdex-sdk/tx/orderMailbox.js`
   - `config/marketplace-deployments.json`
   - die alten Pfade `docs/docsources/core/callable_surface.snapshot` und `docs/docsources/core/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md` muessen entfernt sein
4. Im vendorten Mailbox-Builder nachweisen, dass Fresh `settlementAbi` auswertet, `orderMailboxRegistryObjectId` zwingend verlangt und an `orderMailbox.init` weitergibt. In den API-Schemata muessen `governancePackageId` und `orderMailboxRegistryObjectId` enthalten sein.
5. Keine Admin-/Operator-Kommandos fuer Fee-Queue, -Approve oder -Apply in CLI, Recipes, Topics oder Examples uebernehmen.
6. Danach `npm run check:sync-provenance`, die fokussierten Topologie-/Write-Gate-Tests, `npm run validate -- --strict` und `npm run release:check` ausfuehren.

Bis dieser Sync samt Review und Tests abgeschlossen ist, bleibt der Fresh-Release-Kandidat blockiert.

Vor dem ersten Publish muessen extern und anschliessend read-only verifiziert werden:

- Branch Protection fuer `main` mit den vorgesehenen Reviews und Pflichtchecks
- GitHub Environment `npm-publish` mit Required Reviewers und ohne unkontrollierten Admin-Bypass
- Deployment-Policy ausschliesslich fuer die vorgesehenen geschuetzten Release-Tags
- npm Trusted Publisher fuer Repository `Moron1337/clawnera-bot-market`, Workflow `publish.yml`, Environment `npm-publish`
- frische Evidence in `docs/reports/npm-publish-live-prerequisites.json`; erst danach darf `status` auf `ready` wechseln

Auf `npmjs.com` unter `Packages -> clawnera-bot-market -> Settings -> Trusted publishing`:

1. Provider:
   - `GitHub Actions`
2. Organization or user:
   - `Moron1337`
3. Repository:
   - `clawnera-bot-market`
4. Workflow filename:
   - `publish.yml`
5. Environment name:
   - `npm-publish`
   - im GitHub Environment mindestens Required Reviewers und Schutz vor unkontrolliertem Admin-Bypass konfigurieren

Danach als sicherer Folge-Schritt unter `Settings -> Publishing access`:
- `Require two-factor authentication and disallow tokens`

Erst nachdem der Trusted Publisher erfolgreich getestet wurde.

## 6) Post Release

1. GitHub Release/Notes erstellen.
2. Integratoren ueber neue Version informieren.
3. Pflicht auf den lokalen Operator-Maschinen:
   - `npm run release:sync-global`
   - nur danach mit dem globalen `clawnera-help` weiterarbeiten
4. Optional: vorherige Version als Rollback-Referenz dokumentieren.

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
