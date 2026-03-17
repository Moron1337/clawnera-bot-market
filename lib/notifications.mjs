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
export const CUSTOM_NOTIFICATION_PRESET = "custom";
export const DEFAULT_NOTIFICATION_POLL_MS = 15_000;
export const DEFAULT_NOTIFICATION_BATCH_LIMIT = 50;
export const DEFAULT_NOTIFICATION_TIMEOUT_MS = 10_000;
export const DEFAULT_NOTIFICATION_REFRESH_SKEW_MS = 60_000;
export const KNOWN_NOTIFICATION_EVENT_TYPES = Object.freeze(
  [...new Set(Object.values(NOTIFICATION_PRESETS).flatMap((preset) => [...preset.eventTypes]))].sort()
);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeNotificationEnvValue(value) {
  const normalized = normalizeString(value);
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function shellQuoteSystemdValue(value) {
  return `"${normalizeString(value).replace(/(["\\])/g, "\\$1")}"`;
}

export function isPlaceholderNotificationValue(value) {
  const normalized = normalizeNotificationEnvValue(value).toLowerCase();
  return (
    normalized === "<botfather token>" ||
    normalized === "<chat id>" ||
    normalized === "bot" ||
    normalized === "chat"
  );
}

export function isValidTelegramBotToken(value) {
  const normalized = normalizeNotificationEnvValue(value);
  return /^\d+:[A-Za-z0-9_-]+$/.test(normalized);
}

export function isValidTelegramChatId(value) {
  const normalized = normalizeNotificationEnvValue(value);
  return /^-?\d+$/.test(normalized) || /^@[A-Za-z0-9_]{5,}$/.test(normalized);
}

export function notificationPresetNames() {
  return Object.keys(NOTIFICATION_PRESETS).sort();
}

export function resolveNotificationPreset(rawPreset) {
  const normalized = normalizeString(rawPreset).toLowerCase();
  if (!normalized) {
    return DEFAULT_NOTIFICATION_PRESET;
  }
  if (normalized === CUSTOM_NOTIFICATION_PRESET) {
    return CUSTOM_NOTIFICATION_PRESET;
  }
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
  const rawPreset = normalizeString(preset).toLowerCase();
  const explicitEventTypes = parseNotificationEventTypes(eventTypes);
  const normalizedPreset = rawPreset
    ? resolveNotificationPreset(rawPreset)
    : explicitEventTypes.length > 0
      ? CUSTOM_NOTIFICATION_PRESET
      : DEFAULT_NOTIFICATION_PRESET;
  const invalidPreset = rawPreset && !normalizedPreset ? rawPreset : null;
  const presetEventTypes =
    normalizedPreset && normalizedPreset !== CUSTOM_NOTIFICATION_PRESET
      ? [...NOTIFICATION_PRESETS[normalizedPreset].eventTypes]
      : [];
  const invalidEventTypes = explicitEventTypes.filter((value) => !KNOWN_NOTIFICATION_EVENT_TYPES.includes(value));
  const acceptedExplicitEventTypes = explicitEventTypes.filter((value) => KNOWN_NOTIFICATION_EVENT_TYPES.includes(value));
  const merged =
    acceptedExplicitEventTypes.length > 0 ? [...presetEventTypes, ...acceptedExplicitEventTypes] : presetEventTypes;
  return {
    preset: normalizedPreset,
    eventTypes: [...new Set(merged)].sort(),
    invalidEventTypes,
    invalidPreset
  };
}

function notificationArtifactLabel(rawLabel = DEFAULT_NOTIFICATION_PRESET) {
  const normalized = resolveNotificationPreset(rawLabel);
  if (normalized) {
    return normalized;
  }
  const fallback = normalizeString(rawLabel).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return fallback || DEFAULT_NOTIFICATION_PRESET;
}

export function defaultNotificationEnvPath(homeDir = os.homedir(), label = DEFAULT_NOTIFICATION_PRESET) {
  const suffix = notificationArtifactLabel(label);
  return path.join(homeDir, ".config", "clawnera", `telegram-event-notifier.${suffix}.env`);
}

export function defaultNotificationAuthStatePath(homeDir = os.homedir(), label = DEFAULT_NOTIFICATION_PRESET) {
  const suffix = notificationArtifactLabel(label);
  return path.join(homeDir, ".config", "clawnera", `auth-state.${suffix}.json`);
}

export function defaultNotificationCursorPath(homeDir = os.homedir(), label = DEFAULT_NOTIFICATION_PRESET) {
  const suffix = notificationArtifactLabel(label);
  return path.join(homeDir, ".local", "state", "clawnera", `telegram-event-notifier.${suffix}.cursor.json`);
}

export function defaultNotificationServicePath(homeDir = os.homedir(), label = DEFAULT_NOTIFICATION_PRESET) {
  const suffix = notificationArtifactLabel(label);
  return path.join(homeDir, ".config", "systemd", "user", `clawnera-telegram-event-notifier-${suffix}.service`);
}

export function parsePositiveNotificationValue(raw, envName, fallback) {
  const normalized = typeof raw === "string" ? raw.trim() : "";
  if (!normalized) {
    return fallback;
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`invalid_env_${envName}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_env_${envName}`);
  }
  return parsed;
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
  if (input.telegramBotToken) {
    lines.push(`TELEGRAM_BOT_TOKEN=${input.telegramBotToken}`);
  } else {
    lines.push("# TELEGRAM_BOT_TOKEN=<set your bot token>");
  }
  if (input.telegramChatId) {
    lines.push(`TELEGRAM_CHAT_ID=${input.telegramChatId}`);
  } else {
    lines.push("# TELEGRAM_CHAT_ID=<set your chat id>");
  }
  return `${lines.join("\n")}\n`;
}

export function buildNotificationServiceText(input = {}) {
  const envFile = normalizeString(input.envFile);
  const packageRoot = normalizeString(input.packageRoot);
  const nodeBinary = normalizeString(input.nodeBinary || process.execPath);
  const notifierScript = path.join(packageRoot, "examples", "telegram-event-notifier.mjs");
  const quotedNodeBinary = shellQuoteSystemdValue(nodeBinary);
  const quotedNotifierScript = shellQuoteSystemdValue(notifierScript);
  return `[Unit]
Description=Clawnera Telegram event notifier
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${envFile}
ExecStart=${quotedNodeBinary} ${quotedNotifierScript}
Restart=always
RestartPreventExitStatus=78
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

function formatNotificationAmount(amount, currency) {
  const value = typeof amount === "string" ? amount.replace(/,/g, "").trim() : "";
  if (!value) {
    return "";
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    return currency ? `${amount} ${currency}` : String(amount);
  }
  const [whole, fraction] = value.split(".");
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = (fraction || "").replace(/0+$/, "");
  const formattedAmount = trimmedFraction ? `${formattedWhole}.${trimmedFraction}` : formattedWhole;
  return currency ? `${formattedAmount} ${currency}` : formattedAmount;
}

function shortenHexLike(value, start = 10, end = 6) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  if (!text) {
    return "";
  }
  if (text.length <= start + end + 3) {
    return text;
  }
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function eventHeader(eventType) {
  switch (eventType) {
    case "bid.created":
      return "Clawnera new bid";
    case "bid.status_changed":
      return "Clawnera bid update";
    case "order.accepted":
    case "order.status_changed":
      return "Clawnera order update";
    case "milestone.submitted":
    case "milestone.accepted":
    case "milestone.rejected":
      return "Clawnera milestone update";
    case "mailbox.signal_posted":
      return "Clawnera mailbox update";
    case "dispute.opened":
    case "dispute.finalized":
    case "dispute.resolved":
      return "Clawnera dispute update";
    case "listing.status_changed":
      return "Clawnera listing update";
    default:
      return `Clawnera ${eventType || "event"}`;
  }
}

export function formatNotificationEventForTelegram(event) {
  const payload =
    event && typeof event === "object"
      ? event.payloadJson || event.payload || {}
      : {};
  const header = eventHeader(event?.eventType);
  let bodyLines = [];

  switch (event?.eventType) {
    case "bid.created": {
      const listingTitle =
        typeof payload.listingTitle === "string" && payload.listingTitle.trim() ? payload.listingTitle.trim() : "";
      const amountLine = formatNotificationAmount(payload.amount, payload.currency);
      bodyLines = [
        listingTitle ? `Listing: ${listingTitle}` : "New bid on your listing.",
        amountLine ? `Amount: ${amountLine}` : "",
        payload.bidderAddress ? `Bidder: ${shortenHexLike(payload.bidderAddress)}` : "",
        payload.bidId ? `Bid ID: ${shortenHexLike(payload.bidId, 8, 6)}` : "",
        payload.listingId ? `Listing ID: ${shortenHexLike(payload.listingId, 8, 6)}` : ""
      ];
      break;
    }
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

  return [header, ...bodyLines.filter(Boolean)].join("\n");
}
