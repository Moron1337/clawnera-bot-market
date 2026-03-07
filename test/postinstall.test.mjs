import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGlobalBinDir,
  isEnabledFlag,
  normalizeIotaEnv,
  pathContains,
  shouldWarnForNonMainnet
} from "../scripts/postinstall.mjs";

test("isEnabledFlag treats explicit off values as disabled", () => {
  assert.equal(isEnabledFlag("0"), false);
  assert.equal(isEnabledFlag("false"), false);
  assert.equal(isEnabledFlag("off"), false);
  assert.equal(isEnabledFlag("no"), false);
});

test("isEnabledFlag treats empty and truthy values as enabled", () => {
  assert.equal(isEnabledFlag(undefined), true);
  assert.equal(isEnabledFlag("1"), true);
  assert.equal(isEnabledFlag("true"), true);
});

test("isEnabledFlag can default to disabled", () => {
  assert.equal(isEnabledFlag(undefined, false), false);
  assert.equal(isEnabledFlag("", false), false);
  assert.equal(isEnabledFlag("1", false), true);
});

test("buildGlobalBinDir appends bin on unix-like platforms", () => {
  assert.equal(buildGlobalBinDir("/home/openclaw/.npm-global", "linux"), "/home/openclaw/.npm-global/bin");
});

test("buildGlobalBinDir keeps prefix unchanged on win32", () => {
  assert.equal(buildGlobalBinDir("C:\\Users\\bot\\AppData\\Roaming\\npm", "win32"), "C:\\Users\\bot\\AppData\\Roaming\\npm");
});

test("pathContains matches exact path entries", () => {
  assert.equal(pathContains("/home/openclaw/.npm-global/bin", "/usr/bin:/home/openclaw/.npm-global/bin:/bin", "linux"), true);
  assert.equal(pathContains("/home/openclaw/.npm-global/bin", "/usr/bin:/bin", "linux"), false);
});

test("pathContains is case-insensitive on win32", () => {
  assert.equal(
    pathContains(
      "C:\\Users\\bot\\AppData\\Roaming\\npm",
      "C:\\Windows\\System32;C:\\USERS\\BOT\\APPDATA\\ROAMING\\NPM",
      "win32"
    ),
    true
  );
});

test("normalizeIotaEnv normalizes shell output", () => {
  assert.equal(normalizeIotaEnv(" Mainnet \n"), "mainnet");
  assert.equal(normalizeIotaEnv("TESTNET"), "testnet");
});

test("shouldWarnForNonMainnet only warns outside mainnet", () => {
  assert.equal(shouldWarnForNonMainnet("mainnet"), false);
  assert.equal(shouldWarnForNonMainnet("testnet"), true);
  assert.equal(shouldWarnForNonMainnet("devnet"), true);
  assert.equal(shouldWarnForNonMainnet(""), false);
});
