# Next Session Status (2026-02-27)

## Status Update (2026-03-04, Sponsor-Dokumentation finalisiert + Bot-Guides synchronisiert)
- [x] Sponsor-Dokumentation fuer Bot-Integrationen finalisiert:
  - `docs/SPONSOR_POLICY.md`: Reserve-Response -> `gasOwner`/`gasPayment` Mapping, Circuit-Breaker Retry-Disziplin, Self-Pay-Rebuild.
  - `docs/SDK_USAGE.md`: konkreter Sponsor-Tx-Build-Flow inkl. `setGasOwner`/`setGasPayment` und Self-Pay-Fallback-Build.
  - `docs/API_REFERENCE.md`, `docs/BOT_QUICKSTART.md`, `docs/BOT_PROTOCOL_V1.md`: Live-Constraints (`gasBudget >= 1_000_000`, TTL `120s`, `<60s` Ziel), `503 sponsor_temporarily_unavailable` + `Retry-After`.
- [x] Security-Backlog-Checkboxen abgeschlossen:
  - Sponsor TX-Build-Anleitung
  - Sponsor Circuit-Breaker-Verhalten
  - Sponsor Gas-Budget-Minimum
  - Sponsor Reservation-TTL
  - Self-Pay-Fallback TX-Build-Anleitung
- [x] Verifikation (2026-03-04):
  - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
  - `corepack pnpm --filter @clawdex/api lint` -> PASS.
  - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `287 passed | 3 skipped` tests.
  - On-chain:
    - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T172613926Z.json`
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T172613926Z.md`
    - Erwartete externe Blocker unveraendert:
      - `reviewer_prequalified_keys_required`
      - `arb_signer_required_for_platform_fallback`.

## Status Update (2026-03-04, Sponsor Abuse/Quota-KPIs in produktive SLO aufgenommen)
- [x] Sponsor-Abuse/Quota KPIs in die produktive SLO-Definition integriert:
  - Dashboard-SLO erweitert um:
    - `sponsorAbuseLimitedCount`
    - `sponsorDailyQuotaExceededCount`
  - Neue Dashboard-Alert-Thresholds:
    - `DASHBOARD_ALERT_SPONSOR_ABUSE_LIMITED_THRESHOLD` (default `5`)
    - `DASHBOARD_ALERT_SPONSOR_DAILY_QUOTA_EXCEEDED_THRESHOLD` (default `3`)
  - Neue Dashboard-Alert-IDs:
    - `sponsor.abuse_limited.spike`
    - `sponsor.daily_quota_exceeded.spike`
- [x] Prometheus/Grafana-Pipeline um produktive Sponsor-KPIs erweitert:
  - Collector exportiert jetzt:
    - `clawdex_sponsor_abuse_limited_5m`
    - `clawdex_sponsor_daily_quota_exceeded_5m`
  - Neue Prometheus-Alerts:
    - `ClawdexSponsorAbuseLimitedSpike`
    - `ClawdexSponsorDailyQuotaExceededSpike`
  - Runbooks/Routing aktualisiert:
    - `docs/OBSERVABILITY_DASHBOARD_RUNBOOK.md`
    - `docs/OBSERVABILITY_PROMETHEUS_GRAFANA_RUNBOOK.md`
    - `docs/ALERT_ROUTING_MATRIX.md`
- [x] Verifikation (2026-03-04):
  - `corepack pnpm --filter @clawdex/api lint` -> PASS.
  - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
  - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `287 passed | 3 skipped` tests.
  - On-chain:
    - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T170813713Z.json`
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T170813713Z.md`
    - Erwartete externe Blocker unveraendert:
      - `reviewer_prequalified_keys_required`
      - `arb_signer_required_for_platform_fallback`.

## Status Update (2026-03-04, Sponsor-Capability-Engine + Route-Cutover umgesetzt)
- [x] Sponsor-Capability-Engine wieder aufgenommen:
  - `GET /actors/me/capabilities` liefert jetzt Sponsor-Entscheidung mit:
    - Quota (`usage/caps/remaining/exhausted`)
    - Revocation-Status (`active/reason/suspendedUntil`)
    - Fast-Lane-Policy (`minTier`, `rateLimitBps`).
  - Neue Runtime-Parameter:
    - `SPONSOR_FAST_LANE_MIN_TIER`
    - `SPONSOR_FAST_LANE_RATE_LIMIT_BPS`
    - `SPONSOR_CAPABILITY_AUTO_REVOKE_SEC`.
- [x] Sponsor-Routen auf finales Capability-Modell produktiv gezogen:
  - `/sponsor/reserve` und `/sponsor/execute` nutzen Capability-Entscheidung inkl. Quota-/Revocation-Gates.
  - Fast-Lane wirkt jetzt zusaetzlich als Rate-Limit-Multiplikator.
  - Auto-Revocation wird bei Abuse-Limit und Daily-Quota-Exhaust gesetzt und als `autoRevokedUntil` zurueckgegeben.
  - `/admin/sponsor/circuit` zeigt aktive Auto-Revocations + Capability-Policy.
- [x] Verifikation (2026-03-04):
  - `corepack pnpm --filter @clawdex/api lint` -> PASS.
  - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
  - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `286 passed | 3 skipped` tests.
  - On-chain:
    - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T165501444Z.json`
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T165501444Z.md`
    - Erwartete externe Blocker unveraendert:
      - `reviewer_prequalified_keys_required`
      - `arb_signer_required_for_platform_fallback`.

## Status Update (2026-03-04, Dispute-Bond Gate + Lifecycle Hardening umgesetzt)
- [x] `TASK-DQ-101` umgesetzt:
  - Milestone-Writes (`submit|accept|reject`) blockieren hart ohne aktiven Bond mit
    `409 dispute_bond_not_active` (`required`, `state`, `nextAction`).
  - `POST /bids/{listingId}/accept` liefert jetzt `disputeBondRequired`, `disputeBondState`, `disputeBondPolicy`.
- [x] `TASK-DQ-102` umgesetzt:
  - Order-Lifecycle auf `AWAITING_DEPOSITS` migriert.
  - Neue Bond-Felder in `orders`: policy/state/activated_at/marketing_campaign_id/dispute_bond_object_id.
  - Migrationen hinzugefuegt: `apps/api/db/0010_order_dispute_bond_object_id.sql`,
    `apps/api/db/0011_order_dispute_bond_lifecycle.sql`.
  - Read-Model fuer `GET /orders/{id}` + `GET /orders/{id}/timeline` auf Bond-Metadaten erweitert.
- [x] `TASK-DQ-103` umgesetzt:
  - on-chain Helper `verifyOrderDisputeBondReady` aktiv im Write-Gate.
  - Bond-State-Drift-Sync in Worker eingebaut (DB <-> on-chain), inkl. Audit bei Mismatch.
  - Reconcile setzt `IN_PROGRESS` nur bei Bond `ACTIVE` + vorhandenem Escrow.
- [x] `TASK-DQ-104` umgesetzt:
  - Doku angepasst: `docs/BOT_QUICKSTART.md`, `docs/BOT_PROTOCOL_V1.md`,
    `/home/codex/clawnera-bot-market/docs/guides/BOT_ONBOARDING.md`.
  - OpenAPI angepasst (`apps/api/openapi.yaml`): `AWAITING_DEPOSITS`, neue Order-Bond-Felder,
    erweiterte Accept-Response.
- [x] `TASK-DQ-209` geschlossen:
  - Status-Derivation setzt `IN_PROGRESS` nicht indirekt ueber Milestone-Refresh.
  - Gate bleibt `AWAITING_DEPOSITS` bis Bond+Escrow ready verifiziert sind.
- [x] Verifikation:
  - `corepack pnpm --filter @clawdex/api test` -> `256 passed`.
  - `corepack pnpm --filter @clawdex/api lint` -> PASS.
  - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
  - On-chain E2E Smoke:
    - `CLAWDEX_BOT_LISTING_API_KEY=<secret> corepack pnpm order-full-2p-onchain:e2e:testnet`
    - Ergebnis `ok=true`, `listingId=13a4583a-2a5e-4110-ba5a-34511b9a6afb`,
      `orderId=5a536dcb-3e4c-40af-9221-7cab0b2aed6e`, final `DISPUTED`.

## Status Update (2026-03-03, Dispute-Quorum Default-Testnet Recut + ABI-Adaptive E2E)
- [x] Neue Testnet-Revision fuer `claw_marketplace` publiziert:
  - Publish Tx: `Ki1mDGBd1D59Ejt7L2ySo9wUdsRcGtGnMCMpuiBeRb8`
  - Package: `0x5937fb770a641f6cd8c506c21a08cbc4b05ad904b76df56cf29d750bc8ca6ec8`
  - Shared `FeeConfig`: `0x8c6309023425e62fd5fbbe1d0da5a7ea2d3c2f378a754e2b0c4716f1cf4e9978`
  - Shared `ReputationFeeConfig`: `0xaf80ccc0dfb3a7418c5aca2c7772c9cafb1d22678f21cda5bb3222a76bbb37d6`
  - Shared `ListingDepositConfig`: `0x098800f5172822481f98eac4b2f5b2946c228a9deb622a12e222af91c9724053`
  - Shared `DisputeQuorumConfig`: `0x47397673eb57efc74e8910afa4edb4e2a8286dce6d35b4d3e6dc3695eabf6549`
  - Shared `ReviewerRegistry`: `0xfed01e79b65d8c3090ebfbe6ecfd4c0b99aa9aaf9840ca44b82fb6212a8766ef`
  - `ArbCap`: `0x9dc70c471da7efa8dc83eec69d2c084486fa8b7c49a52acee93b35c1dab5ae9c`
- [x] Runner-Kompatibilitaet gehaertet:
  - `apps/api/scripts/dispute-quorum-onchain-e2e-testnet.mjs` erkennt ABI-Varianten on-chain (alt/neu) und schaltet dynamisch:
    - `accept_dispute_case` mit/ohne `ReviewerRegistry`
    - `finalize_case_with_quorum` mit/ohne `ReviewerRegistry`
    - platform fallback mit `settlement_path` (alt) vs. mit `ReviewerRegistry` (neu)
  - Precheck-/Capability-Reporting erweitert (`acceptParamCount`, `finalizeParamCount`, `platformParamCount`, etc.).
- [x] On-chain E2E gegen neues Default-Package erfolgreich durchgespielt:
  - finaler Report: `docs/reports/dispute-quorum-onchain-e2e-testnet-20260303T203637936Z.json`
  - finale States:
    - `majority=finalized_and_escrow_resolved`
    - `replacement_no_show=replacement_round_started`
    - `fallback_timeout=fallback_resolved_and_escrow_resolved`
- [x] Test/Staging Runtime-Defaults auf neue Testnet-IDs gezogen:
  - `apps/api/wrangler.test.toml`
  - `apps/api/wrangler.staging.toml`
  - `apps/web/wrangler.test.toml`
  - `apps/web/wrangler.staging.toml`
  - `apps/api/scripts/dispute-quorum-onchain-e2e-testnet.mjs` (Default-IDs)
- [!] Hinweis zu `verify-source` auf Testnet:
  - `iota-testnet client verify-source contracts/claw_marketplace [--verify-deps]` liefert derzeit Linkage-Fehler
    (`depends on ...0003` / `...107a not in linkage table`) trotz erfolgreichem Publish; als Upstream/Testnet-Constraint dokumentiert.

## Status Update (2026-03-03, Test/Staging Deploy + Smoke nach Testnet-Recut)
- [x] Deploys mit neuen Testnet-IDs ausgerollt:
  - API test (`clawdex-api-test`): Version `c81ce0c7-9db4-44e9-8f72-169bcec88228`
  - Web test (`clawdex-web-test`): Version `58b0a263-2ca2-47b2-98ec-c3f6ea2b13bd`
  - API staging (`clawdex-api-staging`): Version `99b7f22a-9238-4374-8f15-61630b83a233`
  - Web staging (`clawdex-web-staging`): Version `ef009bb9-b8ef-424b-aef8-b9018c3687bf`
- [x] Smoke-Checks gruen:
  - `GET /health`, `GET /ready` auf test+staging jeweils `200`
  - `GET /` auf web-test + web-staging jeweils `200`
- [x] Policy-IDs live verifiziert:
  - `policy.listingDeposit.packageId` = `0x5937fb770a641f6cd8c506c21a08cbc4b05ad904b76df56cf29d750bc8ca6ec8` (test+staging)
  - `policy.reputationInitFee.packageId` = `0x5937fb770a641f6cd8c506c21a08cbc4b05ad904b76df56cf29d750bc8ca6ec8` (test+staging)
  - `policy.listingDeposit.configObjectId` = `0x098800f5172822481f98eac4b2f5b2946c228a9deb622a12e222af91c9724053`
  - `policy.reputationInitFee.configObjectId` = `0xaf80ccc0dfb3a7418c5aca2c7772c9cafb1d22678f21cda5bb3222a76bbb37d6`
- [x] Verifikations-Workaround fuer Testnet dokumentiert:
  - `iota-testnet client verify-source contracts/claw_marketplace --skip-source --verify-deps` -> `Source verification succeeded!`
  - Full source-match bleibt auf Testnet aktuell blockiert (`...0003` / `...107a` Linkage-Constraint).

## Status Update (2026-03-03, Mainnet Canary Unblock: Sponsor Reservation-ID Reuse)
- [x] Root-Cause fuer `sponsor_execute_failed` im Mainnet-Canary identifiziert:
  - `sponsor_reservations` wurde bei `ON CONFLICT (reservation_id)` so geupserted, dass `status='EXECUTED'` erhalten blieb.
  - Nach Gas-Station-Restart wurden Reservation-IDs erneut ab `1` vergeben; dadurch wurden frische Reservierungen API-seitig als bereits `EXECUTED` behandelt.
- [x] Fix umgesetzt:
  - `apps/api/src/postgresRepository.ts`:
    - bei Reservation-Upsert Status immer auf `RESERVED`
    - `executed_tx_digest` bei neuem Reserve-Write reset auf `NULL`
  - `apps/api/src/repository.ts` (In-Memory-Paritaet):
    - gleiches Verhalten (`status='RESERVED'`, `executedTxDigest` reset)
- [x] Regression-Test hinzugefuegt:
  - `apps/api/test/worker.test.ts`:
    - neuer Test `reuses reservation ids safely after a completed execute`
    - validiert doppelten Reserve/Execute-Zyklus mit wiederverwendeter `reservation_id`.
- [x] Testlauf:
  - `corepack pnpm --filter @clawdex/api exec vitest run test/worker.test.ts` -> `84 passed`.
- [x] Prod API redeployed:
  - `clawdex-api` Version `1f0ae1de-cf88-44e1-b09b-a374d659a273`.
- [x] Mainnet-Canary erneut ausgefuehrt (mit gefundeten 2P-Wallets):
  - Funding Tx fuer Seller+Buyer: `C24jZvYe65uKRCD7ww3pvsqtR6TPh2yPdamnATsmw4qX` (je `2 IOTA`).
  - E2E-Report: `docs/reports/website-e2e-mainnet-20260303T210005Z.json`.
  - Kerndaten:
    - `listingId=bb858951-cd23-492a-9cd9-3fbaa8b6313f`
    - `orderId=f0e24f34-a6b5-4803-9958-3ef2ccd4f2c4`
    - `reservationId=9`
    - `executeTxDigest=FYJnwFFzfx7PXS47cyn7pwEASHhm4NyQ4LRpwDSTciaT`
  - Warning im Report: `listing_feed_visibility_delayed` (nicht-blockierend).
- [x] Post-Run-Nachpruefung fuer denselben `orderId`:
  - final `orderStatus=COMPLETED`
  - Milestones: `SETTLED/SETTLED`.

## Status Update (2026-03-03, Gas-Station Mainnet Cutover + 1 IOTA Top-up)
- [x] Hetzner Gas-Station auf Mainnet umgestellt:
  - `/opt/clawdex/infra/gas-station/config.yaml`: `fullnode-url=https://api.mainnet.iota.cafe`
  - `/opt/clawdex/infra/gas-station/.env`: `IOTA_RPC_URL=https://api.mainnet.iota.cafe`
  - Redis wurde gemaess Config-Hinweis geflusht (`FLUSHALL`) und `gas-station` neu gestartet.
- [x] Sponsor-Wallet mit 1 IOTA aufgeladen:
  - Sponsor-Adresse: `0xd5b5936eddf70e9c19d96752c596df9648e2415fdc5f8637e0c86c7969e00b56`
  - Top-up Tx-Digest: `2ttfhHvabsZ9yzyrFFDBVdZTDFYXqD575UrX3Jwy92gk`
  - Mainnet-Balance direkt nach Transfer: `1.00 IOTA` (1 coin).
- [x] Gas-Station Funktionstest:
  - `corepack pnpm sponsor:live:smoke` erfolgreich (`reservationId=1`).
  - Metrics ohne Fehler:
    - `num_failed_reserve_gas_requests=0`
    - `num_failed_execute_tx_requests=0`
  - Verfuegbare Gas-Coins nach Init/Reserve vorhanden (`gas_station_available_gas_coin_count > 0`).

## Status Update (2026-03-03, Prod Worker Mainnet Wiring + Indexer Stale Alert Fix)
- [x] Prod Worker auf Mainnet-Contract verkabelt und ausgerollt:
  - `apps/api/wrangler.toml`:
    - `IOTA_RPC_URL=https://api.mainnet.iota.cafe`
    - `MARKETPLACE_PACKAGE_ID=0x20ad64b9b12dda6c4fc7916dff7502a85b2b22a52b90fc8948a326d0254d99d6`
    - `REPUTATION_INIT_FEE_CONFIG_OBJECT_ID=0xf4ea3303b503c921d41a020d0464e90af79b10fb862da719e6f988bbb59a59fd`
    - `LISTING_DEPOSIT_CONFIG_OBJECT_ID=0xa670e5d8001bbc6cf849ab68a2ef9b13706befecb25a7d053c0aee64432508a1`
  - `apps/web/wrangler.toml`:
    - `IOTA_RPC_URL=https://api.mainnet.iota.cafe`
    - `MARKETPLACE_PACKAGE_ID=0x20ad64b9b12dda6c4fc7916dff7502a85b2b22a52b90fc8948a326d0254d99d6`
    - `MARKETPLACE_FEE_CONFIG_OBJECT_ID=0x523c9149860ddfdd8c36971a0d80aa0009fa8a60c646c933841c8d9b74b838b9`
  - Deploys:
    - API Worker Deploy erfolgreich (Version-ID im Cloudflare Deploy-Log dokumentiert).
    - Web Worker Deploy erfolgreich (Version-ID im Cloudflare Deploy-Log dokumentiert).
- [x] Live-Verifikation:
  - `https://api.clawnera.com/policy/fees` liefert Mainnet-`packageId` + neue Config-Objekt-IDs.
  - `https://api.clawnera.com/health` = `200`.
- [x] `ClawdexIndexerStreamStale` Root-Cause behoben:
  - `clawdex-indexer-reconcile` lief noch mit Testnet-Cursorn (`indexer_state`) und schlug auf Mainnet mit
    `Could not find referenced transaction ...` fehl.
  - `/home/codex/secrets/clawdex-indexer.env` auf Mainnet (`IOTA_RPC_URL`, `INDEXER_PACKAGE_ID`) umgestellt.
  - Legacy-Cursor fuer `clawdex_escrow_events_v1%` in `indexer_state` bereinigt; danach erfolgreicher Run.
  - Neuer Cursor fuer `module_escrow` zeigt auf Publish-Tx `CVkRjqC9p71EH2X1ggea8awa8HMne3RmQmhxT8RkSPuo`.
- [x] Monitoring (Hetzner) validiert:
  - Collector-Lauf erfolgreich (`clawdex-metrics-collector.service`).
  - `clawdex_indexer_stream_heartbeat_age_seconds{stream_key="clawdex_escrow_events_v1:module_escrow"} = 214` (unter Alert-Schwelle 1800).
  - Prometheus: `ALERTS{alertname="ClawdexIndexerStreamStale",alertstate="firing"} = 0`.
- [x] Begleitende Ops-Env angepasst:
  - `/home/codex/secrets/clawdex-listing-deposit-settlement.env` auf Mainnet-Package + neues `ADMIN_CAP_OBJECT_ID`
    (`0xd570a1505c88345c280b8c9ce963865c31287ae94b795d42942a03b3156fbb09`) umgestellt; Service-Run erfolgreich.

## Status Update (2026-03-03, Mainnet Publish + Secret Rotation + Readiness Gate)
- [x] Mainnet Publish fuer `contracts/claw_marketplace` erfolgreich ausgefuehrt:
  - Tx-Digest: `CVkRjqC9p71EH2X1ggea8awa8HMne3RmQmhxT8RkSPuo`
  - Package-ID: `0x20ad64b9b12dda6c4fc7916dff7502a85b2b22a52b90fc8948a326d0254d99d6`
  - `--verify-deps` im Publish-Flow erfolgreich.
  - `contracts/claw_marketplace/Move.lock` um `[env.mainnet]` Snapshot erweitert.
- [x] Source-Verifikation auf Mainnet erfolgreich:
  - `iota client verify-source contracts/claw_marketplace --verify-deps` -> `Source verification succeeded`.
- [x] Produktive Secrets rotiert und verifiziert:
  - `GAS_STATION_AUTH` (Worker + Hetzner Gas-Station `.env`, Service-Restart),
  - `BOT_LISTING_API_KEY` (inkl. `scripts/ops/sync_bot_listing_key.sh` + Synthetic-Monitor sync),
  - `ADMIN_ADDRESS` (kanonisch auf Admin-Wallet gesetzt).
  - Post-Rotation Verifikation via `/health`, `/ready` und Smoke-Endpunkte (`200`).
- [x] Full Preflight inkl. HTTP-Smoke auf Prod-API ausgefuehrt:
  - `bash scripts/ops/preflight_mainnet_readiness.sh --with-smoke https://clawdex-api.specdrops.workers.dev`
  - Ergebnis: `12 passed, 0 failed, 0 skipped` -> `READY FOR MAINNET`
  - Log: `docs/reports/preflight-mainnet-20260303T151111Z.log` (lokal, nicht versioniert).
- [x] Go/No-Go (2026-03-03): **GO fuer Mainnet-Testbetrieb ohne Multisig**.
  - Residual Risk bleibt bis Cap-Cutover: Governance-/Admin-Caps sind noch nicht auf `2-of-3` Multisig rotiert.
  - Detailreport: `docs/reports/mainnet-readiness-20260303.md`.

## Status Update (2026-03-02, Signer Worker Split + Guardrail Tightening)
- [x] Signer-Oberflaeche physisch aus `apps/web` herausgetrennt:
  - `apps/web/src/worker.ts` blockiert `/signer*` jetzt hart mit `404 signer_not_available`.
  - Signer-Routen und Signer-API-Proxy laufen in neuem dediziertem Paket `apps/signer-web`.
- [x] Neuer dedizierter Signer-Worker (`apps/signer-web`) umgesetzt:
  - `src/worker.ts`: Signer-only Routing (`/`, `/signer`, `/signer/api/*`) + Request-Logging.
  - Guardrails: `SIGNER_ENABLED`, `SIGNER_REQUIRE_GUARD`, CIDR-Check (`SIGNER_ALLOWED_CIDRS`), Access-Token-Check (`SIGNER_ACCESS_TOKEN`).
  - Signer-API-Proxy-Allowlist (`/jobs`, `/jobs/:id`, `POST /jobs/:id/signature`, optional `/health`) mit optionalem Upstream-Bearer (`SIGNER_API_TOKEN`).
- [x] Testabdeckung getrennt:
  - `apps/web/test/worker.test.ts`: Signer bleibt auf Main-Worker deaktiviert.
  - `apps/signer-web/test/worker.test.ts`: Render, Guard-Blockaden, Proxy-Allowlist, Upstream-Config-Fehler.
- [x] Deploy/Runbook angepasst:
  - neues root script: `deploy:signer:prod` -> `@clawdex/signer-web`.
  - `docs/SIGNING_QUEUE_RUNBOOK.md` auf dedizierten Signer-Worker aktualisiert.
  - Custom-Domain fuer Signer-Worker auf `signer.specx.cc` in `apps/signer-web/wrangler.toml` gesetzt.
- [x] Signer queue API auf Hetzner ausgerollt:
  - neuer Service `clawdex-signer-api.service` (Docker, `node:22-alpine`) auf `49.13.114.125`.
  - Runtime-Dateien:
    - `/opt/clawdex/infra/signer-api/signer-api-server.mjs`
    - `/opt/clawdex/infra/signer-api/signer-api.env` (read/write token auth enabled)
    - queue root `/opt/clawdex/ops/signing-queue`
  - Tunnel-Ingress (`/etc/cloudflared/config-clawdex-pg.yml`) erweitert:
    - `signer-api.specx.cc` -> `http://127.0.0.1:9529`
  - DNS `signer-api.specx.cc` als proxied CNAME auf `<tunnel-id>.cfargotunnel.com` gesetzt.
  - Health verifiziert (`/health` mit Bearer token) lokal auf Hetzner und via `https://signer-api.specx.cc`.
- [x] Cloudflare Access vor Signer-Web aktiv:
  - Access-App `CLAWDEX Signer` fuer `signer.specx.cc` angelegt (`self_hosted`, `session_duration=24h`).
  - Access-Policy `Allow Krulc Mail` angelegt (allow nur `krulc@hotmail.de`).
  - Unauth-Verhalten verifiziert: `302` Redirect auf `clawdex.cloudflareaccess.com`.
  - Runtime-CIDR auf `SIGNER_ALLOWED_CIDRS=0.0.0.0/0` gesetzt; Zugriffsschutz erfolgt ueber Access-Policy statt IP-Drift-anfälliger CIDR-Filter.
- [x] CI/Release-Gate gegen Rueckfall gehaertet:
  - neues Script `scripts/ci/enforce_web_no_signer_surface.sh` (forbidden patterns + required hard deny in `apps/web/src/worker.ts`).
  - root script `ci:web-no-signer-surface` hinzugefuegt.
  - `.github/workflows/ci.yml`: neuer Step `Enforce web signer split`.
  - `scripts/ci/release_gate_predeploy.sh`: Stage `enforce-web-no-signer-surface`.
- [x] Verifikation:
  - `corepack pnpm --filter @clawdex/web lint && ... test && ... typecheck` -> PASS.
  - `corepack pnpm --filter @clawdex/signer-web lint && ... test && ... typecheck` -> PASS.
  - `node --check scripts/signing-queue/signer-api-server.mjs` -> PASS.
  - `bash -n scripts/signing-queue/run-signer-api.sh scripts/ops/enable_signer_queue_api_wireguard_only_access.sh` -> PASS.

## Status Update (2026-03-02, 2-of-3 Multisig Cutover Prep Automation)
- [x] Neues Bootstrap-Script fuer `2-of-3` Signer-Config hinzugefuegt:
  - `ops/multisig-cutover/scripts/bootstrap_2of3_signer_config.sh`
  - schreibt `MULTISIG_THRESHOLD=2`, `MULTISIG_PKS=<operator>,<hw1>,<hw2>`, `MULTISIG_WEIGHTS=1,1,1`.
- [x] Neues Handoff-Script fuer Cap-Cutover ohne Writes hinzugefuegt:
  - `ops/multisig-cutover/scripts/prepare_cap_rotation_handoff.sh`
  - validiert signer-set (`2-of-3`), berechnet Ziel-Multisig-Adresse, liest Publish-Tx-Inventar
    (`AdminCap`, `ArbCap`, `TreasuryCap`, `GovernanceConfig`, `UpgradeCap`) und aktuelle Owner.
  - erzeugt Artefakte:
    - Inventory-Env
    - Handoff-Markdown
    - ausfuehrbares Cutover-Script (default `MODE=dry-run`, live nur mit `MODE=execute`)
- [x] Runbook aktualisiert:
  - `ops/multisig-cutover/README.md` um neuen `Phase B.1` Ablauf erweitert.
- [x] Lokaler Secret-Prep ausgefuehrt:
  - `/home/codex/secrets/clawdex-multisig-mainnet-2of3.env` erzeugt (aktuell mit HW-Placeholdern).
- [ ] Offener finaler Input vor produktivem Cutover:
  - zwei echte Hardware-`publicBase64KeyWithFlag` Werte in
    `/home/codex/secrets/clawdex-multisig-mainnet-2of3.env` eintragen.
  - danach `prepare_cap_rotation_handoff.sh` erneut laufen lassen; dann bleibt nur `MODE=execute`
    auf dem generierten Cutover-Script als letzter operativer Schritt.

### Next Tasks List (2-of-3 Cutover Finalization)
- [ ] `MULTISIG_PKS` in `/home/codex/secrets/clawdex-multisig-mainnet-2of3.env` mit 2 echten Hardware-`publicBase64KeyWithFlag` vervollstaendigen.
- [ ] Handoff neu erzeugen:
  - `bash ops/multisig-cutover/scripts/prepare_cap_rotation_handoff.sh --env mainnet --signer-set /home/codex/secrets/clawdex-multisig-mainnet-2of3.env --out-dir /tmp/clawdex-cap-cutover-mainnet`
- [ ] Generiertes Inventory/Report/Cutover-Script gegentesten (Owner, Object-IDs, Ziel-Multisig-Adresse).
- [ ] Cutover live ausfuehren:
  - `MODE=execute bash /tmp/clawdex-cap-cutover-mainnet/<generated-cutover-script>.sh`
- [ ] Post-Cutover verifizieren: alle Caps/Governance-Objekte auf 2-of-3 Multisig-Owner und Worker weiter im signer-split Betrieb.

## Status Update (2026-03-02, P0 Hardening + Pre-Mainnet Ops Tooling)

### P0 Tasks umgesetzt
- [x] **Mailbox-Binding on-chain gehaertet** (P0-1):
  - Neues Modul `apps/api/src/onchainMailbox.ts` (RPC-Validierung: type, order_id, buyer/seller, closed).
  - Integration in `POST /orders/:orderId/mailbox`: on-chain Pruefung vor SQL-Write.
  - Fehlercodes: `mailbox_object_invalid`, `mailbox_order_mismatch`, `mailbox_participant_mismatch`, `mailbox_closed`, `mailbox_verification_unavailable`.
  - 4 Unit-Tests (`onchainMailbox.test.ts`) + 5 Integration-Tests (`worker.test.ts`).
- [x] **Prod-Fail-Fast Guardrails** (P0-3):
  - `PROD_GUARDRAILS_STRICT` in allen 3 Wrangler-Configs auf `true`.
  - `config.ts`: Validierung bei Startup — ADMIN_ADDRESS, anchor confirmation, wallet_auth Pflicht.
  - 4 Guardrails-Tests in `config.test.ts`.
- [x] **Reputation Negative Tests** (P0-4):
  - 8 Unit-Tests (`onchainReputation.test.ts`): not_configured, valid parse, invalid_type, invalid_summary, not_found, rpc_unreachable, out-of-range level.
  - 5 Integration-Tests in `worker.test.ts`: wrong type → 502, RPC unreachable → 503, duplicate profile, wrong package prefix → 502.
- **Teststand**: API 237/237, SDK 61/61, Web 12/12 — alle gruen.

### Pre-Mainnet Ops Tooling
- [x] `scripts/ops/verify_config_drift.sh`:
  - Vergleicht wrangler.toml / staging / test auf Key-Divergenz und kritische Guardrails.
  - Getestet: 0 Fehler, 8 erwartete Warnungen (env-spezifische Keys).
- [x] `scripts/ops/preflight_mainnet_readiness.sh`:
  - Unified preflight: config-drift, api/sdk/web tests, lint, typecheck, abort-coverage, abi-snapshot, e2ee gates, optional HTTP smoke.
  - Aufruf: `bash scripts/ops/preflight_mainnet_readiness.sh [--with-smoke URL]`.
- [x] `scripts/ops/rotate_secrets_with_verify.sh`:
  - Template fuer Secrets-Rotation mit Post-Rotation Health-Verify + Smoke.
  - Aufruf: `--secret NAME --file PATH --env [prod|staging|test] [--smoke-url URL]`.
- [x] CI-Gates gehaertet:
  - `ci:config-drift` und `ci:preflight` als npm-Scripts in root `package.json`.
  - Config-Drift-Check als neuer Step in `.github/workflows/ci.yml` (vor Lint).
  - Config-Drift als Stage 1 in `scripts/ci/release_gate_predeploy.sh` (vor Deploy).

### Verbleibende Mainnet-Vorbereitung (manuell)
- [x] Publish + `iota client verify-source` auf Mainnet ausfuehren. **(2026-03-03)**
- [x] Productive Secrets rotieren (`rotate_secrets_with_verify.sh`): BOT_LISTING_API_KEY, ADMIN_ADDRESS, GAS_STATION_AUTH. **(2026-03-03)**
- [x] Preflight-Run ausfuehren: `bash scripts/ops/preflight_mainnet_readiness.sh --with-smoke https://clawdex-api.specdrops.workers.dev`. **(2026-03-03)**
- [x] Go/No-Go Entscheidung dokumentieren. **(2026-03-03)**

## Status Update (2026-03-01, Qwen-assisted Pilot: Frontend GET Retry)
- Task aus `Next Steps (Autonomy Backlog)` umgesetzt:
  - `Frontend-Retry fuer sichere GETs mit Exponential Backoff`.
- Umsetzung im Web-Frontend:
  - `apps/web/src/ui.ts`:
    - neue Retry-Policy fuer sichere GETs (`/api/health`, `/api/ready`, `/api/listings/categories`, `/api/listings?limit=500`),
    - retry nur bei transienten Fehlern (`network/timeout`, `429`, `502`, `503`, `504`),
    - bounded retries (`3`) + exponential backoff + jitter (kein Endlos-Loop).
  - `apps/web/test/worker.test.ts`:
    - Regression-Checks auf Retry-Logik im gerenderten HTML-Script.
- Verifikation:
  - `corepack pnpm --filter @clawdex/web test` -> PASS (`12/12`).

## Status Update (2026-03-01, Qwen-assisted Pilot: User Error Text Standardization)
- Task aus `Next Steps (Autonomy Backlog)` umgesetzt:
  - `User-Fehlertexte standardisieren (was passiert, was wird automatisch retryt, wann erneut versuchen)`.
- Umsetzung im Web-Frontend:
  - `apps/web/src/ui.ts`:
    - standardisierte Load-Fehlerklassifikation fuer Listing-GET-Flow (`network/timeout/rate_limited/upstream_unavailable/...`),
    - einheitliche User-Meldungen mit:
      - was passiert ist,
      - ob/wie oft Auto-Retry gelaufen ist,
      - klarer Empfehlung fuer manuelles Retry-Zeitfenster.
    - Retry-Metadaten (`retryAttempts`, `retryLimit`) werden direkt aus dem GET-Retry-Wrapper in den Fehlertext uebernommen.
  - `apps/web/test/worker.test.ts`:
    - Regression-Checks fuer neue Error-Message-Formatter und Retry-Hinweis-Texte.
- Verifikation:
  - `corepack pnpm --filter @clawdex/web test` -> PASS (`12/12`).

## Status Update (2026-03-01, Governance-Hardening + Multisig-Cutover-Prep + Repo-Hygiene)
- Hardening im `claw_marketplace` abgeschlossen und committed:
  - `admin.move`: Timelock-Update-Lifecycle (`queue/approve/cancel/apply`) inkl. Events/Tests.
  - `dispute_quorum.move`: Reviewer Active-Case-Tracking von Vektor-Logik auf `dynamic_field` umgestellt.
  - `escrow.move`: `delete_settled_escrow` fuer `RELEASED|RESOLVED` eingefuehrt.
  - `reputation.move`: Profile-Owner-Tracking auf `dynamic_field` umgestellt.
  - Verifikation: `iota move test --skip-fetch-latest-git-deps` -> `143/143 PASS`.
- Observability-Tuning abgeschlossen:
  - `ClawdexIndexerStreamStale` auf pro-Stream-Alerting umgestellt.
  - Alertmanager-Routing fuer `ClawdexIndexerStreamStale` mit `group_by: [alertname, stream_key]` und `repeat_interval: 12h`.
  - Telegram-Template um `Stream: <stream_key>` erweitert.
- Multisig-Cutover-Prep abgeschlossen:
  - Toolkit + Security-Backlog unter `ops/multisig-cutover/` versioniert (`README`, `SECURITY_OPEN_POINTS_AND_RECOMMENDATIONS.md`, Scripts).
  - Referenzierte Testnet-Evidence-Reports wurden committed; offene Reports bleiben absichtlich ausserhalb des cleanen Commit-Sets.
- Repo-Hygiene aufgeraeumt:
  - Nicht referenzierte lokale Artefakte ausserhalb des Repos archiviert: `/home/codex/_archive/clawdex-untracked/20260301T121909Z`.

## Status Update (2026-02-28, Wallet-Auth Core statt globalem Bot-Gate)
- API-Gating umgestellt:
  - Core-Marketplace-Writes laufen jetzt generell ueber Wallet-Auth (`Authorization: Bearer`), ohne globales `isBot`-Pflichtgate.
  - Privilegierte Sponsor-Routen bleiben bot-gatet, wenn `WRITE_INTERACTION_MODE=bot_only` aktiv ist.
- Neue Semantik in `/capabilities`:
  - `interaction.listingCreateMode/writeInteractionMode` zeigen jetzt den offenen Core-Modus (`wallet_auth`).
  - `interaction.privilegedSponsor` zeigt separat, ob Sponsor-Routen bot-gatet sind.
- Runtime-Configs angepasst:
  - `LISTING_CREATE_MODE` in `wrangler.toml`, `wrangler.staging.toml`, `wrangler.test.toml` auf `wallet_auth` gesetzt.
  - `WRITE_INTERACTION_MODE=bot_only` bleibt fuer Sponsor-Privilegierung erhalten.

## Status Update (2026-02-28, Autonomy v2 Sponsor-Privileges umgesetzt)
- Admin-free Normalbetrieb vorbereitet (Break-glass-Admin bleibt moeglich):
  - Neue Runtime-Env: `SPONSOR_PRIVILEGE_MODE=legacy_bot|hybrid|capability`.
  - Sponsor-Gates (`/sponsor/reserve`, `/sponsor/execute`) unterstuetzen jetzt:
    - `legacy_bot` (Bot-Key + `isBot`)
    - `capability` (automatische Entscheidung, kein Bot-Key)
    - `hybrid` (Legacy oder Capability).
- Neuer Self-Visibility Endpoint:
  - `GET /actors/me/capabilities` liefert Sponsor-Entscheidung inkl. Reason-Codes/Risk-Signalen.
- `/capabilities` erweitert:
  - `interaction.privilegedSponsor` enthaelt jetzt `enabled`, `mode`, `enforcement`, `requiresBotKey`, `requiresBotProfile`.
- Runtime-Default fuer API-Deploy-Profile angepasst:
  - `SPONSOR_PRIVILEGE_MODE="capability"` in `wrangler.toml`, `wrangler.staging.toml`, `wrangler.test.toml`.
- Tests:
  - neue API-Tests fuer actor-capabilities + sponsor reserve in capability mode.

## Status Update (2026-02-28, Autonomy v2 Cleanup)
- OpenAPI korrigiert:
  - `/capabilities` Schema wieder gueltig strukturiert (`features` korrekt unter `capabilities.properties`).
  - `GET /actors/me/capabilities` nutzt korrekt `bearerAuth`.
- Doku auf admin-free Default geschaerft:
  - `capability` = kein Admin-Touch im Normalbetrieb.
  - `legacy_bot` nur noch break-glass Notfallpfad.
- Aktive `isBot`-Pflichtgate existiert nur noch im Legacy-Pfad (`SPONSOR_PRIVILEGE_MODE=legacy_bot` bzw. Legacy-Zweig in `hybrid`).

## Status Update (2026-02-28, Sponsor auf Deferred bis CLAW-Payment-Rollout)
- Produktentscheidung:
  - Sponsor wird aktuell nicht im aktiven Betriebsflow genutzt.
  - Sponsor-Activation erfolgt erst zusammen mit CLAW-coin-Payment fuer Endnutzer.
- Operative Konsequenz:
  - Keine Sponsor-On-Chain-Gates im aktuellen Release-Cut.
  - Core-Gates bleiben: Listing -> Accept -> Milestones -> Dispute (wallet-auth).
- Teststrategie angepasst:
  - `docs/TWO_PARTY_TEST_MATRIX.md` fuehrt Sponsor jetzt als dedizierten Deferred-Layer mit separaten Aktivierungs-Tests.

## Status Update (2026-02-28, Bot-Listing-Key Drift Guard umgesetzt)
- Wiederkehrender Prod-Fehler `bot_listing_key_invalid` als Secret-Drift zwischen Worker und Synthetic-Monitor abgesichert.
- Neue Ops-Sync-Utility:
  - `scripts/ops/sync_bot_listing_key.sh`
  - setzt `BOT_LISTING_API_KEY` auf Worker(s) aus lokalen Secret-Files und synchronisiert den Synthetic-Monitor.
- Synthetic-Monitor kann Bot-Key jetzt direkt aus Datei lesen:
  - `apps/api/scripts/synthetic-monitor.mjs` unterstuetzt `CLAWDEX_BOT_LISTING_API_KEY_FILE` als Fallback.
- Synthetic-Env wurde auf file-based Key umgestellt:
  - `~/secrets/clawdex-synthetic-monitor.env` enthaelt nur noch `CLAWDEX_BOT_LISTING_API_KEY_FILE=...` (kein inline Key).
- Verifikation:
  - Fehlerbild wechselte von `bot_listing_key_invalid` auf nachgelagertes Gate `bot_profile_required` (Key-Drift behoben, Bot-Profile separat operativ zu pflegen).

## Status Update (2026-02-28, Dispute-Quorum On-chain E2E Rotation-Hardening abgeschlossen)
- Runner-Hardening in `apps/api/scripts/dispute-quorum-onchain-e2e-testnet.mjs`:
  - automatische Reviewer-Rotation bei retryable Accept-Fehlern (`Abort Code: 45` / `increment_active_case_count_or_abort`),
  - scenario-spezifische Reviewer-Kandidatenpools inkl. Cross-Scenario-Backups,
  - deterministische Ephemeral-Keys fuer stateful Resume (`DQ_ENABLE_DETERMINISTIC_EPHEMERAL_KEYS=1`),
  - gasbudget-basierte Funding-Minima (Buyer/Seller/Reviewer/Arb) fuer stabile Runs mit hohem `DQ_TX_GAS_BUDGET`.
- On-chain Validierung gegen Package `0x2eadbe72e56f49e0740364a5b8b638ee9546acab0861496411e7e29333513592`:
  - finaler Report: `docs/reports/dispute-quorum-onchain-e2e-testnet-20260228T222149609Z.json`
  - Loop-State: `docs/reports/dispute-quorum-onchain-e2e-state-20260228T221743Z-pkg2ead-fixedwallet-rotation.json`
  - finale Szenario-States:
    - `majority=finalized_and_escrow_resolved`
    - `replacement_no_show=replacement_round_started`
    - `fallback_timeout=fallback_resolved_and_escrow_resolved`
- Rotation-Evidenz im Live-Run:
  - `accept_case_rejected_retryable` auf primae/backup Reviewer mit `Abort Code: 45`,
  - erfolgreicher Quorum-Abschluss mit Backup-Reviewer im finalen Majority-Set.
- Detail-Report:
  - `docs/reports/dispute-quorum-onchain-e2e-rotation-hardening-20260228.md`

## Next Steps Plan (2026-02-28, Wallet-Auth Go-Live Track)
- Dieser Plan ist bis zum Mainnet-Cutover der **kanonische** Arbeitsplan.
- Scope-Freeze:
  - Core-Flow bleibt `wallet_auth` (Listing -> Accept -> Milestones -> Dispute).
  - Sponsor bleibt **deferred** bis CLAW-Payment-Rollout (kein Release-Blocker im aktuellen Cut).
  - `isBot` bleibt nur Break-glass/Legacy, nicht Tagesbetrieb.

### P0 - Release-Blocker vor Live-Cutover
- [x] Mailbox-Binding hart machen (`order_id`, `buyer/seller`, `closed`-State vor Persistenz pruefen) + klare 4xx Fehlercodes. **(2026-03-02)**
- [x] Dispute-Plan-Binding hart machen (`orderId <-> escrowObjectId` API-seitig strikt verifizieren, kein spaetes on-chain Abort als Hauptschutz). **(rejectOrderEscrowObjectIdMismatch, bereits erledigt)**
- [x] Prod-Fail-Fast fuer Guardrails erzwingen: **(2026-03-02)**
  - `MANAGED_STORAGE_REQUIRE_CONFIRMED_ANCHOR_ON_ACCEPT=1`
  - `ADMIN_ADDRESS` muss gesetzt sein
  - `LISTING_CREATE_MODE=wallet_auth` als verpflichtender Runtime-Check.
- [x] Reputation-Live-Validierung abschliessen: **(2026-03-02)**
  - Init-Fee/Objektfluss Buyer+Seller auf aktueller Package-ID
  - API-Reputation strikt on-chain verifiziert
  - Negative Tests (duplicate profile, wrong fee, timelock violations).
- [x] Mainnet-Cutover-Run vorbereiten und als ein Ablauf testen: **(2026-03-02, Tooling fertig)**
  - Publish + `verify-source` *(manuell ausstehend)*
  - Runtime-ID/Config-Drift-Check in Worker-Configs *(verify_config_drift.sh + CI-Gate)*
  - Smoke (`/health`, `/ready`, `/listings`, `/policy/fees`) + dokumentierter Go/No-Go *(preflight_mainnet_readiness.sh)*.

### P1 - Stabilitaet und Betrieb
- [ ] Monitoring-Thresholds fuer Anchor/Timeouts nach 24-48h Produktionsfenster final tunen.
- [ ] Security-Cutover ausfuehren (produktive Secrets rotieren + Post-Rotation-Verify). *(Tooling: `rotate_secrets_with_verify.sh` bereit)*
- [x] Release-Gates in CI/Deploy verankern, damit die Test-/Abnahme-Reihenfolge nicht manuell vergessen werden kann. **(2026-03-02, config-drift in CI + release_gate_predeploy)**

### P2 - Deferred (bis CLAW-Payment aktiviert wird; Marketing-Gasless hat eigene P0-Blocker)
- [x] Sponsor-Capability-Engine (`canSponsor`, Quota/Fast-Lane, Auto-Revocation) wieder aufnehmen. **(2026-03-04)**
- [x] Sponsor-Routen (`/sponsor/reserve`, `/sponsor/execute`) auf finales Capability-Modell produktiv cutovern. **(2026-03-04)**
- [x] Sponsor-spezifische Abuse/Quota-KPIs in die produktive SLO-Definition aufnehmen. **(2026-03-04)**
- [x] Sponsor TX-Build-Anleitung fuer Bots formalisieren: **(2026-03-04)**
  - Reserve-Response liefert `gasCoins`/`gasOwner`/`gasPayment`; Bot muss diese in `TransactionData` einbauen.
  - Konkreter Ablauf: Reserve → Response parsen → TX mit Sponsor-Gas-Objekten bauen → User-Sign → Execute.
  - Realer Mainnet-Bug (2026-02) war: TX ohne korrekte `gasOwner`/`gasPayment` gebaut → Execute fehlgeschlagen.
  - Doku-Ziel: neue Dateien `docs/SPONSOR_POLICY.md` + `docs/SDK_USAGE.md` anlegen und in `docs/BOT_PROTOCOL_V1.md` verlinken.
- [x] Sponsor Circuit-Breaker-Verhalten in Bot-Docs aufnehmen: **(2026-03-04)**
  - Bereits implementiert: bei Gas-Station-Ausfall liefern `/sponsor/reserve` und `/sponsor/execute` `503 sponsor_temporarily_unavailable` + `Retry-After` Header.
  - SPONSOR_POLICY.md Failure-Sektion um `sponsor_temporarily_unavailable` + `Retry-After` Handling erweitern.
  - BOT_PROTOCOL_V1.md §8 Retry Discipline um Circuit-Breaker-spezifisches Backoff ergaenzen.
- [x] Sponsor Gas-Budget-Minimum dokumentieren: **(2026-03-04)**
  - Gas-Station hat Mindest-`gasBudget` (aktuell `1_000_000`).
  - `SponsorReserveRequest.gasBudget` unter diesem Wert fuehrt zu Reserve-Fehler.
  - In `docs/SPONSOR_POLICY.md` und `docs/API_REFERENCE.md` (neu) aufnehmen.
- [x] Sponsor Reservation-TTL konkret dokumentieren: **(2026-03-04)**
  - `SPONSOR_RESERVATION_TTL_SEC` Default `120` (2 Minuten).
  - SPONSOR_POLICY.md sagt nur "TTL kurz"; konkreten Wert oder Groessenordnung fuer Bots angeben.
  - Bot-Empfehlung: Reserve und Execute innerhalb von <60s ausfuehren, nie alte Reservationen cachen.
- [x] Self-Pay-Fallback TX-Build-Anleitung fuer Bots: **(2026-03-04)**
  - Bei `fallback: self_pay` muss Bot TX **komplett neu** ohne Sponsor-Gas-Objekte bauen (eigene Gas-Coins).
  - Konkreter Ablauf: Reserve fehlgeschlagen/fallback → TX mit eigenem Gas-Coin bauen → selbst signieren → `client.executeTransactionBlock()`.
  - Wichtig: Payment-Coin und Gas-Coin sauber trennen (nie Sponsor-Gas-Coin fuer Business-Payment missbrauchen).
  - In `docs/SPONSOR_POLICY.md` und `docs/BOT_QUICKSTART.md` als "Fallback-Pfad" Unterabschnitt dokumentieren.
- [ ] `TASK-SP-205` Schema-Migration: `SponsorReserveRequest.orderId` Backward-Compatibility:
  - Wenn `orderId` als Pflichtfeld eingefuehrt wird, bricht das bestehende Bots die kein `orderId` senden.
  - Migrationsstrategie definieren: optionales Feld → Pflichtfeld mit Uebergangsfrist, oder API-Version.
  - OpenAPI + clawnera-bot-market Docs rechtzeitig vor Cutover aktualisieren.
- [x] Sponsor-Quota-Visibility fuer Bots: **(2026-03-04, via `GET /actors/me/capabilities`)**
  - Bots brauchen vor Reserve einen Weg, ihr verbleibendes Sponsor-Budget/Quota abzufragen.
  - Option A: `GET /actors/me/capabilities` um `sponsor.quotaRemaining`/`sponsor.quotaTier` erweitern.
  - Option B: Neuer Endpoint `GET /sponsor/quota` mit `remaining`, `limit`, `resetAt`.
  - Ziel: Bots koennen pre-flight pruefen ob Sponsoring verfuegbar ist, statt blind Reserve aufzurufen.
- [ ] Signatur-/Intent-Domain-Separation fuer Sponsor-Flow:
  - User-Signatur muss einen kanonischen Intent decken: `network|order_id|reservation_id|tx_digest|expires_at|purpose`.
  - Execute akzeptiert nur, wenn Intent frisch/gueltig ist und exakt zum reservierten Kontext passt.
  - Negative Tests: replay mit alter reservation, replay auf anderer order, mutation von `txBytesB64`.
- [ ] Sponsor fuer Marketing-Orders (erst nach DQ-201 + Sponsor-Activation):
  - Marketing-Orders: `sponsor reserve/execute` als bevorzugter Pfad fuer gasless User.
  - Monitoring fuer Sponsor-Budget-Runway + Alert bei nahendem Erschoepfen.
  - Pflicht vor Marketing-GoLive: `SponsorReserveRequest.orderId` + order-gebundene Reservierungen + Intent-Guard.

### Eingeflochtene offene Punkte aus bestehendem Backlog
- Aus `Next Session Hardening Backlog`: Mailbox-Binding, Dispute-Binding, Prod-Fail-Fast.
- Aus `P0 Reputation On-chain Betrieb absichern`: kompletter Reputation-Live-Nachweis.
- Aus `Go/No-Go for Production`: Security-Cutover + formalisierter Go/No-Go mit Runtime-Evidenz.
- Sponsor-bezogene Tasks bleiben fuer den aktuellen Wallet-Auth-Release deferred; fuer Marketing-Gasless-GoLive sind DQ-Blocker (`TASK-DQ-201..209`) verpflichtend.

## Status Update (2026-02-27, Anchor-Gate auf staging+prod live)
- Rollout ausgefuehrt:
  - staging API `clawdex-api-staging` -> Version `8815d63d-2110-4165-9674-2f5493c018b1`
  - prod API `clawdex-api` -> Version `6c9a6362-2f3d-4999-a267-469a6be9f35c`
- Runtime-Config aktiviert:
  - `MANAGED_STORAGE_REQUIRE_CONFIRMED_ANCHOR_ON_ACCEPT=true` in `wrangler.staging.toml` und `wrangler.toml`.
- Live-Smoke-Checks:
  - staging: `/health=200`, `/ready=200`, `/policy/storage` => `requireConfirmedAnchorOnAccept=true`, `/capabilities` => `managedStorageAnchorEnforcedOnAccept=true`
  - prod: `/health=200`, `/ready=200`, `/policy/storage` => `requireConfirmedAnchorOnAccept=true`, `/capabilities` => `managedStorageAnchorEnforcedOnAccept=true`
- Teststatus vor Rollout:
  - `corepack pnpm --filter @clawdex/api build` -> PASS
  - `corepack pnpm --filter @clawdex/api exec vitest run test/worker.test.ts` -> PASS (`62/62`)

## Status Update (2026-02-28, Anchor-Gate Observability erweitert)
- Dashboard-Monitor (`apps/api/src/monitoring/dashboardCli.ts`) um Anchor-Gate-KPIs/Alerts erweitert:
  - Neue KPI-Felder aus `request_metrics`:
    - `manifestAnchorRequiredCount`
    - `manifestAnchorNotConfirmedCount`
    - `backendTimeoutCount`
    - `anchorPollRequestCount`, `anchorPollAvgLatencyMs`, `anchorPollP95LatencyMs`
  - Neue Alert-IDs:
    - `anchor_gate.required.spike`
    - `anchor_gate.not_confirmed.spike`
    - `backend.timeout.spike`
    - `anchor.poll_latency.p95.high`
- Neue Threshold-Env-Parameter:
  - `DASHBOARD_ALERT_MANIFEST_ANCHOR_REQUIRED_THRESHOLD` (default `5`)
  - `DASHBOARD_ALERT_MANIFEST_ANCHOR_NOT_CONFIRMED_THRESHOLD` (default `5`)
  - `DASHBOARD_ALERT_BACKEND_TIMEOUT_THRESHOLD` (default `3`)
  - `DASHBOARD_ALERT_ANCHOR_POLL_P95_LATENCY_MS` (default `5000`)
  - `DASHBOARD_ALERT_ANCHOR_POLL_MIN_SAMPLES` (default `5`)
- Runbook/Alert-Matrix aktualisiert:
  - `docs/OBSERVABILITY_DASHBOARD_RUNBOOK.md`
  - `docs/ALERT_ROUTING_MATRIX.md`
- Tests:
  - Neue Unit-Tests fuer Alert-Evaluierung: `apps/api/test/dashboard.test.ts`

## Status Update (2026-02-28, Staging Drill fuer Anchor-Gate/Indexer-Lag ausgefuehrt)
- Drill laut `docs/ANCHOR_GATE_INDEXER_LAG_RUNBOOK.md` gegen staging durchgefuehrt.
- Wichtige Korrektur im Setup:
  - Staging/Test-Befunde nur mit `clawdex_test` DB-Kontext bewerten (nicht `clawdex`).
- Ergebnis:
  - `monitor:http` staging gruen (`/health`, `/ready`, `/listings` = 200).
  - Authentifizierter Anchor-Read auf realem Fall:
    - Order `5c878b8a-5ead-49c0-9ec3-a0be1bedd92e`
    - Milestone `b63fcdf5-d39d-43de-a0b9-a4cc7cdac634`
    - API: `anchor.status=CONFIRMED`.
  - Recovery-Sequenz (`milestones:anchors:reconcile` -> `indexer:once` -> `milestones:anchors:reconcile`) in `clawdex_test`:
    - DB-Anchor blieb `PENDING`, API-Anchor blieb `CONFIRMED` (RPC-Fallback aktiv).
    - Interpretation: aktueller Indexer-Stream ingestiert kein `manifest_anchor`; DB-only-Reconcile reicht daher nicht fuer Anchor-Bestaetigung.
- Drill-Report:
  - `docs/reports/anchor-gate-indexer-lag-staging-drill-20260228.md`
- Ops-Tuning:
  - Staging-Dashboard mit env-spezifischem Synthetic-State fahren (`SYNTHETIC_MONITOR_STATE_FILE`), um Cross-Environment Alert-Rauschen zu vermeiden.

## Status Update (2026-02-28, Empfehlungen umgesetzt: Staging-Canary + Indexer Manifest-Ingest)
- Staging Bot-Key Blocker behoben:
  - `BOT_LISTING_API_KEY` auf `clawdex-api-staging` neu gesetzt (lokaler Secret-Store, Wert nicht geloggt).
  - Fehlerbild wechselte von `bot_listing_key_invalid` auf erwartete Runtime-Gates (`bot_profile_required` / `manifest_anchor_required`), danach Full-Flow mit bot-profilten Wallets + Anchor-Flag gefahren.
- Staging Full-Canary erfolgreich (Anchor-Gate aktiv):
  - Command: `order-full-2p-onchain:e2e:testnet` gegen `https://clawdex-api-staging.specdrops.workers.dev` mit
    `CLAWDEX_E2E_REQUIRE_CONFIRMED_ANCHOR_ON_ACCEPT=1`.
  - Ergebnis: `ok=true`
  - Listing: `c12b6358-d7e4-4e6f-9850-b65d596c7b1e`
  - Order: `36565b6c-9789-4998-90ee-89e8c4711cec`
  - Anchor Tx (M1): `4VdTrhFkjKaFEyGw4UCtvD46BVr8LrCQ3f8NL3pxVHFd`
  - Final: `order=DISPUTED`, milestones `[SETTLED, REJECTED]`.
  - Report: `docs/reports/order-full-2p-onchain-e2e-staging-anchor-gate-20260228.md`
- Indexer um `manifest_anchor`-Ingest erweitert:
  - API-Indexer CLI laeuft jetzt mit Multi-Run pro Filter (`INDEXER_MODULES`), statt breitem `Any`-Filter.
  - Service-Default: `events,escrow,manifest_anchor`.
  - Live-Check (`clawdex_test`): `module_manifest_anchor` lieferte `eventsFetched=5`, `anchorReconciliationsUpdated=5`.
  - Verifikation auf realem Canary-Anchor:
    - vorher DB: `PENDING`
    - nach `indexer:once`: `CONFIRMED` (inkl. `confirmed_at` gesetzt).
- Synthetic-State Entkopplung fuer staging operationalisiert:
  - `SYNTHETIC_MONITOR_STATE_FILE=/tmp/clawdex-synthetic-monitor-staging.json` in staging/test Dashboard-Env gesetzt.
  - `scripts/cloudflare/deploy_staging_stack.sh` setzt denselben State-File-Default fuer staging synthetic smoke.

## Next Session Hardening Backlog (neu 2026-02-28, Architektur-Review)
1. ~~`P1` Mailbox-Binding on-chain verifizieren~~ — **DONE (2026-03-02)**: `onchainMailbox.ts` + worker integration + 9 Tests.
2. ~~`P1` Dispute-Plan-Endpunkte auf harte Objekt-Bindung schaerfen~~ — **DONE**: `rejectOrderEscrowObjectIdMismatch` in allen relevanten Routes.
3. ~~`P1` Prod-Fail-Fast fuer kritische Guardrails~~ — **DONE (2026-03-02)**: `PROD_GUARDRAILS_STRICT` + 4 Tests.
4. ~~`P2` Test-Hardening fuer neue Gates~~ — **DONE (2026-03-02)**: 8 reputation unit-tests, 5 reputation integration-tests, 4 mailbox unit-tests, 5 mailbox integration-tests, 4 guardrails tests.

## Archiv: Next Session Strategie (Autonomy v2, vor Sponsor-Deferred Entscheidung)
- Hinweis (2026-02-28): Sponsor-bezogene Punkte in diesem Block sind fuer den aktuellen Wallet-Auth Release **deferred** und nicht release-kritisch.
- Zielbild:
  - Kein manueller Admin-Eingriff im Normalbetrieb (Break-glass nur fuer Notfaelle).
  - Core-Marketplace bleibt offen auf `wallet_auth`.
  - Privilegien (Sponsoring/Fast-Lane/Quota) werden automatisch aus objektiven Signalen vergeben und entzogen.

1. `P0` Privilege-Engine statt `isBot`-Boolean:
   - `isBot` nur noch als Legacy-Fallback behandeln (nicht als Zielmodell).
   - Neues Capability-Modell einfuehren:
     - Beispiele: `canSponsor`, `sponsorQuotaTier`, `sponsorFastLane`.
   - Capabilities serverseitig automatisch berechnen (kein Admin-Setzen):
     - Inputs: Wallet-Auth Historie, Abuse-Score, Settlement-Quote, Deposit-/Order-Historie, Reputation/Tier.
   - Expiry + Auto-Revocation + Cooldown verpflichtend (self-healing bei Missbrauch).

2. `P0` API-Gates auf Capability-Checks umstellen:
   - Sponsor-Routen (`/sponsor/reserve`, `/sponsor/execute`) von `isBot` auf `canSponsor` migrieren.
   - Laufzeitmodus fuer sichere Migration:
     - `SPONSOR_PRIVILEGE_MODE=legacy_bot|capability|hybrid`.
   - `GET /capabilities` und neuer Self-Read-Endpoint fuer Actor-Capabilities:
     - `GET /actors/me/capabilities`.

3. `P0` Vollautomatische Abuse-Mechanik:
   - Dynamische Rate-Limits je Actor/IP/Route + Fehlercluster.
   - Auto-Sanktionen: Quota runter, Capability suspendieren, Cooldown setzen.
   - Auto-Recovery via Decay/Rehabilitation nach sauberem Verhalten.
   - Nur noch "break-glass" Manual-Override fuer harte Security-Incidents.

4. `P1` Autonomy Ops + Reliability:
   - Synthetic Full-Write Journey fuer Core-Flows (ohne Sponsor bis Sponsor-Activation).
   - Circuit-Breaker/Retry/DLQ-Replay/Reconcile als Pflichtpfade in systemd/CI.
   - Explizite SLO/Alert-Gates fuer Capability-Denials vs. Abuse-Denials vs. echte Fehler.

5. `P1` Rollout- und Decommission-Plan:
   - Staging: `hybrid` (legacy + capability), dann `capability-only`.
   - Canary in Prod mit kleinem Traffic-Fenster, dann Ramp-up.
   - `legacy_bot` als break-glass Notfallpfad behalten (normalerweise deaktiviert).
   - `isBot` nicht mehr als Tagesbetriebs-Gate nutzen; nur fuer Notfall-Override solange kein alternativer Emergency-Mechanismus existiert.

6. Abnahmekriterien:
   - Neuer Wallet-Actor schafft Listing -> Accept -> Milestone -> Dispute ohne Admin-Eingriff.
   - Sponsor-Privilegien werden ohne Admin aus Signalen vergeben/entzogen.
   - Keine Erhoehung bei `5xx`, kontrolliertes `429`-Profil, stabile Abuse-KPIs.
   - `admin/users/*/tier` wird im Tagesbetrieb nicht mehr fuer Bot-Freischaltungen genutzt.

## Next Steps (ab 2026-02-28)
1. Staging-Canary mit dedizierten Bot-Wallets (kleiner Betrag) einmal End-to-End durchlaufen:
   - Listing -> Accept -> Milestone Submit -> Anchor -> Accept -> Reject/Dispute.
   - Ziel: letzter Nachweis, dass Anchor-Gate unter Live-Sponsor/Live-DB ohne Test-Sonderpfade stabil ist.
   - Status: erledigt am `2026-02-28` (Full-Canary `ok=true`, Anchor `CONFIRMED`).
2. Prod-Observability fuer Anchor-Gate:
   - Status: erledigt am `2026-02-28` (Dashboard/Alert fuer `manifest_anchor_required`, `manifest_anchor_not_confirmed`, `backend_timeout`, Poll-Latenz live im Monitor-Code).
   - Rest: reale Threshold-Tuning-Werte nach 24-48h Produktionsfenster feinjustieren.
3. Ops-Runbook erweitern:
   - Status: erledigt am `2026-02-28`.
   - Ergebnis: dediziertes Incident-Playbook `docs/ANCHOR_GATE_INDEXER_LAG_RUNBOOK.md` mit Triggern, Checks, Recovery-Sequenz (`milestones:anchors:reconcile`, `indexer:once`), manuellen Eingriffskriterien und Exit-Definition.
   - Rest: abgeschlossen (Staging-Drill + Manifest-Anchor-Ingest live verifiziert).
4. ~~Bot-Enablement-Doku konsolidieren~~ (gestrichen/ersetzt):
   - Ersetzt durch `Autonomy v2`-Doku:
     - Capability-Modell + Score/Abuse-Signale + Revocation-Regeln
     - Migrationsmodi `legacy_bot|capability|hybrid`
     - Runbook fuer "admin-free normal operation"

## Status Update (2026-02-27, Anchor-Gate live stabilisiert + Full 2P E2E gruen)
- API-Hardening ausgerollt:
  - `POST /admin/users/{address}/tier` nutzt jetzt Write-Retry (mehrere Versuche + laengeres Timeout), um `backend_timeout` auf Testnet abzufangen.
  - Manifest-Anchor-Reconcile nutzt jetzt RPC-Fallback (`iota_getTransactionBlock` mit Events), falls Indexer-Lag `chain_events` noch nicht geliefert hat.
  - Fallback aktiv in:
    - `GET /orders/{orderId}/milestones/{milestoneId}/anchor`
    - `POST /orders/{orderId}/milestones/{milestoneId}/anchor`
    - Accept-Precheck bei aktiviertem `MANAGED_STORAGE_REQUIRE_CONFIRMED_ANCHOR_ON_ACCEPT`.
- Deploy:
  - API test `clawdex-api-test` Version `1f04666a-4661-4ea4-873d-18d9a3eded08`.
- Live-Verifikation:
  - `GET /policy/storage` zeigt `requireConfirmedAnchorOnAccept=true`.
  - `GET /capabilities` zeigt `managedStorageAnchorEnforcedOnAccept=true`.
  - Bot-Tier-Setzung erfolgreich fuer Seller/Buyer Wallets (`isBot=true`, `tier=1`).
- Full 2P On-chain E2E (bot_only + anchor gate) erfolgreich:
  - Start: `2026-02-27T22:26:47.237Z`
  - Ende: `2026-02-27T22:31:10.590Z`
  - Listing: `4573477e-25c8-4b5f-b219-4e1748da277b`
  - Order: `5c878b8a-5ead-49c0-9ec3-a0be1bedd92e`
  - Anchor Tx (M1): `7tGc1PFP6iRMsn4p9x4m15hhSxVThnD2frNvMFhpwdHc`
  - Anchor Status: `CONFIRMED` (Poll attempt `1/60`)
  - Milestones: `[SETTLED, REJECTED]`
  - Final Order: `DISPUTED`
- Report:
  - `docs/reports/order-full-2p-onchain-e2e-testnet-anchor-gate-20260227.md`

## Status Update (2026-02-27, low-load on-chain gate fuer Dateiuebergabe erweitert)
- Neue optionale Runtime-Guardrail umgesetzt:
  - Env: `MANAGED_STORAGE_REQUIRE_CONFIRMED_ANCHOR_ON_ACCEPT` (default `false`)
  - Wenn aktiv: Bei manifest-basierten Milestone-Submits wird `accept` blockiert, bis der Manifest-Anchor `CONFIRMED` ist.
  - API-Fehlerbilder:
    - `manifest_anchor_required` (kein Anchor gesetzt)
    - `manifest_anchor_not_confirmed` (Anchor vorhanden, aber noch nicht `CONFIRMED`)
- Ziel: mehr On-chain-Verifikation bei minimaler Server-Last (kein serverseitiges File-Reprocessing).
- Teststatus:
  - `corepack pnpm --filter @clawdex/api exec vitest run test/config.test.ts` -> PASS
  - `corepack pnpm --filter @clawdex/api exec vitest run test/worker.test.ts -t "accepts signed manifest submission and exposes recipient-scoped artifact view"` -> PASS

## Status Update (2026-02-27, kompletter Pinata+Encrypt+Buyer-Decrypt E2E erfolgreich)
- Script erweitert auf echten Pinata-v3-JWT-Flow (`/v3/files/sign` + signed upload), inkl. Gateway-Fetch und Decrypt-Validierung.
- Test ausgefuehrt gegen Test-API:
  - `CLAWDEX_API_URL=https://clawdex-api-test.specdrops.workers.dev`
  - `node apps/api/scripts/order-checkpoint-handover-e2e-testnet.mjs`
- Ergebnis: `ok=true`
  - Pinata upload: `pinataMode=jwt_v3_signed_upload`, `pinataNetwork=public`
  - Buyer lädt Manifest per CID von Gateway und decryptet erfolgreich.
  - Seller decryptet ebenfalls erfolgreich.
  - Intruder-Decrypt wird korrekt abgewiesen.
  - Packet tamper/mismatch checks bleiben korrekt negativ.
- Reports:
  - `docs/reports/order-checkpoint-handover-e2e-testnet-pinata-20260227T211600Z.json`
  - `docs/reports/order-checkpoint-handover-e2e-testnet-pinata-20260227T211600Z.md`

## Status Update (2026-02-27, Managed Storage / Pinata aktiviert)
- Managed Storage (`mode=managed`) auf allen API-Profilen aktiviert:
  - test: `https://clawdex-api-test.specdrops.workers.dev`
  - staging: `https://clawdex-api-staging.specdrops.workers.dev`
  - prod: `https://clawdex-api.specdrops.workers.dev`
- Worker-Secrets gesetzt:
  - `MANAGED_STORAGE_PINATA_JWT`
  - `MANAGED_STORAGE_ENABLED=true`
- API Deploy-Versionen:
  - test: `21d2fa98-7684-4ce0-927d-b306733b8109`
  - staging: `fd3fd575-da94-410f-b122-b5eaeb8f74aa`
  - prod: `e78aa968-9904-4ce3-93fd-89be8a325075`
- Runtime-Checks:
  - `GET /policy/storage` -> `policy.modes.managed.enabled=true` auf test/staging/prod
  - `GET /capabilities` -> `200` auf test/staging/prod

## Status Update (2026-02-27, Pinata v3 Sign-Compat Hotfix ausgerollt)
- Root cause:
  - Pinata `v3/files/sign` erwartet in der aktuellen API sowohl `date` als auch `expires`.
  - Response liefert `data` als URL-String (nicht nur als Objekt mit `url`).
- Fix in API:
  - Request-Body erweitert um `date` (Unix-Sekunden) neben `expires`.
  - Response-Parser akzeptiert nun String- und Objekt-Formate (`data`).
  - Falls `expiresAt` fehlt, wird es aus `X-Date` + `X-Expires` der Signed-URL abgeleitet.
- Test:
  - `corepack pnpm --filter @clawdex/api exec vitest run test/worker.test.ts -t "issues managed storage signed upload url when fee event proof matches"` -> PASS
- Rollout-Versionen:
  - test: `185f372f-cbbb-4689-99d4-d7b27e9b99f2`
  - staging: `3c1e0c63-a00b-4d54-a77d-cad644cf08c8`
  - prod: `c3ba5608-ac73-4da6-9da5-8539e1e5c537`

## Status Update (2026-02-27, Positive Quorum live durchgespielt)
- Neue Testnet-Revision fuer Quorum-Unblock publiziert:
  - Publish Tx: `JC8KK9tKv5b13HgKDTeijzav5VfAzn9sMzxtY3ne8BhF`
  - Package: `0x47ad2b920193d0544203133c9e06cb27e3b17dd28f0df52551c993089c5ce06c`
  - Shared `DisputeQuorumConfig`: `0x25f435216bc0e50a9dda24bc721c3234da2f6693f8bb78ed4169a214fc8be2e5`
  - Shared `ReviewerRegistry`: `0xed7218d0b45b3bfb831fd180a9219db3aad32d15fa02eee700f3e9862822fa13`
  - Shared `FeeConfig`: `0xe98a564b1dc2e455df49f5f1e1e0eabf34c926124d9fffd9f2fa4b6221c45774`
- Positiver Majority-Livefall erfolgreich abgeschlossen:
  - Case: `0xd00d1f26fe09a7795ec4c0ba21cccaac508c6460a0bfb499e38a3edea1ed1629`
  - Bond: `0x1b019d1265595f87a506183a2f0f48a480ebc0c7f5783560ba13d6d0b5263f25`
  - Escrow: `0xfcd4ac3dcc697cf829603908af05582828a1daa88228e5546f224603a0e141eb`
  - Finalize+Resolve Tx: `8haVrMfELahohH1ED5DMdNSHsXWB1kAjXp2W8YVwAS58` (`success`)
  - Events in derselben Tx:
    - `dispute_quorum::DisputeQuorumResolved`
    - `dispute_quorum::QuorumResolutionTicketIssued`
    - `escrow::EscrowSettlement`
    - `escrow::EscrowStateChanged`
- On-chain Verifikation:
  - Case `state=3`, `resolved_path=0`, `votes_yes=2`, `votes_no=1`
  - Escrow `state=3` (resolved)
- Report:
  - `docs/reports/dispute-quorum-positive-majority-live-20260227.md`

## Status Update (2026-02-27, Dispute-Quorum On-chain E2E Runner + Blocker-Analyse)
- Neu umgesetzt:
  - Phasenfaehiger On-chain Runner hinzugefuegt:
    - `apps/api/scripts/dispute-quorum-onchain-e2e-testnet.mjs`
    - `corepack pnpm dispute-quorum:onchain:e2e:testnet`
  - Runner ist stateful (Resume ueber `docs/reports/dispute-quorum-onchain-e2e-state.json`) und schreibt JSON+MD Reports.
- Testnet-Ausfuehrung:
  - Report (latest):
    - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260227T172033359Z.json`
    - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260227T172033359Z.md`
  - On-chain Cases angelegt:
    - Majority case: `0x57d2c90766190b863108d372b1dba931569bc0c0965a0a250318d48d1c483a1d`
    - Replacement/no-show case: `0x180f691b46eccbf9c7c3091fd7b8a0de0574838d635929d4f486fc828b2fe26d`
    - Fallback case: `0x9dab54770e42e5ce6bb573a51677f826dde5fbebd5dfb888f696ce86bf232742`
- Harte Blocker fuer Majority/Replacement:
  - Reviewer-Registration faellt auf Testnet mit `Abort Code: 40` (`e_dq_reviewer_not_eligible`) aus.
  - Default `DisputeQuorumConfig` verlangt qualifizierte Reputation (`min level/confidence/score`), frische Profile sind nicht zulassungsfaehig.
  - Event-Check: `ReviewerRegistered` aktuell `0`.
- Fallback-Liveness:
  - Fallback-Case ist vorbereitet und wartet nur auf Timeout-Fenster.
  - `fallbackEligibleAtMs=1772300949538` (`2026-02-28T17:49:09.538Z` UTC).

## Status Update (2026-02-27, Publish + Verify + Runtime-Konsolidierung abgeschlossen)
- Umgesetzt in dieser Session:
  - Bytecode-Publish-Blocker gefixt:
    - Ursache war `max_fields_in_struct=32` auf Testnet; `MilestoneDisputeCase` hatte 33 Felder.
    - `dispute_quorum.move` angepasst (Case auf 32 Felder, Event-Payloads kompakter).
  - Neue Testnet-Revision erfolgreich publiziert:
    - Publish Tx: `6r8xUV5EMjD7m8bXZbERXqowne9s61qxzaTiehLWrKnp`
    - Package: `0xb5c484f5e61a72620b695a10af3b4029831633e454315d3b7f17aabc61f0e7d2`
    - Shared `FeeConfig`: `0xdee938ce2e26214c5ddaa20b93ad72442199913f4aa03e318e4ec8243ad71f8a`
    - Shared `ReputationFeeConfig`: `0x7a7e7062f3d4896cc6fe7208b314b17d2c8f8d6115cbf9dc79f02efb144a3482`
    - Shared `ListingDepositConfig`: `0xbcd2f5d9bf5d1f14299077b0a1cc339248a6ae30903cbdfab3eb017d5fd71344`
    - Shared `DisputeQuorumConfig`: `0x1fa1dd6f28d1455dd45abf376d06ac339c9e1ec26de662a19690504dd82b392e`
  - Source-Verify wieder gruen:
    - `iota-testnet client verify-source contracts/claw_marketplace --verify-deps` -> `Source verification succeeded!`
  - Test-Validierung gegen neue IDs:
    - `corepack pnpm test:contracts` -> PASS (`126/126`)
    - `MARKETPLACE_PACKAGE_ID=0xb5c4... MARKETPLACE_FEE_CONFIG_OBJECT_ID=0xdee9... corepack pnpm test:sdk:testnet` -> PASS (`1/1`)
    - `MARKETPLACE_PACKAGE_ID=0xb5c4... MARKETPLACE_FEE_CONFIG_OBJECT_ID=0xdee9... corepack pnpm test:api:testnet` -> PASS (`1/1`)
    - `corepack pnpm dispute-quorum:api:smoke:testnet` -> PASS, Report:
      - `docs/reports/dispute-quorum-api-smoke-testnet-20260227T154608294Z.json`
      - `docs/reports/dispute-quorum-api-smoke-testnet-20260227T154608294Z.md`
  - Cloudflare test rollout nachgezogen:
    - API `clawdex-api-test` Version `a1d16177-d754-4321-a4c6-4907966d6cc0`
    - Web `clawdex-web-test` Version `4f4f830a-ea3f-4691-ad6f-96b57bc14183`
    - `GET /health`, `GET /ready`, `GET /` -> jeweils `200`
    - `GET /policy/fees` auf test zeigt neue IDs (`package=0xb5c4...`, `listingDeposit=0xbcd2...`, `reputationFee=0x7a7e...`)
    - Post-deploy Smoke erneut gruen:
      - `docs/reports/dispute-quorum-api-smoke-testnet-20260227T154950324Z.json`
      - `docs/reports/dispute-quorum-api-smoke-testnet-20260227T154950324Z.md`
  - Staging + Prod rollout nachgezogen:
    - API staging `clawdex-api-staging` Version `100fe1fb-be59-42b7-9dd4-4d26f7f5085c`
    - Web staging `clawdex-web-staging` Version `efb8e227-1bd7-42a3-9e3f-bf37e6754405`
    - API prod `clawdex-api` Version `2c2e37ca-0f23-4b77-a1d3-520f94151c4a`
    - Web prod `clawdex-web` Version `f745ebb1-2c62-440f-ae37-f36de4cc8ffd`
    - `/policy/fees` auf test/staging/prod zeigt konsistent neue IDs (`0xb5c4...`, `0xbcd2...`, `0x7a7e...`).
  - Full Matrix erneuert:
    - `corepack pnpm test:matrix:2p:full` -> PASS (`Two-party test matrix finished successfully.`)
    - Hinweis: Test-Worker laeuft mit Sponsor `mock`; daher `sponsor_gas_coins_missing_mock_fallback` als nicht-blockierend via
      `CLAWDEX_E2E_BLOCKED_WARNING_CODES=sponsor_execute_failed,sponsored_tx_build_timeout` gesetzt.
  - Session-Evidenz:
    - `docs/reports/dispute-quorum-publish-unblock-20260227.md`
  - Runtime-ID Drift im Repo reduziert:
    - `.env.example`
    - `apps/api/wrangler*.toml`
    - `apps/web/wrangler*.toml`
    - auf die neue Revision synchronisiert.
  - Bereits zuvor erledigte Session-Punkte bleiben gueltig:
    - Dispute-Quorum API Smoke-Runner + Report,
    - Bot-Polling-Runbook,
    - Web-Browse UX Test-Absicherung.

## Status Update (2026-02-26, Next Session Fokus: Dispute Quorum + Reputation + Bot-Only UX)
- Aktueller Stand (bereits gruen):
  - Order-Mailbox + Kommunikations-Handshake inkl. 2P On-chain E2E verifiziert.
  - Reputation-Rollout inkl. On-chain Policy-Lifecycle verifiziert.
  - Dispute-Quorum API Route-Smoke auf dem Test-Worker verifiziert.
- Verbindlicher Fokus fuer die naechste Session:
  - Vollstaendige, wiederholbare Dispute-Quorum E2E-Landschaft (nicht nur Route-Smoke).
  - Package-ID/Config-ID Konsolidierung zwischen Test/Staging/Prod + erneute Source-Verify.
  - Web-Browse UX final gegen Produktvorgaben pruefen (English-only, hide completed, Kategorie-Sortierung, 10/20/50 Limits).

## Naechste Session: Umsetzen + Testen (Checkliste)

### P0 - Chain/Runtime Konsolidierung
- [x] Finales Testnet-Package fuer `order_mailbox`, `dispute_quorum`, `reputation` publishen (falls neuer Commit-Stand), IDs dokumentieren.
- [x] `iota-testnet client verify-source contracts/claw_marketplace --verify-deps --json` gegen die finale Revision ausfuehren.
- [x] Runtime-IDs in `apps/api/wrangler*.toml`, `apps/web/wrangler*.toml`, `.env` und Runbooks auf denselben Stand ziehen.
- [x] Drift-Check: aktive Worker-Env (test/prod) gegen Repo-ID-Stand vergleichen und Delta beheben.

### P0 - Dispute Quorum End-to-End (real on-chain)
- [x] Wiederholbaren Testscript-Run fuer echten Quorum-Flow bereitstellen (3 Reviewers, commit+reveal, finalize, escrow resolve via quorum ticket).
- [x] No-show Ersatzrunden testen: Reviewer faellt aus -> Ersatzsuche -> mehrheitliche Entscheidung.
- [x] Hard-timeout Fallback testen: keine ausreichenden Votes -> fallback resolve Pfad.
- [ ] Reviewer-Payout-Regel testen (Mehrheit gewinnt, Minderheit/no-show ohne Reward, Slashing-Pfade pruefen).
- [x] Evidenz als JSON+MD in `docs/reports/` ablegen.

### P0 - Reputation On-chain Betrieb absichern
- [ ] Reputation-Profil Init-Fee/Objektfluss fuer Buyer+Seller auf aktueller Package-ID erneut live pruefen.
- [ ] Status-Updates aus realen Order-Ausgaengen pruefen (success, dispute loss, no-show reviewer falls vorgesehen).
- [ ] API strikt on-chain verifizieren (`/users/:address/reputation` liefert keine off-chain Fallback-Werte).
- [ ] Negative Tests erneut fahren (duplicate profile, wrong fee, timelock violations).

### P1 - Bot-Kommunikation / Benachrichtigung
- [x] Bot-Polling-Runbook finalisieren: Endpunkte/Event-Quellen + Intervalle (`/orders/:id/mailbox`, `/disputes/:id`, chain events).
- [x] Retry/Backoff/TTL fuer Poller dokumentieren und im Testscript simulieren.
- [x] Sender-pays Matrix nochmals verifizieren und als feste Regel dokumentieren (tx fee immer vom Sender der Nachricht/Vote/Action).

### P1 - Web Browse UX Gate (Bot-Only Portal)
- [x] Confirm: abgeschlossene/terminale Inserate im Default-Feed ausgeblendet.
- [x] Confirm: Kategorie-Filter + Sortierung stabil bei realen Daten.
- [x] Confirm: Anzeige-Limit exakt `10/20/50`.
- [x] Confirm: Details-Panel (inkl. Milestones) nur bei Aufklappen sichtbar.
- [x] Confirm: UI-Texte fuer die Browse-Seite komplett Englisch.

### Verbindliche Testreihenfolge naechste Session
1. `cd /home/codex/clawdex && corepack pnpm test:contracts`
2. `cd /home/codex/clawdex && corepack pnpm --filter @clawdex/sdk test`
3. `cd /home/codex/clawdex && corepack pnpm --filter @clawdex/api test`
4. `cd /home/codex/clawdex && corepack pnpm order-communication:e2e:testnet`
5. `cd /home/codex/clawdex && corepack pnpm order-chat:e2e:testnet`
6. `cd /home/codex/clawdex && corepack pnpm order-checkpoint-handover:e2e:testnet`
7. `cd /home/codex/clawdex && corepack pnpm order-full-2p-onchain:e2e:testnet`
8. `cd /home/codex/clawdex && corepack pnpm test:sdk:testnet`
9. `cd /home/codex/clawdex && corepack pnpm test:api:testnet`
10. `cd /home/codex/clawdex && corepack pnpm test:matrix:2p:full`

### Go/No-Go fuer Production
- [ ] Alle 10 Testschritte gruen, keine blocker warnings.
- [ ] `GET /health`, `GET /ready`, `GET /listings`, `GET /policy/fees` auf test+prod liefern `200`.
- [x] Mindestens ein realer 2-Parteien-Fall mit Dispute-Decision erfolgreich abgeschlossen und reportet.
- [ ] Multisig Browser-Hardware-Signing Security-Backlog abarbeiten (kanonisch: `ops/multisig-cutover/SECURITY_OPEN_POINTS_AND_RECOMMENDATIONS.md`, Tasks `TASK-MSIG-001` bis `TASK-MSIG-009`).
- [ ] Security-Cutover vor Mainnet: alle produktionsrelevanten Secrets rotieren (u. a. Pinata JWT, Bot API Key, Gas-Station Auth, Cloudflare Tokens), nur als Worker-Secrets/Datei-Secret setzen, niemals in Chat/Repo.
- [ ] `docs/reports/` + `docs/NEXT_SESSION_STATUS.md` mit finalen IDs/Tx/Worker-Versionen aktualisiert.

## Status Update (2026-02-25, On-chain Rerun nach Outage erfolgreich)
- Endpoint-Lage:
  - Testnet RPC/Faucet war wieder verfuegbar (`rpc_http=200`, Faucet `202`).
- Neue Testnet-Revision publiziert:
  - Publish Tx: `BLTZA6ZCbCt5w3UhZAA77432BEZ9VU3SnR9pQVjgRDRW`
  - Package: `0x2fa4ba98adead585ec5e24851064c7325fb1f0ad63b4aeac73c7376a00ec4116`
  - Shared `FeeConfig`: `0x0fa95e27faccc55b245aef4ddfc32a43675fa95ec9f845e31d1d32c5c834c166`
  - Shared `ListingDepositConfig`: `0x8162fa45fe634160ce11af9d8ff5e59288027e2fd1e25f4a6a8276e312538fed`
  - Shared `GovernanceConfig`: `0x762f8e26cad1d5466e5651ecd818277d7fb7bf2f115656621b8aecb31ae63317`
- Source Verify:
  - `iota-testnet client verify-source contracts/claw_marketplace --verify-deps --json` -> success.
- On-chain Test-Suites gegen neue IDs:
  - `corepack pnpm test:sdk:testnet` -> PASS (`1/1`)
  - `corepack pnpm test:api:testnet` -> PASS (`1/1`)
  - `corepack pnpm test:matrix:2p:testnet` -> PASS
- Evidenzreport:
  - `docs/reports/smart-contract-hardening-testnet-validation-20260225-rerun.md`

## Status Update (2026-02-25, On-chain Testnet Blocker: RPC/Faucet/Indexer Outage)
- Kontext:
  - Code-Stand fuer Hardening + cancel-pending + shared listing-deposit defaults ist auf `main` gepusht.
  - Commits:
    - `6d7f3e6` (`feat: add cancel-pending governance paths and shared deposit defaults`)
    - `5f2a827` (`docs(reports): record testnet rpc outage during on-chain validation`)
- Ziel in dieser Session:
  - Neues `claw_marketplace` Package auf Testnet publishen und danach On-chain Tests fahren.
- Blocker (UTC):
  - `2026-02-25 21:01` bis `21:05` mehrere Publish/Health-Replays mit hartem Upstream-Fehler:
    - `iota-testnet client publish --gas-budget 2000000000 --json` -> `Request rejected 503`
    - RPC Probe `https://api.testnet.iota.cafe` (`rpc.discover`) -> durchgehend HTTP `503`
  - Parallelchecks:
    - `https://faucet.testnet.iota.cafe/v1/gas` -> HTTP `503`
    - `https://indexer.testnet.iota.cafe` -> HTTP `504` (Gateway Timeout)
    - `https://explorer.iota.org/iota2-testnet` -> HTTP `200` (Explorer erreichbar)
- Interpretation:
  - Infrastruktur-/Upstream-Ausfall, nicht paket- oder testspezifisch.
- Evidenzreport:
  - `docs/reports/onchain-validation-attempt-20260225.md`
- Resume sobald Endpoint wieder stabil ist:
  1. `cd /home/codex/clawdex/contracts/claw_marketplace && iota-testnet client publish --gas-budget 2000000000 --json`
  2. Neue IDs aus Publish-JSON extrahieren (`package`, `FeeConfig`, `ListingDepositConfig`, `GovernanceConfig`).
  3. `cd /home/codex/clawdex && iota-testnet client verify-source contracts/claw_marketplace --verify-deps --json`
  4. Testnet-Suites mit neuen IDs:
     - `corepack pnpm test:sdk:testnet`
     - `corepack pnpm test:api:testnet`
     - `corepack pnpm test:matrix:2p:testnet`

## Status Update (2026-02-23, Restore-Drill Fehlalarm via Dashboard-Misrouting gefixt)
- Root cause des Telegram-Fehlalarms:
  - `clawdex-dashboard-monitor` und `db-restore-drill` nutzten denselben n8n-Webhook.
  - Dashboard-Critical-Alert (`synthetic.success_rate.low`) wurde dadurch im n8n-Flow als Restore-Drill-Fehler formatiert (`runId: unknown`, `last runs: no history`).
- Sofortfix auf Host:
  - `DASHBOARD_ALERT_WEBHOOK_URL` aus `/home/codex/secrets/clawdex-dashboard-monitor.env` entfernt.
  - Ergebnis: Dashboard erzeugt weiter Alerts intern, liefert sie aber nicht mehr an den Restore-Drill-Webhook; damit keine falschen Restore-Drill-Telegram-Meldungen mehr.
- Offener Follow-up:
  - separaten n8n-Webhook fuer Dashboard-Alerts anlegen und in `DASHBOARD_ALERT_WEBHOOK_CRITICAL_URL`/`DASHBOARD_ALERT_WEBHOOK_WARNING_URL` eintragen.

## Offener Punkt fuer naechste Session (GitHub Actions Secrets)
- Ziel: `STAGING_BOT_LISTING_API_KEY` und `CANARY_BOT_LISTING_API_KEY` im Repo `Moron1337/Clawdex` final setzen.
- Hintergrund: aktuelles lokales PAT hat fuer Actions-Secrets nur `403` geliefert (kein Secret-Write erlaubt).
- Option A (empfohlen, UI):
  - GitHub -> `Moron1337/Clawdex` -> `Settings` -> `Secrets and variables` -> `Actions` -> beide Secrets anlegen.
- Option B (CLI mit neuem PAT):
  - Fine-grained PAT mit Repo-Recht `Secrets: Read and write` erstellen.
  - Datei lokal ablegen (z. B. `/home/codex/secrets/github-token-actions.txt`), dann:
  - `gh auth login --hostname github.com --with-token < /home/codex/secrets/github-token-actions.txt`
  - `gh secret set STAGING_BOT_LISTING_API_KEY -R Moron1337/Clawdex < /home/codex/secrets/clawdex-bot-listing-api-key-test.txt`
  - `gh secret set CANARY_BOT_LISTING_API_KEY -R Moron1337/Clawdex < /home/codex/cloudflare-restore/secrets/clawdex-bot-listing-key.txt`

## Status Update (2026-02-23, Website-E2E jetzt strikt write-only)
- `apps/api/scripts/website-e2e-testnet.mjs` laeuft jetzt fail-closed:
  - ohne `CLAWDEX_BOT_LISTING_API_KEY` -> sofort `missing_env_CLAWDEX_BOT_LISTING_API_KEY`.
  - read-only "green" laeuft nicht mehr als gueltiger E2E-Durchlauf.
  - blocked Sponsor-Warnings (`sponsor_gas_coins_missing_mock_fallback`, `sponsor_execute_failed`, `sponsored_tx_build_timeout`) brechen den Lauf jetzt ebenfalls hart ab.
- `scripts/cloudflare/deploy_staging_stack.sh` nutzt fuer `RUN_SYNTHETIC=1` jetzt zwingend den Bot-Key:
  - bei fehlendem `STAGING_BOT_LISTING_API_KEY` bricht der Run mit klarer Meldung ab.
- `scripts/cloudflare/deploy_api_canary_with_gates.sh` zieht dieselbe Guardrail nach:
  - `RUN_SYNTHETIC=1` verlangt jetzt `CANARY_BOT_LISTING_API_KEY` (oder `CLAWDEX_BOT_LISTING_API_KEY`), sonst harter Abbruch.
- `.github/workflows/deploy-gated.yml` uebergibt fuer Production-Canary jetzt:
  - `CANARY_BOT_LISTING_API_KEY` mit Workflow-Fallback auf `STAGING_BOT_LISTING_API_KEY`.
  - Damit bleibt der Gate-Lauf fail-closed im Script, ohne bestehende CI zu brechen.

## Status Update (2026-02-23, Fallback-Hardening Synthetic + Sponsor-Mode)
- Identifizierte Fail-Open/Fallback-Risiken geschlossen:
  - Synthetic-Monitor konnte zuvor read-only Runs ohne Bot-Key als `ok` werten (Scenario `null`).
  - Sponsor-Mode fiel bei fehlender Env implizit auf `mock` zurueck.
- Umgesetzt:
  - `apps/api/scripts/synthetic-monitor.mjs`
    - neue Guardrails (default fail-closed):
      - `SYNTHETIC_MONITOR_REQUIRE_WRITE_FLOW=1`
      - `SYNTHETIC_MONITOR_REQUIRE_EXECUTE_TX_DIGEST=1`
      - `SYNTHETIC_MONITOR_BLOCKED_WARNING_CODES=...`
    - Monitor markiert read-only/blocked-warning/missing execute digest jetzt als Failure.
  - `apps/api/src/config.ts`
    - `SPONSOR_PROXY_MODE` ist jetzt verpflichtend (`invalid_env_SPONSOR_PROXY_MODE` bei fehlender Env).
  - `apps/api/src/worker.ts`
    - `x-listings-cache=stale_*` wird als `errorCode` in Request-Metriken/Logs mitgeschrieben.
- Ops-Umsetzung auf Host:
  - `~/secrets/clawdex-synthetic-monitor.env` mit `CLAWDEX_BOT_LISTING_API_KEY` angelegt (`600`).
  - synthetic timer/service neu installiert (`bash scripts/ops/install_synthetic_monitor_timer.sh`).
  - Verifikation: Service-Lauf mit voller Journey inkl. `executeTxDigest` erfolgreich (`readOnly=false`, `alerts=[]`).

## Status Update (2026-02-23, Soak-48h Auswertungstermin fixiert)
- 48h Soak-Auswertung fest eingeplant:
  - Soak-Summary Timer: `clawdex-soak-summary.timer`
  - Geplanter Auswertungszeitpunkt (UTC): `2026-02-25 21:09:43`
  - Trigger laut systemd: `Wed 2026-02-25 21:09:43 UTC`
- Erwartete Report-Artefakte nach Trigger:
  - `docs/reports/soak-summary-dashboard-<timestamp>.json`
  - `docs/reports/soak-window-dashboard-<timestamp>.json`
- Manuelle Auswertung (falls vor/nach Trigger notwendig):
  - `cd /home/codex/clawdex && bash scripts/ops/generate_soak_summary.sh --window-hours 48`

## Status Update (2026-02-23, web-prod acceptance + compliance sign-off umgesetzt)
- Prod deploy aktualisiert:
  - API `clawdex-api` Version `500c8cef-293e-439c-aba1-32fea4267132`
  - Web `clawdex-web` Version `38189349-3b9e-4a4c-8783-14d429861201`
  - Smoke-Checks: `/health`, `/ready`, `/listings`, `/` => `200`
- Bot-Only Write-Gate auf Prod verifiziert:
  - Vorabfehler `bot_listing_key_invalid` reproduziert.
  - `BOT_LISTING_API_KEY` auf `clawdex-api` aus lokalem Secret-Store neu gesetzt und redeployed.
- Reale web-prod Wallet-Abnahme erfolgreich:
  - E2E Report: `docs/reports/website-e2e-web-prod-20260223-201332.json`
  - Wallet-Acceptance Report: `docs/reports/wallet-manual-acceptance-web-prod-20260223.md`
  - Ergebnis: `listingId=27dfd244-bbb9-4397-ac18-4a3c0352ea5a`, `orderId=12da6dcb-ce19-4e47-8c32-487b34d578a1`, final `COMPLETED`, Milestones `SETTLED/SETTLED`.
- Compliance Sign-off Baseline auf Prod geschlossen:
  - `COMPLIANCE_LEGAL_CHECKPOINT_LAST_DATE=2026-02-23`
  - `COMPLIANCE_LEGAL_CHECKPOINT_INTERVAL_DAYS=90`
  - `COMPLIANCE_LEGAL_CHECKPOINT_FAIL_ON_OVERDUE=true`
  - `/policy/contact` zeigt `legalCheckpoint.status=scheduled`, `nextReviewDueDate=2026-05-24`.
- Monitoring Evidence nach Prod-Abnahme:
  - `docs/reports/observability-dashboard-prod-20260223-201741.json`
  - KPI: `successfulListings=1`, `successfulAccepts=1`, `requestCount=58`, `status5xxCount=0`, `worker1101Count=0`
  - Offener Watchpoint: `latency.p95.high` warning (`9543ms` bei threshold `8000ms`).
- Formales Protokoll:
  - `docs/reports/release-go-no-go-20260223-prod.md`

## Status Update (2026-02-23, RLS-006/RLS-008/RLS-010 Execution Pass)
- RLS-006 Observability abgeschlossen:
  - API/Web schreiben jetzt einheitliche JSON Request-Logs (`requestId`, `actor`, `operation`, `latencyMs`, `outcome`, `backend`, `errorCode`).
  - Persistente Request-Metriken wurden als Migration `apps/api/db/0007_request_metrics.sql` eingefuehrt und auf Hetzner angewendet (`corepack pnpm --filter @clawdex/api db:prepare`).
  - Dashboard-Runner + Routing/Severity/Dedup/Quiet-Hours sind live:
    - `apps/api/src/monitoring/dashboardCli.ts`
    - `docs/OBSERVABILITY_DASHBOARD_RUNBOOK.md`
    - `docs/ALERT_ROUTING_MATRIX.md`
  - Reale Evidenz:
    - Baseline Snapshot: `docs/reports/observability-dashboard-20260223-194512.json`
    - Warning Alert Routing: `docs/reports/observability-dashboard-alert-test-warning-20260223-194435.json`
    - Critical Alert Routing: `docs/reports/observability-dashboard-alert-test-critical-20260223-194449.json`
- RLS-008 Listing-Deposit/Refund now end-to-end in Policy + Settlement:
  - `/policy/fees` liefert jetzt `listingDeposit.packageId` + `listingDeposit.configObjectId`.
  - Settlement CLI kann Refunds on-chain ausfuehren (`listing_deposit::refund_listing_deposit_full`) und danach DB-Status finalisieren.
  - Neue Config: `LISTING_DEPOSIT_CONFIG_OBJECT_ID`, `LISTING_DEPOSIT_SETTLEMENT_EXECUTE_ONCHAIN`, `LISTING_DEPOSIT_SETTLEMENT_ADMIN_SECRET_KEY(_FILE)`.
- RLS-010 teilweise abgeschlossen:
  - Deploy-Workflow nutzt jetzt verpflichtenden Predeploy Gate:
    - `scripts/ci/release_gate_predeploy.sh`
    - `.github/workflows/deploy-gated.yml`
    - `docs/TEST_EXECUTION_ORDER.md`
  - Freigabe-Doku angelegt:
    - `docs/WEB_PROD_WALLET_MANUAL_ACCEPTANCE.md`
    - `docs/RELEASE_GO_NO_GO_PROTOCOL.md`
- Verifikation dieses Laufs:
  - `bash scripts/ci/release_gate_predeploy.sh` -> erfolgreich (lint/typecheck/tests + `test:release:e2ee-gates`).
- Noch offen fuer Testnet-Produktionsstart:
  1. Manuelle Wallet-Abnahme auf `web-prod` real durchlaufen und protokollieren.
  2. Formales Go/No-Go Sign-off (Tech/Ops/Compliance) mit Datum/Owner dokumentieren.

## Status Update (2026-02-23, Testnet Deploy + Real-Conditions Acceptance)
- Cloudflare test deploy aktualisiert:
  - API `clawdex-api-test` Version `08cc99ea-da67-4027-8f7e-bfc56d5e448d`
  - Web `clawdex-web-test` Version `8f0d151b-7698-47ef-9eaa-ca4f14310da8`
  - Smoke: `/health`, `/ready`, `/listings`, `/` jeweils `200`.
- Full write E2E unter realen Bedingungen erneut ausgefuehrt und versioniert:
  - `docs/reports/website-e2e-testnet-20260223-195750.json`
  - Ergebnis: `listingId=c589c633-acbe-4843-a687-5f2fffdc785c`, `orderId=59c69e48-b58f-4963-b15a-feeb89f8f749`, final `COMPLETED`.
  - Warning bleibt erwartungsgemaess `sponsor_gas_coins_missing_mock_fallback` (`SPONSOR_PROXY_MODE=mock` im test worker).
- Dashboard KPI auf korrekter Testnet-DB (`clawdex_test`) verifiziert:
  - Neues RO-Monitoring-User-Setup auf Hetzner: `clawdex_monitor_ro` (nur `SELECT` auf `audit_log`, `request_metrics`).
  - Lokale Monitor-Env: `/home/codex/secrets/clawdex-dashboard-monitor-testnet.env`.
  - Report: `docs/reports/observability-dashboard-testnet-20260223-200348.json`
  - KPI: `successfulListings=2`, `successfulAccepts=2`, `requestCount=57`, `status5xxCount=0`, `worker1101Count=0`.
  - Offene Beobachtung: `latency.p95.high` warning (`12319.4ms`).
- Formale Testnet-Abnahmeprotokolle erstellt:
  - `docs/reports/wallet-manual-acceptance-20260223.md`
  - `docs/reports/release-go-no-go-20260223-testnet.md`

## Status Update (2026-02-23, Real-Conditions Listing-Deposit E2E)
- API stability fix:
  - `apps/api/src/worker.ts`: Dead-letter writes blockieren `auth/challenge` nicht mehr bei Audit-Timeout.
  - `appendAuditSafe` feuert Dead-letter enqueue jetzt best-effort und timeout-begrenzt.
- Contract fix fuer reale Wallet/PTB-Nutzung:
  - `contracts/claw_marketplace/sources/listing_deposit.move` hat neuen Entry-Call:
    - `listing_deposit::create_listing_deposit_iota_entry(...)`
    - Erstellt Deposit und transferiert intern per `transfer::transfer` an den Owner.
- Neue Testnet-Revision (Owner-Cancel Guard + Entry-Fix) publiziert:
  - Package: `0xe5fb9a2e31dfb2ad32b0935201b04e2e01e6cfd714d1dca85c29d75fab54a6ce`
  - Publish Tx: `HXDpSWPfmHAgiJzzEokikpYs3bqBE9zrtryvysiX5KHK`
  - Shared FeeConfig: `0xfc9ecee718d69ae7f96ff00781448f13670f64a6031aaa0080745b23771af8da`
  - Shared GovernanceConfig: `0xa21808eea209ee21f34439ae5fb20f790e324f3ab3bbf7d4dbccc1acbb71d28b`
  - Shared ListingDepositConfig: `0x2c7218694309d67d5f8f98d0226311ad50a01cdc578ad788fefa61638b17f2c0`
  - AdminCap: `0x827a6a4bbb4948d43bc6ca7c4c4bdf73758705828a3d0bf49e807c08aa35b4ae`
- Deposit settlement policy hardening:
  - `listing_deposit::refund_listing_deposit_owner_cancel` ist jetzt `public(package)` und extern nicht mehr direkt aufrufbar.
  - Real-E2E refundt nach Accept ueber `listing_deposit::refund_listing_deposit_full` (AdminCap-Pfad).
- Cloudflare API test redeploy:
  - Worker: `clawdex-api-test`
  - Version ID: `5da72112-ad9e-4c1e-aba5-7b209137f010`
  - URL: `https://clawdex-api-test.specdrops.workers.dev`
- Cloudflare Web test redeploy:
  - Worker: `clawdex-web-test`
  - Version ID: `c78bbfdf-27a9-4c40-821f-6e6eac5218c1`
  - URL: `https://clawdex-web-test.specdrops.workers.dev`
- Reproduzierbarer Real-E2E Script:
  - `apps/api/scripts/real-listing-deposit-e2e.mjs`
  - Nutzt echte Wallet-Signaturen (`/auth/challenge` + `/auth/verify`), On-chain Deposit/Create/Refund (AdminCap) und API Create/Accept.
- Erfolgreicher Real-E2E Lauf (2026-02-23):
  - Listing ID: `761d3ab5-a4c4-4030-a616-b920904c4712`
  - Order ID: `bb8c5681-0c70-408d-915b-d403941e05c8`
  - Deposit Object: `0x80c191cad245b463c3300c44a327b2ecf026a66840b08af59435803739e1beac`
  - Deposit Create Tx: `D9CP4LS6qfnj9PExEUMrhc9wGscNBNQgF7Jd9YTZoPdM`
  - Refund Tx: `6AaU4P7PssxuTvXG3mijCqm12hXt7K7z1J2gi87f2H74`
  - On-chain Objekt-Check: `state=1`, `refunded_total=1000000`, `locked=0` (REFUNDED).
  - API Order-Check: `GET /orders/{id}` -> `status=AWAITING_ESCROW`.
- Verifikation:
  - `corepack pnpm test:contracts` -> `54/54` gruen
  - `corepack pnpm --filter @clawdex/api test` -> `145 passed`, `3 skipped`
  - `MARKETPLACE_PACKAGE_ID=... MARKETPLACE_FEE_CONFIG_OBJECT_ID=... corepack pnpm test:api:testnet` -> `1/1` gruen
  - `MARKETPLACE_PACKAGE_ID=... MARKETPLACE_FEE_CONFIG_OBJECT_ID=... corepack pnpm test:sdk:testnet` -> `1/1` gruen
  - `CLAWDEX_BOT_LISTING_API_KEY=<set> MARKETPLACE_PACKAGE_ID=... MARKETPLACE_FEE_CONFIG_OBJECT_ID=... LISTING_DEPOSIT_CONFIG_OBJECT_ID=... CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev corepack pnpm test:matrix:2p:full` -> gruen.

## Status Update (2026-02-23, RLS-003/RLS-004 umgesetzt)
- Neue Deploy-Gate Artefakte:
  - `apps/api/wrangler.staging.toml`
  - `apps/web/wrangler.staging.toml`
  - `scripts/cloudflare/deploy_staging_stack.sh`
  - `scripts/cloudflare/deploy_api_canary_with_gates.sh`
  - `.github/workflows/deploy-gated.yml`
  - `docs/DEPLOY_GATES_CANARY_ROLLBACK_RUNBOOK.md`
- Staging (prod-parity) live:
  - API: `https://clawdex-api-staging.specdrops.workers.dev` (Version `be750806-64f7-438f-94e2-a381dde46217`)
  - Web: `https://clawdex-web-staging.specdrops.workers.dev` (Version `cb01c43b-fe70-44fe-9d81-81013ac803d9`)
  - Smoke gruen:
    - `monitor:http` auf `/health`, `/ready`, `/listings`
    - `monitor:synthetic` gegen staging web
- Canary gate unter realen Bedingungen validiert (test worker):
  - Canary success run:
    - Previous: `5da72112-ad9e-4c1e-aba5-7b209137f010`
    - Canary upload/new: `d7cc61aa-17ac-4cbf-bb99-99791e0ddcca`
    - Split `95/5`, Smoke gruen, Promotion auf `100%`.
  - Rollback dry-run:
    - Canary upload/new: `37f6c872-007b-4ffa-ade9-35617650fdd2`
    - Erzwungener Smoke-Fail ueber harte Latenz-Schwellen (`HTTP_MONITOR_MAX_LATENCY_MS_*=1`)
    - Auto-Rollback erfolgreich auf `d7cc61aa-17ac-4cbf-bb99-99791e0ddcca@100%`.
- Aktueller `clawdex-api-test` Status:
  - Deployment `b063bfd2-1c4a-45cf-9b99-178c41af2bb6`
  - Version `d7cc61aa-17ac-4cbf-bb99-99791e0ddcca` bei `100%`.

## Status Update (2026-02-23, RLS-005 Restore-Drills umgesetzt)
- Neue Restore-Drill Artefakte:
  - `apps/api/scripts/db-restore-drill.mjs`
  - `ops/systemd/clawdex-db-restore-drill.service`
  - `ops/systemd/clawdex-db-restore-drill.timer`
  - `scripts/ops/install_db_restore_drill_timer.sh`
  - `docs/DB_RESTORE_DRILL_RUNBOOK.md`
- Runtime-Setup:
  - Isolierte Drill-DB auf Hetzner angelegt: `clawdex_restore_drill` (Owner `clawdex_app`).
  - `pg_hba.conf` um erlaubten Zugriff fuer `clawdex_restore_drill` von `192.168.10.131/32` erweitert.
  - Lokale Timer-Env angelegt: `/home/codex/secrets/clawdex-db-restore-drill.env`.
- Drift-Fix vor erfolgreichem Drill:
  - Produktion hatte fehlende Migration `0006_listing_category_index.sql`.
  - Nachgezogen via `corepack pnpm db:prepare` gegen `clawdex`.
- Restore-Evidenz:
  - Letzte drei erfolgreichen Laeufe:
    - `restore-1771873141659-57beadeb` (`2026-02-23T18:59:13.430Z`)
    - `restore-1771873174077-4782c309` (`2026-02-23T18:59:46.865Z`)
    - `restore-1771873187368-256ce4e4` (`2026-02-23T18:59:59.044Z`)
  - State-Datei mit Historie: `/home/codex/.local/state/clawdex/db-restore-drill-state.json`
- Alerting:
  - `RESTORE_DRILL_ALERT_WEBHOOK_URL` gesetzt auf internen n8n-Webhook (IP-basiert, domain-unabhaengig).
  - n8n Workflow `CLAWDEX Restore Drill Alerts` aktiv.
  - Failure-Test bestaetigt (`alertDelivered=true`).
- Automation:
  - Timer installiert und aktiv: `clawdex-db-restore-drill.timer`
  - Naechster Lauf laut systemd: `2026-02-24 03:42:59 UTC`.

## Release Master Checklist
- Zentrale Release-Readiness Liste: `docs/RELEASE_READINESS_MASTER_CHECKLIST.md`
- Dezentraler E2EE-Implementierungsplan: `docs/DECENTRALIZED_E2EE_EXCHANGE_PLAN.md`

## Risk-based Finalization Order (2026-02-22)
1. Governance finalisieren (SC-01/SC-04): Multisig-/Dual-Control-Custody, Rotation-Runbook, Incident-Freeze.
2. Escrow/Dispute final absichern (SC-02/SC-05): No-permanent-lock Rules + Property-Invarianten.
3. Event/Indexer-Determinismus finalisieren (SC-03): Golden-Event Release-Gates.
4. Availability produktiv schliessen (SC-08): Pinning >=3 + SLO/Alerts + Retrieval-Drills.
5. Compliance Gate operativ schliessen (SC-10): Legal Owner + Quarterly Checkpoint + Evidenz.

Entscheidung (2026-02-22):
- Echte Multisig-Custody wird erst nach stabilen Testnet-End-to-End-Laeufen final aktiviert.
- Bis dahin: getrennte Rollen-Schluessel (Admin/Arb/Treasury) + On-chain Dual-Control/Fee-Approval/Freeze-Regeln aktiv testen.

Status Start mit Punkt 1 (2026-02-22):
- On-chain Governance erweitert:
  - Incident-Freeze Flag + Event in `admin::GovernanceConfig`.
  - Dual-Approval fuer Cap-Rotationen (zweite Freigabe vor `apply_*_cap_rotation`).
  - Emergency Rotation nur noch im Incident-Freeze-Modus.
  - Fee-Update-Pfad respektiert Incident-Freeze via `admin::assert_incident_not_frozen`.
- Move-Tests erweitert und gruen: `corepack pnpm test:contracts` -> `34/34`.

Status Start mit Punkt 2 (2026-02-22):
- Escrow/Dispute-Fairness gehaertet:
  - Timeout-Resolve (`resolve_dispute_after_timeout_to_seller`) erfordert jetzt zusaetzlich `now >= deadline_ms`.
  - Verhindert seller-forced settlement vor vertraglicher Deadline.
- State-Machine/Test-Invarianten erweitert:
  - neue Negativtests fuer illegale Transitionen (`release`/`claim_after_deadline` in `DISPUTED`, resolve ohne `DISPUTED`).
  - Boundary-Test (`now == disputed_at + timeout`) und Deadline-Guard-Test.
  - Fee-Rounding-Invariantentabelle fuer IOTA Escrows (mehrere Betraege, floor-rounding, `fee <= amount`, terminal `locked==0`).
- Move-Tests nach Erweiterung gruen: `corepack pnpm test:contracts` -> `41/41`.

Status Teilstart mit Punkt 3 (2026-02-22):
- Event-Coverage-Testtiefe erweitert:
  - `bond_tests`: `BondCreated` + `BondStateChanged` Assertions.
  - `tier_tests`: `TierLockCreated` + `TierLockStateChanged` Assertions.
  - `rewards_tests`: `RewardPoolInitialized` + `RewardPoolTotalsUpdated` + `RewardPoolStateChanged` Assertions.
  - `escrow_tests`: Dispute-timeout Event-Pfad (`EscrowCreated` + 2x `EscrowStateChanged`) als fester Test.

Status Update (2026-02-22, nach Testnet-Publish):
- Neue Testnet-Revision publiziert:
  - Package: `0xf8e862a48138923ff7bae94f532dd889511cddbd407a90b6165d499324746600`
  - Tx: `5WeBAK2hkQZaqSwd19TomEyifC6j8Z5MvpG3tH17rimG`
  - Shared FeeConfig: `0xe1f7db78959903bb326f6085b9d9b88e2b9faa38c2bb7b03e55d1241b40f367c`
  - Shared GovernanceConfig: `0xbffe9b7cacd8ffa01969f478c28869fa6bd5a808cb58c49127e520f4ef4c88ff`
- Verifikation/Läufe gegen neue IDs:
  - `iota-testnet client verify-source ... --verify-deps --json` -> Exit `0`
  - `corepack pnpm test:sdk:testnet` -> passed (`1/1`)
  - `corepack pnpm test:api:testnet` -> passed (`1/1`)
  - `corepack pnpm test:matrix:2p:full` -> passed (final order `COMPLETED`, milestones `SETTLED/SETTLED`)
- Cloudflare test redeploy:
  - API test: `f1fffe09-f14a-4393-bb2f-304fc026dcfc`
  - Web test: `b3d3f682-b611-402a-a932-78537dcacd04`
  - Smoke: `/health`, `/ready`, `/` -> `200`.
- SC-08/SC-10 Ops-Evidenz:
  - `corepack pnpm milestones:availability:probe` (nach Migrationen) -> report ohne schema warning.
  - `corepack pnpm --filter @clawdex/api retention:cleanup` (dry-run) -> erfolgreich.
  - Bugfix: `retentionCli.ts` nutzt jetzt explizit `DATABASE_URL` (vorher konnte DB-Auth fehlschlagen).

Status Update (2026-02-22, weiterer Hardening-Pass):
- SC-03 Golden-Event-Hardening erweitert:
  - Event-Payload-Helper in Move (`escrow`, `bond`, `tier`, `rewards`) hinzugefuegt.
  - Tests pruefen jetzt nicht nur Event-Anzahl, sondern konkrete Felder (`actor`, `state`, `amount`, `kind`, `epoch`, `unlock_ms`, `fee`).
  - `corepack pnpm test:contracts` weiterhin gruen (`41/41`).
- SC-08 Probe-Gate gehaertet:
  - `MILESTONE_AVAILABILITY_MIN_SAMPLE_COUNT` ergaenzt.
  - Report enthaelt jetzt `sampleSufficient`; bei `MILESTONE_AVAILABILITY_FAIL_ON_SLO_BREACH=1` wird sowohl auf SLO-Verletzung als auch zu kleine Stichprobe gefailt.
- SC-10 Legal-Checkpoint operationalisiert:
  - Neue Legal-Checkpoint-Utility + CLI: `corepack pnpm compliance:legal-checkpoint`.
  - `/policy/contact` liefert jetzt `legalCheckpoint`-Status (owner, due-date, overdue).
  - Neue Env-Gates: `COMPLIANCE_LEGAL_OWNER`, `COMPLIANCE_LEGAL_CHECKPOINT_LAST_DATE`, `COMPLIANCE_LEGAL_CHECKPOINT_INTERVAL_DAYS`, `COMPLIANCE_LEGAL_CHECKPOINT_FAIL_ON_OVERDUE`.
  - API-Tests gruen inkl. neuer Legal-Checkpoint-Tests (`102 passed`, `3 skipped`).

Status Update (2026-02-22, SC-05/SC-03 Finalisierungsschritt):
- SC-05 Escrow-Accounting-Invarianten erweitert:
  - Neues Settlement-Event `EscrowSettlement` mit `settlement_path`, `total_amount`, `fee_paid`, `seller_paid`, `buyer_paid`.
  - Settlement-Pfade (`to_seller`/`to_buyer`) sind jetzt explizit als Konstanten und Getter verfuegbar.
  - Neue Invariantentests fuer Seller-Release, Buyer-Resolve und Timeout-Resolve erzwingen `fee_paid + seller_paid + buyer_paid == total_amount`.
  - Zusatztst: `release` darf nicht zweimal ausgefuehrt werden (`e_invalid_state`).
  - Move-Tests nach Erweiterung gruen: `corepack pnpm test:contracts` -> `44/44`.
- SC-03 Indexer-Payload-Gate auf API-Seite gehaertet:
  - `deriveOrderReconciliationInstruction` lehnt Escrow-Events ohne Pflicht-Identifiers jetzt strikt ab (z. B. `EscrowCreated` ohne `order_id` oder ohne `escrow_object_id`).
  - Neue Negativtests decken fehlende IDs und ungueltige `next_state`-Werte ab.
  - API-Typecheck und API-Tests gruen: `106 passed`, `3 skipped`.

Status Update (2026-02-22, Availability Bootstrap):
- Availability-/Provider-Modell jetzt bootstrap-faehig:
  - Ein einzelner Provider funktioniert direkt (`MILESTONE_AVAILABILITY_REQUIRED_GATEWAYS=1`, `MILESTONE_AVAILABILITY_MIN_SUCCESS_GATEWAYS=1`).
  - Multi-Provider bleibt voll unterstuetzt (Gateway-Liste oder `MILESTONE_PINNING_PROVIDERS` JSON).
  - Runbook/.env entsprechend aktualisiert; Zielbild bleibt weiterhin >=3 unabhängige Provider in Produktion.

Status Update (2026-02-22, Non-Multisig-Fortsetzung):
- SC-03 Indexer Runtime-Gate erweitert:
  - `indexer/reconcile` liefert jetzt Skip-Reasons fuer ungueltige Escrow-Payloads.
  - `indexer/service` schreibt best-effort Audit-Eintraege (`indexer.reconcile.invalid_payload`) und zaehlt Invalid-Payload-Skips separat.
  - Monitoring hat neuen Alert `chain.reconcile.invalid_payload.spike` (Threshold via `MONITOR_THRESHOLD_CHAIN_RECONCILE_INVALID_PAYLOAD_COUNT`).
- SC-10 Reviewer-Separation operativ schaltbar:
  - Env-Gate `COMPLIANCE_ENFORCE_REVIEWER_SEPARATION` hinzugefuegt.
  - Wenn aktiv, darf der Notice-Entscheider nicht dieselbe Appeal entscheiden (`409 appeal_reviewer_conflict` + Audit-Event).
  - `.env.example` erweitert.
- Verifikation:
  - `corepack pnpm --filter @clawdex/api typecheck` -> gruen
  - `corepack pnpm --filter @clawdex/api test` -> `121 passed`, `3 skipped`
  - `corepack pnpm --filter @clawdex/api lint` -> gruen

## Morgen-Start (ohne Multisig)
1. SC-10 Rest sauber abschliessen:
   - Owner-Roster final setzen (Compliance, Security, Moderation, Data Protection).
   - Ziel-Env fuer Betrieb fixieren (`COMPLIANCE_ENFORCE_REVIEWER_SEPARATION=true` in prod).
2. SC-07/SC-06 weiter haerten:
   - E2EE strict-mode stufenweise fuer Produktivtraffic aktivieren.
   - Replay-/Wrong-recipient-/Tamper-Gates als feste Release-Voraussetzung fahren.
3. SC-08 produktiv ausrollen:
   - Start mit 1 Provider bleibt erlaubt.
   - Danach schrittweise auf Multi-Provider hochziehen (Zielbild >=3 unabhaengige Provider) inkl. SLO-Alerts.
4. SC-09 economic anti-spam:
   - Listing deposit/refund Design + Implementierungsplan finalisieren und in den Release-Gate aufnehmen.

Status Update (2026-02-22, Morgen-Punkte abgearbeitet):
- Erfolgreich umgesetzt:
  - SC-10 Owner-/Reviewer-Gates:
    - Neues Owner-Roster in API-Konfig + Public Policy (`/policy/contact`) integriert.
    - Rollen: `compliance`, `security`, `moderation`, `dataProtection`.
    - Reviewer-Separation bleibt aktivierbar und ist in `wrangler.toml` + `wrangler.test.toml` auf `true` gesetzt.
    - Neue Env-Keys: `COMPLIANCE_OWNER_*`, `COMPLIANCE_FAIL_ON_MISSING_OWNER_ROSTER`.
    - Legal-Checkpoint-CLI liefert jetzt auch Owner-Roster-Status und kann bei fehlenden Rollen failen.
  - SC-07/SC-06 E2EE-Hardening:
    - Strict-Mode Flags in Deploy-Configs aktiviert:
      - `ENFORCE_MILESTONE_MANIFEST_STRICT=true`
      - `ENFORCE_MILESTONE_SIGNING_CONTEXT_STRICT=true`
    - Fester Release-Gate-Command eingefuehrt:
      - `corepack pnpm test:release:e2ee-gates`
    - Testreihenfolge-Doku ergaenzt (`Stage 3b`).
  - SC-08 Availability-Rollout:
    - Probe hat jetzt Provider-Count-Gate:
      - `MILESTONE_AVAILABILITY_MIN_PROVIDER_COUNT`
      - `MILESTONE_AVAILABILITY_FAIL_ON_PROVIDER_COUNT_BREACH`
    - Bootstrap mit 1 Provider bleibt moeglich; harte Multi-Provider-Enforcement-Option ist jetzt eingebaut.
  - SC-09 economic anti-spam:
    - Listing-Deposit/Refund Ausfuehrungsplan versioniert:
      - `docs/LISTING_DEPOSIT_REFUND_EXECUTION_PLAN.md`
    - Release-Checklist referenziert den Plan explizit.
- Verifikation dieses Laufs:
  - `corepack pnpm --filter @clawdex/api typecheck` -> gruen
  - `corepack pnpm --filter @clawdex/api test` -> `123 passed`, `3 skipped`
  - `corepack pnpm --filter @clawdex/api lint` -> gruen
  - `corepack pnpm test:release:e2ee-gates` -> gruen (`SDK 6 tests`, `API 40 tests`)

Was nach diesem Lauf noch ansteht (ohne Multisig):
1. SC-10:
   - Owner-Roster auf echte produktive Verantwortliche final pinnen (statt Team-Defaults) und Quarterly-Termine in Ops/Legal kalendarisch fixieren.
2. SC-07/SC-06:
   - On-chain Manifest-Anchor Aktivierung/Abnahme finalisieren.
   - Key-lifecycle SOP (Rotation/Recovery/Revocation) als harte Betriebsrichtlinie abschliessen.
3. SC-08:
   - Produktiv auf >=3 unabhaengige Pinning-Provider inkl. echten pin endpoints und Drill-Nachweisen hochziehen.
4. SC-09:
   - Erledigt am 2026-02-23 (Contract/API/Tests + `/policy/fees` Integration).
   - Restpunkt nur noch operativ: Deploy + Beobachtung im produktiven Testnet-Traffic.

Status Update (2026-02-23, clawdex runtime cutover auf Hetzner):
- CLAWDEX runtime-Abhaengigkeiten von `codex-admin` entfernt:
  - `pg-clawdex.spec-coin.cc` und `gasstation.spec-coin.cc` zeigen beide auf Tunnel `clawdex-pg-hetzner` (`840413f1-8c44-4f40-b771-c0d1c1c3cd4f`).
  - Tunnel-Connector laeuft auf Hetzner (`49.13.114.125`) via `cloudflared-clawdex-pg.service`.
  - Hetzner-Tunnel-Origins:
    - Postgres: `tcp://127.0.0.1:5432`
    - Gas Station: `http://127.0.0.1:9527`
- Gas-Station runtime auf Hetzner aufgebaut:
  - Docker Compose: `/opt/clawdex/infra/docker-compose.gasstation.yml`
  - Container: `infra-gas-station-1`, `infra-redis-1`
  - Ports nur lokal gebunden (`127.0.0.1:9527`, `127.0.0.1:9184`), kein Public Exposure.
- Lokale clawdex infra auf `codex-admin` gestoppt:
  - `docker compose -f /home/codex/clawdex/infra/docker-compose.yml down`
  - Ergebnis: keine `infra-*` Container mehr lokal aktiv.
- Verifikation nach Cutover:
  - `https://clawdex-api.specdrops.workers.dev/ready` -> `200`
  - `https://clawdex-api-test.specdrops.workers.dev/ready` -> `200`
  - `https://gasstation.spec-coin.cc/` -> `200`
  - `corepack pnpm --filter @clawdex/api sponsor:live:smoke` -> erfolgreich.

## Current State
- Fee-System/Monetization-Hardening (2026-02-20) umgesetzt:
  - `create_escrow_iota` akzeptiert lokal keinen externen `fee_recipient`-Parameter mehr (Contract-Interface reduziert, kein User-/API-Injection-Pfad).
  - UI-Feld fuer freien Fee-Recipient entfernt (IOTA Fee-Recipient ist on-chain fix).
  - Neues Public-Policy-Endpoint `GET /policy/fees` liefert leichtgewichtige Fee-Formel:
    - `escrowFeeBps.IOTA=200`, `escrowFeeBps.CLAW=0`
    - `listingFee.model=reference_execute_gas` mit Min/Max-Klammer und BPS-Multiplikator.
  - Config-Flags fuer Listing-Fee-Formel hinzugefuegt:
    - `LISTING_FEE_REFERENCE_EXEC_GAS`, `LISTING_FEE_MULTIPLIER_BPS`, `LISTING_FEE_MIN_IOTA`, `LISTING_FEE_MAX_IOTA`, `LISTING_FEE_UPDATE_CADENCE_SEC`.
  - Contract-Hardening live: IOTA-Fee-Recipient ist on-chain fix; `create_escrow_coin<IOTA>` wird explizit geblockt (`abort 13`), und kritische Auth-Checks (`release`/`open_dispute`/`claim_after_deadline`) validieren jetzt den echten Tx-Sender statt freiem `caller`-Parameter.
- Human/Bot-Split aktiv:
  - Web-UI ist jetzt fuer Menschen read-only (nur offene Auftraege + Suche, keine Create/Accept/Settlement-Controls mehr in der Oberfläche).
  - `POST /listings` ist auf Bot-Modus umstellbar und in prod/test aktiv als `LISTING_CREATE_MODE=bot_only`.
  - Listing-Create im Bot-Modus verlangt zusaetzlich Header `x-clawdex-bot-key` (Secret `BOT_LISTING_API_KEY`) plus normalen Bearer-Token.
- Manuelle Dispute-Eskalation default deaktiviert (2026-02-20):
  - `POST /orders/:id/mark-disputed` ist standardmaessig ausgeschaltet (`ENABLE_MANUAL_DISPUTE=0`).
  - Rueckgabe bei Aufruf: `409 manual_dispute_disabled`.
  - Dispute-Status soll primär aus objektiven Regeln kommen (Milestone-Reject/Auto-Settlement/Chain-Reconcile).
- Write-Safety/State-Hardening umgesetzt (2026-02-20):
  - Idempotency-Key ist fuer kritische Write-Endpunkte aktiv: `POST /listings`, `POST /bids/:id/accept`, `POST /sponsor/execute`.
  - Replay mit identischem Key liefert gecachte Antwort (`x-idempotent-replay: 1`), parallele Doppel-Ausfuehrung wird blockiert.
  - Accept-Flow ist atomar: Listing wird nur aus `OPEN` nach `FILLED` gesetzt, wenn gleichzeitig die Order erstellt werden kann.
  - Order-Transitions werden zentral validiert (`canTransitionOrderStatus`), ungueltige Spruenge liefern `409 invalid_order_status_transition`.
  - Neue Postgres-Tabelle `write_idempotency_keys` fuer persistente Idempotency ueber Worker-Restarts hinweg.
  - Hotfix: `beginWriteIdempotency` legt Actor zuerst in `users` an (FK-safe) und nutzt Retry/Timeout-Haertung gegen Hyperdrive-Latenzspitzen.
- Degraded-Mode/Auto-Recovery Update (2026-02-20):
  - Web zeigt jetzt eine API-Health-Ampel (`ok/degraded/down`) und blendet bei Problemen einen klaren Degraded-Banner ein.
  - Bei `down` wird kein harter UI-Fehler geworfen; stattdessen kontrollierter Fallback mit Retry-Hinweis.
  - Sponsor-Gateway hat Circuit Breaker (`failure threshold` + `open window`) gegen Gas-Station-Ausfaelle.
  - Bei offenem Circuit liefern `/sponsor/reserve` und `/sponsor/execute` jetzt `503 sponsor_temporarily_unavailable` + `Retry-After`.
  - Neue Env-Parameter fuer den Circuit Breaker:
    - `GAS_STATION_CIRCUIT_FAILURE_THRESHOLD`
    - `GAS_STATION_CIRCUIT_OPEN_SEC`
- Side-Effect Dead-Letter + Retry (2026-02-20) umgesetzt:
  - Neue persistente DB-Tabelle: `side_effect_dead_letters` (`PENDING`/`RESOLVED`) fuer kritische Nebenwirkungen.
  - Worker legt Dead-Letter an bei:
    - fehlgeschlagenen Audit-Writes (`kind=AUDIT`)
    - Sponsor-Reserve/Execute Upstream-Fehlern (`SPONSOR_RESERVE`/`SPONSOR_EXECUTE`)
  - Indexer-CLI legt bei Run-Fehlern Dead-Letter an (`kind=CHAIN_SYNC`).
  - Replay-CLI live:
    - `corepack pnpm deadletters:replay` (dry-run)
    - `SIDE_EFFECT_REPLAY_COMMIT=1 corepack pnpm deadletters:replay --commit`
  - Automatischer Replay-Timer live:
    - Service: `clawdex-deadletter-replay.service`
    - Timer: `clawdex-deadletter-replay.timer` (alle 10 Minuten)
    - Env-Datei: `/home/codex/secrets/clawdex-deadletter-replay.env`
  - Aktueller Live-Status:
    - `PENDING=0`, `RESOLVED=24` (Audit-Dead-Letter erfolgreich replayed).
- Listings-Latenz-Haertung (2026-02-20):
  - `GET /listings` hat jetzt Worker-Cache mit stale-fallback:
    - hit-TTL: `3s`
    - stale-if-error Fenster: `180s`
    - stale-refresh Timeout-Budget: `1200ms`
  - Cache wird nach Listing-Write-Pfaden invalidiert:
    - nach `POST /listings`
    - nach `POST /bids/:id/accept` (Listing wird `FILLED`)
  - Response-Header fuer Diagnose:
    - `x-listings-cache=hit|miss|refresh|stale_refresh_timeout`
- Stuck-Order Watchdog (2026-02-20) live:
  - Neue CLI: `corepack pnpm watchdog:stuck-orders`
  - Regeln:
    - `AWAITING_ESCROW` ueber Schwellwert -> Auto-Cancel (`CANCELLED`)
    - `IN_PROGRESS` ueber Schwellwert -> Audit-Flag fuer Review
  - Timer live:
    - Service: `clawdex-stuck-order-watchdog.service`
    - Timer: `clawdex-stuck-order-watchdog.timer` (alle 10 Minuten)
    - Env-Datei: `/home/codex/secrets/clawdex-stuck-order-watchdog.env`
- Reconciliation-Timer (2026-02-20) live:
  - Indexer laeuft jetzt zyklisch als systemd timer:
    - Service: `clawdex-indexer-reconcile.service`
    - Timer: `clawdex-indexer-reconcile.timer` (alle 2 Minuten)
    - Env-Datei: `/home/codex/secrets/clawdex-indexer.env`
- Sponsor/Indexer Retry-Haertung (2026-02-20):
  - Sponsor-Client retryt transiente Upstream-Fehler (`timeout`, `unreachable`, `invalid_response`, `5xx`) mit Backoff.
  - Neue Env-Parameter:
    - `GAS_STATION_RETRY_ATTEMPTS` (default `2`)
    - `GAS_STATION_RETRY_BACKOFF_MS` (default `300`)
  - Indexer-RPC query retryt jetzt ebenfalls mit Backoff:
    - `INDEXER_RPC_RETRY_ATTEMPTS` (default `3`)
    - `INDEXER_RPC_RETRY_BACKOFF_MS` (default `300`)
- Sponsor-Reservation Lifecycle Hardening (2026-02-20):
  - Neue persistente Tabelle `sponsor_reservations` inkl. Status (`RESERVED`/`EXECUTED`/`EXPIRED`) + Ablaufzeit.
  - `POST /sponsor/reserve` speichert Reservation jetzt serverseitig mit `expiresAt` und liefert diese Zeit im Response.
  - `POST /sponsor/execute` validiert Reservation vor Execute:
    - muss existieren
    - muss dem Actor gehoeren
    - muss `RESERVED` und nicht abgelaufen sein
  - Neue Sweep-CLI fuer Ablaufbereinigung:
    - `corepack pnpm sponsor:reservations:sweep` (dry-run)
    - `SPONSOR_RESERVATION_SWEEP_COMMIT=1 corepack pnpm sponsor:reservations:sweep --commit`
  - systemd Templates hinzugefuegt:
    - `ops/systemd/clawdex-sponsor-reservation-sweep.service`
    - `ops/systemd/clawdex-sponsor-reservation-sweep.timer`
  - Timer live aktiviert auf `codex-admin`:
    - `clawdex-sponsor-reservation-sweep.timer` (alle 10 Minuten)
    - Env-Datei: `/home/codex/secrets/clawdex-sponsor-reservation-sweep.env`
  - Neuer Env-Parameter:
    - `SPONSOR_RESERVATION_TTL_SEC` (default `120`)
- Rewards Pipeline Automation (2026-02-21):
  - Neuer End-to-End Pipeline-CLI:
    - `corepack pnpm rewards:payout:pipeline` (dry-run)
    - `REWARDS_PIPELINE_COMMIT=1 corepack pnpm rewards:payout:pipeline --commit`
  - Pipeline-Stufen:
    - `plan` (Window + Kandidaten + Fee-Pool)
    - `review gate` (Guardrails)
    - `execute` (`plan_only` | `record_only` | `chain_transfer`)
    - `verify` (Counts + Summenabgleich)
  - Guardrail-Env:
    - `REWARDS_PIPELINE_MAX_ITEMS`
    - `REWARDS_PIPELINE_MAX_PAYOUT_POOL`
    - `REWARDS_PIPELINE_MAX_PAYOUT_PER_ITEM`
    - `REWARDS_PIPELINE_REQUIRE_NONZERO_POOL`
    - `REWARDS_PIPELINE_EXECUTION_MODE=record_only|plan_only|chain_transfer`
  - Chain-Executor-Env (`chain_transfer`):
    - `REWARDS_EXECUTOR_RPC_URL` (Fallback: `IOTA_RPC_URL`)
    - `REWARDS_EXECUTOR_SECRET_KEY_FILE` oder `REWARDS_EXECUTOR_SECRET_KEY`
    - `REWARDS_EXECUTOR_GAS_BUDGET` (optional)
  - systemd-Automation live:
    - Service: `clawdex-rewards-pipeline.service`
    - Timer: `clawdex-rewards-pipeline.timer` (alle 6 Stunden)
    - Env-Datei: `/home/codex/secrets/clawdex-rewards-pipeline.env`
- DB Migration Runner mit Versionshistorie (2026-02-21):
  - `schema_migrations` wird automatisch gepflegt (Version + SHA256 Checksum + applied_at).
  - Migration-Apply:
    - `corepack pnpm db:migrate` (Alias: `corepack pnpm db:prepare`)
  - Migration-Status:
    - `corepack pnpm db:migrations:status`
  - Verhalten:
    - Version + Checksum bereits bekannt -> skip
    - Checksum-Drift -> Hard-Fail (`migration_checksum_mismatch`)
  - Aktueller DB-Status:
    - `0001_init.sql` als `APPLIED`, `pendingCount=0`, `mismatchCount=0`.
- Human-UI Redesign (2026-02-21):
  - Read-only Human-Seite visuell aufgeraeumt und kontrastreicher umgesetzt (Hero, Statuschips, bessere Karten, mobile optimiert).
  - Health/Degraded-Logik, Such-/Refresh-Flow und bestehende Test-Hooks (`searchInput`, `btnRefreshFeed`, `listingsFeed`, `data-testid`) bleiben kompatibel.
- Gas-Station Live-Pfad ist jetzt end-to-end online:
  - Lokale Gas Station läuft via Docker (`infra/docker-compose.yml`) mit Redis + Config-Path.
  - Public Endpoint via Tunnel: `https://gasstation.spec-coin.cc`
  - API prod (`clawdex-api`) hat `SPONSOR_PROXY_MODE=live`, `GAS_STATION_URL=https://gasstation.spec-coin.cc`, Secret `GAS_STATION_AUTH` gesetzt.
- Sponsor-Live Integration wurde kompatibel zur aktuellen Gas-Station API gemacht:
  - `reserve_gas`: `reserve_duration_secs` ergänzt.
  - `execute_tx`: `user_sig` statt `signature`, `reservation_id` als Zahl (`u64`) statt String.
  - Reserve-Response parsed jetzt auch `gas_coins` und reicht sie als `reservation.gasCoins` durch.
- Website E2E (prod web) ist wieder grün inkl. Sponsor Execute:
  - `CLAWDEX_WEB_URL=https://clawdex-web.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich.
  - Execute Digest im letzten Run: `GTRU2s6C5bCERU4pCA4qLviHsDgBdiuG3BNeYxj5Mi6r`.
- Website-Testscript baut jetzt echte sponsorable TransactionData (mit `gasOwner` + `gasPayment` aus Reserve), statt ungültiger TransactionKind-Bytes.
- UI default für Sponsor Gas Budget auf `1000000` angehoben (Gas-Station Mindestbudget).
- Wichtiger Betriebsstatus:
  - API prod laeuft wieder auf `DATA_BACKEND=hyperdrive` (kein Memory-Fallback mehr aktiv).
  - Hyperdrive-Timeout-Recovery ist gehaertet:
    - kuerzere Read-Timeouts/Re-Try-Fenster fuer Cloudflare Worker Limits
    - bei `repository_timeout:*` wird der Postgres-Pool aktiv rotiert (`resetConnections`)
    - Pool-Rotation blockiert nicht mehr auf `oldPool.end()`
- DB/Timeline-Konsistenz und Latenz-Tuning (2026-02-20):
  - `/listings` in Postgres filtert/sortiert jetzt SQL-seitig auf `status='OPEN'` + `ORDER BY created_at DESC LIMIT 500` (statt teurem Full-Scan + App-Filter).
  - Default-Timeouts gesenkt: `REPOSITORY_TIMEOUT_MS=6000`, `READ_RETRY_TIMEOUT_MS=5000`, `READ_RETRY_BACKOFF_MS=120`.
  - Compliance-Profil-Read im Listing-Create wurde auf atomaren Upsert mit `RETURNING` umgestellt (kein sporadisches `address undefined` mehr).
  - `GET /orders/:id/timeline` nutzt jetzt konsistenten Repository-Pfad (`getOrderTimelineConsistent`) mit erhoehtem Route-Retry-Profil (`attempts=2`, `timeoutMs=12000`, `backoffMs=180`) gegen Hyperdrive-Spitzen.
  - Milestone-Status-Refresh laeuft write-seitig transaktional ueber `refreshOrderStatusFromMilestones` (Primary-Pfad), damit `COMPLETED` bei `SETTLED/SETTLED` stabil gesetzt wird.

- Web-Worker wurde in Module aufgeteilt:
  - `apps/web/src/worker.ts` (Router)
  - `apps/web/src/apiProxy.ts` (API-Proxy + Upstream-URL)
  - `apps/web/src/sdk.ts` (SDK Build Handler)
  - `apps/web/src/ui.ts` (HTML/UI Template)
  - `apps/web/src/types.ts`, `apps/web/src/json.ts` (Shared Types/Helpers)
- Online-Profile sind jetzt klar getrennt:
  - `clawdex-api` (`apps/api/wrangler.toml`): persistent/hyperdrive
  - `clawdex-api-test` (`apps/api/wrangler.test.toml`): memory/mock
  - `clawdex-web` (`apps/web/wrangler.toml`): zeigt auf `clawdex-api`
  - `clawdex-web-test` (`apps/web/wrangler.test.toml`): zeigt auf `clawdex-api-test`
- Letzte Deploys (`2026-02-22`):
  - API test: `f1fffe09-f14a-4393-bb2f-304fc026dcfc`
  - Web test: `b3d3f682-b611-402a-a932-78537dcacd04` (redeploy mit `MARKETPLACE_PACKAGE_ID=0xf8e862a48138923ff7bae94f532dd889511cddbd407a90b6165d499324746600` und `MARKETPLACE_FEE_CONFIG_OBJECT_ID=0xe1f7db78959903bb326f6085b9d9b88e2b9faa38c2bb7b03e55d1241b40f367c`)
  - Smoke gruen:
    - `https://clawdex-api-test.specdrops.workers.dev/health` -> `200`
    - `https://clawdex-api-test.specdrops.workers.dev/ready` -> `200`
    - `https://clawdex-web-test.specdrops.workers.dev/` -> `200`
  - Source-Verifikation final gruen:
    - `iota-testnet client verify-source contracts/claw_marketplace --verify-deps --json` erfolgreich.
    - Linkage-Fix in `contracts/claw_marketplace/Move.lock`: nur direkte Abhaengigkeiten (`Iota`, `MoveStdlib`), transitive (`IotaSystem`, `Stardust`) entfernt.
- Letzte Deploys (`2026-02-21`):
  - API test: `0aa11606-f860-4efa-97f0-13ed4d1edc53`
  - API prod: `6756f5cd-6fc3-412f-82b9-fba303ecf95e`
  - Web test: `221c594b-01dd-442e-abed-7f7dc11e4042`
  - Web prod: `6644b789-26b6-4446-8915-464a5b8de4ba`
- API Read-Resilienz verbessert:
  - `repositoryReadWithRetry` fuer kritische Read-Pfade (`/listings`, `/bids/:id/accept` Lookup, `/orders/:id`, Compliance-Reads, Admin-Reads).
  - Aktuell: `READ_RETRY_ATTEMPTS=2`, `READ_RETRY_TIMEOUT_MS=5000`, `READ_RETRY_BACKOFF_MS=120`, `REPOSITORY_TIMEOUT_MS=6000`.
  - Timeline-Route nutzt bewusst ein hoeheres Budget: `get_order_timeline_consistent` mit `attempts=2`, `timeoutMs=12000`.
- HTTP Endpoint Monitoring aktiv:
  - CLI: `corepack pnpm monitor:http`
  - Runbook: `docs/HTTP_MONITORING_RUNBOOK.md`
  - User-Systemd Timer: `clawdex-http-monitor.timer` (alle 2 Minuten)
  - Gepruefte Endpunkte: `/health`, `/ready`, `/listings`
  - Alerts: `5xx`, `Worker 1101`, Latenz-Grenzwerte
  - Incident-Burst-Logik aktiv: mehrere `worker_1101`/`backend_timeout` in Zeitfenster triggern `severity=critical` inkl. Cooldown/Dedup.
- Dead-Letter Runbook:
  - `docs/DEAD_LETTER_RUNBOOK.md`
- Stuck-Order Runbook:
  - `docs/STUCK_ORDER_WATCHDOG_RUNBOOK.md`
- Synthetic Journey Monitoring aktiv:
  - CLI: `corepack pnpm monitor:synthetic`
  - Runbook: `docs/SYNTHETIC_MONITORING_RUNBOOK.md`
  - User-Systemd Timer: `clawdex-synthetic-monitor.timer` (alle 10 Minuten)
  - Journey: `auth -> listing create -> accept -> sponsor reserve -> execute`
  - Burst-Alerting: `synthetic_run_failure_burst` via Webhook bei wiederholten Fehlschlaegen
- Website-E2E-Script gehaertet (`apps/api/scripts/website-e2e-testnet.mjs`):
  - Faucet `429` wird als Warnung `faucet_rate_limited` reportet (kein Hard-Fail mehr).
  - Listings-Feed-Check mit kurzer Polling-Phase statt Einmal-Read.
  - Bei verzögertem Feed-Read gibt es `listing_feed_visibility_delayed` als Warning statt Abbruch.
  - Ohne `CLAWDEX_BOT_LISTING_API_KEY` faehrt das Script automatisch einen read-only Smoke-Run (kein Hard-Fail).
  - Mit `CLAWDEX_BOT_LISTING_API_KEY` laeuft weiterhin der volle Flow (listing create -> accept -> sponsor execute).
  - Write-Calls senden jetzt `idempotency-key` fuer `listings/create`, `accept`, `sponsor/execute`.
  - Neu: Milestone-Journey im Write-Flow (`timeline -> submit -> accept`) inklusive Rollen-Negativtests.
  - Neu: API/Faucet-HTTP-Timeouts (`CLAWDEX_HTTP_TIMEOUT_MS`) und kuerzeres Feed-Polling gegen Hangs.
  - Neuer Schalter `CLAWDEX_E2E_REJECT_FINAL_MILESTONE=1` fuer gezielten Reject-Dispute-Test; Default bleibt `accept` (Order endet `COMPLETED`).
- End-to-End Checks heute:
  - Two-Party Matrix definiert + Runner implementiert:
    - `docs/TWO_PARTY_TEST_MATRIX.md`
    - `scripts/run_two_party_test_matrix.sh`
    - npm scripts: `test:matrix:2p:local|testnet|full`
  - `CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich.
  - `CLAWDEX_WEB_URL=https://clawdex-web.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich (mit Warning `faucet_rate_limited`).
  - Nach Timeout-Fix: 3x `CLAWDEX_WEB_URL=https://clawdex-web.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich.
  - Nach Move-Security-Update und Re-Deploy: `web-test` erfolgreich mit Warnings `faucet_rate_limited`, `sponsor_gas_coins_missing_mock_fallback`; `web-prod` erfolgreich mit on-chain `executeTxDigest`.
  - Nach Human/Bot-Split: read-only Smoke erfolgreich ohne Bot-Key; voller Flow weiterhin erfolgreich mit gesetztem `CLAWDEX_BOT_LISTING_API_KEY`.
  - Nach Idempotency/Accept-Atomik-Update: `CLAWDEX_WEB_URL=https://clawdex-web.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich (Execute Digest `DbuYBK6z3z3fGn5yy7m3vhWyWJgYouhA8CPLb7h2pVEB`).
  - Nach FK/Retry-Hotfix und Re-Deploy: `CLAWDEX_WEB_URL=https://clawdex-web.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich mit Warning `faucet_rate_limited` (Execute Digest `G7TbCC4EE8AEq1gsbJW2sBPgf82qRvksqLNh5DuzmY25`).
  - Nach Health-Ampel/Circuit-Breaker Deploy: `CLAWDEX_WEB_URL=https://clawdex-web.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich (Execute Digest `2PKRAoTaHd9afe8hggaMPx1FA1jVkQPbC33hHKXnNwE5`).
  - Nach finalem Re-Deploy (API+Web): `CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev corepack pnpm website:e2e:testnet` erfolgreich (Warning `sponsor_gas_coins_missing_mock_fallback`).
  - Nach Milestone-E2E-Upgrade: `CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev` + `CLAWDEX_BOT_LISTING_API_KEY` erfolgreich inkl. Milestone-Flow (`SETTLED/SETTLED`, final `COMPLETED`).
  - Nach DB-Latenz-/Konsistenz-Fix: `web-test` Write-E2E erneut erfolgreich (`SETTLED/SETTLED`, final `COMPLETED`).
  - Nach Timeline-Consistency-Fix + Retry-Profil: `web-prod` Write-E2E erfolgreich (Warning `faucet_rate_limited`) mit Milestone-Flow `SETTLED/SETTLED`, final `COMPLETED`, Execute Digest `6FLSt5dVmtxZ7dMiGNirXYX8LQg9kFeYFA2fyDLhVbfs`.
  - Nach Dead-Letter+Retry Deploy: `web-prod` Write-E2E erfolgreich (Warning `listing_feed_visibility_delayed`) mit Milestone-Flow `SETTLED/SETTLED`, final `COMPLETED`, Execute Digest `Bk8MTupGAgzwRJiuxvL21kVBYVoFn6HCxDYXwTBfVoNB`.
  - Nach Manual-Dispute-Disable Deploy: `web-prod` Write-E2E erneut erfolgreich (Warning `listing_feed_visibility_delayed`) mit Milestone-Flow `SETTLED/SETTLED`, final `COMPLETED`, Execute Digest `2dnmQAbzdX98JibqSitFfXnZUTgpy2tQP7gsSL9rKhLR`.
  - Nach Watchdog/Indexer/Cache Deploy: `web-prod` Write-E2E erneut erfolgreich (Warning `listing_feed_visibility_delayed`) mit Milestone-Flow `SETTLED/SETTLED`, final `COMPLETED`, Execute Digest `9tK3xZtR1BoPUMe5z6RAC4iGNJqjpUZ6XT3YsCDneWyA`.
  - Prod Read-only Smoke weiter erfolgreich (`bot_listing_api_key_missing_write_flows_skipped`).
  - Beobachtung: Prod Write-E2E kann bei hoher Backend-Latenz sehr lange laufen; Shell-Timeout-Run wurde deshalb mit SIGTERM beendet (kein funktionaler API-Fehlerbeleg, aber Ops-Latenzthema fuer separates Tuning).
  - Beobachtung: `GET /listings` liefert unter normaler Last jetzt meist <`100ms`; bei Hyperdrive-Spitzen statt ~`5s` nun schneller stale-fallback (~`1.2s`) + anschließender refresh/hit.
  - Nach Milestone-Autonomy Deploy: `web-test` und `web-prod` read-only E2E erfolgreich mit Warning `bot_listing_api_key_missing_write_flows_skipped`.
  - Nach Testnet-Re-Deploy (2026-02-22): `CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev corepack pnpm website:e2e:testnet` read-only erfolgreich (Warning `bot_listing_api_key_missing_write_flows_skipped`).
  - Nach Bot-Key Secret-Set auf `clawdex-api-test`: voller Write-E2E auf `web-test` erfolgreich (Listing/Create/Accept + Milestones `SETTLED/SETTLED`, final `COMPLETED`; Warning `sponsor_gas_coins_missing_mock_fallback`).
  - Nach Fee-Interface-Hardening Publish + `web-test` Re-Deploy: `corepack pnpm test:matrix:2p:full` gegen `MARKETPLACE_PACKAGE_ID=0xc4b533e30c4f615b6c01eec5bc09f2c280013d29cbcce5d78ae7e5641001df63` erneut erfolgreich (Write-Flow + Milestones `SETTLED/SETTLED`, final `COMPLETED`).
  - Nach Governance/Liveness + FeeConfig Publish (`0x92db29...`) und Test-Deploy-Update (`api-test` `8b83da4d...`, `web-test` `53631033...`): `corepack pnpm test:matrix:2p:full` erneut erfolgreich mit gesetztem Bot-Key (Milestones `SETTLED/SETTLED`, final `COMPLETED`).
  - Nach Timelock-/Dual-Approval-/Abuse-/Availability-Revision (`0x09e831...`) und Test-Deploy-Update (`api-test` `1d0f574b...`, `web-test` `d6d5c989...`): `corepack pnpm test:matrix:2p:full` erneut erfolgreich mit gesetztem Bot-Key (Milestones `SETTLED/SETTLED`, final `COMPLETED`).
  - Two-Party Matrix Lauf (2026-02-22):
    - `corepack pnpm test:matrix:2p:local` erfolgreich (Move `30/30`, API `42/42`, SDK `16/16`).
    - API Testnet-Flow erneut erfolgreich: `test/testnet.flow.test.ts` (`1/1`).
    - Full write E2E erneut erfolgreich mit Bot-Key auf `web-test` (final `COMPLETED`, Negative Checks `creator/seller/buyer mismatch` korrekt geblockt).
    - Komplettlauf `corepack pnpm test:matrix:2p:full` erfolgreich (alle Layer inkl. testnet API + write E2E in einem Durchgang).
- Milestone-Autonomy Backend (2026-02-20) umgesetzt:
  - Neue Order-Milestone API-Routen live im Worker-Code:
    - `GET /orders/:orderId/timeline`
    - `POST /orders/:orderId/milestones/:milestoneId/submit`
    - `POST /orders/:orderId/milestones/:milestoneId/accept`
    - `POST /orders/:orderId/milestones/:milestoneId/reject`
  - Listing-Milestones akzeptieren jetzt optional:
    - `dueAtMs`, `reviewWindowHours`, `acceptanceRulesHash`
  - Beim Accept werden `order_milestones` automatisch erzeugt (aus Listing-Milestones).
  - Neue DB-Tabelle `order_milestones` inkl. Due-/Review-Indizes.
  - Neuer Settlement-CLI-Job:
    - `corepack pnpm milestones:settle` (dry-run)
    - `MILESTONE_SETTLEMENT_COMMIT=1 corepack pnpm milestones:settle --commit`
  - Ops-Templates fuer Automation vorhanden:
    - `ops/systemd/clawdex-milestone-settlement.service`
    - `ops/systemd/clawdex-milestone-settlement.timer`
    - `scripts/ops/install_milestone_settlement_timer.sh`
  - DB-Schema live angewendet via `db:prepare` (inkl. `order_milestones`).
  - Timer live aktiviert:
    - `clawdex-milestone-settlement.timer` (`enabled`, alle 5 Minuten)
    - initialer Service-Run (`--commit`) erfolgreich, `candidateCount=0`.
  - Auto-Regeln im Settlement-Job:
    - `AUTO_REFUND` bei ueberfaelligem `PENDING`
    - `AUTO_RELEASE` bei `SUBMITTED` + abgelaufenem Review-Fenster
  - Order-Status wird dabei aus Milestone-Status abgeleitet (`IN_PROGRESS`/`COMPLETED`/`CANCELLED`/`DISPUTED`).
- Milestone 12 (Tier/Rewards) und Milestone 13 (Compliance/Security) sind lokal umgesetzt und validiert.
- Move-Paket wurde auf IOTA Testnet neu publiziert am `2026-02-20`:
  - Package ID: `0xd4709df52a57442977387d2ffab204674b44d7ab9f163208ac8158a2fb157518`
  - Tx Digest: `2WDwwHjEQgEUwx2xJQoKau5k8j9HCcnFtZh7aDjxZavt`
  - UpgradeCap: `0xa4117adb2fc1757b498a3e65e09062856196e07eeb315a2fa5734943c91c29c2`
- Move-Paket wurde erneut auf IOTA Testnet publiziert am `2026-02-22` (Fee-Interface-Hardening):
  - Package ID: `0xc4b533e30c4f615b6c01eec5bc09f2c280013d29cbcce5d78ae7e5641001df63`
  - Tx Digest: `CbgRg8hue9UUrJMzqR9uqKDASPnpC12qN7xpNfbGuCwp`
  - UpgradeCap: `0x984766d7104904fedbacf44a2642b91f3e2dd951a292afcb9dc24f0fa4e5727a`
- IDs wurden in Env/Runbooks/Test-Defaults aktualisiert (`.env.example`, `apps/web/wrangler.toml`, `docs/TESTNET_DEPLOYMENT_STATUS.md`, API/Web Testnet-Tests).
- End-to-End Checks erfolgreich:
  - `bash scripts/local_prepare_and_validate.sh`
  - `MARKETPLACE_PACKAGE_ID=0xc4b533e30c4f615b6c01eec5bc09f2c280013d29cbcce5d78ae7e5641001df63 corepack pnpm test:sdk:testnet`
  - `MARKETPLACE_PACKAGE_ID=0xc4b533e30c4f615b6c01eec5bc09f2c280013d29cbcce5d78ae7e5641001df63 corepack pnpm test:api:testnet`
- Rewards Planner validiert (Dry-Run + Commit-Testbatch):
  - Dry-Run/Commit Window-End: `2026-02-20T07:36:35Z`
  - Commit Batch ID: `e010b3e6-079e-4914-a417-d5e7c0f64505`
  - Ergebnis: `total_iota_fees=160000000`, `payout_pool=40000000`, `2` Payout-Items.
- Dabei wurde ein Bug im Planner behoben:
  - Datei: `apps/api/src/rewards/cli.ts`
  - Fix: Fee-Summenbildung auf ganzzahlige Werte (`FLOOR`) umgestellt, damit `invalid_total_iota_fees` entfaellt.
- Security-Hardening-Checks erfolgreich:
  - Secret-Scan ohne harte Leaks (nur Platzhalter/Maskierungspfade).
  - `.gitignore` und Secret-Dateirechte geprueft (`600`, owner `codex:codex`).
  - API Auth/Rate-Limit/Abuse via Tests + `corepack pnpm monitor:security` (`alertCount=0`).
  - Hyperdrive/Tunnel Reachability: `https://clawdex-api.specdrops.workers.dev/health` und `/ready` jeweils HTTP `200`.
- Dezentrale Deliverable-Security (2026-02-22) neu spezifiziert:
  - Zentrales Architektur-/Abarbeitungsdokument erstellt: `docs/DECENTRALIZED_E2EE_EXCHANGE_PLAN.md`.
  - Bestehende Milestone-Felder werden dafuer verbindlich eingeordnet:
    - `submissionProofHash = sha256(manifest)`
    - `submissionRef = ipfs://<manifestCid>`
  - Zielbild: E2EE by default + optionaler on-chain Manifest-Anchor fuer manipulationssicheren Nachweis.
- E2EE-Foundation Implementierung gestartet (2026-02-22):
  - Neue DB-Migration: `apps/api/db/0002_e2ee_exchange_foundation.sql` (`user_key_agreements`, `milestone_artifact_manifests`, `milestone_artifact_recipients`).
  - Neue API-Routen live im Worker-Code:
    - `PUT /users/me/key-agreement` (wallet-signierte Key-Bindung + upsert)
    - `GET /users/:address/key-agreement` (latest oder `?keyVersion=...`)
    - `GET /orders/:orderId/milestones/:milestoneId/artifact-manifest` (seller sieht alle wraps, buyer nur eigenen wrap)
  - Milestone-Submit Haertung erweitert:
    - Feature-Flag `ENFORCE_MILESTONE_MANIFEST_STRICT`
    - bei aktivem Flag ist ein signiertes `manifest` Pflicht (inkl. Recipient-Wraps)
    - serverseitig verifiziert: seller-signature, manifest-hash, ipfs-ref, recipient-key-bindings.
    - Persistenz in `milestone_artifact_manifests` + `milestone_artifact_recipients` laeuft transaktional mit Submit.
  - Spec-Freeze/ADR:
    - `docs/ADR_E2EE_MANIFEST_V1.md` beschreibt verbindliches `v1` Signatur-/Hash-Verfahren.
  - SDK-Start (E2EE-03):
    - Neues Modul `packages/sdk/src/e2ee/manifest.ts` mit:
      - `prepareMilestoneManifestForSigning`
      - `buildSignedMilestoneSubmitPayload`
      - kanonische Manifest-Serialisierung + SHA-256 + Signing-Message Helper.
    - Neue Crypto-Module:
      - `packages/sdk/src/e2ee/keys.ts` (`generateKeyAgreementKeypair`, key encode/decode)
      - `packages/sdk/src/e2ee/deliverable.ts` (`createEncryptedDeliverable`, `decryptDeliverableForRecipient`)
      - `verifyManifestSignature` in `packages/sdk/src/e2ee/manifest.ts`
  - Bot-/E2E-Flow umgestellt:
    - `apps/api/scripts/website-e2e-testnet.mjs` nutzt jetzt signierten Manifest-Submit inkl. CEK-Wraps + keyAgreement upsert.
  - Anchor-Tracking + Reconcile implementiert:
    - `POST /orders/:orderId/milestones/:milestoneId/anchor`
    - `GET /orders/:orderId/milestones/:milestoneId/anchor`
    - CLI: `corepack pnpm milestones:anchors:reconcile`
  - Move-Anchor-Basis integriert:
    - Neues Contract-Modul `contracts/claw_marketplace/sources/manifest_anchor.move`
    - Event `MilestoneManifestAnchored` + Entry `anchor_milestone_manifest`
    - SDK-Builder: `packages/sdk/src/tx/manifestAnchor.ts` (`buildMilestoneManifestAnchorTx`)
  - Monitoring fuer Manifest-Haertung erweitert:
    - Audit-Metriken: `milestone_manifest.invalid_signature`, `milestone_manifest.hash_mismatch`, `milestone_manifest.cid_unresolvable`
    - Security-Monitor (`apps/api/src/monitoring/cli.ts`, `anomaly.ts`) wertet die drei KPI jetzt aus.
  - Hardening-Tests erweitert:
    - API-Negativtests fuer Hash/CID/Signature-Tampering + Recipient-KeyVersion-Drift.
    - SDK-Rotationstest: alte Deliverables bleiben nach Key-Rotation entschluesselbar.
  - SDK-Node-ESM Stabilisierung:
    - interne SDK-Imports auf `.js`-Specifier umgestellt, damit `@clawdex/sdk` in Node-ESM-Flows (z. B. `website-e2e-testnet.mjs`) stabil geladen wird.
  - Move auf Testnet publiziert + gehaertet getestet (2026-02-22):
    - Package: `0x3d8deaad5e9624ddfee34649ff5393620975428b5a381e97d66ef4dff386b1cd`
    - Publish Tx: `YGMuVWr4pDnCj7JeqkvfC8M5fPT2Hz4Ga11RU61Ph7y`
    - Erfolgs-Anchor Tx: `5FWFznXtZhMHAZWKc2crHXzVzVRtBbgYt6LW3frqRPoH` (Event `MilestoneManifestAnchored`)
    - Security dry-runs: Abort `1` (unauthorized) und Abort `14` (invalid hash input) bestaetigt.
    - Nachweisreport: `docs/reports/manifest-anchor-testnet-security-20260222.md`.
    - Details unter `docs/TESTNET_DEPLOYMENT_STATUS.md`.
  - Folge-Revision auf Testnet publiziert (2026-02-22, Fee-Interface-Hardening):
    - Package: `0xc4b533e30c4f615b6c01eec5bc09f2c280013d29cbcce5d78ae7e5641001df63`
    - Publish Tx: `CbgRg8hue9UUrJMzqR9uqKDASPnpC12qN7xpNfbGuCwp`
    - Contract-Security Delta: `create_escrow_iota` ohne externen `fee_recipient`-Parameter.
    - Verifiziert via `verify-source` + `test:sdk:testnet` + `test:api:testnet` gegen neue Package-ID.
  - Folge-Revision auf Testnet publiziert (2026-02-22, Governance/Liveness + FeeConfig live):
    - Package: `0x92db29c98059f58259d6703caa8328fbdb4f291e1b3d32939a4ab75078193bde`
    - Publish Tx: `F9v9wgR4NVFMZZmbS6sQoKsFTmMXk1BFYAzBnVXaisjV`
    - Shared FeeConfig: `0x6aae887d1c9d1f0c9f3a360f53067c42ed332ee4c56f68fdc4533ccf82974f0d`
    - Contract-Security Delta:
      - `admin::rotate_admin_cap`, `admin::rotate_arb_cap`, `admin::rotate_treasury_cap` live.
      - `escrow::resolve_dispute_after_timeout_to_seller` live (deterministischer Liveness-Fallback).
      - `escrow::create_escrow_iota` verlangt shared `FeeConfig` + timelocked fee update path.
    - Verifiziert via `verify-source` + `test:sdk:testnet` + `test:api:testnet` gegen neue Package-/FeeConfig-ID.
  - Folge-Revision auf Testnet publiziert (2026-02-22, Timelock/Dual-Approval + Abuse + Availability):
    - Package: `0x09e8319a3ba6fbb3c473a6393518282e0bd5fe6a3720687c939c519e4ff0d44e`
    - Publish Tx: `EqC3Ev2daMXB5mtF8dzPCHn6LyWj3ZkE6P5ewZ5HTL5P`
    - Shared FeeConfig: `0x5c8dd5fd37950bacace382597717886895840a9a834ea23eb23a180bd481d480`
    - Shared GovernanceConfig: `0xf54b10add239ed946dcd02b810c4352d60f222dcdb796c2047053f19e57fb247`
    - Contract-Security Delta:
      - Timelocked queue/apply Rotation fuer `AdminCap`, `ArbCap`, `TreasuryCap`.
      - Emergency Rotation nur bei aktivem Emergency-Mode in `GovernanceConfig`.
      - Fee-Update braucht zusaetzliche Treasury-Freigabe vor Timelock-Apply.
    - Off-chain/Ops Delta:
      - Sponsor-Abuse-Guards + Budget-Circuit (`sponsor_abuse_limited`, `sponsor_budget_circuit_open`) live.
      - Availability-Probe CLI + systemd timer templates (`milestones:availability:probe`) hinzugefuegt.
    - Verifiziert via `verify-source` + `test:contracts` (`30/30`) + `test:sdk:testnet` + `test:api:testnet` + `test:matrix:2p:full` gegen neue Package-/FeeConfig-ID.
  - IOTA dual-CLI Betrieb eingerichtet (Mainnet/Testnet parallel):
    - `iota-mainnet` -> stable mainnet profile (`client-mainnet.yaml`)
    - `iota-testnet` -> testnet profile (`client-testnet.yaml`, CLI `1.17.1-rc`)
    - Host-Default `iota client active-env` wurde bewusst auf `mainnet` zurueckgesetzt.
  - `verify-source` final mit `iota-testnet` geprueft:
    - Root-Cause war lokales `Move.lock` mit transitive framework deps (`IotaSystem`, `Stardust`) ausserhalb der on-chain Linkage.
    - Nach Lockfile-Fix erfolgreich inkl. Dependency-Pruefung (`--verify-deps`, Exit `0`).

Status Update (2026-02-23, Testnet-Stabilisierung ohne Multisig):
- Fokus dieses Laufs:
  - Vollstaendige Testnet-E2E-Stabilitaet herstellen; Multisig bleibt bewusst nachgelagert bis mehrere stabile Full-Runs vorliegen.
- Behobener Runtime-Blocker:
  - API-Route `PUT /users/me/key-agreement` war bei Hyperdrive-Latenzspitzen anfaellig fuer `backend_timeout`.
  - Fix in `apps/api/src/worker.ts`:
    - neues `repositoryWriteWithRetry(...)` (Timeout + Retry + Backoff + optionales Pool-Reset fuer PostgresRepository)
    - `upsert_user_key_agreement` von One-Shot Timeout auf Write-Retry umgestellt.
    - neue Defaults: `WRITE_RETRY_ATTEMPTS=2`, `WRITE_RETRY_TIMEOUT_MS=8000`, `WRITE_RETRY_BACKOFF_MS=180`.
- Verifikation (dieser Lauf):
  - `corepack pnpm test:matrix:2p:full` -> erfolgreich (final order `COMPLETED`, milestones `SETTLED/SETTLED`).
  - `corepack pnpm --filter @clawdex/api test` -> `132 passed`, `3 skipped` (erwartete Skip-Gates fuer optionale Integration/Testnet-Suiten).
  - `corepack pnpm --filter @clawdex/api typecheck` -> gruen.
  - Erwartete nicht-blockierende Testnet-Warnungen im Full-Run:
    - `faucet_rate_limited`
    - `sponsor_gas_coins_missing_mock_fallback`

Status Update (2026-02-23, Product-Entscheid Bot-Only Portal):
- Zielbild festgezogen:
  - `clawdex-web` bleibt strikt read-only (nur offene/gepostete Auftraege, Suche/Filter).
  - Interaktion (create/accept/milestone/sponsor) ausschliesslich via API-Bots.
- Umsetzungsplan dokumentiert:
  - `docs/BOT_ONLY_PORTAL_EXECUTION_PLAN.md`
- Konsequenz fuer Backlog:
  - "E2EE-Flow in Web" wird fuer Public-Web de-scoped; E2EE-Hardening bleibt auf Bot-/API/SDK-Flow priorisiert.

Status Update (2026-02-23, Bot-Only Portal Umsetzung Phase 1-3):
- API Kategorie-Support live:
  - Listing-Model erweitert um `category` (`dev|design|marketing|ops|security|other`).
  - `GET /listings` akzeptiert jetzt `category`, `q`, `limit`, `cursor`; Antwort liefert optional `nextCursor`.
  - Neuer Read-Endpoint `GET /listings/categories` mit offenen Kategorie-Counts.
  - Postgres + InMemory Repositories inkl. Filter/Limit/Cursor verdrahtet.
  - DB-Migration hinzugefuegt: `apps/api/db/0006_listing_category_index.sql`.
- Globales Bot-Write-Gate live:
  - Neue Env: `WRITE_INTERACTION_MODE` (`wallet_auth|bot_only`), fallback-kompatibel zu `LISTING_CREATE_MODE`.
  - Bei `bot_only` werden Marketplace-Write-Routen zentral ueber `x-clawdex-bot-key` gegated:
    - `/listings`, `/bids/:id/accept`, milestone submit/accept/reject/anchor, `mark-disputed`, `sponsor/reserve`, `sponsor/execute`.
  - `wrangler.toml` + `wrangler.test.toml` auf `WRITE_INTERACTION_MODE="bot_only"` gesetzt.
- Web read-only hard lock live:
  - `apps/web` proxied nur noch Read-Allowlist (`/health`, `/ready`, `/listings`, `/listings/categories`, `/policy/fees`).
  - Alle anderen `/api/*` Aufrufe via Web liefern `403 portal_read_only`.
  - UI erweitert um Kategorie-Filter (`categoryFilter`) und Kategorie-Anzeige in Listing-Cards.
- E2E Runner angepasst:
  - `website-e2e-testnet.mjs` routet bei Write-Flows `/api/*` direkt auf `CLAWDEX_API_URL` (oder abgeleitete API-URL), damit read-only Web den Full-Flow nicht blockiert.
  - Bot-Key wird bei Non-GET/HEAD Requests automatisch gesetzt.
- Verifikation:
  - `corepack pnpm --filter @clawdex/api test` -> `137 passed`, `3 skipped`.
  - `corepack pnpm --filter @clawdex/api typecheck` -> gruen.
  - `corepack pnpm --filter @clawdex/api lint` -> gruen.
  - `corepack pnpm --filter @clawdex/web test` -> `12 passed`.
  - `corepack pnpm --filter @clawdex/web typecheck` -> gruen.
  - `corepack pnpm --filter @clawdex/web lint` -> gruen.
  - `CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev corepack pnpm --filter @clawdex/api website:e2e:testnet` -> read-only smoke gruen.
  - `CLAWDEX_BOT_LISTING_API_KEY=<set> CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev CLAWDEX_API_URL=https://clawdex-api-test.specdrops.workers.dev corepack pnpm --filter @clawdex/api website:e2e:testnet` -> full write E2E gruen (final `COMPLETED`).
  - `CLAWDEX_BOT_LISTING_API_KEY=<set> CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev CLAWDEX_API_URL=https://clawdex-api-test.specdrops.workers.dev IOTA_RPC_URL=https://api.testnet.iota.cafe MARKETPLACE_PACKAGE_ID=0xf8e862a48138923ff7bae94f532dd889511cddbd407a90b6165d499324746600 MARKETPLACE_FEE_CONFIG_OBJECT_ID=0xe1f7db78959903bb326f6085b9d9b88e2b9faa38c2bb7b03e55d1241b40f367c corepack pnpm test:matrix:2p:full` -> gruen.

## Quick Resume Commands
```bash
cd /home/codex/clawdex
bash scripts/local_prepare_and_validate.sh
corepack pnpm test:contracts
corepack pnpm db:migrate
corepack pnpm db:migrations:status
CLAWDEX_RUN_DB_TESTS=1 corepack pnpm --filter @clawdex/api test:integration
corepack pnpm rewards:payout:plan
corepack pnpm rewards:payout:pipeline
corepack pnpm milestones:settle
corepack pnpm listing-deposit:settle
corepack pnpm deadletters:replay
corepack pnpm watchdog:stuck-orders
corepack pnpm indexer:once
corepack pnpm sponsor:reservations:sweep
```

## Next Steps (Autonomy Backlog)

### Neuer Ziel-Blueprint
- [ ] Blueprint aus `docs/AUTONOMOUS_MILESTONE_ALIAS_MODEL.md` als Umsetzungsbasis festziehen (Milestone-Pflicht + Alias-Reputation + Auto-Settlement).

### P0 - Betrieb ohne manuellen Eingriff absichern
- [x] Synthetic Journey Monitor bauen (auth -> listing create -> accept -> sponsor reserve -> execute) und alle 5-10 Minuten laufen lassen.
- [x] Bei mehreren `worker_1101`/`backend_timeout` in kurzer Zeit automatisch Incident-Alert ausloesen (Webhook + klarer Titel/Severity).
- [x] Listing-Erstellung auf Milestone-Pflicht umstellen (2-8 Milestones, Budget-Summe muss exakt passen).
- [x] Milestone-Settlement-Worker bauen: Auto-Release bei Buyer-Inaktivitaet, Auto-Refund bei Seller-Deadline-Verzug.
- [x] Manuelle Operator-Dispute-Entscheidung aus dem Standardfluss entfernen; nur objektive Frist-/Regelentscheidungen zulassen.
- [x] API-Health-Ampel im Web integrieren (`/health` + `/ready`) inkl. degradiertem Modus fuer User.
- [x] Idempotency Keys fuer write-Endpoints (`POST /listings`, `/bids/:id/accept`, sponsor execute) erzwingen.
- [x] Order-State-Machine hart absichern (nur erlaubte Transitions, keine stillen Inkonsistenzen).
- [x] Beim Accept Listing-Status automatisch von `OPEN` auf `FILLED` setzen (atomar mit Order-Erstellung).
- [x] Dead-letter/Retry-Strategie fuer kritische Side-Effects einziehen (Audit, Sponsor Calls, Chain Sync).
- [x] Auto-Recovery fuer Gas-Station-Ausfaelle implementieren (Circuit Breaker + Retry + klarer Fallback-Status statt hartem Fail).

### P0 - Dispute-Bond als Scam-Protection bei Vertragsschluss (neu 2026-03-04)

Design-Grundsatz:
- Der Dispute-Bond ist **Scam-Protection**, nicht nur ein Dispute-Mechanismus.
- Beide Parteien hinterlegen ihren Bond **bei Vertragsschluss** (direkt nach Order-Erstellung),
  nicht erst wenn ein Dispute gebraucht wird.
- Ohne aktiven Bond (beide Seiten funded) darf keine Milestone-Arbeit beginnen.
- Korrekter Order-Ablauf:
  1. `POST /bids/{listingId}/accept` → Order erstellt (`AWAITING_DEPOSITS`)
  2. Buyer+Seller: Bond on-chain initialisieren (`init_order_dispute_bond`) + beide Seiten funden
  3. Buyer: Escrow on-chain erstellen + funden
  4. Bond ACTIVE + Escrow funded → Order `IN_PROGRESS`, Milestone-Arbeit kann beginnen
- Marketing-Orders: Plattform-Funding ist nur nach Contract-Delta + Sponsor-Hardening erlaubt (sonst Feature-Flag bleibt aus).

- [x] `TASK-DQ-101` Harter Bond-Gate bei Vertragsschluss.
  - API-Gate: `POST /orders/{orderId}/milestones/{milestoneId}/submit|accept|reject` nur wenn `disputeBondState=ACTIVE`.
  - Fehlerbild standardisieren: `409 dispute_bond_not_active` mit `required=true`, `state`, `nextAction`.
  - `POST /bids/{listingId}/accept` Response um `disputeBondRequired`, `disputeBondState`, `disputeBondPolicy` erweitern,
    damit Bot sofort weiss was als naechstes zu tun ist.
  - Timing klar kommunizieren: Bond-Funding ist Teil des Vertragsschlusses, nicht des Dispute-Flows.
    Bot-Ablauf nach Accept: Bond init → Bond fund (buyer+seller) → Escrow create → erst dann Milestone-Arbeit.
- [x] `TASK-DQ-102` Order-Lifecycle um expliziten Bond-State erweitern.
  - DB-Migration: `orders.dispute_bond_policy` (`DUAL_BOND_REQUIRED|PLATFORM_FUNDED_MARKETING`),
    `orders.dispute_bond_state` (`PENDING|ACTIVE|CANCELED`), `orders.dispute_bond_activated_at`,
    `orders.marketing_campaign_id` (nullable), `orders.dispute_bond_object_id` (nullable in Migration, danach required sobald vorhanden).
  - Repository/InMemory + Postgres Parity fuer neue Felder.
  - Read-Endpoints (`GET /orders/{id}`, `GET /orders/{id}/timeline`) um Bond-Metadaten erweitern.
  - Neuer Order-Status `AWAITING_DEPOSITS` (statt direkt `AWAITING_ESCROW`):
    Order bleibt in `AWAITING_DEPOSITS` bis Bond ACTIVE **und** Escrow funded.
  - Transition-Trigger `AWAITING_DEPOSITS` → `IN_PROGRESS`:
    Reconcile-Worker prueft on-chain Bond-State + Escrow-State; bei Bond ACTIVE **und** Escrow funded
    wird Order automatisch auf `IN_PROGRESS` gesetzt. Kein separater API-Call durch den Bot noetig.
  - `canTransitionOrderStatus` anpassen: `AWAITING_DEPOSITS → IN_PROGRESS` darf **nur** durch den
    Reconcile-Worker (nach on-chain Verifikation) ausgeloest werden, **nicht** durch `deriveOrderStatusFromMilestones`.
    Bestehende `AWAITING_ESCROW`-Referenzen im Code migrieren (stuckOrdersCli, reconcile.ts, repository.ts).
- [x] `TASK-DQ-103` On-chain Ready-Check verbindlich einziehen.
  - Helper `verifyOrderDisputeBondReady`: prueft on-chain `OrderDisputeBond` (`state == BOND_ACTIVE`, beide Seiten funded).
  - Reconcile-Worker mappt on-chain Bond-Zustand auf DB (`PENDING -> ACTIVE`), inklusive Drift-Alert bei Mismatch.
  - Negative-Guards: Milestone-Write verweigern, wenn Bond-Objekt fehlt/inkonsistent zur Order.
  - Harte Bindung: Order muss zu genau einem `dispute_bond_object_id` gebunden sein; kein client-seitiges frei waehlbares Bond-Objekt.
  - Binding-Moment: erster `POST /orders/{orderId}/dispute-bond/fund` mit `bondObjectId` speichert die Bindung
    in `orders.dispute_bond_object_id`; alle Folge-Calls (fund andere Seite, open case) muessen denselben Wert liefern,
    sonst `409 dispute_bond_object_id_mismatch`.
  - Stuck-Bond-Watchdog: Order in `AWAITING_DEPOSITS` laenger als X Stunden → Auto-Cancel-Kandidat
    (analog zum bestehenden `AWAITING_ESCROW` Watchdog).
- [x] `TASK-DQ-104` Security/UX-Doku aktualisieren.
  - `docs/BOT_QUICKSTART.md`, `docs/BOT_PROTOCOL_V1.md` auf den harten Timing-Gate anpassen.
  - Klartext fuer Bots: "Order accepted ≠ Arbeitsstart. Arbeitsstart erst nach Bond ACTIVE + Escrow funded."
  - `docs/BOT_QUICKSTART.md`: Bond-Init/Fund von "Dispute Loop" in den direkten Post-Accept Ablauf verschieben.
  - `clawnera-bot-market/docs/guides/BOT_ONBOARDING.md`: Bond-Init/Fund von §7 (Dispute Quorum Flow)
    nach §3 (direkt nach Order-Erstellung) verschieben. §7 bleibt fuer Dispute-Eröffnung/Voting/Resolution,
    aber Bond-Funding ist kein Dispute-Schritt mehr sondern Vertragsschluss-Schritt.
  - Ablauf klar als: Accept → Bond → Escrow → Milestone-Arbeit.

- [x] `TASK-DQ-201` Contract-Delta fuer Marketing-Funding (Blocker vor Marketing-GoLive).
  - Umsetzung (2026-03-04):
    - `dispute_quorum.move` erweitert um dedizierte Capability `MarketingFundingCap` plus Entry
      `issue_marketing_funding_cap`.
    - Cap-gated Funding-Entry-Points live:
      - `fund_bond_as_buyer_with_marketing_cap`
      - `fund_bond_as_seller_with_marketing_cap`
    - `OrderDisputeBond` erweitert um immutable `funding_policy` sowie sichere Refund-Metadaten
      `buyer_funder`/`seller_funder`; Refund-Pfade zahlen damit an tatsaechliche Funder aus.
    - Marketing-Policy bleibt on-chain streng:
      - Standard-Funding-Entry-Points sind fuer `PLATFORM_FUNDED_MARKETING` geblockt.
      - Marketing-Cap-Funding ist nur fuer Marketing-Policy und mit Plattform-Partei im Bond erlaubt.
      - Side-Amount fuer Marketing-Cap-Funding muss exakt `cfg.min_dispute_bond_per_side_iota` sein.
    - Campaign-Aktiv/Freigabe jetzt auch on-chain modelliert:
      - neue Campaign-Gate-Registry via Dynamic-Field-Key `MarketingCampaignGateKey`.
      - Admin-Entry `set_marketing_campaign_status` (emit `MarketingCampaignStatusSet`).
      - Marketing-Cap-Funding verlangt aktive Campaign im on-chain Gate.
      - neue Marketing-Bond-Init-Entry-Points:
        - `create_order_dispute_bond_with_marketing_campaign`
        - `init_order_dispute_bond_with_marketing_campaign`
      - Marketing-Campaign-ID wird immutable im Bond gespeichert.
    - SDK erweitert:
      - neuer Init-Builder `buildInitOrderDisputeBondWithMarketingCampaignTx`.
      - bestehende Marketing-Cap-Funding-Builder bleiben erhalten.
  - Verifikation (2026-03-04):
    - `corepack pnpm test:contracts` -> PASS (`199/199`).
    - `corepack pnpm --filter @clawdex/sdk test` -> PASS (`65 passed | 1 skipped`).
    - `corepack pnpm --filter @clawdex/api lint` -> PASS.
    - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
    - `corepack pnpm --filter @clawdex/api test` -> PASS (`24 passed | 3 skipped` files, `281 passed | 3 skipped` tests).
    - `corepack pnpm ci:dq-rollout-gates` -> PASS.
    - `corepack pnpm ci:contracts:abi-snapshot` -> PASS (Snapshots aktualisiert).
    - On-chain:
      - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T162848601Z.json`
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T162848601Z.md`
      - Erwartete externe Blocker unveraendert:
        - `reviewer_prequalified_keys_required`
        - `arb_signer_required_for_platform_fallback`
- [x] `TASK-DQ-202` Marketing Abuse-Schutz (API-Level).
  - Campaign-Grenzen: `max_order_amount`, `max_open_orders_per_buyer`, `campaign_expiry_ms`.
  - Nur Plattform-Creator duerfen Marketing-Listings erzeugen (Creator-Allowlist).
  - Globaler Kill-Switch (`MARKETING_ENABLED=false`) + Auto-Disable bei Budget-Threshold.
  - Rate-Limits fuer neue Wallets: `max_open_orders_per_buyer_new`, Cooldown.
  - Telemetrie: `marketing_bonds_funded_total`, `marketing_campaign_budget_remaining`.
  - Umsetzung (2026-03-04):
    - Neue Marketing-Runtime-Config eingefuehrt (`MARKETING_ENABLED`, `MARKETING_CREATOR_ALLOWLIST`,
      `MARKETING_DEFAULT_CAMPAIGN_ID`, `MARKETING_CAMPAIGNS`, `MARKETING_AUTO_DISABLE_BUDGET_THRESHOLD`)
      inkl. Parser/Guards in `apps/api/src/config.ts`.
    - Marketing-Listing-Guard aktiv in `POST /listings`:
      - nur Allowlist-Creator,
      - nur aktive/nicht abgelaufene Campaigns,
      - `max_order_amount` enforced.
    - Marketing-Accept-Guard aktiv in `POST /bids/{listingId}/accept`:
      - `max_order_amount`,
      - `max_open_orders_per_buyer`,
      - `max_open_orders_per_buyer_new` + `new_wallet_cooldown_ms`,
      - Campaign-Budget-Reserve vor Order-Create und Rollback bei Fehlern,
      - Auto-Disable bei unterschrittenem Budget-Threshold.
    - Repo/Postgres erweitert um `countOpenOrdersByBuyer(..., marketingCampaignId?)` fuer Campaign-spezifische
      Open-Order-Limits.
    - `POST /orders/{id}/dispute-bond/fund` liefert fuer Marketing-Funding Telemetrie mit
      `marketing_bonds_funded_total` und aktuellem `marketing_campaign_budget_remaining`.
    - `/health` um Marketing-Runtime-Telemetrie erweitert.
  - Verifikation (2026-03-04):
    - `corepack pnpm --filter @clawdex/api exec vitest run test/config.test.ts test/worker.test.ts` -> PASS.
    - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
    - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `270 passed | 3 skipped` tests.
    - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T144100573Z.json`
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T144100573Z.md`
      - Erwartete externe Blocker unveraendert: `reviewer_prequalified_keys_required`, `arb_signer_required_for_platform_fallback`.
- [x] `TASK-DQ-203` Refund-/Budget-Sicherheit fuer Plattform-Funding.
  - Bei `PLATFORM_FUNDED_MARKETING` muessen Refunds aus Bond-Pool an die tatsaechlichen Funder-Adressen gehen (nicht blind buyer/seller).
  - Fallback/Cancel/Timeout-Pfade muessen dieselbe Rueckzahlungsregel nutzen.
  - Keine Budget-Leaks: pro Campaign dedizierte Budget-Buckets + harte Untergrenzen fuer Reviewer-Payout.
  - Umsetzung (2026-03-04):
    - Refund-Routing auf Funder-Adressen umgestellt:
      - `cancel_pending_order_dispute_bond`
      - `distribute_fallback_pool` (inkl. Timeout-Fallback-Pfad)
      - `distribute_quorum_pool`
    - Gemeinsame Recipient-Helper (`buyer_refund_recipient`/`seller_refund_recipient`) erzwingen einheitliche
      Rueckzahlungsziele aus `buyer_funder`/`seller_funder`.
    - API-Level Budget-Hardening ergaenzt:
      - Campaign-Config erweitert um dedizierten Bond-Bucket:
        - `bond_budget_remaining`
        - `reviewer_payout_budget_floor`
      - Runtime-Guards in `POST /orders/{id}/dispute-bond/fund`:
        - idempotente Bond-Budget-Reservierung pro `orderId+side` (kein Double-Charge bei Retries),
        - hartes Mismatch-Blocking bei abweichendem Retry-Amount derselben `orderId+side`,
        - harte Ablehnung bei Bond-Bucket-Exhaustion,
        - harte Ablehnung bei Unterschreitung von `reviewer_payout_budget_floor`.
      - Auto-Disable beruecksichtigt jetzt auch Bond-Bucket/Floor (zusaetzlich zu Listing-Budget-Threshold).
      - Health/Fund-Telemetrie erweitert um:
        - `marketing_campaign_bond_budget_remaining`
        - `reviewer_payout_budget_floor`.
    - Testabdeckung erweitert:
      - Config-Validation fuer `reviewer_payout_budget_floor <= bond_budget_remaining`.
      - Worker-Tests fuer:
        - idempotente `orderId+side` Reservierung ohne Double-Charge,
        - Reservation-Mismatch-Fehler bei abweichendem Retry-Amount,
        - Floor-Breach-Ablehnung.
  - Verifikation (2026-03-04):
    - `corepack pnpm --filter @clawdex/api exec vitest run test/config.test.ts test/worker.test.ts` -> PASS.
    - `corepack pnpm --filter @clawdex/api lint` -> PASS.
    - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
    - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `274 passed | 3 skipped` tests.
    - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T145611668Z.json`
      - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T145611668Z.md`
      - Erwartete externe Blocker unveraendert: `reviewer_prequalified_keys_required`, `arb_signer_required_for_platform_fallback`.
- [x] `TASK-DQ-204` Sponsor-Hardening als Marketing-Blocker (nicht optional).
  - `POST /sponsor/reserve` um `orderId` erweitern; in `sponsor_reservations` persistieren.
  - `POST /sponsor/execute` akzeptiert nur bei `reservation.orderId` Match + Intent-Match (`network|order_id|reservation_id|tx_digest|expires_at|purpose`).
  - Fuer Marketing-Policy kein stiller Self-Pay-Downgrade bei Sponsor-Fehlern (expliziter Fehler + klare Retry-Semantik).
  - Backward-Compatibility via Uebergangsphase/API-Version, dann Pflichtfeld fuer Marketing-Flows.
  - Umsetzung (2026-03-04):
    - API-Contracts erweitert: `orderId` auf Reserve/Execute; optionales `intent`-Objekt auf Execute.
    - Persistenz erweitert: `sponsor_reservations.order_id` (Schema + Migration `apps/api/db/0012_sponsor_reservation_order_id.sql`).
    - Execute-Guards: harte `reservation.orderId`-Bindung und Intent-Match auf `network/orderId/reservationId/txDigest/expiresAt/purpose`.
    - Marketing-Orders (`PLATFORM_FUNDED_MARKETING`) erzwingen sponsor-only Fehlerpfad ohne `fallback: self_pay` und mit explizitem `retry`-Block.
    - Testabdeckung ergänzt in `apps/api/test/contracts.test.ts` und `apps/api/test/worker.test.ts` (orderId-Mismatch, intent-required/mismatch, sponsor-only retry semantics).
- [x] `TASK-DQ-205` Doku-Artefakte vervollstaendigen (fehlende Ziel-Dateien).
  - Umsetzung (2026-03-04):
    - Neue Docs erstellt:
      - `docs/SPONSOR_POLICY.md`
      - `docs/SDK_USAGE.md`
      - `docs/API_REFERENCE.md`
    - Bestehende Docs aktualisiert:
      - `docs/BOT_QUICKSTART.md`
      - `docs/BOT_PROTOCOL_V1.md`
    - `clawnera-bot-market` Guides auf dieselbe Sponsor-/API-Semantik synchronisiert:
      - `docs/guides/SPONSOR_POLICY.md`
      - `docs/guides/SDK_USAGE.md`
      - `docs/guides/API_REFERENCE.md`
      - `docs/guides/BOT_ONBOARDING.md`
    - Dokumentierte Sponsor-Laufzeitregeln jetzt konsistent:
      - `orderId`-Bindung auf `reserve/execute`
      - `intent`-Pflicht fuer `PLATFORM_FUNDED_MARKETING`
      - sponsor-only Retry-Semantik statt stiller Self-Pay-Downgrade bei Marketing.
  - Verifikation (2026-03-04):
    - `corepack pnpm --filter @clawdex/api lint` -> PASS.
    - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
    - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `277 passed | 3 skipped` tests.
    - `corepack pnpm ci:dq-rollout-gates` -> PASS.
    - `corepack pnpm test:contracts` -> PASS (`197/197`).
    - On-chain:
      - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T154408940Z.json`
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T154408940Z.md`
      - Erwartete externe Blocker unveraendert:
        - `reviewer_prequalified_keys_required`
        - `arb_signer_required_for_platform_fallback`
- [x] `TASK-DQ-206` Testmatrix + Rollout-Gates.
  - Umsetzung (2026-03-04):
    - API-Guard fuer Plattform-Partei ergaenzt:
      - neue Runtime-Config `MARKETING_PLATFORM_ADDRESS` (optional, validierte IOTA-Adresse).
      - `POST /orders/{id}/dispute-bond/fund` verweigert Marketing-Funding jetzt mit
        `409 marketing_platform_party_required`, wenn bei gesetzter Plattform-Adresse weder Buyer noch Seller
        die konfigurierte Plattform-Partei sind.
    - API-Testmatrix erweitert:
      - neuer echter End-to-End-Test `listing(marketing) -> accept -> dispute-bond/fund(with marketing cap)`
        fuer `PLATFORM_FUNDED_MARKETING`.
      - negativer Test `Marketing ohne Plattform-Partei -> rejected` (`marketing_platform_party_required`).
      - bestehende Security-Negativtests als Pflichtanker weiterverwendet:
        - Replay/Domain-Mismatch (`rejects signing-context audience mismatch...`)
        - Sponsor `orderId`-Mismatch
        - Sponsor `intent` required/mismatch
        - Refund-Routing-Absicherung in Move-Tests (`test_dq_cancel_pending_marketing_bond_keeps_funder_routing`).
    - Rollout-Gate in CI/Predeploy verankert:
      - neues Gate-Script `scripts/ci/check_dispute_quorum_rollout_gates.sh`
        (Coverage-Anker + gezielte DQ-206 API-Matrix via `vitest --testNamePattern`).
      - neue npm-Task `ci:dq-rollout-gates`.
      - eingebunden in:
        - `.github/workflows/ci.yml`
        - `scripts/ci/release_gate_predeploy.sh`
      - Script dokumentiert den Rollout-Pfad:
        `testnet -> staging canary -> mainnet canary (small campaign caps) -> scale-up`.
  - Verifikation (2026-03-04):
    - `corepack pnpm --filter @clawdex/api exec vitest run test/config.test.ts test/worker.test.ts` -> PASS (`152 passed`).
    - `corepack pnpm ci:dq-rollout-gates` -> PASS.
    - `corepack pnpm --filter @clawdex/api lint` -> PASS.
    - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
    - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `277 passed | 3 skipped` tests.
    - `corepack pnpm test:contracts` -> PASS (`197/197`).
    - On-chain:
      - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T151844073Z.json`
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T151844073Z.md`
      - Erwartete externe Blocker unveraendert:
        - `reviewer_prequalified_keys_required`
        - `arb_signer_required_for_platform_fallback`
      - `corepack pnpm order-full-2p-onchain:e2e:testnet` mit gesetztem Bot-Key gestartet, lief bis `order_accepted`,
        hing danach im externen Polling und wurde nach Timeout manuell beendet (kein lokaler Code-Fehler).
- [x] `TASK-DQ-207` Governance/Custody fuer `MarketingFundingCap` (Blocker vor Prod).
  - Umsetzung (2026-03-04):
    - API-Custody-Gates fuer Marketing-Cap-Funding umgesetzt:
      - neue Runtime-Flags:
        - `MARKETING_CAP_SIGNING_QUEUE_REQUIRED` (default `true`)
        - `MARKETING_CAP_FOUR_EYES_REQUIRED` (default `true`)
        - `MARKETING_CAP_MULTISIG_2OF3_REQUIRED` (default `false`)
      - `POST /orders/{id}/dispute-bond/fund` akzeptiert `marketingFundingCustodyProof` mit:
        - `jobId`
        - `approvalMode` (`four_eyes|multisig_2of3`)
        - `approverA`
        - `approverB`
      - erzwungene Konfliktfehler fuer Marketing-Funding:
        - `409 marketing_funding_custody_proof_required`
        - `409 marketing_funding_four_eyes_required`
        - `409 marketing_funding_multisig_2of3_required`
    - Auditierbarkeit erweitert:
      - Erfolgsaudit `dispute_quorum.bond.fund.plan` enthaelt jetzt
        `marketingFundingJobId`, `marketingFundingApprovalMode`,
        `marketingFundingApproverA`, `marketingFundingApproverB`.
      - Deny-Audits fuer Custody-Verstoesse enthalten klaren `reason`.
      - Response echo't `marketingFundingCustodyProof` im `request`-Block fuer Off-Chain-Evidence-Kopplung.
    - API/Contract-Interface aktualisiert:
      - `apps/api/openapi.yaml` um `MarketingFundingCustodyProofRequest` erweitert.
      - `apps/api/src/contracts.ts` Request-Parser fuer Custody-Proof validiert strikt.
    - CI-Rollout-Gate erweitert:
      - `scripts/ci/check_dispute_quorum_rollout_gates.sh` prueft jetzt DQ-207-Testanker
        (`custody proof required`, `four-eyes distinct`, `multisig 2-of-3 required`).
    - Runbooks/API-Doku aktualisiert:
      - `docs/SIGNING_QUEUE_RUNBOOK.md`
      - `docs/API_REFERENCE.md`
      - `docs/BOT_PROTOCOL_V1.md`
  - Verifikation (2026-03-04):
    - `corepack pnpm --filter @clawdex/api lint` -> PASS.
    - `corepack pnpm --filter @clawdex/api typecheck` -> PASS.
    - `corepack pnpm --filter @clawdex/api test` -> `24 passed | 3 skipped` files, `281 passed | 3 skipped` tests.
    - `corepack pnpm ci:dq-rollout-gates` -> PASS.
    - `corepack pnpm test:contracts` -> PASS (`197/197`).
    - On-chain:
      - `corepack pnpm dispute-quorum:onchain:e2e:testnet` abgeschlossen; Report:
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T160833898Z.json`
        - `docs/reports/dispute-quorum-onchain-e2e-testnet-20260304T160833898Z.md`
      - Erwartete externe Blocker unveraendert:
        - `reviewer_prequalified_keys_required`
        - `arb_signer_required_for_platform_fallback`
- [x] `TASK-DQ-208` Atomare Bond-Bindung + Race-Safety.
  - DB-Regeln: `order_id -> dispute_bond_object_id` first-write-wins; optional zusaetzlich unique auf `dispute_bond_object_id` zur Vermeidung von Reuse.
  - Repository-Write als compare-and-set (kein blindes overwrite), idempotent bei Retries.
  - Gleichzeitige `fund`-Requests (buyer/seller parallel) duerfen niemals zu inkonsistenter Bindung fuehren.
  - Fehlervertrag bei Race klar festlegen: `409 dispute_bond_object_id_mismatch`.
- [x] `TASK-DQ-209` Status-Derivation-Bypass schliessen.
  - `deriveOrderStatusFromMilestones`/`refreshOrderStatusFromMilestones`/Timeline-Refresh duerfen `IN_PROGRESS` nicht setzen, solange Bond+Escrow nicht ready sind.
  - `AWAITING_DEPOSITS` bleibt hard gate bis beide Preconditions on-chain bestaetigt sind.
  - Tests: Milestone-Status darf nie indirekt `AWAITING_DEPOSITS -> IN_PROGRESS` triggern ohne Ready-Check.
  - Negative Test: manuelle Milestone-Mutation auf `SUBMITTED` darf Gate nicht umgehen.

### P1 - Datenkonsistenz und Selbstheilung
- [x] Reconciliation-Worker zyklisch laufen lassen: on-chain Events vs. `orders/listings` in Postgres abgleichen und korrigieren.
- [x] Watchdog fuer "stuck orders" bauen (z. B. `AWAITING_DEPOSITS` zu lange) inkl. Auto-Transition/Flagging.
- [x] Listing-Deposit-Settlement-Worker bauen (`listing-deposit:settle`) inkl. compare-and-set Finalisierung `REFUND_PENDING` -> `REFUNDED/FORFEITED`.
- [x] Sponsor-Reservations mit Ablauf/Leichenbereinigung regelmaessig aufraeumen.
- [x] Rewards/Payout Pipeline vollautomatisieren (plan -> review gate -> execute -> verify) mit sicheren Guardrails.
- [x] DB-Migrations-Runner mit Versionshistorie einfuehren (statt manueller Schema-Steuerung).
- [x] Regelmaessige Restore-Tests fuer DB-Backups automatisieren (nicht nur Backup erzeugen, sondern Restore pruefen).

### P1 - Observability und Alerting vervollstaendigen
- [ ] Einheitliches JSON-Logging fuer API/Web mit `requestId`, `actor`, `operation`, `latencyMs`, `outcome`.
- [ ] Monitoring um Business-KPIs erweitern: erfolgreiche Listings/Accepts, Sponsor-Error-Rate, avg/p95 Latenz.
- [ ] Dashboard/Board aufsetzen (Health, Ready, Listings-Latenz, 5xx, 1101, E2E Erfolgsquote).
- [ ] Alert-Routing definieren (Warnung vs. Critical) inkl. Ruhezeiten/Dedup, damit keine Alarmflut entsteht.
- [ ] Monitoring-Runbooks je Alarmtyp verlinken (ein Alert -> ein klarer Handlungsablauf).

### P1 - Deployment und Rollback
- [x] Canary-Deploy fuer API einfuehren (kleiner Traffic-Anteil vor Full Rollout).
- [x] Auto-Smoke-Gate im Deploy: erst freigeben, wenn `/health`, `/ready`, `/listings` und Synthetic Journey gruen sind.
- [x] Automatischer Rollback bei definierten Schwellwerten (5xx/1101/Latenz) nach Deploy.
- [x] Release-Checkliste versionieren (Preflight, Post-Deploy Checks, Rollback-Bedingungen).

### P0 - Dezentraler E2EE-Deliverable-Austausch
- [x] Spec Freeze laut `docs/DECENTRALIZED_E2EE_EXCHANGE_PLAN.md` (Manifest v1, Cipher-Suite, Canonicalization).
- [x] API/DB fuer Wallet-gebundene `keyAgreement` Keys einbauen (inkl. Rotation/Expiry-Basis).
- [x] Milestone-Submit-Validation haerten: signiertes `manifest` + `ipfs://` + SHA-256 + recipient key binding (`ENFORCE_MILESTONE_MANIFEST_STRICT`).
- [ ] SDK Crypto-Pipeline vollstaendig fertigstellen (streaming/upload, production-hardening, interop-tests).
- [x] SDK Crypto-Pipeline Basis implementieren (encrypt -> wrap keys -> sign manifest -> verify/decrypt).
- [x] SDK Helper/Builder fuer Manifest-Signing im Client finalisieren.
- [ ] E2EE-Flow in Web einziehen (kein Klartext-Upload).
- [x] E2EE-Flow im Bot-/E2E-Submit einziehen (kein Klartext-Upload im Submit-Payload).
- [x] Move-Event fuer Manifest-Anchor integrieren.
- [x] API/Indexer-Reconcile fuer Manifest-Anchor-Tracking integrieren.
- [x] Security Monitoring erweitern (`invalid_signature`, `hash_mismatch`, `cid_unresolvable`).
- [x] E2E/Negativtests fuer Tampering, falsche Signatur, falschen Recipient und Key-Rotation aufbauen.

### P2 - Sicherheit und Abuse-Resistenz
- [ ] Adaptive Rate-Limits pro Route/Actor (dynamisch statt nur statische Werte).
- [ ] Zus. Bot-/Abuse-Signale auswerten (IP/Actor Velocity, Fehlercluster, wiederholte invalid requests).
- [ ] Secrets-Rotation zeitgesteuert automatisieren (Access Token, API Keys, Service Auth) inkl. Verifikationsschritt.
- [ ] Admin-Aktionen manipulationssicher extern spiegeln (append-only Export/Archiv).
- [ ] Beidseitigen Bond pro Milestone einfuehren (Buyer+Seller Stake) inkl. klaren Slashing-Regeln.
- [ ] Pseudonymes Alias-System (kein Klarname) mit objektivem Reputationsscore aus Milestone-/Dispute-Daten einfuehren.
- [ ] Sybil-Schutz fuer Alias-Reputation (Mindestvolumen/Stake, Newcomer-Limits, Paar-/Velocity-Checks) umsetzen.
- [x] Move-Upgrade lokal umgesetzt: `escrow::create_escrow_iota` ohne externen `fee_recipient`-Parameter (Publish/Cutover weiter als eigener Deploy-Schritt).
- [ ] Listing-Fee-Deposit/Refund on-chain einfuehren (Deposit bei Listing, teilweiser Refund bei erstem Completed-Deal; kein Refund bei Spam/Verstoss), an `/policy/fees` koppeln.

### P2 - UX fuer autonomen Betrieb
- [x] User-Fehlertexte standardisieren (was passiert, was wird automatisch retryt, wann erneut versuchen).
- [x] Frontend-Retry fuer sichere GETs mit Exponential Backoff.
- [ ] Klare Statusseiten fuer "degraded mode" und "maintenance", damit Nutzerfluss nicht abbricht.

### Offene bereits bekannte Punkte
- [ ] Web `prod` mit realem Wallet-Flow manuell abnehmen (zus. zur Automation).
- [ ] CLI auf finalen Production-Protokollstand heben (inkl. Version-Pinning in Runbooks/CI).
- [ ] Offene Compliance-Restpunkte aus `docs/COMPLIANCE_SECURITY_EXECUTION_PLAN.md` systematisch abarbeiten (Owner + Termine + Gate-Freigaben).
- [ ] Test-/Abnahme-Reihenfolge aus `docs/TEST_EXECUTION_ORDER.md` als Release-Gate in CI/Deploy-Runbook verankern.

### Neu vermerken (noch nicht vollstaendig abgedeckt)
- [ ] Externe Gap-Analyse der Handover-Datei einholen und Findings mit Owner+Termin in diese Liste uebernehmen.
- [ ] Multisig Security Workstream (kanonisch): `ops/multisig-cutover/SECURITY_OPEN_POINTS_AND_RECOMMENDATIONS.md` (Kickoff erledigt: Toolkit + Backlog versioniert; Hardening/Execute-Gates weiter offen).
- [ ] Multisig Abarbeitungsreihenfolge (security-first, vor Mainnet-Cutover):
  1. [ ] `TASK-MSIG-001`: Finale signer-set policy beschliessen (`2-of-3`, Rollen, Recovery-Owner).
  2. [ ] `TASK-MSIG-002`: Execute Four-Eyes SOP schriftlich + technisch erzwingen.
  3. [ ] `TASK-MSIG-003`: Signing-Queue um `job_hash` + Allowlist-Prechecks erweitern.
     - [x] `TASK-MSIG-003a`: `combine_partial_sigs.sh` auf stabiles JSON-Parsing fuer Combined-Signature haerten (kein heuristisches Feld-Picking).
     - [x] `TASK-MSIG-003b`: `prepare_queue_job.sh` Address-Parsing robust machen (`multisig_address=` strikt extrahieren, keine implizite Einzeilen-Annahme).
     - [x] `TASK-MSIG-003c`: `attach_multisig_signature_to_job.sh` um `job-id` Pattern-Validation ergaenzen.
  4. [ ] `TASK-MSIG-004`: Append-only Audit Sink fuer Governance-Aktionen anbinden.
  5. [x] `TASK-MSIG-005`: Minimal Signer-UI (read-only review + tx-hash visibility) bauen.
     - [x] `/signer` Route in `apps/web` hinzugefuegt (request/tx-bytes review, tx-digest visibility, move-target/object-id extraction).
     - [x] Queue-Job Read-Model/List-View via `/signer/api/jobs` + `/signer/api/jobs/<id>` integriert.
  6. [x] `TASK-MSIG-006`: Nightly/IOTA-Extension Signature Capture integrieren (ohne execute).
     - [x] Wallet Connect + Signature Capture (`standard:connect`, Nightly/IOTA detection, sign-only flow) im `/signer` UI integriert.
     - [x] Persistenz der erfassten Signatur in Queue-Artefakte via `/signer/api/jobs/<id>/signature` (`multisig.signature.b64` + meta/audit).
     - [x] Execute bleibt weiterhin ausserhalb der UI (CLI-Gate unveraendert).
  7. [ ] `TASK-MSIG-007`: WireGuard-only Deployment fuer Signer-UI umsetzen und pentest-light pruefen.
  8. [ ] `TASK-MSIG-008`: End-to-end Dry-Run mit realen Hardware-Wallets auf Testnet dokumentieren.
  9. [ ] `TASK-MSIG-009`: Mainnet Cutover Runbook finalisieren (inkl. UpgradeCap Schritt).
- [ ] Event-Coverage Review fuer alle kritischen Statuswechsel abschliessen (Escrow/Bond/Tier/Rewards) und fehlende Events ergaenzen.
- [ ] Key-Loss/Recovery SOP fuer E2EE festziehen (Was ist recoverbar? Wer darf was? Welche Nachweise?).
- [ ] Verbindliche Pinning-Redundanz + Retrieval-SLO festlegen (mind. 2/3 Pins, Healthchecks, Alert bei CID-Ausfall).
- [ ] Signature Domain-Separation Review abschliessen (keine Replay-Moeglichkeit zwischen API-Routen/Chain-Kontexten).
- [ ] Manifest-Versionierung und Legacy-Migrationspfad verbindlich definieren (`v1` -> Folgeversionen ohne Bruch).

Status Update (2026-02-23, Listing-Deposit Domain-Binding Phase-1):
- Externe Analyse in konkreten Umsetzungsplan ueberfuehrt:
  - `docs/DEPOSIT_IMPLEMENTATION_EXECUTION_PLAN_2026-02-23.md`
- Domain-Binding fuer Listing-Deposit API-seitig implementiert:
  - Neues Env-Flag: `LISTING_DEPOSIT_ENFORCE_REF_BINDING` (Default `false`)
  - Utility fuer Binding-Digest + On-chain `listing_ref` Parsing:
    - `apps/api/src/listingDepositBinding.ts`
  - Verifikation aktiv in:
    - `POST /listings`
    - `POST /bids/:listingId/accept` (Deposit-Guard)
    - Listings-Reconcile bei Feed-Read
  - Neuer Fehler bei Mismatch:
    - `listing_deposit_listing_ref_mismatch`
- `/policy/fees` + OpenAPI erweitert um Binding-Metadaten:
  - `enforceRefBinding`
  - `bindingRefFormat = sha256_hex_32_bytes_v1`

## Status Update (2026-03-03, Dispute-Guardrails staging+prod aktiviert)
- Neue API-Flags in Runtime aktiviert:
  - `DISPUTE_STRICT_PARTY_GUARDS=true`
  - `DISPUTE_CASE_READ_PRIVACY_GUARD=true`
- Rollout:
  - staging (`clawdex-api-staging`): Version `d6a0c14d-046e-4a5d-bc2d-64cf7e7fa72d`
  - prod (`clawdex-api`): Version `2cd291e4-d240-4ebf-a8f2-64eee665d937`
- Smoke-Checks:
  - staging `monitor:http` gegen `https://clawdex-api-staging.specdrops.workers.dev` -> `severity=ok`, `alertCount=0`
  - prod `monitor:http` gegen `https://clawdex-api.specdrops.workers.dev` -> `severity=ok`, `alertCount=0`
  - prod custom-domain check: `GET https://api.clawnera.com/health` -> `200`
