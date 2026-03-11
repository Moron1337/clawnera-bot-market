#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAuthState,
  refreshAuthState,
  saveAuthState,
  tokenExpiresSoon,
  validateRuntimeAuthState
} from "../lib/runtime-auth.mjs";
import {
  CUSTOM_NOTIFICATION_PRESET,
  DEFAULT_NOTIFICATION_BATCH_LIMIT,
  DEFAULT_NOTIFICATION_PRESET,
  DEFAULT_NOTIFICATION_POLL_MS,
  DEFAULT_NOTIFICATION_REFRESH_SKEW_MS,
  DEFAULT_NOTIFICATION_TIMEOUT_MS,
  defaultNotificationCursorPath,
  formatNotificationEventForTelegram,
  isPlaceholderNotificationValue,
  isValidTelegramBotToken,
  isValidTelegramChatId,
  normalizeNotificationEnvValue,
  parsePositiveNotificationValue,
  resolveNotificationEventTypes
} from "../lib/notifications.mjs";

const HELP_TEXT = `Telegram event notifier

Polls actor-visible Clawnera marketplace events and forwards selected events to Telegram.

Required env:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Auth env:
- Either CLAWNERA_API_JWT
- Or CLAWNERA_AUTH_STATE_FILE
- Optional: CLAWNERA_API_REFRESH_TOKEN

API base:
- Either CLAWNERA_API_BASE_URL
- Or an auth state file with apiBase

Notification env:
- CLAWNERA_NOTIFY_PRESET           default: seller
- CLAWNERA_NOTIFY_EVENT_TYPES      comma-separated override/extension

Optional env:
- CLAWNERA_AUTH_STATE_FILE         JSON auth state written by clawnera-help auth-login or notifications init
- CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK  set 1 to allow invalid env auth to fall back to CLAWNERA_AUTH_STATE_FILE
- CLAWNERA_NOTIFY_CURSOR_FILE      default: ${defaultNotificationCursorPath()}
- CLAWNERA_NOTIFY_POLL_MS          default: ${DEFAULT_NOTIFICATION_POLL_MS}
- CLAWNERA_NOTIFY_BATCH_LIMIT      default: ${DEFAULT_NOTIFICATION_BATCH_LIMIT}
- CLAWNERA_NOTIFY_TIMEOUT_MS       default: ${DEFAULT_NOTIFICATION_TIMEOUT_MS}
- CLAWNERA_NOTIFY_REFRESH_SKEW_MS  default: ${DEFAULT_NOTIFICATION_REFRESH_SKEW_MS}
- CLAWNERA_NOTIFY_ONCE             set 1/true/yes/on for a single poll cycle

Usage:
- node ./examples/telegram-event-notifier.mjs
- node ./examples/telegram-event-notifier.mjs --once
- node ./examples/telegram-event-notifier.mjs --help

Auth precedence:
- Env auth wins when valid.
- Invalid env auth fails startup by default.
- Set CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK=1 to let the notifier fall back to a valid auth state file.
`;
const CURSOR_PERSIST_ATTEMPTS = 3;
const CURSOR_PERSIST_RETRY_DELAY_MS = 150;
const CURSOR_PERSIST_FATAL_THRESHOLD = 3;

function readRequiredEnv(name) {
  const value = normalizeNotificationEnvValue(process.env[name]);
  if (!value) {
    throw new Error(`missing_env_${name}`);
  }
  return value;
}

function normalizeApiBase(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("invalid_protocol");
    }
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return "";
  }
}

function readConfiguredApiBaseEnv() {
  const rawApiBase = readOptionalEnv("CLAWNERA_API_BASE_URL");
  if (!rawApiBase) {
    return "";
  }
  const apiBase = normalizeApiBase(rawApiBase);
  if (!apiBase) {
    throw new Error("missing_or_invalid_api_base");
  }
  return apiBase;
}

function readRequiredTelegramEnv(name) {
  const value = readRequiredEnv(name);
  if (isPlaceholderNotificationValue(value)) {
    throw new Error(`invalid_env_${name}`);
  }
  if (name === "TELEGRAM_BOT_TOKEN" && !isValidTelegramBotToken(value)) {
    throw new Error(`invalid_env_${name}`);
  }
  if (name === "TELEGRAM_CHAT_ID" && !isValidTelegramChatId(value)) {
    throw new Error(`invalid_env_${name}`);
  }
  return value;
}

function readOptionalEnv(name) {
  const value = normalizeNotificationEnvValue(process.env[name]);
  return value || "";
}

function envFlagEnabled(name) {
  const normalized = readOptionalEnv(name).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  throw new Error(`invalid_boolean_env:${name}`);
}

function buildCursor(event) {
  return `${event.createdAt}|${event.id}`;
}

function defaultCursorFile(label) {
  return defaultNotificationCursorPath(undefined, label);
}

function backupStateFile(cursorFile) {
  return `${cursorFile}.bak`;
}

async function readCursorStateFile(cursorFile) {
  const raw = await fs.readFile(cursorFile, "utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed.cursor === "string" && parsed.cursor ? { cursor: parsed.cursor } : { cursor: undefined };
}

export async function loadState(cursorFile) {
  const problems = [];
  let primaryMissing = false;
  let backupMissing = false;
  const backupFile = backupStateFile(cursorFile);
  try {
    return await readCursorStateFile(cursorFile);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      primaryMissing = true;
    }
    problems.push(error instanceof Error ? error.message : String(error));
  }

  try {
    return await readCursorStateFile(backupFile);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      backupMissing = true;
    }
    problems.push(error instanceof Error ? error.message : String(error));
  }

  if (!(primaryMissing && backupMissing) && problems.length > 0) {
    console.warn(`telegram_event_notifier_warning: cursor_state_reset_due_to_invalid_files:${problems.join("|")}`);
  }
  return { cursor: undefined };
}

export async function saveState(cursorFile, state) {
  const target = path.resolve(cursorFile);
  const tempFile = `${target}.${process.pid}.${Date.now()}.tmp`;
  const backupFile = backupStateFile(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tempFile, target);
  try {
    await fs.copyFile(target, backupFile);
    return {
      backupWarning: null
    };
  } catch (error) {
    return {
      backupWarning: error instanceof Error ? error.message : String(error)
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEventPage({ apiBase, jwt, cursor, batchLimit, timeoutMs, eventTypeFilter }) {
  const url = new URL("/events", apiBase);
  url.searchParams.set("scope", "all");
  url.searchParams.set("limit", String(batchLimit));
  if (eventTypeFilter) {
    url.searchParams.set("type", eventTypeFilter);
  }
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
  const envToken = readOptionalEnv("CLAWNERA_API_JWT");
  const envRefreshToken = readOptionalEnv("CLAWNERA_API_REFRESH_TOKEN");
  const envAuthProvided = Boolean(envToken || envRefreshToken);
  const allowAuthStateFallback = envFlagEnabled("CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK");
  const envValidation = validateRuntimeAuthState({
    apiBase,
    token: envToken,
    refreshToken: envRefreshToken
  });
  let stateValidation = null;

  if (authStateFile) {
    try {
      const state = await loadAuthState(authStateFile);
      stateValidation = validateRuntimeAuthState(state, {
        apiBaseFallback: apiBase,
        requiredApiBase: apiBase
      });
    } catch (error) {
      stateValidation = {
        ok: false,
        authState: null,
        issues: [error instanceof Error ? error.message : "invalid_auth_state_file"]
      };
    }
  }

  if (envAuthProvided) {
    if (envValidation.ok) {
      return {
        authSource: "env",
        authState: envValidation.authState
      };
    }
    if (allowAuthStateFallback && stateValidation?.ok) {
      console.warn("telegram_event_notifier_warning: invalid_env_auth_source_using_auth_state_file");
      return {
        authSource: "auth_state_fallback",
        authState: stateValidation.authState
      };
    }
    const envIssue = envValidation.issues[0] || "invalid_env_auth";
    const stateIssue = stateValidation?.issues?.[0];
    throw new Error(
      `invalid_env_auth_source:${envIssue}${stateIssue ? `:auth_state:${stateIssue}` : ""}`
    );
  }

  if (stateValidation) {
    if (stateValidation.ok) {
      return {
        authSource: "auth_state_file",
        authState: stateValidation.authState
      };
    }
    throw new Error(stateValidation.issues[0] || "invalid_auth_state_file");
  }

  if (!envValidation.ok) {
    throw new Error(envValidation.issues[0]);
  }
  return {
    authSource: "env",
    authState: envValidation.authState
  };
}

async function persistCursorState(cursorFile, state) {
  let lastError = null;
  for (let attempt = 1; attempt <= CURSOR_PERSIST_ATTEMPTS; attempt += 1) {
    try {
      const result = await saveState(cursorFile, state);
      if (result?.backupWarning) {
        console.warn(`telegram_event_notifier_warning: cursor_backup_save_failed:${result.backupWarning}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < CURSOR_PERSIST_ATTEMPTS) {
        await sleep(CURSOR_PERSIST_RETRY_DELAY_MS);
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : "unknown";
  throw new Error(`cursor_state_save_failed:${reason}`);
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

  if (!tokenExpiresSoon(authState.token, refreshSkewMs)) {
    return authState;
  }

  if (!authState.refreshToken) {
    throw new Error("expired_auth_no_refresh");
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
  refreshSkewMs,
  eventTypeFilter
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
      timeoutMs,
      eventTypeFilter
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

    let page;
    try {
      page = await fetchEventPage({
        apiBase: activeState.apiBase,
        jwt: activeState.token,
        cursor,
        batchLimit,
        timeoutMs,
        eventTypeFilter
      });
    } catch (error) {
      const retryMessage = error instanceof Error ? error.message : String(error);
      if (retryMessage.startsWith("event_feed_http_401")) {
        throw new Error("event_feed_http_401_after_refresh");
      }
      throw error;
    }
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

function isFatalNotifierError(message) {
  if (!message) {
    return false;
  }
  return (
    message.startsWith("missing_env_") ||
    message.startsWith("invalid_env_") ||
    message.startsWith("invalid_notification_preset") ||
    message.startsWith("invalid_notification_event_types") ||
    message.startsWith("missing_notification_event_types") ||
    message.startsWith("missing_auth_token") ||
    message.startsWith("missing_or_invalid_auth_token") ||
    message.startsWith("expired_auth_no_refresh") ||
    message.startsWith("expired_auth_refresh_token") ||
    message.startsWith("invalid_env_auth_source:") ||
    message.startsWith("auth_state_api_base_mismatch") ||
    message.startsWith("invalid_auth_state_file") ||
    message.startsWith("event_feed_http_400") ||
    message.startsWith("event_feed_http_401") ||
    message.startsWith("event_feed_http_403") ||
    message.startsWith("telegram_http_400:") ||
    message.startsWith("telegram_http_401:") ||
    message.startsWith("telegram_http_403:")
  );
}

function failureBackoffMs(pollMs, failureCount) {
  const normalizedPollMs = Number.isSafeInteger(pollMs) && pollMs > 0 ? pollMs : DEFAULT_NOTIFICATION_POLL_MS;
  const normalizedFailureCount = Math.max(1, Number(failureCount) || 1);
  return Math.min(normalizedPollMs * Math.min(normalizedFailureCount, 4), 60_000);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const once = argv.includes("--once") || envFlagEnabled("CLAWNERA_NOTIFY_ONCE");
  const apiBase = readConfiguredApiBaseEnv();
  const authStateFile = readOptionalEnv("CLAWNERA_AUTH_STATE_FILE");
  const botToken = readRequiredTelegramEnv("TELEGRAM_BOT_TOKEN");
  const chatId = readRequiredTelegramEnv("TELEGRAM_CHAT_ID");
  const preset = process.env.CLAWNERA_NOTIFY_PRESET?.trim() || "";
  const resolvedEvents = resolveNotificationEventTypes({
    preset,
    eventTypes: process.env.CLAWNERA_NOTIFY_EVENT_TYPES
  });
  if (resolvedEvents.invalidPreset) {
    throw new Error(`invalid_notification_preset:${resolvedEvents.invalidPreset}`);
  }
  if (resolvedEvents.invalidEventTypes.length > 0) {
    throw new Error(`invalid_notification_event_types:${resolvedEvents.invalidEventTypes.join(",")}`);
  }
  if (resolvedEvents.preset === CUSTOM_NOTIFICATION_PRESET && resolvedEvents.eventTypes.length === 0) {
    throw new Error("missing_notification_event_types");
  }
  if (resolvedEvents.eventTypes.length === 0) {
    throw new Error("missing_notification_event_types");
  }
  const selectedEventTypes = new Set(resolvedEvents.eventTypes);
  const eventTypeFilter = [...selectedEventTypes].sort().join(",");
  const cursorFile = path.resolve(
    process.env.CLAWNERA_NOTIFY_CURSOR_FILE?.trim() || defaultCursorFile(resolvedEvents.preset || CUSTOM_NOTIFICATION_PRESET)
  );
  const pollMs = parsePositiveNotificationValue(process.env.CLAWNERA_NOTIFY_POLL_MS, "CLAWNERA_NOTIFY_POLL_MS", DEFAULT_NOTIFICATION_POLL_MS);
  const batchLimit = parsePositiveNotificationValue(
    process.env.CLAWNERA_NOTIFY_BATCH_LIMIT,
    "CLAWNERA_NOTIFY_BATCH_LIMIT",
    DEFAULT_NOTIFICATION_BATCH_LIMIT
  );
  const timeoutMs = parsePositiveNotificationValue(
    process.env.CLAWNERA_NOTIFY_TIMEOUT_MS,
    "CLAWNERA_NOTIFY_TIMEOUT_MS",
    DEFAULT_NOTIFICATION_TIMEOUT_MS
  );
  const refreshSkewMs = parsePositiveNotificationValue(
    process.env.CLAWNERA_NOTIFY_REFRESH_SKEW_MS,
    "CLAWNERA_NOTIFY_REFRESH_SKEW_MS",
    DEFAULT_NOTIFICATION_REFRESH_SKEW_MS
  );

  const state = await loadState(cursorFile);
  const authLoad = await loadNotifierAuthState({
    apiBase,
    authStateFile
  });
  let authState = authLoad.authState;
  const effectiveApiBase = authState.apiBase || apiBase;
  if (!effectiveApiBase) {
    throw new Error("missing_or_invalid_api_base");
  }
  authState = {
    ...authState,
    apiBase: effectiveApiBase
  };
  let authSource = authLoad.authSource;
  let failureCount = 0;
  let cursorPersistFailureCount = 0;

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
          refreshSkewMs,
          eventTypeFilter
        });
        authState = eventRead.authState;
        authSource = authStateFile ? authSource : "env";
        pageCount += 1;

        if (eventRead.items.length === 0) {
          break;
        }

        let confirmedCursor = state.cursor;
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
          confirmedCursor = buildCursor(event);
          if (confirmedCursor && confirmedCursor !== state.cursor) {
            state.cursor = confirmedCursor;
            await persistCursorState(cursorFile, state);
          }
        }

        if (eventRead.nextCursor && eventRead.nextCursor !== state.cursor) {
          state.cursor = eventRead.nextCursor;
          await persistCursorState(cursorFile, state);
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
              preset: resolvedEvents.preset || CUSTOM_NOTIFICATION_PRESET,
              eventTypes: resolvedEvents.eventTypes,
              pages: pageCount,
              fetched,
              delivered,
              cursor: state.cursor ?? null,
              address: authState.address || null,
              authSource
            },
            null,
            2
          )
        );
        return;
      }
      failureCount = 0;
      cursorPersistFailureCount = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`telegram_event_notifier_error: ${message}`);
      if (message.startsWith("cursor_state_save_failed:") && !once) {
        cursorPersistFailureCount += 1;
        if (cursorPersistFailureCount < CURSOR_PERSIST_FATAL_THRESHOLD) {
          console.warn(
            `telegram_event_notifier_warning: cursor_state_save_retry:${cursorPersistFailureCount}:${message}`
          );
          await sleep(failureBackoffMs(pollMs, cursorPersistFailureCount));
          continue;
        }
      }
      if (once || isFatalNotifierError(message) || message.startsWith("cursor_state_save_failed:")) {
        process.exitCode = 1;
        return;
      }
      failureCount += 1;
      await sleep(failureBackoffMs(pollMs, failureCount));
      continue;
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
