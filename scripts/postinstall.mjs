#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path, { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const installScript = path.join(repoRoot, "scripts", "install-iota-cli.sh");
const bootstrapScript = path.join(repoRoot, "scripts", "bootstrap-iota-first-steps.sh");
const LOG_PREFIX = "[clawnera-bot-market postinstall]";

export function isEnabledFlag(value, defaultValue = true) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return !new Set(["0", "false", "off", "no"]).has(normalized);
}

export function buildGlobalBinDir(prefix, platform = process.platform) {
  const normalized = String(prefix || "").trim();
  if (!normalized) {
    return "";
  }
  return platform === "win32" ? normalized : path.join(normalized, "bin");
}

export function pathContains(targetDir, pathValue, platform = process.platform) {
  const normalizedTarget = String(targetDir || "").trim();
  if (!normalizedTarget) {
    return false;
  }
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  return String(pathValue || "")
    .split(pathDelimiter)
    .filter(Boolean)
    .some((entry) =>
      platform === "win32"
        ? entry.trim().toLowerCase() === normalizedTarget.toLowerCase()
        : entry.trim() === normalizedTarget
    );
}

export function normalizeIotaEnv(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function shouldWarnForNonMainnet(value) {
  const envName = normalizeIotaEnv(value);
  return Boolean(envName) && envName !== "mainnet";
}

function info(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function warn(message) {
  console.warn(`${LOG_PREFIX} ${message}`);
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15000,
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024
  });
}

function detectIotaVersion(cliPath) {
  const result = runCommand(cliPath, ["--version"], { timeoutMs: 15000 });
  if (result.status !== 0 || result.error) {
    return "";
  }
  return String(result.stdout || "").trim();
}

function detectIotaActiveEnv(cliPath) {
  const result = runCommand(cliPath, ["client", "active-env"], { timeoutMs: 15000 });
  if (result.status !== 0 || result.error) {
    return "";
  }
  return normalizeIotaEnv(result.stdout);
}

function maybeWarnAboutIotaEnv(cliPath) {
  const activeEnv = detectIotaActiveEnv(cliPath);
  if (!shouldWarnForNonMainnet(activeEnv)) {
    return;
  }

  warn(`Detected IOTA CLI active env: ${activeEnv}`);
  warn("Clawnera uses IOTA mainnet. Switch before using production marketplace flows.");
  warn("Recommended command: iota client switch --env mainnet");
}

function maybeSetIotaMainnet(cliPath) {
  // Initialize CLI state non-interactively if the first-run prompt appears.
  runCommand(cliPath, ["client", "envs", "--json"], {
    expectJson: false,
    input: "mainnet\n0\n",
    timeoutMs: 30000
  });

  const switched = runCommand(cliPath, ["client", "switch", "--env", "mainnet"], {
    timeoutMs: 30000
  });
  if (switched.status !== 0 || switched.error) {
    warn("Installed IOTA CLI, but failed to switch the active env to mainnet automatically.");
    warn("Run `iota client switch --env mainnet` before using Clawnera on mainnet.");
    return;
  }

  const activeEnv = detectIotaActiveEnv(cliPath);
  if (activeEnv === "mainnet") {
    info("Activated IOTA CLI env: mainnet");
    return;
  }

  warn(`Installed IOTA CLI, but active env is still "${activeEnv || "unknown"}".`);
  warn("Run `iota client switch --env mainnet` before using Clawnera on mainnet.");
}

function globalInstallPrefix() {
  const envPrefix = String(process.env.npm_config_prefix || "").trim();
  if (envPrefix) {
    return envPrefix;
  }

  const result = runCommand("npm", ["config", "get", "prefix"], { timeoutMs: 10000 });
  if (result.status !== 0 || result.error) {
    return "";
  }
  return String(result.stdout || "").trim();
}

function maybeWarnAboutGlobalBinPath() {
  if (String(process.env.npm_config_global || "").trim() !== "true") {
    return;
  }

  const prefix = globalInstallPrefix();
  const binDir = buildGlobalBinDir(prefix);
  if (!binDir) {
    return;
  }

  if (!pathContains(binDir, process.env.PATH)) {
    warn(`Global npm bin dir is not on PATH: ${binDir}`);
    warn(`Add it to your shell profile, for example: export PATH="${binDir}:$PATH"`);
    warn("Until then, the package is installed but `clawnera-help` may not be found directly.");
  }
}

function maybeAutoInstallIotaCli() {
  const cliPath = String(process.env.IOTA_CLI_PATH || "iota").trim() || "iota";
  const detectedVersion = detectIotaVersion(cliPath);
  if (detectedVersion) {
    info(`Detected IOTA CLI: ${detectedVersion}`);
    maybeWarnAboutIotaEnv(cliPath);
    return cliPath;
  }

  if (!isEnabledFlag(process.env.CLAWNERA_AUTO_INSTALL_IOTA_CLI, true)) {
    warn("IOTA CLI not detected. Optional next step: `clawnera-help first-steps --run`.");
    return cliPath;
  }

  if (!existsSync(installScript)) {
    warn("IOTA CLI install helper is missing; skipping auto-install.");
    return cliPath;
  }

  const version = String(process.env.CLAWNERA_IOTA_CLI_VERSION || "latest").trim() || "latest";
  const installDir = String(process.env.CLAWNERA_IOTA_CLI_INSTALL_DIR || path.join(homedir(), ".local", "bin")).trim();
  info(`IOTA CLI not detected. Attempting auto-install (${version}) to ${installDir}...`);

  const result = runCommand("bash", [installScript, version], {
    timeoutMs: 120000,
    env: {
      ...process.env,
      INSTALL_DIR: installDir
    }
  });

  if (result.status !== 0 || result.error) {
    warn(`IOTA CLI auto-install failed: ${String(result.stderr || result.error || "unknown_error").trim()}`);
    warn("You can still run `clawnera-help first-steps --run` later.");
    return cliPath;
  }

  const installedCliPath = path.join(installDir, process.platform === "win32" ? "iota.exe" : "iota");
  const installedVersion = detectIotaVersion(installedCliPath);
  if (installedVersion) {
    info(`Installed IOTA CLI: ${installedVersion}`);
  } else {
    warn(`IOTA CLI install completed, but verification failed at ${installedCliPath}`);
  }

  maybeSetIotaMainnet(installedCliPath);

  if (!pathContains(installDir, process.env.PATH)) {
    warn(`IOTA CLI install dir is not on PATH: ${installDir}`);
    warn(`Add it to your shell profile or set IOTA_CLI_PATH=${installedCliPath}`);
  }

  return installedCliPath;
}

function maybeRunIotaBootstrap(iotaCliPath) {
  if (!isEnabledFlag(process.env.CLAWNERA_BOOTSTRAP_IOTA, false)) {
    return;
  }

  if (!existsSync(bootstrapScript)) {
    warn("IOTA bootstrap helper is missing; skipping wallet bootstrap.");
    return;
  }

  const args = [bootstrapScript];
  if (isEnabledFlag(process.env.CLAWNERA_INIT_IOTA_WALLET, false)) {
    args.push("--init-wallet");
  }

  info("Running optional IOTA first-step bootstrap...");
  const result = runCommand("bash", args, {
    timeoutMs: 120000,
    env: {
      ...process.env,
      IOTA_CLI_PATH: iotaCliPath,
      IOTA_HELPER_AUTO_INSTALL_CLI: isEnabledFlag(process.env.CLAWNERA_AUTO_INSTALL_IOTA_CLI, true) ? "1" : "0",
      IOTA_HELPER_INIT_WALLET: isEnabledFlag(process.env.CLAWNERA_INIT_IOTA_WALLET, false) ? "1" : "0"
    }
  });

  if (result.status !== 0 || result.error) {
    warn(`IOTA first-step bootstrap failed: ${String(result.stderr || result.error || "unknown_error").trim()}`);
    return;
  }

  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    info(line);
  }
}

export function runPostinstall() {
  maybeWarnAboutGlobalBinPath();
  const iotaCliPath = maybeAutoInstallIotaCli();
  maybeRunIotaBootstrap(iotaCliPath);
}

if (process.argv[1] === __filename) {
  try {
    runPostinstall();
  } catch (error) {
    warn(`Unexpected postinstall error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
