import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNotificationEnvText,
  buildNotificationServiceText,
  CUSTOM_NOTIFICATION_PRESET,
  KNOWN_NOTIFICATION_EVENT_TYPES,
  defaultNotificationCursorPath,
  defaultNotificationEnvPath,
  defaultNotificationServicePath,
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
  assert.deepEqual(resolved.invalidEventTypes, []);
});

test("unknown event types are reported instead of silently accepted", () => {
  const resolved = resolveNotificationEventTypes({
    preset: "seller",
    eventTypes: "bid.created,not.real.event"
  });
  assert.ok(KNOWN_NOTIFICATION_EVENT_TYPES.includes("bid.created"));
  assert.deepEqual(resolved.invalidEventTypes, ["not.real.event"]);
  assert.ok(!resolved.eventTypes.includes("not.real.event"));
});

test("custom preset keeps only explicit event types", () => {
  const resolved = resolveNotificationEventTypes({
    preset: CUSTOM_NOTIFICATION_PRESET,
    eventTypes: "bid.created,order.status_changed"
  });
  assert.equal(resolved.preset, CUSTOM_NOTIFICATION_PRESET);
  assert.equal(resolved.invalidPreset, null);
  assert.deepEqual(resolved.eventTypes, ["bid.created", "order.status_changed"]);
});

test("explicit event types without preset default to custom-only selection", () => {
  const resolved = resolveNotificationEventTypes({
    eventTypes: "bid.created,order.status_changed"
  });
  assert.equal(resolved.preset, CUSTOM_NOTIFICATION_PRESET);
  assert.deepEqual(resolved.eventTypes, ["bid.created", "order.status_changed"]);
});

test("invalid preset is surfaced explicitly", () => {
  const resolved = resolveNotificationEventTypes({
    preset: "typo",
    eventTypes: "bid.created"
  });
  assert.equal(resolved.preset, null);
  assert.equal(resolved.invalidPreset, "typo");
  assert.deepEqual(resolved.eventTypes, ["bid.created"]);
});

test("notification env text contains auth, preset, and blank telegram values", () => {
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
  assert.match(envText, /TELEGRAM_BOT_TOKEN=$/m);
  assert.match(envText, /TELEGRAM_CHAT_ID=$/m);
});

test("notification service text points at the generic event notifier", () => {
  const serviceText = buildNotificationServiceText({
    envFile: "/home/test/.config/clawnera/telegram-event-notifier.env",
    packageRoot: "/opt/clawnera-bot-market",
    nodeBinary: "/usr/local/bin/node"
  });

  assert.match(serviceText, /EnvironmentFile="\/home\/test\/\.config\/clawnera\/telegram-event-notifier\.env"/);
  assert.match(serviceText, /ExecStart="\/usr\/local\/bin\/node" "\/opt\/clawnera-bot-market\/examples\/telegram-event-notifier\.mjs"/);
});

test("default notification paths are isolated per preset", () => {
  assert.equal(
    defaultNotificationEnvPath("/home/test", "seller"),
    "/home/test/.config/clawnera/telegram-event-notifier.seller.env"
  );
  assert.equal(
    defaultNotificationEnvPath("/home/test", "mailbox"),
    "/home/test/.config/clawnera/telegram-event-notifier.mailbox.env"
  );
  assert.equal(
    defaultNotificationCursorPath("/home/test", "custom"),
    "/home/test/.local/state/clawnera/telegram-event-notifier.custom.cursor.json"
  );
  assert.equal(
    defaultNotificationServicePath("/home/test", "buyer"),
    "/home/test/.config/systemd/user/clawnera-telegram-event-notifier-buyer.service"
  );
});
