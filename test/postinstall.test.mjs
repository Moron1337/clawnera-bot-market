import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGlobalBinDir,
  checkNodeVersion,
  isEnabledFlag,
  normalizeIotaEnv,
  pathContains,
  runCommand,
  shouldAutoInstallIotaCli,
  shouldAutoSwitchIotaMainnet,
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

test("isEnabledFlag rejects invalid boolean strings", () => {
  assert.throws(() => isEnabledFlag("maybe"), /invalid_boolean_flag:maybe/);
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

test("runCommand passes stdin through to spawned processes", () => {
  const result = runCommand("bash", ["-lc", "read line; printf '%s' \"$line\""], {
    input: "mainnet\n",
    timeoutMs: 5_000
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "mainnet");
});

test("shouldAutoInstallIotaCli defaults to global installs only", () => {
  assert.equal(shouldAutoInstallIotaCli({ npm_config_global: "true" }), true);
  assert.equal(shouldAutoInstallIotaCli({ npm_config_global: "false" }), false);
  assert.equal(shouldAutoInstallIotaCli({}), false);
});

test("shouldAutoInstallIotaCli disables default auto-install in CI unless explicitly enabled", () => {
  assert.equal(shouldAutoInstallIotaCli({ npm_config_global: "true", CI: "1" }), false);
  assert.equal(shouldAutoInstallIotaCli({ npm_config_global: "false", CLAWNERA_AUTO_INSTALL_IOTA_CLI: "1" }), true);
  assert.equal(shouldAutoInstallIotaCli({ npm_config_global: "true", CLAWNERA_AUTO_INSTALL_IOTA_CLI: "0" }), false);
});

test("shouldAutoSwitchIotaMainnet requires explicit opt-in", () => {
  assert.equal(shouldAutoSwitchIotaMainnet({}), false);
  assert.equal(shouldAutoSwitchIotaMainnet({ CLAWNERA_AUTO_SWITCH_IOTA_MAINNET: "0" }), false);
  assert.equal(shouldAutoSwitchIotaMainnet({ CLAWNERA_AUTO_SWITCH_IOTA_MAINNET: "1" }), true);
});

test("checkNodeVersion passes for Node >= 20", () => {
  assert.equal(checkNodeVersion("20.11.0").ok, true);
  assert.equal(checkNodeVersion("22.0.0").ok, true);
  assert.equal(checkNodeVersion("20.0.0").major, 20);
});

test("checkNodeVersion fails for Node < 20", () => {
  assert.equal(checkNodeVersion("18.19.1").ok, false);
  assert.equal(checkNodeVersion("16.20.0").ok, false);
  assert.equal(checkNodeVersion("18.19.1").major, 18);
});
