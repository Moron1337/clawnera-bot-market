import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  readPrivateFile,
  writePrivateJsonAtomic,
} from "./local-security.mjs";

export const DEFAULT_TRANSFER_DRAFT_TTL_SEC = 900;

const TRANSFER_DRAFT_DOCUMENT_VERSION = 2;
const MAX_TRANSFER_DRAFT_ENTRIES = 10_000;
const TERMINAL_TOMBSTONE_STATUSES = new Set(["EXECUTED", "UNCERTAIN", "CANCELLED", "EXPIRED"]);
const TOMBSTONE_STATUSES = new Set(["EXECUTING", ...TERMINAL_TOMBSTONE_STATUSES]);
const UPDATE_RETRY_LIMIT = 32;

function assertIdentifier(value, errorCode) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || value.trim() !== value) {
    throw new Error(errorCode);
  }
  return value;
}

function normalizeDraftArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("invalid_transfer_draft_document");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("invalid_transfer_draft_document");
    }
    assertIdentifier(entry.id, "invalid_transfer_draft_document");
    return { ...entry };
  });
}

function normalizeTombstoneArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("invalid_transfer_draft_document");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("invalid_transfer_draft_document");
    }
    const id = assertIdentifier(entry.id, "invalid_transfer_draft_document");
    const status = String(entry.status || "");
    if (!TOMBSTONE_STATUSES.has(status)) {
      throw new Error("invalid_transfer_draft_document");
    }
    const normalized = {
      id,
      status,
      updatedAtMs: Number.isSafeInteger(entry.updatedAtMs) ? entry.updatedAtMs : 0,
    };
    if (typeof entry.claimId === "string" && entry.claimId) {
      normalized.claimId = assertIdentifier(entry.claimId, "invalid_transfer_draft_document");
    }
    if (typeof entry.txDigest === "string" && entry.txDigest) {
      normalized.txDigest = assertIdentifier(entry.txDigest, "invalid_transfer_draft_document");
    }
    return normalized;
  });
}

function normalizeDocument(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_transfer_draft_document");
  }
  const version = parsed.version === 1 ? 1 : Number(parsed.version);
  if (version !== 1 && version !== TRANSFER_DRAFT_DOCUMENT_VERSION) {
    throw new Error("invalid_transfer_draft_document_version");
  }
  const drafts = normalizeDraftArray(parsed.drafts);
  const tombstones = version === 1 ? [] : normalizeTombstoneArray(parsed.tombstones);
  if (drafts.length + tombstones.length > MAX_TRANSFER_DRAFT_ENTRIES) {
    throw new Error("transfer_draft_document_too_large");
  }
  const ids = new Set();
  for (const entry of [...drafts, ...tombstones]) {
    if (ids.has(entry.id)) {
      throw new Error("duplicate_transfer_draft_id");
    }
    ids.add(entry.id);
  }
  return {
    version: TRANSFER_DRAFT_DOCUMENT_VERSION,
    drafts,
    tombstones,
  };
}

function emptyDocument() {
  return {
    version: TRANSFER_DRAFT_DOCUMENT_VERSION,
    drafts: [],
    tombstones: [],
  };
}

export function defaultIotaTransferDraftsPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "clawnera", "iota-transfer-drafts.json");
}

async function loadDraftSnapshot(draftsPath) {
  const target = path.resolve(draftsPath);
  try {
    const raw = await readPrivateFile(target, null);
    const expectedSha256 = createHash("sha256").update(raw).digest("hex");
    if (raw.length === 0 || !raw.toString("utf8").trim()) {
      return { target, expectedSha256, document: emptyDocument() };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new Error("invalid_transfer_draft_document_json");
    }
    return { target, expectedSha256, document: normalizeDocument(parsed) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { target, expectedSha256: null, document: emptyDocument() };
    }
    throw error;
  }
}

function isRetryableUpdateConflict(error) {
  return error?.message === "secret_file_compare_and_swap_conflict" || error?.message === "secret_file_write_in_progress";
}

async function mutateDraftDocument(draftsPath, mutator) {
  for (let attempt = 0; attempt < UPDATE_RETRY_LIMIT; attempt += 1) {
    const snapshot = await loadDraftSnapshot(draftsPath);
    const mutation = mutator(snapshot.document);
    if (mutation.write === false) {
      return mutation.result;
    }
    try {
      await writePrivateJsonAtomic(snapshot.target, mutation.document, {
        expectedSha256: snapshot.expectedSha256,
      });
      return mutation.result;
    } catch (error) {
      if (!isRetryableUpdateConflict(error) || attempt === UPDATE_RETRY_LIMIT - 1) {
        if (isRetryableUpdateConflict(error)) {
          throw new Error("transfer_draft_update_conflict");
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(4 * (attempt + 1), 50)));
    }
  }
  throw new Error("transfer_draft_update_conflict");
}

function tombstoneFor(id, status, nowMs, extra = {}) {
  return {
    id,
    status,
    updatedAtMs: nowMs,
    ...extra,
  };
}

function expireDrafts(document, nowMs) {
  const expired = [];
  const drafts = [];
  for (const draft of document.drafts) {
    if (Number.isSafeInteger(draft.expiresAt) && draft.expiresAt <= nowMs) {
      expired.push(tombstoneFor(draft.id, "EXPIRED", nowMs));
    } else {
      drafts.push(draft);
    }
  }
  return {
    version: TRANSFER_DRAFT_DOCUMENT_VERSION,
    drafts,
    tombstones: [...document.tombstones, ...expired],
  };
}

function throwForTombstone(tombstone) {
  if (tombstone.status === "EXECUTING" || tombstone.status === "UNCERTAIN") {
    throw new Error("transfer_draft_execution_uncertain");
  }
  throw new Error("transfer_draft_consumed");
}

export async function saveIotaTransferDraft(draftsPath, draft, nowMs = Date.now()) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("invalid_transfer_draft");
  }
  const id = assertIdentifier(draft.id, "invalid_transfer_draft_id");
  const normalizedDraft = { ...draft, id };
  const savedPath = path.resolve(draftsPath);
  return mutateDraftDocument(draftsPath, (current) => {
    const document = expireDrafts(current, nowMs);
    if (document.tombstones.some((entry) => entry.id === id)) {
      throw new Error("transfer_draft_already_consumed");
    }
    if (document.drafts.some((entry) => entry.id === id)) {
      throw new Error("transfer_draft_id_conflict");
    }
    if (document.drafts.length + document.tombstones.length >= MAX_TRANSFER_DRAFT_ENTRIES) {
      throw new Error("transfer_draft_document_too_large");
    }
    document.drafts.push(normalizedDraft);
    return {
      document,
      result: { draftsPath: savedPath, draft: normalizedDraft },
    };
  });
}

export async function loadIotaTransferDraft(draftsPath, draftId, nowMs = Date.now()) {
  const id = assertIdentifier(draftId, "invalid_transfer_draft_id");
  const snapshot = await loadDraftSnapshot(draftsPath);
  const tombstone = snapshot.document.tombstones.find((entry) => entry.id === id);
  if (tombstone) {
    throwForTombstone(tombstone);
  }
  const draft = snapshot.document.drafts.find((entry) => entry.id === id);
  if (!draft) {
    throw new Error("transfer_draft_not_found");
  }
  if (!Number.isSafeInteger(draft.expiresAt) || draft.expiresAt > nowMs) {
    return draft;
  }
  await mutateDraftDocument(draftsPath, (current) => {
    const document = expireDrafts(current, nowMs);
    return { document, result: null };
  });
  throw new Error("transfer_draft_expired");
}

export async function claimIotaTransferDraft(draftsPath, draftId, claimId, nowMs = Date.now()) {
  const id = assertIdentifier(draftId, "invalid_transfer_draft_id");
  const normalizedClaimId = assertIdentifier(claimId, "invalid_transfer_draft_claim_id");
  return mutateDraftDocument(draftsPath, (current) => {
    const document = expireDrafts(current, nowMs);
    const tombstone = document.tombstones.find((entry) => entry.id === id);
    if (tombstone) {
      throwForTombstone(tombstone);
    }
    const index = document.drafts.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("transfer_draft_not_found");
    }
    const [draft] = document.drafts.splice(index, 1);
    document.tombstones.push(tombstoneFor(id, "EXECUTING", nowMs, { claimId: normalizedClaimId }));
    return { document, result: draft };
  });
}

export async function finalizeIotaTransferDraft(
  draftsPath,
  draftId,
  { claimId, status, txDigest = "", nowMs = Date.now() } = {},
) {
  const id = assertIdentifier(draftId, "invalid_transfer_draft_id");
  const normalizedClaimId = assertIdentifier(claimId, "invalid_transfer_draft_claim_id");
  if (status !== "EXECUTED" && status !== "UNCERTAIN") {
    throw new Error("invalid_transfer_draft_final_status");
  }
  const normalizedTxDigest = txDigest ? assertIdentifier(txDigest, "invalid_transfer_draft_tx_digest") : "";
  return mutateDraftDocument(draftsPath, (document) => {
    const index = document.tombstones.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("transfer_draft_claim_not_found");
    }
    const current = document.tombstones[index];
    if (current.status !== "EXECUTING" || current.claimId !== normalizedClaimId) {
      throw new Error("transfer_draft_claim_mismatch");
    }
    document.tombstones[index] = tombstoneFor(id, status, nowMs, {
      claimId: normalizedClaimId,
      ...(normalizedTxDigest ? { txDigest: normalizedTxDigest } : {}),
    });
    return { document, result: document.tombstones[index] };
  });
}

export async function deleteIotaTransferDraft(draftsPath, draftId, nowMs = Date.now()) {
  const id = assertIdentifier(draftId, "invalid_transfer_draft_id");
  return mutateDraftDocument(draftsPath, (current) => {
    const document = expireDrafts(current, nowMs);
    const tombstone = document.tombstones.find((entry) => entry.id === id);
    if (tombstone) {
      return { document, result: tombstone, write: false };
    }
    const index = document.drafts.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      document.drafts.splice(index, 1);
    }
    const cancelled = tombstoneFor(id, "CANCELLED", nowMs);
    document.tombstones.push(cancelled);
    return { document, result: cancelled };
  });
}
