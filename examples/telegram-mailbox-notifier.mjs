#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const HELP_TEXT = `Telegram mailbox notifier

Polls actor-visible Clawnera mailbox events and forwards new mailbox messages to Telegram.

Required env:
- CLAWNERA_API_BASE_URL
- CLAWNERA_API_JWT
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Optional env:
- CLAWNERA_NOTIFY_CURSOR_FILE   default: ./.clawnera-mailbox-notifier.cursor.json
- CLAWNERA_NOTIFY_POLL_MS       default: 15000
- CLAWNERA_NOTIFY_BATCH_LIMIT   default: 50
- CLAWNERA_NOTIFY_TIMEOUT_MS    default: 10000
- CLAWNERA_NOTIFY_ONCE          set 1 for a single poll cycle

Usage:
- node ./examples/telegram-mailbox-notifier.mjs
- node ./examples/telegram-mailbox-notifier.mjs --once
- node ./examples/telegram-mailbox-notifier.mjs --help
`;

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing_env_${name}`);
  }
  return value;
}

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid_env_${name}`);
  }
  return parsed;
}

function buildCursor(event) {
  return `${event.createdAt}|${event.id}`;
}

function defaultCursorFile() {
  return path.resolve(process.cwd(), ".clawnera-mailbox-notifier.cursor.json");
}

async function loadState(cursorFile) {
  try {
    const raw = await fs.readFile(cursorFile, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.cursor === "string" && parsed.cursor ? { cursor: parsed.cursor } : { cursor: undefined };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { cursor: undefined };
    }
    throw error;
  }
}

async function saveState(cursorFile, state) {
  await fs.mkdir(path.dirname(cursorFile), { recursive: true });
  await fs.writeFile(cursorFile, JSON.stringify(state, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTelegramMessage(event) {
  const payload = event?.payloadJson ?? {};
  const orderId = typeof payload.orderId === "string" ? payload.orderId : "unknown";
  const senderRole = typeof payload.senderRole === "string" ? payload.senderRole : "counterparty";
  const signalIntent = typeof payload.signalIntent === "string" ? payload.signalIntent : "MSG";
  const seq = typeof payload.seq === "string" ? payload.seq : "?";
  const payloadRef = typeof payload.payloadRef === "string" ? payload.payloadRef : "";

  const lines = [
    "Clawnera mailbox update",
    `Order: ${orderId}`,
    `From: ${senderRole}`,
    `Type: ${signalIntent}`,
    `Seq: ${seq}`
  ];
  if (payloadRef) {
    lines.push(`Ref: ${payloadRef}`);
  }
  return lines.join("\n");
}

async function fetchMailboxEvents({ apiBase, jwt, cursor, batchLimit, timeoutMs }) {
  const url = new URL("/events", apiBase);
  url.searchParams.set("scope", "all");
  url.searchParams.set("type", "mailbox.signal_posted");
  url.searchParams.set("limit", String(batchLimit));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${jwt}`
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`event_feed_http_${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

async function sendTelegramMessage({ botToken, chatId, text, timeoutMs }) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`telegram_http_${response.status}:${body}`);
  }
}

async function run() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const once = process.argv.includes("--once") || process.env.CLAWNERA_NOTIFY_ONCE === "1";
  const apiBase = readRequiredEnv("CLAWNERA_API_BASE_URL");
  const jwt = readRequiredEnv("CLAWNERA_API_JWT");
  const botToken = readRequiredEnv("TELEGRAM_BOT_TOKEN");
  const chatId = readRequiredEnv("TELEGRAM_CHAT_ID");
  const cursorFile = path.resolve(process.env.CLAWNERA_NOTIFY_CURSOR_FILE?.trim() || defaultCursorFile());
  const pollMs = parsePositiveIntEnv("CLAWNERA_NOTIFY_POLL_MS", 15_000);
  const batchLimit = parsePositiveIntEnv("CLAWNERA_NOTIFY_BATCH_LIMIT", 50);
  const timeoutMs = parsePositiveIntEnv("CLAWNERA_NOTIFY_TIMEOUT_MS", 10_000);

  const state = await loadState(cursorFile);

  for (;;) {
    try {
      const items = await fetchMailboxEvents({
        apiBase,
        jwt,
        cursor: state.cursor,
        batchLimit,
        timeoutMs
      });

      for (const event of items) {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: formatTelegramMessage(event),
          timeoutMs
        });
        state.cursor = buildCursor(event);
        await saveState(cursorFile, state);
      }

      if (once) {
        console.log(JSON.stringify({ ok: true, fetched: items.length, cursor: state.cursor ?? null }, null, 2));
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`telegram_mailbox_notifier_error: ${message}`);
      if (once) {
        process.exitCode = 1;
        return;
      }
    }

    await sleep(pollMs);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`telegram_mailbox_notifier_fatal: ${message}`);
  process.exitCode = 1;
});
