# CLAW Swap Gateway Current State (Mainnet)

Stand: 2026-02-18 UTC

## Zweck

- On-chain Entry-Point Swap fuer `CLAW` (Port von `spec_sale_multicoin_v2`).
- Setup ist live und initial mit CLAW-Reserve gefundet.

## Package / Object IDs

- `PACKAGE_ID`:
  - `0x73467a1b86bbfb8d9b0dcf0e4c320f7d8d6d3f60567cd70f5bb00b909fcddd8c`
- `GATEWAY_ID`:
  - `0xa23fd506eccf65a4c3b469eabb3701cb331b29413b76570e64b5fdfd1d5cea7c`
- `CLAW_TYPE`:
  - `0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN`

Caps:

- `ADMIN_CAP_ID`:
  - `0x03235bd4a7e6db48e842ae8ded18485ccdeb2365608f47255af26ae9d17ae6f3`
- `GUARDIAN_CAP_ID`:
  - `0x4b194daff7d282d2b798ed7d16584e5a1ebf0d3aab426743f367329e49a97dc0`
- `ORACLE_CAP_ID`:
  - `0x4d77762d04f582ddf7f11d47fd97e5d0f2b6a83924d64d055d81bc6a85fd2a87`

## Treasury / Reserve

- `treasury`:
  - `0x0a0d4c9a9f935dac9f9bee55ca0632c187077a04d0dffcc479402f2de9a82140`
- `paused=false`
- `require_fresh_oracle=false` (temporär deaktiviert am 2026-02-18)
- `reserve_claw=1337000000000000` (`1,337,000,000 CLAW`; Top-up am 2026-02-18)

## Coin-Setup (registriert)

- `IOTA`
- `VUSD`
- `iBTC`
- `vIOTA (CERT)`
- `TLN`

Oracle-Bootstrap wurde ausgefuehrt (core + TLN); initiales Reserve-Funding erfolgte danach per `top_up_claw`.

## Wichtige Tx-Digests

- Publish Gateway Package:
  - `8JsZLrd16ddJFP1XmzXEvRfruvZQ8rBEjXws8kY8yJey`
- Create Gateway:
  - `3tZG1N9gBbD1wEQ4LPtAYAdmDfnt7DKSC4TCHsHyPvCf`
- Set target / coin config:
  - Start: `DefGw4Agr3nfJGvFmhdtMUhcqmqNPZR8vav9875k7brz`
  - Freshness enabled: `EmZBeGeycDiKutaP458aewvkscsk1cAHZNkssG88WMAr`
- Freshness disabled (temporär):
  - `Ds5aWMdWh1vuZBvd9oHJ2zCHYEM6uqnFZdWQmm5k8Xje`
- Oracle bootstrap:
  - Core final: `7cnkvLfDEQzmTyVs68wqegp7HFe3daZdDemgqJXhxwkn`
  - TLN: `GQCPnWH5HmpnJUD4j7CpiAs9naRwjEU2vv1GLHhRc61f`
- CLAW Reserve Top-up:
  - `F17vKEQfvqwBdcoubQFfpS5DnC7zKh7wjrNXerEvrAf9` (`TopUpClaw amount=1337000000000000`)

## Relevante Pfade

- Move Package:
  - `/home/codex/cloudflare-restore/claw_swap_gateway`
- Deploy Script:
  - `/home/codex/cloudflare-restore/scripts/deploy_claw_swap_gateway.sh`
- Setup Script (prepare/live, ohne Top-up):
  - `/home/codex/cloudflare-restore/scripts/claw_swap_gateway_setup.sh`

## Hinweis

- Der Gateway ist einsatzbereit konfiguriert und mit initialer CLAW-Liquiditaet gefundet.
- Weitere Reserve-Erhoehungen laufen via `top_up_claw`.
