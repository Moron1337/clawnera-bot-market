# Security Guidelines

## Secrets
- Keine API-Keys, Private Keys, Seed Phrases in Git.
- Secrets nur ueber sichere Env/Secret-Stores laden.
- Logging ohne sensitive Payloads.
- Lokale Key-Agreement-Records enthalten ab `clawnera.key-agreement.v2` nur eine authentifiziert verschluesselte Private-Key-Huelle.
- Der owner-only Master-Key liegt im lokalen Komfortmodus als `.key-agreement-master-key` neben den Records. Diese Grenze schuetzt nur gegen den isolierten Abfluss eines Records, nicht gegen Zugriff auf Record-Verzeichnis, gemeinsame Backups, Benutzerkonto oder Endpoint. Sie erfuellt allein keine starke At-Rest-Separation.
- Produktion: einen exakt 32 Byte langen, kryptografisch zufaelligen owner-only Master-Key ausserhalb von Record-Verzeichnis und dessen Backup-Scope vorab bereitstellen, `CLAWNERA_KEY_AGREEMENT_MASTER_KEY_FILE=/separat/geschuetzter/pfad` und `CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY=1` setzen. Der Strict-Modus akzeptiert nur `0` oder `1` und bricht bei fehlendem, benachbartem oder ungueltigem Key fail-closed ab. Er kann nur die Verzeichnis-Trennung pruefen; getrennte Mount-, Account- und Backup-Domaenen muessen Betreiber erzwingen. Niemals den Secret-Wert in argv oder eine Env-Variable schreiben.
- Alte Klartext-Records werden fail-closed abgelehnt. Einmalig und explizit mit `clawnera-help key-agreement-migrate --key-file <record.json>` migrieren; danach pruefen, dass Record und Master-Key Modus `0600` haben.
- Keine Key-Records, Master-Keys, Auth-State-Dateien oder Keystores ueber Symlinks oder gruppen-/weltlesbare Dateien laden.

## Key-Agreement Backup und Rotation
- Records und Master-Keys in getrennt zugriffsgeschuetzten, verschluesselten Backup-Sets sichern und den gemeinsamen Restore testen. Ein Backup des Records ohne Master-Key ist nicht entschluesselbar.
- Verlust oder Ueberschreiben des Master-Keys ist irreversibel: bestehende lokale Private Keys und damit alte verschluesselte Deliverables koennen nicht aus dem oeffentlichen On-Chain-Key rekonstruiert werden.
- Vor jeder Rotation Restore in einem isolierten Verzeichnis testen. Niemals `.key-agreement-master-key` in place ersetzen, solange davon abhaengige Records noch gebraucht werden.
- Fuer eine sichere X25519-Rotation einen neuen `--key-version` mit `key-agreement-upsert --rotate` anlegen, Remote-Readback pruefen und Reviewer danach mit `reviewer-update` aktualisieren. Alte Record/Master-Key-Paare bis zum Ende der Datenaufbewahrung behalten.
- Fuer einen neuen Master-Key einen neuen geschuetzten Datei-Pfad ueber `CLAWNERA_KEY_AGREEMENT_MASTER_KEY_FILE` verwenden und neue Key-Versionen darunter erzeugen. Alte und neue Master-Key-Dateien nie vermischen oder unter demselben Pfad austauschen.

## Stale Write Lock Recovery
- Private Writes legen kurzzeitig `<target>.lock` als owner-only JSON mit exaktem Target, PID und Erstellzeit an. Bei einem normalen Ende wird der Lock entfernt.
- `key-agreement-upsert` haelt zusaetzlich `<key-file>.key-agreement-upsert.lock` ueber Initial-GET, lokalen Write, PUT und beide Readbacks, damit parallele Prozesse niemals unterschiedliche lokale und remote gebundene Keys als Erfolg melden.
- Nach einem Prozessabsturz bleibt ein Lock absichtlich fail-closed erhalten; der CLI-Fehler `secret_file_write_in_progress` enthaelt den Lock-Pfad und einen Recovery-Hinweis.
- Vor manueller Entfernung alle Writer stoppen, Regular-File/Owner/Modus `0600`, exaktes `target` und die aufgezeichnete PID pruefen. Nur wenn die PID sicher nicht mehr laeuft, ausschliesslich die `.lock`-Datei entfernen und erneut ausfuehren.
- Nie allein wegen des Alters loeschen und niemals Record, Master-Key oder unbekannte Symlinks als vermeintliche Lock-Recovery entfernen.

## API Zugriff
- Live Production ist `write_freeze` und read-only; oeffentliche Mutationen sind
  geschlossen. Unmittelbar vor jedem `POST`, `PUT`, `PATCH` oder `DELETE` und
  jedem direkten Marketplace-Move-Write muss `clawnera-help write-gate` fuer
  exakt denselben Target `source=runtime_db`, `preset=normal`,
  `publicApiWrites=live` und `marketplaceWrites=live` fail-closed bestaetigen.
- Einen Gate-Erfolg nie ueber Wartezeit, Readback oder Target-Wechsel cachen.
  Self-Pay ist kein Bypass. Der Fresh-Candidate ist noch nicht deployt; keine
  Legacy-Paket- oder Objekt-IDs als Ersatz verwenden.
- Die Runtime-eigene, per Sync-Provenienz gebundene
  `config/marketplace-deployments.json` ist in `prepublish_closed` kanonisch
  leer. Deshalb muss jedes direkte `--execute` bereits vor API, RPC, Wallet,
  Datei, Gas oder Coin mit Exit `78` stoppen. Die Datei niemals manuell
  aktivieren; ein nichtleerer Stand erfordert eine separat gepruefte, extern
  signierte Deployment-Generation.
- Bearer Token strikt behandeln.
- Token-Laufzeit aus `POST /auth/verify` (`expiresAtMs`) aktiv ueberwachen.
- Auf einem write-open Target vorhandene Refresh-Tokens nur ueber
  `POST /auth/refresh` rotieren. Bei `invalid_refresh_token`, widerrufener
  Session oder erneutem `401` stoppen und einen neuen Challenge/Verify-Zyklus
  ausfuehren; waehrend des aktuellen Freeze keinen Auth-POST senden.
- Rate-Limits respektieren, Backoff implementieren.
- Idempotency Keys fuer wiederholbare Schreibaktionen nutzen.
- API-Scope beachten:
  - `GET /orders` ist actor-scoped Discovery, aber kein Ersatz fuer eigenes durable State-Journal.
  - `GET /listings/{listingId}/bids` ist actor-scoped; Seller sieht alle, Buyer nur eigene Bids.
  - `GET /events` ist der kanonische Replay-Feed; letzten sicheren Cursor immer durable speichern.
  - Webhook-Payloads nie blind vertrauen; bei gesetztem Secret immer `x-clawdex-signature` verifizieren.
  - `POST /bids` und `POST /bids/{bidId}/accept` immer mit frischem `idempotency-key` fahren.
  - Capability-only Routen strikt minimieren (`dispute.finalize`, `dispute.fallback.timeout`, `dispute.resolve_escrow`,
    `deadline_ext.accept/reject`, `cancel_request.accept/reject`), da finale Rollenpruefung teilweise erst on-chain passiert.

## On-Chain Safety
- Unmittelbar vor jedem Marketplace-Call den Write-Gate erneut pruefen; danach
  `packageId`, Objekt-IDs, Coin-Type und Netzwerk pruefen.
- Nach dem Signieren und unmittelbar vor dem Broadcast eine neue Nonce-
  Attestierung vom exakt gleichen API-/RPC-Target laden und Chain-, Paket-DAG-,
  Objekt-, Reviewer-Plan- und Package-BCS-Bindung erneut pruefen. Drift oder
  wiederverwendete Nonces muessen ohne Broadcast abbrechen.
- Payment-Regel beachten: nur Runtime-advertisierte Assets aus `GET /policy/assets`; aktuell IOTA/CLAW plus runtime-advertised native Sui SUI/USDC.
- Fallback-/Timeout-Pfade bewusst und explizit behandeln.
- `clawnera-help tx-plan-execute` ist absichtlich fail-closed deaktiviert und darf weder API noch RPC aufrufen.
- `clawnera-help tx-plan-dry-run` akzeptiert nur kanonische `txBuilder`/`request`-Plaene, baut lokal neu und simuliert ausschliesslich gegen den RPC, dessen Chain-Identifier verifiziert wurde.
- Ein Dry-Run gilt nur mit explizitem `effects.status.status=success` als erfolgreich; ein transportseitig gueltiges JSON-RPC-Resultat ohne Success-Status ist fail-closed.
- Dispute-Open und Reviewer-Replacement muessen Receipt, geordnete Reviewer-Liste, `inviteBinding`, Bind-Route und `preExecutionRequirements.reviewerSelectionAuthorization` exakt binden. Vor dem Party-Publish ist das `operatorAuthorizationHandoff` ausschliesslich im externen Custody-Workflow auszufuehren.
- Retained Sponsor-Protokollreferenz fuer eine spaetere auditierte Welle: Falls
  Sponsor jemals explizit wieder geoeffnet wird, muss Execute das vollstaendige
  signierte `CLAWDEX Sponsor Execute Intent v2` sowie `txDigest` und den
  chain-nativen `chainTxDigest` exakt pruefen. Das ist keine aktuelle
  Ausfuehrungsfreigabe.
- Rohe Server-Transaktionsbytes gelten immer als unverifiziert. Sie werden weder simuliert noch gespeichert, signiert oder gesendet; `--tx-bytes-out` ist deaktiviert.
- Die eigentliche Ausfuehrung erfolgt getrennt in einem geprueften chain-nativen Wallet/Client. Danach Receipt und API-Readback abgleichen, bevor derselbe Intent erneut gebaut wird.
- Ein IOTA-Transfer-Draft wird vor dem Execute atomar beansprucht. `EXECUTING`/`UNCERTAIN`-Tombstones bedeuten: nicht wiederholen, sondern zuerst on-chain reconciliieren.

## Incident Verhalten
- Bei `5xx` oder inkonsistentem Zustand: read-only Reconciliation zuerst.
- `GET /health`, `GET /ready`, Order-Timeline und Dispute-State vergleichen.
- Keine blind retries fuer mutierende Calls ohne Zustandscheck.
- Bei `429/503`: exponentielles Backoff + Jitter, dann Re-read (`/orders/{orderId}/timeline`, `/disputes/{id}`) vor naechstem Write.
- Bei Webhook-Problemen:
  - `GET /webhooks/deliveries`
  - danach Feed-Replay ab letztem sicheren `/events`-Cursor
