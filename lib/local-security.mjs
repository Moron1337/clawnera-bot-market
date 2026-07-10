import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_LOCK_VERSION = "clawnera.private-file-lock.v1";

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

export function normalizeAuthenticatedUrl(value, options = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  const errorCode = options.errorCode || "invalid_url";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(errorCode);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(errorCode);
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))) {
    throw new Error(errorCode);
  }
  return parsed.toString();
}

export function normalizeAuthenticatedBaseUrl(value, options = {}) {
  const normalized = normalizeAuthenticatedUrl(value, options);
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function copyAndClearSensitiveBytes(value) {
  if (!(value instanceof Uint8Array)) {
    throw new Error("invalid_sensitive_byte_buffer");
  }
  try {
    return Uint8Array.from(value);
  } finally {
    value.fill(0);
  }
}

async function assertPrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  await fs.mkdir(resolved, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("unsafe_secret_directory");
  }
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    throw new Error("unsafe_secret_directory_owner");
  }
  if ((stat.mode & 0o077) !== 0) {
    await fs.chmod(resolved, PRIVATE_DIRECTORY_MODE);
    const hardened = await fs.lstat(resolved);
    if ((hardened.mode & 0o077) !== 0) {
      throw new Error("unsafe_secret_directory_mode");
    }
  }
  return resolved;
}

async function assertPrivateRegularFile(fileHandle, filePath) {
  const stat = await fileHandle.stat();
  if (!stat.isFile()) {
    throw new Error("unsafe_secret_file_type");
  }
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    throw new Error("unsafe_secret_file_owner");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("unsafe_secret_file_mode");
  }
  if (stat.size > 16 * 1024 * 1024) {
    throw new Error("unsafe_secret_file_size");
  }
  return filePath;
}

export async function readPrivateFile(filePath, encoding = "utf8") {
  const resolved = path.resolve(filePath);
  let handle;
  try {
    handle = await fs.open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    await assertPrivateRegularFile(handle, resolved);
    return await handle.readFile(encoding);
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error("unsafe_secret_file_symlink");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function assertReplaceableTarget(target) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("unsafe_secret_file_target");
    }
    const uid = currentUid();
    if (uid !== null && stat.uid !== uid) {
      throw new Error("unsafe_secret_file_owner");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function privateFileLockPayload(target) {
  return `${JSON.stringify({
    version: PRIVATE_FILE_LOCK_VERSION,
    target,
    pid: process.pid,
    createdAtMs: Date.now(),
  })}\n`;
}

function secretFileWriteInProgressError(lockPath) {
  const error = new Error("secret_file_write_in_progress");
  error.lockPath = lockPath;
  return error;
}

export async function withPrivateFileOperationLock(filePath, operation, operationName = "operation") {
  if (typeof operation !== "function" || !/^[a-z0-9-]{1,64}$/.test(operationName)) {
    throw new Error("invalid_private_file_operation_lock");
  }
  const target = path.resolve(filePath);
  await assertPrivateDirectory(path.dirname(target));
  const lockPath = `${target}.${operationName}.lock`;
  let lockHandle;
  let ownsLock = false;
  try {
    lockHandle = await fs.open(
      lockPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    ownsLock = true;
    await lockHandle.writeFile(privateFileLockPayload(target));
    await lockHandle.chmod(PRIVATE_FILE_MODE);
    await lockHandle.sync();
    return await operation();
  } catch (error) {
    if (error?.code === "EEXIST" && error?.path === lockPath) {
      throw secretFileWriteInProgressError(lockPath);
    }
    if (error?.code === "ELOOP") {
      throw new Error("unsafe_secret_file_symlink");
    }
    throw error;
  } finally {
    await lockHandle?.close();
    if (ownsLock) {
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
  }
}

async function currentPrivateFileSha256(target) {
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    await assertPrivateRegularFile(handle, target);
    const content = await handle.readFile();
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function writePrivateFileAtomic(filePath, content, options = {}) {
  const target = path.resolve(filePath);
  const directory = await assertPrivateDirectory(path.dirname(target));
  const lockPath = `${target}.lock`;
  const tempPath = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let lockHandle;
  let tempHandle;
  let ownsLock = false;
  try {
    lockHandle = await fs.open(
      lockPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    ownsLock = true;
    await lockHandle.writeFile(privateFileLockPayload(target));
    await lockHandle.chmod(PRIVATE_FILE_MODE);
    await lockHandle.sync();
    await assertReplaceableTarget(target);
    if (Object.prototype.hasOwnProperty.call(options, "expectedSha256")) {
      const expectedSha256 = options.expectedSha256;
      if (expectedSha256 !== null && !/^[0-9a-f]{64}$/.test(String(expectedSha256))) {
        throw new Error("invalid_expected_secret_file_sha256");
      }
      const actualSha256 = await currentPrivateFileSha256(target);
      if (actualSha256 !== expectedSha256) {
        const conflict = new Error("secret_file_compare_and_swap_conflict");
        conflict.expectedSha256 = expectedSha256;
        conflict.actualSha256 = actualSha256;
        throw conflict;
      }
    }
    tempHandle = await fs.open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await tempHandle.writeFile(content);
    await tempHandle.chmod(PRIVATE_FILE_MODE);
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;
    await fs.rename(tempPath, target);
    const directoryHandle = await fs.open(directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return target;
  } catch (error) {
    if (error?.code === "EEXIST" && error?.path === lockPath) {
      throw secretFileWriteInProgressError(lockPath);
    }
    if (error?.code === "ELOOP") {
      throw new Error("unsafe_secret_file_symlink");
    }
    throw error;
  } finally {
    await tempHandle?.close();
    await lockHandle?.close();
    await fs.rm(tempPath, { force: true }).catch(() => {});
    if (ownsLock) {
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
  }
}

export async function writePrivateFileAtomicExclusive(filePath, content) {
  const target = path.resolve(filePath);
  const directory = await assertPrivateDirectory(path.dirname(target));
  const tempPath = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let tempHandle;
  try {
    try {
      const existing = await fs.lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error("unsafe_secret_file_target");
      }
      const uid = currentUid();
      if (uid !== null && existing.uid !== uid) {
        throw new Error("unsafe_secret_file_owner");
      }
      return false;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    tempHandle = await fs.open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await tempHandle.writeFile(content);
    await tempHandle.chmod(PRIVATE_FILE_MODE);
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;

    try {
      await fs.link(tempPath, target);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const existing = await fs.lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error("unsafe_secret_file_target");
      }
      const uid = currentUid();
      if (uid !== null && existing.uid !== uid) {
        throw new Error("unsafe_secret_file_owner");
      }
      return false;
    }

    const directoryHandle = await fs.open(directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return true;
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error("unsafe_secret_file_symlink");
    }
    throw error;
  } finally {
    await tempHandle?.close();
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function writePrivateJsonAtomic(filePath, value, options = {}) {
  return writePrivateFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function writePrivateFileAtomicSync(filePath, content) {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  fsSync.mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const directoryStat = fsSync.lstatSync(directory);
  const uid = currentUid();
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("unsafe_secret_directory");
  }
  if (uid !== null && directoryStat.uid !== uid) {
    throw new Error("unsafe_secret_directory_owner");
  }
  if ((directoryStat.mode & 0o077) !== 0) {
    fsSync.chmodSync(directory, PRIVATE_DIRECTORY_MODE);
  }
  try {
    const targetStat = fsSync.lstatSync(target);
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new Error("unsafe_secret_file_target");
    }
    if (uid !== null && targetStat.uid !== uid) {
      throw new Error("unsafe_secret_file_owner");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const lockPath = `${target}.lock`;
  const tempPath = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let lockFd;
  let tempFd;
  let ownsLock = false;
  try {
    lockFd = fsSync.openSync(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    ownsLock = true;
    fsSync.writeFileSync(lockFd, privateFileLockPayload(target));
    fsSync.fchmodSync(lockFd, PRIVATE_FILE_MODE);
    fsSync.fsyncSync(lockFd);
    tempFd = fsSync.openSync(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    fsSync.writeFileSync(tempFd, content);
    fsSync.fchmodSync(tempFd, PRIVATE_FILE_MODE);
    fsSync.fsyncSync(tempFd);
    fsSync.closeSync(tempFd);
    tempFd = undefined;
    fsSync.renameSync(tempPath, target);
    const directoryFd = fsSync.openSync(directory, fsConstants.O_RDONLY);
    try {
      fsSync.fsyncSync(directoryFd);
    } finally {
      fsSync.closeSync(directoryFd);
    }
    return target;
  } catch (error) {
    if (error?.code === "EEXIST" && error?.path === lockPath) {
      throw secretFileWriteInProgressError(lockPath);
    }
    if (error?.code === "ELOOP") {
      throw new Error("unsafe_secret_file_symlink");
    }
    throw error;
  } finally {
    if (tempFd !== undefined) {
      fsSync.closeSync(tempFd);
    }
    if (lockFd !== undefined) {
      fsSync.closeSync(lockFd);
    }
    fsSync.rmSync(tempPath, { force: true });
    if (ownsLock) {
      fsSync.rmSync(lockPath, { force: true });
    }
  }
}
