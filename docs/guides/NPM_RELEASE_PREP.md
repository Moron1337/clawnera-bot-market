# NPM Release Preparation

Diese Checkliste sichert einen reproduzierbaren Publish-Flow fuer `@clawnera/bot-market`.

## 1) Vor dem Version Bump

1. Arbeitsbaum sauber:
   - `git status`
2. CLI lokal pruefen:
   - `npm run help`
   - `npm run validate`
   - `npm run test`
   - `npm run release:check`
3. Doku/Topics sync:
   - `npm run sync:local` (falls Core/CLAW geaendert wurde)
   - `npm run validate -- --strict`

## 2) Versionieren

1. Gewuenschten semver bump:
   - `npm version patch` oder `npm version minor`
2. Changelog/Release Notes ergaenzen.
3. Commit + Tag pruefen:
   - `git log -1 --oneline`
   - `git tag --list --sort=-creatordate | head`

## 3) Pack und Install Smoke-Test

1. Tarball erstellen:
   - `npm pack`
2. Lokale Install-Pruefung:
   - `npm install --prefix /tmp/clawnera-smoke -g ./clawnera-bot-market-<version>.tgz`
   - `PATH=/tmp/clawnera-smoke/bin:$PATH clawnera-help --help`
   - `PATH=/tmp/clawnera-smoke/bin:$PATH clawnera-help show onboarding`
3. Tarball-Inhalt pruefen:
   - `npm pack --dry-run`

## 4) Publish (wenn Token gesetzt)

1. Login/Identity pruefen:
   - `npm whoami`
2. Publish:
   - `npm publish --access public --provenance`
3. Verifikation:
   - `npm view @clawnera/bot-market version`
   - `npx @clawnera/bot-market --help`

## 5) Post Release

1. GitHub Release/Notes erstellen.
2. Integratoren ueber neue Version informieren.
3. Optional: vorherige Version als Rollback-Referenz dokumentieren.
