import os from "node:os";
import path from "node:path";

export const NOTIFICATION_PRESETS = Object.freeze({
  seller: Object.freeze({
    description: "Listing creator / seller alerts for new bids, order state, milestones, and mailbox updates.",
    eventTypes: Object.freeze([
      "bid.created",
      "bid.status_changed",
      "order.accepted",
      "order.status_changed",
      "milestone.submitted",
      "milestone.accepted",
      "milestone.rejected",
      "mailbox.signal_posted"
    ])
  }),
  buyer: Object.freeze({
    description: "Buyer alerts for order state, milestones, disputes, and mailbox updates.",
    eventTypes: Object.freeze([
      "order.accepted",
      "order.status_changed",
      "milestone.submitted",
      "milestone.accepted",
      "milestone.rejected",
      "dispute.opened",
      "dispute.finalized",
      "dispute.resolved",
      "mailbox.signal_posted"
    ])
  }),
  all: Object.freeze({
    description: "Broad actor-visible alerts for both buy-side and sell-side workflows.",
    eventTypes: Object.freeze([
      "listing.status_changed",
      "bid.created",
      "bid.status_changed",
      "order.accepted",
      "order.status_changed",
      "milestone.submitted",
      "milestone.accepted",
      "milestone.rejected",
      "dispute.opened",
      "dispute.finalized",
      "dispute.resolved",
      "mailbox.signal_posted"
    ])
  }),
  mailbox: Object.freeze({
    description: "Legacy mailbox-only notifications.",
    eventTypes: Object.freeze(["mailbox.signal_posted"])
  })
});

export const DEFAULT_NOTIFICATION_PRESET = "seller";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function notificationPresetNames() {
  return Object.keys(NOTIFICATION_PRESETS).sort();
}

export function resolveNotificationPreset(rawPreset) {
  const normalized = normalizeString(rawPreset || DEFAULT_NOTIFICATION_PRESET).toLowerCase();
  return NOTIFICATION_PRESETS[normalized] ? normalized : null;
}

export function parseNotificationEventTypes(rawValue) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : normalizeString(rawValue)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  return [...new Set(values)].sort();
}

export function resolveNotificationEventTypes({ preset, eventTypes } = {}) {
  const normalizedPreset = resolveNotificationPreset(preset || DEFAULT_NOTIFICATION_PRESET);
  const presetEventTypes = normalizedPreset ? [...NOTIFICATION_PRESETS[normalizedPreset].eventTypes] : [];
  const explicitEventTypes = parseNotificationEventTypes(eventTypes);
  const merged = explicitEventTypes.length > 0 ? [...presetEventTypes, ...explicitEventTypes] : presetEventTypes;
  return {
    preset: normalizedPreset,
    eventTypes: [...new Set(merged)].sort()
  };
}

export function defaultNotificationEnvPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "clawnera", "telegram-event-notifier.env");
}

export function defaultNotificationCursorPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".local", "state", "clawnera", "telegram-event-notifier.cursor.json");
}

export function defaultNotificationServicePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "systemd", "user", "clawnera-telegram-event-notifier.service");
}

export function buildNotificationEnvText(input = {}) {
  const lines = [];
  if (input.packageRoot) {
    lines.push(`CLAWNERA_PACKAGE_ROOT=${input.packageRoot}`);
  }
  if (input.apiBase) {
    lines.push(`CLAWNERA_API_BASE_URL=${input.apiBase}`);
  }
  if (input.authStateFile) {
    lines.push(`CLAWNERA_AUTH_STATE_FILE=${input.authStateFile}`);
  }
  if (input.preset) {
    lines.push(`CLAWNERA_NOTIFY_PRESET=${input.preset}`);
  }
  if (Array.isArray(input.eventTypes) && input.eventTypes.length > 0) {
    lines.push(`CLAWNERA_NOTIFY_EVENT_TYPES=${input.eventTypes.join(",")}`);
  }
  if (input.cursorFile) {
    lines.push(`CLAWNERA_NOTIFY_CURSOR_FILE=${input.cursorFile}`);
  }
  if (input.pollMs) {
    lines.push(`CLAWNERA_NOTIFY_POLL_MS=${String(input.pollMs)}`);
  }
  if (input.batchLimit) {
    lines.push(`CLAWNERA_NOTIFY_BATCH_LIMIT=${String(input.batchLimit)}`);
  }
  if (input.timeoutMs) {
    lines.push(`CLAWNERA_NOTIFY_TIMEOUT_MS=${String(input.timeoutMs)}`);
  }
  if (input.refreshSkewMs) {
    lines.push(`CLAWNERA_NOTIFY_REFRESH_SKEW_MS=${String(input.refreshSkewMs)}`);
  }
  lines.push(`TELEGRAM_BOT_TOKEN=${input.telegramBotToken || "<botfather token>"}`);
  lines.push(`TELEGRAM_CHAT_ID=${input.telegramChatId || "<chat id>"}`);
  return `${lines.join("\n")}\n`;
}

export function buildNotificationServiceText(input = {}) {
  const envFile = normalizeString(input.envFile);
  const packageRoot = normalizeString(input.packageRoot || "$CLAWNERA_PACKAGE_ROOT");
  return `[Unit]
Description=Clawnera Telegram event notifier
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${envFile}
ExecStart=/usr/bin/env bash -lc 'node "${packageRoot}/examples/telegram-event-notifier.mjs"'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function genericDetails(payload, keys) {
  return keys
    .map((key) => {
      const value = payload?.[key];
      return typeof value === "string" && value.trim() ? `${key}: ${value}` : "";
    })
    .filter(Boolean);
}

export function formatNotificationEventForTelegram(event) {
  const payload = event && typeof event === "object" ? event.payloadJson || {} : {};
  const header = `Clawnera ${event?.eventType || "event"}`;
  let bodyLines = [];

  switch (event?.eventType) {
    case "bid.created":
      bodyLines = [
        "New bid on your listing.",
        ...genericDetails(payload, ["listingId", "bidId", "bidderAddress", "amount", "currency"])
      ];
      break;
    case "bid.status_changed":
      bodyLines = [
        "Bid status changed.",
        ...genericDetails(payload, ["listingId", "bidId", "previousStatus", "status"])
      ];
      break;
    case "order.accepted":
    case "order.status_changed":
      bodyLines = [
        "Order status update.",
        ...genericDetails(payload, ["orderId", "listingId", "previousStatus", "status"])
      ];
      break;
    case "milestone.submitted":
    case "milestone.accepted":
    case "milestone.rejected":
      bodyLines = [
        "Milestone update.",
        ...genericDetails(payload, ["orderId", "milestoneId", "status"])
      ];
      break;
    case "mailbox.signal_posted":
      bodyLines = [
        "New mailbox message.",
        ...genericDetails(payload, ["orderId", "senderRole", "signalIntent", "payloadRef"])
      ];
      break;
    case "dispute.opened":
    case "dispute.finalized":
    case "dispute.resolved":
      bodyLines = [
        "Dispute update.",
        ...genericDetails(payload, ["orderId", "disputeCaseId", "status", "resolution"])
      ];
      break;
    case "listing.status_changed":
      bodyLines = [
        "Listing status changed.",
        ...genericDetails(payload, ["listingId", "previousStatus", "status"])
      ];
      break;
    default:
      bodyLines = genericDetails(payload, ["listingId", "bidId", "orderId", "status"]);
      if (bodyLines.length === 0) {
        bodyLines = ["New marketplace event."];
      }
      break;
  }

  return [header, ...bodyLines].join("\n");
}
