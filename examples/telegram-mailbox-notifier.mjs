#!/usr/bin/env node
process.env.CLAWNERA_NOTIFY_PRESET ||= "mailbox";

const { main } = await import("./telegram-event-notifier.mjs");

await main(process.argv.slice(2));
