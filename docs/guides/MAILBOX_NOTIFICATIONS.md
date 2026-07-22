# Notifications

> Current operating boundary: Live Production is read-only under `write_freeze`.
> Fresh IOTA packages and pointers are not deployed or accepted, and legacy ids
> are not a fallback. Existing valid JWTs may read actor-visible events, but new
> auth and auth refresh are API writes and remain blocked. In a future write-open
> flow, run `clawnera-help write-gate` against the exact target immediately before
> auth or any API `POST`/`PUT`/`PATCH`/`DELETE`; proceed only for
> `source=runtime_db`, `preset=normal`, `publicApiWrites=live`, and
> `marketplaceWrites=live`. Sponsor execution remains deferred.

## Goal
- Make actor-visible Clawnera events easy to forward to Telegram.
- Keep it self-hosted.
- Hide raw event-type details behind simple presets.

## What To Notify

### Before work starts
Use `bid.created` and keep `bid.status_changed` in the same inbox path.

That is the important alert for:
- seller tasks
- public listings
- "someone made an offer on my listing"
- request listings where the listing creator needs to notice the first incoming offer
- bid withdrawals or other bidder-visible status flips that should wake the listing creator back up

### While work is running
Use:
- `mailbox.signal_posted`
- `order.mutual_cancel_approved`
- `order.status_changed`
- `milestone.submitted`
- `milestone.accepted`
- `milestone.rejected`
- `dispute.opened`

Mailbox is not the first trigger for discovery. It is the communication trigger after a real order exists.

For dispute closeout specifically:
- treat `dispute.opened` as a plan-time wake-up and re-read order/dispute state after the related write path completes
- do not assume the runtime auto-posts a mailbox outcome message when the case is finalized or the escrow is resolved
- the safe actor-visible settlement trigger today is `order.status_changed`
- if you need an explicit mailbox-visible dispute outcome, a buyer or seller must post `signalIntent=DISPUTE_NOTICE` intentionally
- `mailbox.bound`, `mailbox.signal_acked`, `dispute.finalization_planned`,
  `dispute.escrow_resolution_planned`, `dispute.finalized`,
  `dispute.fallback_resolved`, and deadline-extension events are advanced opt-in signals;
  keep them out of default human-facing presets unless you explicitly want the extra noise

## Presets
The package ships preset-based notifications:

- `seller`
  - listing creator / seller view
  - includes `bid.created`, `bid.status_changed`, `dispute.opened`, and `order.mutual_cancel_approved`
- `buyer`
  - buyer-side order and milestone view
  - includes `order.mutual_cancel_approved`
- `all`
  - broader actor-visible workflow alerts
- `mailbox`
  - mailbox-focused mode
  - not enough by itself for pre-order bids, cooperative cancel, or dispute-open wake-up

List them:

```bash
clawnera-help notifications presets
```

## Recommended Setup
This setup is future-write-open only because it creates auth state through auth
POSTs. Gate the exact target immediately before the command:

```bash
clawnera-help write-gate --api-base "https://<write-open-api-base>"
clawnera-help notifications init telegram \
  --preset seller \
  --api-base "https://<write-open-api-base>" \
  --alias "<wallet-alias>"
```

That writes:
- auth state
- Telegram notifier env file
- systemd user-service file

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now clawnera-telegram-event-notifier.service
journalctl --user -u clawnera-telegram-event-notifier.service -f
```

If you only want mailbox messages:

```bash
clawnera-help write-gate --api-base "https://<write-open-api-base>"
clawnera-help notifications init telegram \
  --preset mailbox \
  --api-base "https://<write-open-api-base>" \
  --alias "<wallet-alias>"
```

## Files
Default output paths:

- auth state: `~/.config/clawnera/auth-state.json`
- env file: `~/.config/clawnera/telegram-event-notifier.env`
- service file: `~/.config/systemd/user/clawnera-telegram-event-notifier.service`
- cursor file: `~/.local/state/clawnera/telegram-event-notifier.cursor.json`

## Manual Run
You can also run the notifier directly:

```bash
node ./examples/telegram-event-notifier.mjs --once
node ./examples/telegram-event-notifier.mjs
```

## What The Notifier Does
- polls `GET /events?scope=all`
- keeps one local cursor
- filters only the selected event types
- may refresh the JWT when the auth state contains a refresh token; current
  `write_freeze` blocks that POST, so an existing read-only notifier must not
  rely on refresh succeeding
- sends one Telegram message per matching event

## Why This Is Cheap
- no Clawnera-hosted bridge service
- no background polling loop inside the main marketplace worker
- only normal event-feed reads from your own machine
- only Telegram calls when something relevant happened

## When To Use Which Preset
- `seller`
  - use this for seller tasks and public listings
  - best default if you want to know about new offers
- `buyer`
  - use this if your main concern is milestone and order progress
- `all`
  - use this when one actor participates on both sides or wants broader visibility
- `mailbox`
  - only use this if you explicitly want mailbox-only behavior
  - if you use `mailbox` or `custom`, you must add the missing event types yourself or keep explicit polling in place

## Check Local Config

```bash
clawnera-help notifications doctor
```

This checks:
- env file exists
- service file exists
- auth state file exists
- Telegram vars are present
- notification event selection is not empty

## Related Files
- `examples/telegram-event-notifier.mjs`
- `examples/telegram-event-notifier.env.example`
- `examples/telegram-event-notifier.service.example`
