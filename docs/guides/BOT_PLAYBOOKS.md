# Bot Playbooks (Buyer, Seller, Reviewer, Ops)

> Security boundary: `tx-plan-dry-run` only rebuilds and simulates a canonical plan. It never signs, exports bytes, or broadcasts; execute separately in a reviewed chain-native wallet/client and verify the receipt through API readback.

> Aktuelle Betriebsgrenze: Live Production ist unter `write_freeze` read-only.
> Fresh-IOTA-Pakete und Pointer sind weder deployt noch akzeptiert; Legacy-IDs
> sind kein Fallback. Alle Write-Schritte unten sind Future-Write-Open-Referenz.
> Sponsor-Ausfuehrung bleibt deferred und emergency-disabled.

Wenn ein Bot nur die knappe Reihenfolge braucht, zuerst `clawnera-help journey buyer|seller|reviewer|operator` nutzen. Fuer den naechsten exakten Schritt danach `clawnera-help recipe <recipe-id>` nutzen.

Diese Playbooks sind der schnelle Ablaufleitfaden pro Rolle.
Alle Flows setzen voraus, dass der Bot zuerst `doctor` und `validate` ausfuehrt.
Wenn moeglich, `doctor` ueber den gespeicherten Auth-State fahren statt mit einem kurzlebigen manuell exportierten JWT.
Wenn der Bot oder das LLM noch keinen sicheren mentalen Ablauf hat, zuerst `clawnera-help show canonical-flow` lesen.

Globaler Write-Gate fuer alle Rollen: Unmittelbar vor Auth, jedem Marketplace-
API-`POST`/`PUT`/`PATCH`/`DELETE` und erneut unmittelbar vor jedem direkten
Marketplace-Move-Broadcast `clawnera-help write-gate` gegen den exakten Target
ausfuehren. Nur bei `source=runtime_db`, `preset=normal`,
`publicApiWrites=live` und `marketplaceWrites=live` fortfahren; sonst stoppen.
Direct-Move-Helper sind standardmaessig Dry-Run. `--execute` darf nur nach dem
unmittelbar vorherigen Gate in einem spaeteren write-open Flow gesetzt werden.

Buyer/seller truth:
- `@clawdex/sdk/bot` ist die allgemeine bot-facing Read-/Contract-Surface
- die buyer/seller runtime helper lane sitzt auf exakten Listing-/Order-/Dispute-Readbacks
- reviewer-self und operator/admin lifecycle bleiben ausserhalb dieser lane

## 1) Buyer Playbook

1. Runtime lesen:
   - `GET /health`, `GET /ready`, `GET /capabilities`, `GET /policy/fees`
2. Auth aufbauen:
   - `clawnera-help write-gate --api-base https://<write-open-api-base>`
   - `POST /auth/challenge`
   - `clawnera-help write-gate --api-base https://<write-open-api-base>` erneut
   - `POST /auth/verify`
3. Optional Key-Agreement registrieren:
   - unmittelbar davor `clawnera-help write-gate --auth-state-file <file>`
   - `PUT /users/me/key-agreement`
4. Listing finden und lokal persistieren:
   - `GET /listings`
   - passende `listingId` lokal speichern
5. Bid erstellen und spaeter den gewaehlten Bid akzeptieren:
   - unmittelbar vor jedem der folgenden POSTs
     `clawnera-help write-gate --auth-state-file <file>` erneut ausfuehren
   - zuerst `POST /bids`
   - seller waehlte spaeter die Gewinner-`bidId`
   - dann ruft genau dieser Buyer `POST /bids/{bidId}/accept` mit `idempotency-key` auf
   - `orderId` lokal durable speichern
6. Falls noetig Bond + Escrow on-chain vervollstaendigen:
   - `clawnera-help write-gate --auth-state-file <file> && clawnera-help order-init-bond --execute --auth-state-file <file> ...`
   - `clawnera-help write-gate --auth-state-file <file> && clawnera-help order-create-escrow --execute --auth-state-file <file> ...`
   - auf `AWAITING_DEPOSITS -> IN_PROGRESS` warten
7. Milestones beobachten:
   - `GET /orders/{orderId}/timeline`
   - Bei Manifest-Flow zusaetzlich `GET /.../artifact-manifest` und `GET /.../anchor`
8. Milestones entscheiden:
   - unmittelbar vor jedem der folgenden POSTs das exakte Gate erneut ausfuehren
   - Accept: `POST /orders/{orderId}/milestones/{milestoneId}/accept`
   - Reject: `POST /orders/{orderId}/milestones/{milestoneId}/reject`
9. Dispute bei Bedarf:
   - Bond funden, Case oeffnen, Quorum/Fallback-Pfade nach Runtime fahren
10. Vor dem naechsten Write immer erst exakten Order-/Dispute-Readback lesen; fuer buyer/seller Zustandsinterpretation danach die runtime helper lane aus `@clawdex/sdk/bot` nutzen statt Timeline-/Event-Fragmente zu raten.

## 2) Seller Playbook

1. Runtime und Auth analog Buyer.
2. Listing erstellen:
   - Falls aktiv: `clawnera-help write-gate --auth-state-file <file> && clawnera-help listing-deposit-create --execute --auth-state-file <file> ...`
   - unmittelbar vor dem API-POST erneut `clawnera-help write-gate --auth-state-file <file>`
   - `POST /listings` mit `idempotency-key`
3. Bids actor-scoped lesen und Gewinner festlegen:
   - `GET /listings/{listingId}/bids`
   - seller gibt die gewaehlte `bidId` an den Buyer weiter
4. Eigene aktive Orders lokal nachhalten (`orderId`-Set).
5. Delivery einreichen:
   - unmittelbar davor `clawnera-help write-gate --auth-state-file <file>`
   - `POST /orders/{orderId}/milestones/{milestoneId}/submit`
5. Bei Manifest-Mode:
   - unmittelbar davor `clawnera-help write-gate --auth-state-file <file>`
   - `POST /orders/{orderId}/milestones/{milestoneId}/anchor`
6. Kommunikationspfad optional:
   - optional `GET /orders/{orderId}/communication-agreement`
     - `404 communication_agreement_not_found` ist normal, wenn beim Accept kein Proposal gesetzt wurde
   - fuer den echten Mailbox-Pfad zuerst `GET /orders/{orderId}` lesen und `order.mailboxObjectId` als Bindungs-Wahrheit behandeln
   - `POST /orders/{orderId}/mailbox/init-plan`
   - `GET/POST /orders/{orderId}/mailbox`
   - `POST /orders/{orderId}/mailbox/post-signal-plan`
   - `POST /orders/{orderId}/mailbox/ack-plan`
7. Bei Reject/Dispute:
   - Bond funden (seller side), Dispute-Open/Review-Pfade ausfuehren.
   - wenn Reviewer Mailbox- oder Checkpoint-Beweis sehen muessen:
     - `clawnera-help mailbox-evidence-export --case-id <dispute-case-id> --auth-state-file ~/.config/clawnera/auth-state.json`
     - `clawnera-help checkpoint-evidence-export --case-id <dispute-case-id> --submit-body-file <file> --payload-file <managed-deliverable-payload.json> --auth-state-file ~/.config/clawnera/auth-state.json`
8. Sobald `orderId` oder `disputeCaseId` bekannt ist, wieder exakten Readback bevorzugen; die buyer/seller helper lane in `@clawdex/sdk/bot` ist fuer Zustandsdeutung da, nicht fuer Reviewer-/Operator-Lifecycle.

## 3) Reviewer / Quorum Playbook

Reviewer-self lifecycle routes are intentionally outside `@clawdex/sdk/bot`.
Use the reviewer-specific guide and the dedicated reviewer-self contract for reviewer-owned automation:
- `apps/api/openapi.reviewer-self.yaml`
- `@clawdex/sdk/reviewer-self`

Keep using `@clawdex/sdk/bot` for shared reads such as reviewer directory and dispute snapshots/evidence.

1. Reputation on-chain vorbereiten:
   - `clawnera-help write-gate --auth-state-file <file> && clawnera-help reputation-init --execute --auth-state-file <file>`
2. Reviewer registrieren:
   - `clawnera-help write-gate --auth-state-file <file> && clawnera-help reviewer-register --execute --auth-state-file <file> ...`
3. Nicht auf eine offene Queue warten, sondern die eigene Inbox pollen:
   - `clawnera-help reviewer-invites --auth-state-file ~/.config/clawnera/auth-state.json`
4. Operator-Selector-Regel verstehen:
   - `POST /admin/reviewer-selection/shortlist` ist operator-only
   - `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` und `POST /disputes/{disputeCaseId}/reviewers/replace` bleiben Buyer-/Seller-Publish-Routen, auch wenn der Operator die Shortlist vorbereitet
   - der spaetere Publish muss `publishTarget.requestPatch` exakt kopieren
   - wenn die Publish-Tx nicht `post_execute_binding_ok=true` bestaetigt, anhalten und Receipt-/Dispute-Readback pruefen statt eine manuelle Bind-Route zu suchen
   - die Inbox bleibt leer, bis die reale Open/Replace-Tx ausgefuehrt und `ReviewerInvited` indexiert wurde
5. Case akzeptieren:
   - zuerst `GET /reviewers/me/invites` oder `GET /reviewers/me/metrics`
   - nur weitermachen, wenn `acceptReadiness.status=ready`
   - `POST /disputes/{disputeCaseId}/reviewers/accept`
   - `403 reviewer_not_invited` = sofort stoppen, nicht weiter raten
   - `409 reviewer_pending_metrics_claim_required` = altes Closed-Case-Outcome erst mit
     `POST /reviewers/me/claim-metrics` bereinigen
   - bei `claim-metrics` die geschlossene `disputeCaseObjectId` mitsenden, ausser die CLI kann genau einen geschlossenen Invite sicher ableiten
6. Evidence zuerst:
   - `GET /disputes/{disputeCaseId}/evidence`
   - `GET /disputes/{disputeCaseId}/evidence/{evidenceId}/content`
   - Reviewer sollen den gespeicherten Content lokal mit `clawnera-help dispute-evidence-decrypt --content-file ...` decrypten, nicht die normale `/orders/{orderId}/milestones/{milestoneId}/artifact-manifest*`-Route erraten
7. Vote-Phasen:
   - Commit: `POST /disputes/{disputeCaseId}/votes/commit`
   - warten bis `commitDeadlineMs`
   - Reveal: `POST /disputes/{disputeCaseId}/votes/reveal`
     - `vote=1` bedeutet seller-settlement
     - `vote=0` bedeutet buyer-settlement
   - Hilfsweg:
     - `clawnera-help reviewer-vote-prepare --case-id <0x...> --vote seller|buyer --auth-state-file ~/.config/clawnera/auth-state.json --out reviewer-vote.json`
     - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help tx-plan-dry-run POST /disputes/{disputeCaseId}/votes/commit --auth-state-file ~/.config/clawnera/auth-state.json --body-file reviewer-vote.json --body-select commitRequestBody`
     - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help tx-plan-dry-run POST /disputes/{disputeCaseId}/votes/reveal --auth-state-file ~/.config/clawnera/auth-state.json --body-file reviewer-vote.json --body-select revealRequestBody`
8. Abschluss:
   - Finalize/Fallback nur auf Buyer-/Seller-Seite je nach Rolle und Capability.
   - Auch nach einer Reveal-Mehrheit kann `POST /disputes/{disputeCaseId}/finalize`
     noch `409 dispute_challenge_window_open` liefern; dann bis `challengeDeadlineMs`
     warten und neu planen.
   - Der Helper druckt dabei top-level `wait_until` und `retry_after_ms` und auto-retried einen kurzen Grenzfall einmal.
   - `finalize` und `fallback/timeout` auto-hydraten Dispute-, Config-, gebundene
     Escrow- und Escrow-Coin-Inputs; diese Werte nicht von Hand zusammensetzen.
   - Beide liefern genau eine atomare PTB mit zwei geordneten Move Calls: zuerst
     die Dispute-Entscheidung, danach `order_escrow::resolve_dispute_with_binding`
     fuer das gebundene Escrow mit demselben Config-Argument.
   - Diese PTB genau einmal ausfuehren und keine separate normale Escrow-Resolution
     anhaengen. Wenn ein Call abbricht, bricht die gesamte PTB ab.
   - Der ArbCap Platform-Fallback folgt derselben Zwei-Call-Regel, ist aber
     Operator/Admin-only und liegt ausserhalb des Public Helpers.
   - `/resolve-escrow` nur fuer Legacy-/Recovery-/Reconciliation verwenden, niemals
     als normalen zweiten Schritt nach erfolgreichem `finalize` oder `fallback/timeout`.
   - seller-settlement bedeutet Escrow-Auszahlung an den Seller; buyer-settlement
     bedeutet Escrow-Refund an den Buyer.
   - Nur in einem expliziten Recovery-Flow den `/resolve-escrow`-Plan als kanonisch behandeln, inklusive
     `disputeQuorumConfigObjectId`.
   - Vor finalisiertem Streitfall kommt korrekt `409 dispute_settlement_not_ready`.
   - Nach einer erfolgreichen atomaren Closeout-PTB kommt bei `/resolve-escrow`
     korrekt `409 dispute_escrow_already_resolved`; das ist kein fehlgeschlagenes Settlement.
   - Kein automatischer Mailbox-Ausgang wird beim Closeout gepostet; fuer Bots ist
     `order.status_changed` das verlaessliche actor-visible Abschluss-Signal, ausser
     eine Partei postet bewusst `DISPUTE_NOTICE`.
8. Immer state-first:
   - Vor Writes `GET /disputes/{disputeCaseId}` lesen.
   - Nach erfolgreicher Escrow-Resolution sollte der Order terminal `COMPLETED` lesen; spaetere
     Milestone-Writes muessen dort mit `409 order_not_in_progress` stoppen.

## 4) Ops Bot Playbook

1. Dauerchecks:
   - `GET /health`, `GET /ready`, `GET /capabilities`
2. Funding-Posture:
   - Live Production ist `write_freeze`; alle oeffentlichen Mutationen und
     direkten Marketplace-Move-Broadcasts sind blockiert. Nur Control-Plane,
     Policy und Capabilities lesen.
   - Aktuell aufrufbare Sponsor-Diagnosen sind nur `GET /policy/control-plane`,
     `GET /policy/sponsor` und `GET /actors/me/capabilities`.
   - `POST /sponsor/preflight` ist kein Read. Ein spaeterer kompatibler Target
     kann ihn als non-reserving/non-executing Diagnose anbieten, die trotzdem
     Audit- oder Rate-State schreiben kann.
   - Der undeployte IOTA-first Candidate ist self-pay-first und haelt Sponsor
     emergency-disabled/deferred.
3. Incident-Pfad:
   - Bei `429/503`: exponentieller Backoff + erneutes Read
   - Bei `409`: immer Reconciliation (kein blind retry)
4. Canary:
   - Waehrend `write_freeze` keinen E2E-Canary starten.
   - Ein spaeterer Canary braucht vorher den vollstaendig gruene globalen
     Write-Gate und eine eigene explizite Rollout-Freigabe.

## 5) Pflichtregeln fuer alle Rollen

- `idempotency-key` fuer kritische Writes nutzen.
- Keine Secrets in Logs.
- Keine blinden Retries bei State-Fehlern.
- Vor jedem mutierenden Schritt aktuellen State lesen.
- Bei unklaren Runtime-/Docs-Widerspruechen: `clawnera-help triage "<problem>"` und danach GitHub Issue anlegen.
