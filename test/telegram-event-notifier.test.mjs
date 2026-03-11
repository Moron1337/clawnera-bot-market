import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { loadState, main, saveState } from "../examples/telegram-event-notifier.mjs";

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function buildJwtWithExp(expSeconds) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expSeconds })}.signature`;
}

test("saveState writes atomically and loadState falls back to backup on corrupt primary", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-state-"));
  const cursorFile = path.join(tempDir, "cursor.json");

  await saveState(cursorFile, { cursor: "cursor-1" });
  await fs.writeFile(cursorFile, "{not valid json");

  const loaded = await loadState(cursorFile);
  assert.deepEqual(loaded, { cursor: "cursor-1" });
});

test("loadState resets to empty cursor when both primary and backup are corrupt", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-state-reset-"));
  const cursorFile = path.join(tempDir, "cursor.json");

  await fs.writeFile(cursorFile, "{not valid json");
  await fs.writeFile(`${cursorFile}.bak`, "{also not valid json");

  const loaded = await loadState(cursorFile);
  assert.deepEqual(loaded, { cursor: undefined });
});

test("loadState falls back to backup when the primary cursor file is missing", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-state-missing-primary-"));
  const cursorFile = path.join(tempDir, "cursor.json");

  await fs.writeFile(`${cursorFile}.bak`, JSON.stringify({ cursor: "cursor-from-backup" }, null, 2));

  const loaded = await loadState(cursorFile);
  assert.deepEqual(loaded, { cursor: "cursor-from-backup" });
});

test("saveState keeps primary cursor even when backup copy fails", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-state-backup-warning-"));
  const cursorFile = path.join(tempDir, "cursor.json");
  const backupPath = `${cursorFile}.bak`;

  mkdirSync(backupPath, { recursive: true });
  const result = await saveState(cursorFile, { cursor: "cursor-1" });
  const loaded = JSON.parse(await fs.readFile(cursorFile, "utf8"));

  assert.equal(loaded.cursor, "cursor-1");
  assert.equal(typeof result.backupWarning, "string");
});

test("main rejects placeholder telegram credentials before polling", async () => {
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: "<botfather token>",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: "jwt-token",
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_env_TELEGRAM_BOT_TOKEN/);
    }
  );
});

test("main rejects invalid notification presets", async () => {
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: "jwt-token",
      CLAWNERA_NOTIFY_PRESET: "typo",
      CLAWNERA_NOTIFY_EVENT_TYPES: "bid.created",
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_notification_preset:typo/);
    }
  );
});

test("main treats explicit event types without preset as custom-only selection", async () => {
  const previousFetch = globalThis.fetch;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const consoleLines = [];
  const previousConsoleLog = console.log;
  let seenRequestUrl = "";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      seenRequestUrl = url;
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };
  console.log = (...args) => {
    consoleLines.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_EVENT_TYPES: "bid.created",
        CLAWNERA_NOTIFY_ONCE: "1"
      },
      async () => {
        await main([]);
      }
    );

    const parsed = JSON.parse(String(consoleLines[0] || "").trim());
    assert.equal(parsed.preset, "custom");
    assert.deepEqual(parsed.eventTypes, ["bid.created"]);
    assert.match(seenRequestUrl, /[?&]type=bid\.created(?:&|$)/);
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousConsoleLog;
  }
});

test("main sends comma-separated event type filters when multiple event types are selected", async () => {
  const previousFetch = globalThis.fetch;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  let seenRequestUrl = "";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      seenRequestUrl = url;
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_PRESET: "seller",
        CLAWNERA_NOTIFY_ONCE: "1"
      },
      async () => {
        await main([]);
      }
    );

    assert.match(seenRequestUrl, /[?&]type=/);
    assert.match(seenRequestUrl, /bid\.created/);
    assert.match(seenRequestUrl, /order\.status_changed/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main accepts truthy once env flags beyond numeric 1", async () => {
  const previousFetch = globalThis.fetch;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  let fetchCount = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_ONCE: "true"
      },
      async () => {
        await main([]);
      }
    );

    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main rejects invalid boolean env flag values", async () => {
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: validToken,
      CLAWNERA_NOTIFY_ONCE: "maybe"
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_boolean_env:CLAWNERA_NOTIFY_ONCE/);
    }
  );
});

test("main rejects non-decimal numeric env values", async () => {
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: "jwt-token",
      CLAWNERA_NOTIFY_ONCE: "1",
      CLAWNERA_NOTIFY_POLL_MS: "10ms"
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_env_CLAWNERA_NOTIFY_POLL_MS/);
    }
  );
});

test("main rejects invalid api base values before polling", async () => {
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "not-a-url",
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: "jwt-token",
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /missing_or_invalid_api_base/);
    }
  );
});

test("main can start from auth-state api base when env api base is omitted", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-auth-state-api-base-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const cursorFile = path.join(tempDir, "cursor.json");
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const previousFetch = globalThis.fetch;
  let seenRequestUrl = "";

  await fs.writeFile(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: validToken,
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      seenRequestUrl = url;
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: undefined,
        CLAWNERA_AUTH_STATE_FILE: authStateFile,
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile,
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_NOTIFY_ONCE: "1"
      },
      async () => {
        await main([]);
      }
    );

    assert.match(seenRequestUrl, /https:\/\/api\.clawnera\.com\/events/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main fails fast for expired jwt without refresh token", async () => {
  const expiredToken = buildJwtWithExp(Math.floor(Date.now() / 1000) - 60);
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: expiredToken,
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /expired_auth_no_refresh/);
    }
  );
});

test("main falls back to env auth when auth state file is unreadable", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-auth-fallback-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const cursorFile = path.join(tempDir, "cursor.json");
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const previousFetch = globalThis.fetch;

  await fs.writeFile(authStateFile, "{not json");
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        CLAWNERA_AUTH_STATE_FILE: authStateFile,
        CLAWNERA_API_JWT: validToken,
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_NOTIFY_ONCE: "1",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
      },
      async () => {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        try {
          await main([]);
          assert.equal(process.exitCode, 0);
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main prefers explicit env auth over valid auth state file", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-env-precedence-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const cursorFile = path.join(tempDir, "cursor.json");
  const authStateToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const envToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 7200);
  const previousFetch = globalThis.fetch;
  let seenAuthorization = "";

  await fs.writeFile(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: authStateToken,
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/events")) {
      seenAuthorization = String(init.headers?.authorization || "");
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        CLAWNERA_AUTH_STATE_FILE: authStateFile,
        CLAWNERA_API_JWT: envToken,
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_NOTIFY_ONCE: "1",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
      },
      async () => {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        try {
          await main([]);
          assert.equal(process.exitCode, 0);
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    );

    assert.equal(seenAuthorization, `Bearer ${envToken}`);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main rejects stale env auth by default even when auth state exists", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-auth-fallback-valid-state-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const cursorFile = path.join(tempDir, "cursor.json");
  const authStateToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const expiredEnvToken = buildJwtWithExp(Math.floor(Date.now() / 1000) - 60);

  await fs.writeFile(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: authStateToken,
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      CLAWNERA_AUTH_STATE_FILE: authStateFile,
      CLAWNERA_API_JWT: expiredEnvToken,
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_NOTIFY_ONCE: "1",
      CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_env_auth_source:expired_auth_no_refresh/);
    }
  );
});

test("main falls back to auth state when explicitly allowed and env auth is stale", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-auth-fallback-valid-state-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const cursorFile = path.join(tempDir, "cursor.json");
  const authStateToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const expiredEnvToken = buildJwtWithExp(Math.floor(Date.now() / 1000) - 60);
  const previousFetch = globalThis.fetch;
  let seenAuthorization = "";

  await fs.writeFile(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: authStateToken,
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/events")) {
      seenAuthorization = String(init.headers?.authorization || "");
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        CLAWNERA_AUTH_STATE_FILE: authStateFile,
        CLAWNERA_API_JWT: expiredEnvToken,
        CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK: "1",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_NOTIFY_ONCE: "1",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
      },
      async () => {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        try {
          await main([]);
          assert.equal(process.exitCode, 0);
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    );

    assert.equal(seenAuthorization, `Bearer ${authStateToken}`);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main falls back to auth state when explicitly allowed and env token format is invalid", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-auth-format-fallback-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const cursorFile = path.join(tempDir, "cursor.json");
  const authStateToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const previousFetch = globalThis.fetch;
  let seenAuthorization = "";

  await fs.writeFile(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: authStateToken,
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/events")) {
      seenAuthorization = String(init.headers?.authorization || "");
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null
        })
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        CLAWNERA_AUTH_STATE_FILE: authStateFile,
        CLAWNERA_API_JWT: "bad.token.value",
        CLAWNERA_API_REFRESH_TOKEN: "refresh-token",
        CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK: "1",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_NOTIFY_ONCE: "1",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
      },
      async () => {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        try {
          await main([]);
          assert.equal(process.exitCode, 0);
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    );

    assert.equal(seenAuthorization, `Bearer ${authStateToken}`);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("main exits in loop mode on fatal feed auth errors", async () => {
  const previousFetch = globalThis.fetch;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const previousExitCode = process.exitCode;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      return {
        ok: false,
        status: 401
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_ONCE: "0"
      },
      async () => {
        process.exitCode = 0;
        await main([]);
        assert.equal(process.exitCode, 1);
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    process.exitCode = previousExitCode;
  }
});

test("main rejects auth state api base mismatch", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-auth-base-mismatch-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  await fs.writeFile(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.other.example",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      CLAWNERA_AUTH_STATE_FILE: authStateFile,
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /auth_state_api_base_mismatch/);
    }
  );
});

test("main rejects quoted placeholder telegram credentials", async () => {
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: '"<botfather token>"',
      TELEGRAM_CHAT_ID: "123456",
      CLAWNERA_API_JWT: "jwt-token",
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_env_TELEGRAM_BOT_TOKEN/);
    }
  );
});

test("main rejects malformed telegram chat ids", async () => {
  await withEnv(
    {
      CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
      TELEGRAM_CHAT_ID: "bad-chat",
      CLAWNERA_API_JWT: "jwt-token",
      CLAWNERA_NOTIFY_ONCE: "1"
    },
    async () => {
      await assert.rejects(() => main([]), /invalid_env_TELEGRAM_CHAT_ID/);
    }
  );
});

test("main exits only after repeated cursor persistence failures in loop mode", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-cursor-fatal-"));
  const stateDir = path.join(tempDir, "state");
  const cursorFile = path.join(stateDir, "cursor.json");
  const previousFetch = globalThis.fetch;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  let eventCalls = 0;

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(cursorFile, JSON.stringify({ cursor: undefined }));
  chmodSync(stateDir, 0o500);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      eventCalls += 1;
      const eventId = `evt-${eventCalls}`;
      const createdAt = `2026-03-09T00:00:0${eventCalls}.000Z`;
      return {
        ok: true,
        json: async () => ({
          items: [{ id: eventId, createdAt, eventType: "bid.created", payloadJson: {} }],
          nextCursor: null
        })
      };
    }
    if (url.includes("api.telegram.org")) {
      return { ok: true };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  const previousExitCode = process.exitCode;
  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_ONCE: "0",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile,
        CLAWNERA_NOTIFY_POLL_MS: "1"
      },
      async () => {
        await main([]);
      }
    );

    assert.equal(eventCalls, 3);
    assert.equal(process.exitCode, 1);
  } finally {
    chmodSync(stateDir, 0o700);
    globalThis.fetch = previousFetch;
    process.exitCode = previousExitCode;
  }
});

test("main keeps cursor at last confirmed event when telegram delivery fails", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-delivery-"));
  const cursorFile = path.join(tempDir, "cursor.json");
  const previousFetch = globalThis.fetch;
  let eventCalls = 0;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      eventCalls += 1;
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: "evt-1", createdAt: "2026-03-09T00:00:00.000Z", eventType: "bid.created", payloadJson: {} },
            { id: "evt-2", createdAt: "2026-03-09T00:00:01.000Z", eventType: "bid.created", payloadJson: {} }
          ],
          nextCursor: null
        })
      };
    }
    if (url.includes("api.telegram.org")) {
      throw new Error("telegram_down");
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  const previousExitCode = process.exitCode;
  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_ONCE: "1",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
      },
      async () => {
        await main([]);
      }
    );

    assert.equal(eventCalls, 1);
    const loaded = await loadState(cursorFile);
    assert.deepEqual(loaded, { cursor: undefined });
    assert.equal(process.exitCode, 1);
  } finally {
    globalThis.fetch = previousFetch;
    process.exitCode = previousExitCode;
  }
});

test("main persists last confirmed cursor before later delivery failure", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notifier-partial-"));
  const cursorFile = path.join(tempDir, "cursor.json");
  const previousFetch = globalThis.fetch;
  let telegramCalls = 0;
  const validToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/events")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: "evt-1", createdAt: "2026-03-09T00:00:00.000Z", eventType: "bid.created", payloadJson: {} },
            { id: "evt-2", createdAt: "2026-03-09T00:00:01.000Z", eventType: "bid.created", payloadJson: {} }
          ],
          nextCursor: null
        })
      };
    }
    if (url.includes("api.telegram.org")) {
      telegramCalls += 1;
      if (telegramCalls === 1) {
        return { ok: true };
      }
      throw new Error("telegram_down");
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  const previousExitCode = process.exitCode;
  try {
    await withEnv(
      {
        CLAWNERA_API_BASE_URL: "https://api.clawnera.com",
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF-real-token",
        TELEGRAM_CHAT_ID: "123456",
        CLAWNERA_API_JWT: validToken,
        CLAWNERA_NOTIFY_ONCE: "1",
        CLAWNERA_NOTIFY_CURSOR_FILE: cursorFile
      },
      async () => {
        await main([]);
      }
    );

    const loaded = await loadState(cursorFile);
    assert.deepEqual(loaded, { cursor: "2026-03-09T00:00:00.000Z|evt-1" });
    assert.equal(process.exitCode, 1);
  } finally {
    globalThis.fetch = previousFetch;
    process.exitCode = previousExitCode;
  }
});
