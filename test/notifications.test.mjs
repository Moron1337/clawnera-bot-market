import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNotificationEnvText,
  formatNotificationEventForTelegram,
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

test("notification env text contains auth, preset, and telegram placeholders when credentials are missing", () => {
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
  assert.match(envText, /# TELEGRAM_BOT_TOKEN=<set your bot token>/);
  assert.match(envText, /# TELEGRAM_CHAT_ID=<set your chat id>/);
});

test("notification service text points at the generic event notifier", () => {
  const serviceText = buildNotificationServiceText({
    envFile: "/home/test/.config/clawnera/telegram-event-notifier.env",
    packageRoot: "/opt/clawnera-bot-market",
    nodeBinary: "/usr/local/bin/node"
  });

  assert.match(serviceText, /EnvironmentFile=\/home\/test\/\.config\/clawnera\/telegram-event-notifier\.env/);
  assert.match(serviceText, /ExecStart="\/usr\/local\/bin\/node" "\/opt\/clawnera-bot-market\/examples\/telegram-event-notifier\.mjs"/);
  assert.match(serviceText, /RestartPreventExitStatus=78/);
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

test("bid notifications prefer listing title and readable values", () => {
  const text = formatNotificationEventForTelegram({
    eventType: "bid.created",
    payloadJson: {
      listingTitle: "Signal Spark Post",
      listingId: "410619eb-8e5e-4ee7-a100-8cb8c5500af3",
      bidId: "36953195-8f21-41d1-8774-aee88e58ac87",
      bidderAddress: "0x0a0d4c9a9f935dac9f9bee55ca0632c187077a04d0dffcc479402f2de9a82140",
      amount: "117000000",
      currency: "CLAW"
    }
  });

  assert.match(text, /^Clawnera new bid/m);
  assert.match(text, /Listing: Signal Spark Post/);
  assert.match(text, /Amount: 117,000,000 CLAW/);
  assert.match(text, /Bidder: 0x0a0d4c9a\.\.\.a82140/);
  assert.match(text, /Bid ID: 36953195\.\.\.58ac87/);
  assert.match(text, /Listing ID: 410619eb\.\.\.500af3/);
});

test("bid notifications also read event feed payload fields", () => {
  const text = formatNotificationEventForTelegram({
    eventType: "bid.created",
    payload: {
      listingTitle: "Post-a-Job Guide",
      listingId: "768d326c-13df-4f66-a9ef-b96a44c0afab",
      bidId: "9a8673d9-9763-4f57-886c-1ee3c549190c",
      bidderAddress: "0x57b578c7e0c754f67f736bc26a4bda4b4c8d29dc6a74071aba075a0b343f1e5a",
      amount: "130000000",
      currency: "CLAW"
    }
  });

  assert.match(text, /^Clawnera new bid/m);
  assert.match(text, /Listing: Post-a-Job Guide/);
  assert.match(text, /Amount: 130,000,000 CLAW/);
  assert.match(text, /Bidder: 0x57b578c7\.\.\.3f1e5a/);
  assert.match(text, /Bid ID: 9a8673d9\.\.\.49190c/);
  assert.match(text, /Listing ID: 768d326c\.\.\.c0afab/);
});

test("order accepted notifications explain the next deposit step for dual-bond orders", () => {
  const text = formatNotificationEventForTelegram({
    eventType: "order.accepted",
    payloadJson: {
      orderId: "19b441a1-5a96-421c-b320-50a1a7e93804",
      listingId: "768d326c-13df-4f66-a9ef-b96a44c0afab",
      status: "AWAITING_DEPOSITS",
      disputeBondPolicy: "DUAL_BOND_REQUIRED"
    }
  });

  assert.match(text, /^Clawnera bid accepted/m);
  assert.match(text, /Your bid was accepted\. The order is now waiting for deposits\./);
  assert.match(text, /Next step: fund the required dispute-bond deposits so the order can move into execution\./);
  assert.match(text, /orderId: 19b441a1-5a96-421c-b320-50a1a7e93804/);
  assert.match(text, /listingId: 768d326c-13df-4f66-a9ef-b96a44c0afab/);
  assert.match(text, /status: AWAITING_DEPOSITS/);
});

test("order accepted notifications explain platform-funded marketing orders differently", () => {
  const text = formatNotificationEventForTelegram({
    eventType: "order.accepted",
    payloadJson: {
      orderId: "19b441a1-5a96-421c-b320-50a1a7e93804",
      listingId: "768d326c-13df-4f66-a9ef-b96a44c0afab",
      status: "AWAITING_DEPOSITS",
      disputeBondPolicy: "PLATFORM_FUNDED_MARKETING"
    }
  });

  assert.match(text, /^Clawnera bid accepted/m);
  assert.match(text, /Your bid was accepted\. No user-funded dispute bond is required for this order\./);
  assert.match(text, /The dispute bond is platform-funded for this order\./);
});
