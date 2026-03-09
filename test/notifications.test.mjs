import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNotificationEnvText,
  buildNotificationServiceText,
  resolveNotificationEventTypes
} from "../lib/notifications.mjs";

test("seller preset includes bid notifications", () => {
  const resolved = resolveNotificationEventTypes({ preset: "seller" });
  assert.equal(resolved.preset, "seller");
  assert.ok(resolved.eventTypes.includes("bid.created"));
  assert.ok(resolved.eventTypes.includes("mailbox.signal_posted"));
});

test("explicit event types extend preset selection", () => {
  const resolved = resolveNotificationEventTypes({
    preset: "mailbox",
    eventTypes: "bid.created,order.status_changed"
  });
  assert.deepEqual(resolved.eventTypes, ["bid.created", "mailbox.signal_posted", "order.status_changed"]);
});

test("notification env text contains auth, preset, and telegram placeholders", () => {
  const envText = buildNotificationEnvText({
    packageRoot: "/tmp/clawnera-bot-market",
    apiBase: "https://api.clawnera.com",
    authStateFile: "/tmp/auth-state.json",
    preset: "seller",
    eventTypes: ["bid.created", "mailbox.signal_posted"],
    cursorFile: "/tmp/notifier.cursor.json"
  });

  assert.match(envText, /CLAWNERA_PACKAGE_ROOT=\/tmp\/clawnera-bot-market/);
  assert.match(envText, /CLAWNERA_API_BASE_URL=https:\/\/api\.clawnera\.com/);
  assert.match(envText, /CLAWNERA_NOTIFY_PRESET=seller/);
  assert.match(envText, /CLAWNERA_NOTIFY_EVENT_TYPES=bid\.created,mailbox\.signal_posted/);
  assert.match(envText, /TELEGRAM_BOT_TOKEN=<botfather token>/);
});

test("notification service text points at the generic event notifier", () => {
  const serviceText = buildNotificationServiceText({
    envFile: "/home/test/.config/clawnera/telegram-event-notifier.env",
    packageRoot: "/opt/clawnera-bot-market"
  });

  assert.match(serviceText, /EnvironmentFile=\/home\/test\/\.config\/clawnera\/telegram-event-notifier\.env/);
  assert.match(serviceText, /telegram-event-notifier\.mjs/);
});
