#!/usr/bin/env node
process.env.CLAWNERA_NOTIFY_PRESET = "mailbox";
process.env.CLAWNERA_NOTIFY_EVENT_TYPES = "mailbox.signal_posted";

const { main } = await import("./telegram-event-notifier.mjs");

await main(process.argv.slice(2));
