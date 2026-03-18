import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_TRANSFER_DRAFT_TTL_SEC = 900;

function normalizeDraftArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string");
}

export function defaultIotaTransferDraftsPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "clawnera", "iota-transfer-drafts.json");
}

async function loadDraftDocument(draftsPath) {
  try {
    const raw = await fs.readFile(draftsPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: typeof parsed?.version === "number" ? parsed.version : 1,
      drafts: normalizeDraftArray(parsed?.drafts),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        version: 1,
        drafts: [],
      };
    }
    throw error;
  }
}

async function saveDraftDocument(draftsPath, document) {
  const target = path.resolve(draftsPath);
  const directory = path.dirname(target);
  const tempFile = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    tempFile,
    JSON.stringify(
      {
        version: typeof document?.version === "number" ? document.version : 1,
        drafts: normalizeDraftArray(document?.drafts),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await fs.chmod(tempFile, 0o600);
  await fs.rename(tempFile, target);
  return target;
}

function pruneDrafts(drafts, nowMs) {
  return normalizeDraftArray(drafts).filter((draft) => {
    if (typeof draft.expiresAt !== "number") {
      return true;
    }
    return draft.expiresAt > nowMs;
  });
}

export async function saveIotaTransferDraft(draftsPath, draft) {
  const document = await loadDraftDocument(draftsPath);
  const nowMs = Date.now();
  const drafts = pruneDrafts(document.drafts, nowMs).filter((entry) => entry.id !== draft.id);
  drafts.push(draft);
  const savedPath = await saveDraftDocument(draftsPath, {
    version: document.version,
    drafts,
  });
  return {
    draftsPath: savedPath,
    draft,
  };
}

export async function loadIotaTransferDraft(draftsPath, draftId, nowMs = Date.now()) {
  const document = await loadDraftDocument(draftsPath);
  const drafts = pruneDrafts(document.drafts, nowMs);
  const draft = drafts.find((entry) => entry.id === draftId) || null;
  if (drafts.length !== document.drafts.length) {
    await saveDraftDocument(draftsPath, {
      version: document.version,
      drafts,
    });
  }
  if (!draft) {
    throw new Error("transfer_draft_not_found");
  }
  return draft;
}

export async function deleteIotaTransferDraft(draftsPath, draftId) {
  const document = await loadDraftDocument(draftsPath);
  const drafts = document.drafts.filter((entry) => entry.id !== draftId);
  await saveDraftDocument(draftsPath, {
    version: document.version,
    drafts,
  });
}
