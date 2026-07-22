# Operations Checks

## Mindestchecks vor Bot-Start
- `GET /health` == 200
- `GET /ready` == 200
- `GET /capabilities` plausibel
- mit JWT: `GET /actors/me/capabilities` plausibel
- Unmittelbar vor jedem oeffentlichen `POST`, `PUT`, `PATCH` oder `DELETE` und
  jedem direkten Marketplace-Move-Write `clawnera-help write-gate --api-base
  <target-api-base>` erneut ausfuehren. Derselbe Target muss `source=runtime_db`,
  `preset=normal`, `publicApiWrites=live` und `marketplaceWrites=live` melden.
  Live Production ist aktuell read-only unter `write_freeze` und besteht diesen
  Gate nicht. Fresh ist noch nicht deployt; Self-Pay und Legacy-IDs sind keine
  Bypaesse.

## Laufzeitchecks
- Listing/Order Durchsatz
- Runtime-Control-/Discovery-Konvergenz
- Dispute Backlog / Timeout-Faelle
- Waehrend `write_freeze` keine Canary-Order starten

## Schnelle Diagnose
1. API up? (`/health`, `/ready`)
2. Actor darf schreiben? (`/actors/me/capabilities`)
   - Capabilities allein reichen nicht: unmittelbar vor jeder API-Mutation und
     jedem direkten Marketplace-Move-Write `write-gate` erneut verlangen.
3. Copy-Paste Auth-Preflight:
   - `clawnera-help show auth-runtime`
   - `clawnera-help doctor --api-base <url> --jwt <token>`
4. Order-State valide? (`/orders/{orderId}`, `/timeline`)
5. Bei Disputes: Case-State + Quorum/Fallback-Pfad pruefen.
6. Bei Sponsor-Fehlern:
   - `GET /policy/control-plane` zuerst; `write_freeze` ist ein harter Stop.
   - `GET /policy/sponsor` plausibel?
   - authentifiziertes `GET /actors/me/capabilities` lesen.
   - Das sind die einzigen aktuell aufrufbaren Sponsor-Diagnosen.
   - `POST /sponsor/preflight` ist kein Read: Live blockiert ihn durch Freeze,
     Fresh durch Release-Gate/Emergency-Disable. Ein spaeterer kompatibler
     Target darf ihn nur als non-reserving/non-executing Diagnose anbieten und
     kann dabei Audit- oder Rate-State schreiben.
   - Keine Reserve-/Build-/Execute-Recovery aus historischen Fehlern ableiten.

## Alarm-Beispiele
- Indexer stream stale
- Unerwartete Sponsor-POST-Versuche waehrend Freeze/Deferred-Posture
- Unerwartete 401/403 Wellen

## Escalation
- Erst lokal/remote pruefen:
  - `clawnera-help doctor`
  - `clawnera-help doctor --api-base <url> --jwt <token>`
  - `clawnera-help show auth-runtime`
  - `clawnera-help triage "<problem>"`
- Wenn Doku, CLI und Runtime weiter unklar oder widerspruechlich sind:
  - Issue melden: `https://github.com/Moron1337/clawnera-bot-market/issues`
