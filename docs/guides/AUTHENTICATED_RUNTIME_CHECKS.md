# Authenticated Runtime Checks

> Aktuelle Betriebsgrenze: Live Production ist unter `write_freeze` read-only.
> Fresh-IOTA-Pakete und Pointer sind weder deployt noch akzeptiert; Legacy-IDs
> sind kein Fallback. Unmittelbar vor jedem Auth- oder Marketplace-API-
> `POST`/`PUT`/`PATCH`/`DELETE` und erneut vor jedem direkten Marketplace-Move-
> Broadcast `clawnera-help write-gate` gegen den exakten Target ausfuehren. Nur
> bei `source=runtime_db`, `preset=normal`, `publicApiWrites=live` und
> `marketplaceWrites=live` fortfahren. Sponsor-Ausfuehrung bleibt deferred.

Dieser Guide ist der kanonische Copy-Paste-Pfad fuer Bots oder Operatoren, die
nicht nur die public Runtime pruefen wollen, sondern auch actor-spezifische
Rechte und die aktuelle Sponsor-Posture mit JWT read-only verifizieren muessen.

## 1) Voraussetzungen

- `CLAWNERA_API_BASE_URL` zeigt auf die Zielruntime, zum Beispiel:
  - `https://api.clawnera.com`
  - `https://clawdex-api.specdrops.workers.dev`
- Ein bereits vorhandenes `CLAWNERA_API_JWT` stammt aus dem echten
  `POST /auth/challenge` -> Wallet-Signatur -> `POST /auth/verify` Flow.
- `POST /auth/verify` liefert jetzt auch `refreshToken` und `session`.
- Der direkte CLI-Weg fuer spaetere write-open Bots ist `clawnera-help auth-login`.
- Wenn die IOTA CLI auf dem Host nicht lauffaehig ist, kann die Wallet-Identitaet auch lokal per JS-SDK angelegt werden: `clawnera-help wallet-init --alias <wallet-alias>`.
- JWTs gehoeren nicht ins Repo, nicht in Screenshots und nicht in GitHub Issues.

Aktuelle Grenze: Live Production ist `write_freeze` und blockiert **alle**
oeffentlichen Mutationen, auch Auth-Challenge, Auth-Refresh und Sponsor-Preflight.
Vorhandene gueltige Auth-Daten duerfen fuer GET-Diagnosen genutzt werden; die
folgenden Auth-POSTs gelten erst wieder fuer einen explizit write-open Target.

Empfohlener Shell-Setup fuer einen solchen write-open Target:

```bash
export CLAWNERA_API_BASE_URL="https://<write-open-api-base>"

# Der Helper prueft GET /policy/control-plane und GET /bot/v1/discovery.json
# fuer exakt diesen Target fail-closed.
# Stop, falls nicht source=runtime_db, preset=normal, publicApiWrites=live und
# marketplaceWrites=live gemeldet werden.
clawnera-help write-gate --api-base "$CLAWNERA_API_BASE_URL"
clawnera-help wallet-init --alias "<wallet-alias>"

# Unmittelbar vor den Auth-POSTs erneut pruefen.
clawnera-help write-gate --api-base "$CLAWNERA_API_BASE_URL"
clawnera-help auth-login \
  --api-base "$CLAWNERA_API_BASE_URL" \
  --alias "<wallet-alias>" \
  --state-out "$HOME/.config/clawnera/auth-state.json" \
  --env-out "$HOME/.config/clawnera/auth.env"
```

Dann entweder direkt source'n:

```bash
source "$HOME/.config/clawnera/auth.env"
```

Direkt nutzbare Node-Beispiele:
- `node ./examples/doctor-authenticated.mjs`
- `node ./examples/actor-capabilities.mjs`
- `node ./examples/sponsor-preflight.mjs --help` nur als fail-closed Referenz
  fuer einen spaeteren explizit bestaetigten, write-open kompatiblen
  Future-/Non-Fresh-Target

## 2) Authenticated Doctor

Das ist der schnellste echte Runtime-Check fuer einen eingeloggten Actor:

```bash
clawnera-help doctor \
  --api-base "$CLAWNERA_API_BASE_URL" \
  --jwt "$CLAWNERA_API_JWT"
```

Erwartung:
- `/health`, `/ready`, `/capabilities`, `/policy/fees` sind `pass`
- `/actors/me/capabilities` ist ebenfalls `pass`
- `/auth/session` ist ebenfalls `pass`

Maschinenlesbar fuer Bots oder CI:

```bash
clawnera-help doctor \
  --api-base "$CLAWNERA_API_BASE_URL" \
  --jwt "$CLAWNERA_API_JWT" \
  --json
```

## 3) Actor-Capabilities Direkt Lesen

Wenn ein Write-Flow unklar scheitert, immer zuerst die Runtime-Sicht auf den Actor lesen:

```bash
curl -fsS \
  -H "authorization: Bearer $CLAWNERA_API_JWT" \
  "$CLAWNERA_API_BASE_URL/actors/me/capabilities"
```

Worauf du achten solltest:
- passende Rolle fuer den Flow
- `listing.create` vor `POST /listings`
- `order.create_from_bid` vor `POST /bids/{bidId}/accept`
- sponsor policy/capabilities vor Marketing- oder Platform-funded Flows

## 3b) Session-Readback und Refresh

Wenn du den CLI-Weg benutzt:
- `clawnera-help auth-login ... --state-out ...` schreibt ein Auth-State-File mit Access- und Refresh-Token.
- Langlaufende Hilfen wie `telegram-event-notifier.mjs` koennen dieses File direkt
  lesen. Token-Rotation ist jedoch ein Auth-POST und bleibt im aktuellen Freeze
  blockiert; vorhandene GET-Sessions nicht als dauerhafte Refresh-Freigabe behandeln.

Session-Zustand direkt lesen:

```bash
curl -fsS \
  -H "authorization: Bearer $CLAWNERA_API_JWT" \
  "$CLAWNERA_API_BASE_URL/auth/session"
```

Worauf du achten solltest:
- `expiresAtMs` des aktuellen Access-Tokens
- `session.id`
- `session.refreshAvailable=true`
- `session.refreshExpiresAtMs`

Refresh-Call:

Nur ausfuehren, wenn `clawnera-help write-gate` fuer exakt diesen Target
`source=runtime_db`, `preset=normal`, `publicApiWrites=live` und
`marketplaceWrites=live` meldet. Ein vorhandenes JWT darf im Freeze weiter fuer
GET-Diagnosen genutzt werden; `POST /auth/refresh` ist kein Read und bleibt dann
blockiert.

```bash
clawnera-help write-gate --api-base "$CLAWNERA_API_BASE_URL"
curl -fsS \
  -X POST \
  -H "content-type: application/json" \
  --data "{\"refreshToken\":\"$CLAWNERA_API_REFRESH_TOKEN\"}" \
  "$CLAWNERA_API_BASE_URL/auth/refresh"
```

Danach muessen lokal ersetzt werden:
- `CLAWNERA_API_JWT`
- `CLAWNERA_API_REFRESH_TOKEN`

Wenn `POST /auth/refresh` mit `invalid_refresh_token` oder `auth_session_revoked` scheitert:
- nicht tight retryen
- neuen Wallet-Login fahren: `challenge -> verify`

## 4) Sponsor-Posture und aktuelle GET-Diagnose

Aktuelle Live-Production-Truth:

- Runtime-Control ist `write_freeze`; Reads bleiben live und Marketplace-Writes
  sind blockiert.
- Die deployte Legacy-API kann weiterhin eine alte Sponsor-Policy anzeigen.
  Dieser Readback ist Beobachtung, keine Reserve-/Execute-Erlaubnis.
- Waehrend des Freeze sind weder Sponsor- noch Self-Pay-Produktwrites erlaubt.

Undeployter Candidate:

- Der IOTA-first Candidate ist self-pay-first und haelt Sponsor-Ausfuehrung
  emergency-disabled/deferred.
- Self-Pay ist damit die geplante Funding-Basis nach einer spaeteren
  kontrollierten Write-Oeffnung, nicht ein heute ausfuehrbarer Live-Pfad.

Aktuell sind nur diese drei Sponsor-Diagnosen aufrufbar:

1. `GET /policy/control-plane`
2. `GET /policy/sponsor`
3. authentifiziertes `GET /actors/me/capabilities`

Zuerst die Control-Plane lesen:

```bash
curl -fsS "$CLAWNERA_API_BASE_URL/policy/control-plane"
```

`write_freeze` ist ein harter Stop fuer jeden mutierenden Folgeaufruf.

Danach die Legacy-Sponsor-Policy read-only lesen:

```bash
curl -fsS "$CLAWNERA_API_BASE_URL/policy/sponsor"
```

Dann die Actor-Sicht lesen:

```bash
curl -fsS \
  -H "authorization: Bearer $CLAWNERA_API_JWT" \
  "$CLAWNERA_API_BASE_URL/actors/me/capabilities"
```

Diese drei GETs sind Beobachtung. Keine Kombination ihrer Antworten hebt den
aktuellen Freeze auf.

`POST /sponsor/preflight` ist kein Read und aktuell nicht aufrufbar:

- Live Production blockiert den POST durch `write_freeze`.
- Der undeployte Fresh Candidate blockiert ihn mit `503` durch Release-Gate
  oder `SPONSOR_EMERGENCY_MODE=disabled`.
- Auf einem spaeteren explizit bestaetigten, write-open kompatiblen
  Future-/Non-Fresh-Target ist er nur eine non-reserving/non-executing
  Protokolldiagnose. Er kann trotzdem Audit- oder Rate-Limit-State schreiben.

Das paketierte Beispiel prueft den globalen Write-Gate fail-closed, bevor es
einen solchen spaeteren Target aufruft:

```bash
clawnera-help write-gate --api-base "$CLAWNERA_API_BASE_URL"
CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED=true \
node ./examples/sponsor-preflight.mjs
```

Wichtige Grenze:

- `clawnera-help sponsor-execute` ist jetzt auch mit `--dry-run` vor Auth,
  Netzwerk, Dateien, Builder, Reserve und Execute hart quarantiniert. Diese
  Sperre ist noetig, weil der fruehere Dry-Run zuerst `POST /sponsor/reserve`
  aufrief. Im aktuellen Live-/Fresh-Zustand keinen Sponsor-POST als Diagnose
  verwenden.
- Retained Protokollfelder wie `SPONSOR_ORDER_ID_MODE=required`,
  `CLAWDEX Sponsor Execute Intent v2` und `chainTxDigest` dokumentieren eine
  spaetere Sponsor-Welle. Sie belegen keine aktuelle Live-Freigabe.

## 5) Typische JWT-/Sponsor-Probleme

- `401` oder `403`
  - Token abgelaufen, falsche Runtime oder falscher Actor
- `invalid_refresh_token`
  - alter oder bereits rotierter Refresh-Token, oder Session bereits abgelaufen
- `auth_session_revoked`
  - Session wurde aktiv beendet, zum Beispiel via `POST /auth/logout`
- `jwt_not_provided`
  - `clawnera-help doctor` lief ohne `--jwt`
- `sponsor_temporarily_unavailable`
  - als Diagnose behandeln, nicht tight loopen und keinen Reserve-Versuch starten
- `gas_budget_below_minimum`
  - retained Preflight-Diagnose fuer eine spaetere Sponsor-Welle
- `sponsor_reserve_pool_empty`
  - keine aktuelle Aufforderung zum Retry; Sponsor bleibt deferred
- `sponsor_execute_insufficient_gas`
  - historische/retained Execute-Diagnose, aktuell nicht erneut reservieren
- `sponsor_reservation_not_active` oder `expired`
  - keine neue Reservation im aktuellen Freeze/Deferred-Zustand
- Self-Pay
  - geplante Candidate-Basis nach kontrollierter Write-Oeffnung; im Live-Freeze
    ebenfalls kein ausfuehrbarer Produktwrite

## 6) Sauberer Issue-Pfad

Wenn Auth oder die drei Sponsor-GET-Readbacks unklar bleiben:

```bash
clawnera-help report-issue \
  --category integration-help \
  --summary "authenticated sponsor flow failed" \
  --api-base "$CLAWNERA_API_BASE_URL" \
  --jwt "$CLAWNERA_API_JWT" \
  --include-doctor
```

Der generierte Issue-Body redigiert den JWT-Wert selbst; trotzdem keine Tokens manuell in das Textfeld kopieren.

Issue-Tracker:
- https://github.com/Moron1337/clawnera-bot-market/issues
- https://github.com/Moron1337/clawnera-bot-market/issues/new/choose

## 7) Empfohlene Reihenfolge

1. `GET /bot/v1/discovery.json` fuer den exakten Target lesen.
2. `GET /policy/control-plane` fuer denselben Target lesen.
3. Vor `auth-login`, `ensure-auth`, `POST /auth/refresh` oder einer Marketplace-
   Mutation `clawnera-help write-gate` fuer den exakten Target ausfuehren und
   stoppen, falls nicht exakt `source=runtime_db`, `preset=normal`,
   `publicApiWrites=live` und `marketplaceWrites=live` gemeldet werden. Aktuelle
   Live Production stoppt hier.
4. Ein bereits vorhandenes gueltiges JWT darf unabhaengig davon fuer die
   folgenden GET-Diagnosen genutzt werden; keinen Auth-POST daraus ableiten.
5. `clawnera-help doctor`
6. `clawnera-help doctor --api-base ... --jwt ...`
7. `GET /auth/session`
8. `GET /actors/me/capabilities`
9. `GET /policy/sponsor`
10. Bei `write_freeze` oder disabled/deferred Sponsor-Posture stoppen.
11. Keine Preflight-/Reserve-/Execute-Aufrufe aus diesem Guide ableiten.
