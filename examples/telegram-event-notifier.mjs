#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAuthState,
  refreshAuthState,
  saveAuthState,
  tokenExpiresSoon
} from "../lib/runtime-auth.mjs";
import {
  DEFAULT_NOTIFICATION_PRESET,
  formatNotificationEventForTelegram,
  resolveNotificationEventTypes
} from "../lib/notifications.mjs";

const HELP_TEXT = `Telegram event notifier

Polls actor-visible Clawnera marketplace events and forwards selected events to Telegram.

Required env:
- CLAWNERA_API_BASE_URL
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Auth env:
- Either CLAWNERA_API_JWT
- Or CLAWNERA_AUTH_STATE_FILE
- Optional: CLAWNERA_API_REFRESH_TOKEN

Notification env:
- CLAWNERA_NOTIFY_PRESET           default: seller
- CLAWNERA_NOTIFY_EVENT_TYPES      comma-separated override/extension

Optional env:
- CLAWNERA_AUTH_STATE_FILE         JSON auth state written by clawnera-help auth-login or notifications init
- CLAWNERA_NOTIFY_CURSOR_FILE      default: ./.clawnera-event-notifier.cursor.json
- CLAWNERA_NOTIFY_POLL_MS          default: 15000
- CLAWNERA_NOTIFY_BATCH_LIMIT      default: 50
- CLAWNERA_NOTIFY_TIMEOUT_MS       default: 10000
- CLAWNERA_NOTIFY_REFRESH_SKEW_MS  default: 60000
- CLAWNERA_NOTIFY_ONCE             set 1 for a single poll cycle

Usage:
- node ./examples/telegram-event-notifier.mjs
- node ./examples/telegram-event-notifier.mjs --once
- node ./examples/telegram-event-notifier.mjs --help
`;

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing_env_${name}`);
  }
  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || "";
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
  return path.resolve(process.cwd(), ".clawnera-event-notifier.cursor.json");
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

async function fetchEventPage({ apiBase, jwt, cursor, batchLimit, timeoutMs }) {
  const url = new URL("/events", apiBase);
  url.searchParams.set("scope", "all");
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
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    nextCursor: typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null
  };
}

async function loadNotifierAuthState({ apiBase, authStateFile }) {
  if (authStateFile) {
    const state = await loadAuthState(authStateFile);
    return {
      ...state,
      apiBase: state.apiBase || apiBase
    };
  }

  return {
    apiBase,
    token: readOptionalEnv("CLAWNERA_API_JWT"),
    refreshToken: readOptionalEnv("CLAWNERA_API_REFRESH_TOKEN")
  };
}

async function ensureFreshToken({ authState, authStateFile, timeoutMs, refreshSkewMs }) {
  if (!authState?.token) {
    if (!authState?.refreshToken) {
      throw new Error("missing_auth_token");
    }
    const refreshed = await refreshAuthState({
      apiBase: authState.apiBase,
      authState,
      timeoutMs
    });
    if (authStateFile) {
      await saveAuthState(authStateFile, refreshed);
    }
    return refreshed;
  }

  if (!authState.refreshToken || !tokenExpiresSoon(authState.token, refreshSkewMs)) {
    return authState;
  }

  const refreshed = await refreshAuthState({
    apiBase: authState.apiBase,
    authState,
    timeoutMs
  });
  if (authStateFile) {
    await saveAuthState(authStateFile, refreshed);
  }
  return refreshed;
}

async function fetchEventPageWithRefresh({
  authState,
  authStateFile,
  cursor,
  batchLimit,
  timeoutMs,
  refreshSkewMs
}) {
  let activeState = await ensureFreshToken({
    authState,
    authStateFile,
    timeoutMs,
    refreshSkewMs
  });

  try {
    const page = await fetchEventPage({
      apiBase: activeState.apiBase,
      jwt: activeState.token,
      cursor,
      batchLimit,
      timeoutMs
    });
    return {
      authState: activeState,
      ...page
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("event_feed_http_401") || !activeState.refreshToken) {
      throw error;
    }

    activeState = await refreshAuthState({
      apiBase: activeState.apiBase,
      authState: activeState,
      timeoutMs
    });
    if (authStateFile) {
      await saveAuthState(authStateFile, activeState);
    }

    const page = await fetchEventPage({
      apiBase: activeState.apiBase,
      jwt: activeState.token,
      cursor,
      batchLimit,
      timeoutMs
    });
    return {
      authState: activeState,
      ...page
    };
  }
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

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const once = argv.includes("--once") || process.env.CLAWNERA_NOTIFY_ONCE === "1";
  const apiBase = readRequiredEnv("CLAWNERA_API_BASE_URL");
  const authStateFile = readOptionalEnv("CLAWNERA_AUTH_STATE_FILE");
  const botToken = readRequiredEnv("TELEGRAM_BOT_TOKEN");
  const chatId = readRequiredEnv("TELEGRAM_CHAT_ID");
  const preset = process.env.CLAWNERA_NOTIFY_PRESET?.trim() || DEFAULT_NOTIFICATION_PRESET;
  const resolvedEvents = resolveNotificationEventTypes({
    preset,
    eventTypes: process.env.CLAWNERA_NOTIFY_EVENT_TYPES
  });
  if (resolvedEvents.eventTypes.length === 0) {
    throw new Error("missing_notification_event_types");
  }
  const selectedEventTypes = new Set(resolvedEvents.eventTypes);
  const cursorFile = path.resolve(process.env.CLAWNERA_NOTIFY_CURSOR_FILE?.trim() || defaultCursorFile());
  const pollMs = parsePositiveIntEnv("CLAWNERA_NOTIFY_POLL_MS", 15_000);
  const batchLimit = parsePositiveIntEnv("CLAWNERA_NOTIFY_BATCH_LIMIT", 50);
  const timeoutMs = parsePositiveIntEnv("CLAWNERA_NOTIFY_TIMEOUT_MS", 10_000);
  const refreshSkewMs = parsePositiveIntEnv("CLAWNERA_NOTIFY_REFRESH_SKEW_MS", 60_000);

  const state = await loadState(cursorFile);
  let authState = await loadNotifierAuthState({
    apiBase,
    authStateFile
  });

  for (;;) {
    try {
      let pageCursor = state.cursor;
      let pageCount = 0;
      let fetched = 0;
      let delivered = 0;

      for (;;) {
        const eventRead = await fetchEventPageWithRefresh({
          authState,
          authStateFile,
          cursor: pageCursor,
          batchLimit,
          timeoutMs,
          refreshSkewMs
        });
        authState = eventRead.authState;
        pageCount += 1;

        if (eventRead.items.length === 0) {
          break;
        }

        for (const event of eventRead.items) {
          fetched += 1;
          if (selectedEventTypes.has(event.eventType)) {
            await sendTelegramMessage({
              botToken,
              chatId,
              text: formatNotificationEventForTelegram(event),
              timeoutMs
            });
            delivered += 1;
          }
          state.cursor = buildCursor(event);
        }

        if (state.cursor) {
          await saveState(cursorFile, state);
        }

        if (!eventRead.nextCursor || eventRead.nextCursor === pageCursor) {
          break;
        }
        pageCursor = eventRead.nextCursor;
      }

      if (once) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              preset: resolvedEvents.preset,
              eventTypes: resolvedEvents.eventTypes,
              pages: pageCount,
              fetched,
              delivered,
              cursor: state.cursor ?? null,
              address: authState.address || null
            },
            null,
            2
          )
        );
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`telegram_event_notifier_error: ${message}`);
      if (once) {
        process.exitCode = 1;
        return;
      }
    }

    await sleep(pollMs);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`telegram_event_notifier_fatal: ${message}`);
    process.exitCode = 1;
  });
}
