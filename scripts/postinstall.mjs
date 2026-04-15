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
const MIN_NODE_MAJOR = 20;

export function checkNodeVersion(nodeVersion = process.versions.node) {
  const major = Number(String(nodeVersion).split(".")[0]);
  return { major, ok: major >= MIN_NODE_MAJOR };
}

export function isEnabledFlag(value, defaultValue = true) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (new Set(["1", "true", "yes", "on"]).has(normalized)) {
    return true;
  }
  if (new Set(["0", "false", "off", "no"]).has(normalized)) {
    return false;
  }
  throw new Error(`invalid_boolean_flag:${String(value).trim()}`);
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

export function shouldAutoInstallIotaCli(env = process.env) {
  const explicit = env.CLAWNERA_AUTO_INSTALL_IOTA_CLI;
  if (explicit !== undefined && String(explicit).trim() !== "") {
    return isEnabledFlag(explicit, false);
  }
  return false;
}

export function shouldAutoSwitchIotaMainnet(env = process.env) {
  return isEnabledFlag(env.CLAWNERA_AUTO_SWITCH_IOTA_MAINNET, false);
}

function info(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function warn(message) {
  console.warn(`${LOG_PREFIX} ${message}`);
}

export function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15000,
    env: options.env ?? process.env,
    input: options.input,
    stdio: options.input !== undefined ? ["pipe", "pipe", "pipe"] : undefined,
    maxBuffer: 16 * 1024 * 1024
  });
}

function formatCommandFailure(result) {
  const stdout = String(result?.stdout || "").trim();
  const stderr = String(result?.stderr || "").trim();
  const error = result?.error ? String(result.error).trim() : "";
  return [stderr, stdout, error].filter(Boolean).join("\n").trim() || "unknown_error";
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

function detectMissingSharedLibraries(cliPath) {
  const result = runCommand("ldd", [cliPath], { timeoutMs: 15000 });
  const combined = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
  const missing = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("=>") && line.includes("not found"))
    .map((line) => line.split("=>")[0]?.trim())
    .filter(Boolean);
  return Array.from(new Set(missing));
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

function maybeSetIotaMainnet(cliPath, env = process.env) {
  if (!shouldAutoSwitchIotaMainnet(env)) {
    warn("Installed IOTA CLI, but did not switch the active env automatically.");
    warn("Run `iota client switch --env mainnet` before using Clawnera on mainnet.");
    warn("To enable auto-switch during install, set CLAWNERA_AUTO_SWITCH_IOTA_MAINNET=1.");
    return;
  }

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
    warn(`Fix now:  export PATH="${binDir}:$PATH"`);
    warn(`Fix permanently:  echo 'export PATH="${binDir}:$PATH"' >> ~/.bashrc && source ~/.bashrc`);
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

  if (!shouldAutoInstallIotaCli(process.env)) {
    info("IOTA CLI not detected (optional). Quick start without CLI: `clawnera-help wallet-init --alias <name>`.");
    info("Verified auto-install is opt-in: set `CLAWNERA_AUTO_INSTALL_IOTA_CLI=1` to enable it.");
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
    timeoutMs: 60000,
    env: {
      ...process.env,
      INSTALL_DIR: installDir
    }
  });

  if (result.status !== 0 || result.error) {
    warn(`IOTA CLI auto-install failed: ${formatCommandFailure(result)}`);
    warn("The IOTA CLI is optional. Use the JS-SDK path instead: `clawnera-help wallet-init --alias <name>`.");
    return cliPath;
  }

  const installedCliPath = path.join(installDir, process.platform === "win32" ? "iota.exe" : "iota");
  const installedVersion = detectIotaVersion(installedCliPath);
  if (installedVersion) {
    info(`Installed IOTA CLI: ${installedVersion}`);
  } else {
    warn(`IOTA CLI install completed, but verification failed at ${installedCliPath}`);
    const missingLibraries = detectMissingSharedLibraries(installedCliPath);
    if (missingLibraries.length > 0) {
      warn(`Missing shared libraries: ${missingLibraries.join(", ")}`);
      warn("Fix: sudo apt-get install -y libpq5  (Debian/Ubuntu) | apk add libpq  (Alpine) | dnf install libpq  (Fedora)");
      warn("Or skip the CLI entirely and use: `clawnera-help wallet-init --alias <name>`.");
    }
  }

  maybeSetIotaMainnet(installedCliPath, process.env);

  if (!pathContains(installDir, process.env.PATH)) {
    warn(`IOTA CLI install dir is not on PATH: ${installDir}`);
    warn(`Fix now:  export PATH="${installDir}:$PATH"`);
    warn(`Fix permanently:  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`);
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
      IOTA_HELPER_AUTO_INSTALL_CLI: shouldAutoInstallIotaCli(process.env) ? "1" : "0",
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

function printNextStepHints() {
  info("Quick start (no IOTA CLI needed): `clawnera-help wallet-init --alias <name>` then `clawnera-help auth-login --api-base https://api.clawnera.com --alias <name>`.");
  info("Need Telegram alerts? `clawnera-help notifications init telegram --preset seller --api-base https://api.clawnera.com --alias <name>`.");
}

export function runPostinstall() {
  const nodeCheck = checkNodeVersion();
  if (!nodeCheck.ok) {
    warn(`Node.js ${process.versions.node} detected. clawnera-bot-market requires Node.js >= ${MIN_NODE_MAJOR}.`);
    warn("Upgrade: https://nodejs.org/ or via nvm: nvm install 20");
  }
  maybeWarnAboutGlobalBinPath();
  const iotaCliPath = maybeAutoInstallIotaCli();
  maybeRunIotaBootstrap(iotaCliPath);
  printNextStepHints();
}

if (process.argv[1] === __filename) {
  try {
    runPostinstall();
  } catch (error) {
    warn(`Unexpected postinstall error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
