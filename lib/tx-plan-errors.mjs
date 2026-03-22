export function normalizeTxPlanErrorMessage(value) {
  if (value instanceof Error && typeof value.message === "string") {
    return value.message.trim();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

export function isSharedObjectVersionRaceMessage(message) {
  const text = normalizeTxPlanErrorMessage(message);
  return /Could not find the referenced object .*asked version SequenceNumber\(\d+\) is higher than the latest SequenceNumber\(\d+\)/i.test(
    text,
  );
}

export function isMoveAbortCodeMessage(message, code) {
  const text = normalizeTxPlanErrorMessage(message);
  return new RegExp(`Abort Code:\\s*${code}\\b`, "i").test(text);
}

export function classifyTxPlanExecutionError({ errorMessage, txBuilder } = {}) {
  const message = normalizeTxPlanErrorMessage(errorMessage);
  if (!message) {
    return null;
  }
  if (isSharedObjectVersionRaceMessage(message)) {
    return {
      code: "shared_object_version_race",
      retryable: true,
      hint:
        "A shared dispute object advanced while this tx was being built or executed. Rerun the same tx-plan-execute command once. If you are driving multiple reviewer wallets for the same dispute from one machine, submit commit/reveal steps sequentially.",
    };
  }
  if (txBuilder === "disputeQuorum.commitVote" && isMoveAbortCodeMessage(message, 48)) {
    return {
      code: "reviewer_vote_already_committed",
      retryable: false,
      hint:
        "This reviewer already committed for the dispute case. Keep the saved reviewer-vote.json file and wait for the reveal window before running the reveal step.",
    };
  }
  return null;
}

function parseDeadlineMs(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function formatUtcTimestampMs(value) {
  const deadlineMs = parseDeadlineMs(value);
  if (!deadlineMs) {
    return null;
  }
  return new Date(deadlineMs).toISOString();
}

function normalizeDisputeStateLabel(value) {
  const state = typeof value === "number" && Number.isFinite(value) ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(state)) {
    return "unknown";
  }
  switch (state) {
    case 0:
      return "awaiting_reviewers";
    case 1:
      return "commit_phase";
    case 2:
      return "reveal_phase";
    case 3:
      return "finalized";
    case 4:
      return "fallback_resolved";
    default:
      return "unknown";
  }
}

function extractDisputeCaseObjectId(rawPath) {
  const text = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!text) {
    return null;
  }
  const match = text.match(/^\/disputes\/([^/]+)/);
  return match?.[1] || null;
}

function buildReplacementCommandHint(disputeCaseObjectId) {
  const caseId = typeof disputeCaseObjectId === "string" && disputeCaseObjectId.trim()
    ? disputeCaseObjectId.trim()
    : "<disputeCaseId>";
  return `clawnera-help reviewer-shortlist --scope REPLACEMENT --dispute-case-id ${caseId} --auth-state-file <operator-auth-state-file>`;
}

export function classifyDisputeTxPlanExecutionError({
  errorMessage,
  txBuilder,
  rawPath,
  disputeCase = null,
  nowMs = Date.now(),
} = {}) {
  const message = normalizeTxPlanErrorMessage(errorMessage);
  if (!message) {
    return null;
  }
  const disputeCaseObjectId =
    typeof disputeCase?.objectId === "string" && disputeCase.objectId.trim()
      ? disputeCase.objectId.trim()
      : extractDisputeCaseObjectId(rawPath);
  if (txBuilder === "disputeQuorum.commitVote" && isMoveAbortCodeMessage(message, 49)) {
    const commitDeadlineMs = parseDeadlineMs(disputeCase?.commitDeadlineMs);
    const revealDeadlineMs = parseDeadlineMs(disputeCase?.revealDeadlineMs);
    const commitDeadlineIso = formatUtcTimestampMs(commitDeadlineMs);
    const revealDeadlineIso = formatUtcTimestampMs(revealDeadlineMs);
    if (revealDeadlineMs && nowMs <= revealDeadlineMs) {
      return {
        code: "reviewer_vote_commit_window_closed",
        retryable: false,
        waitUntilMs: revealDeadlineMs,
        waitUntilIso: revealDeadlineIso,
        disputeCaseObjectId,
        hint:
          `The commit window is already closed${commitDeadlineIso ? ` (commitDeadlineMs=${commitDeadlineIso})` : ""}. ` +
          `This reviewer round cannot accept any new commits now. Wait until revealDeadlineMs=${revealDeadlineIso || "<unknown>"}; ` +
          `if the case still has no quorum after that, a buyer or seller must start a replacement round instead of retrying this commit.`,
        nextCommandHint: buildReplacementCommandHint(disputeCaseObjectId),
      };
    }
    return {
      code: "reviewer_vote_commit_window_closed",
      retryable: false,
      disputeCaseObjectId,
      hint:
        `The commit window is already closed${commitDeadlineIso ? ` (commitDeadlineMs=${commitDeadlineIso})` : ""}. ` +
        `Do not retry this reviewer commit. Read GET /disputes/{disputeCaseId}; if the round stayed below quorum after revealDeadlineMs${revealDeadlineIso ? `=${revealDeadlineIso}` : ""}, ` +
        `a buyer or seller can move into a replacement round.`,
      nextCommandHint: buildReplacementCommandHint(disputeCaseObjectId),
    };
  }
  if (txBuilder === "disputeQuorum.startReplacementRound" && isMoveAbortCodeMessage(message, 55)) {
    const acceptDeadlineMs = parseDeadlineMs(disputeCase?.acceptDeadlineMs);
    const revealDeadlineMs = parseDeadlineMs(disputeCase?.revealDeadlineMs);
    const acceptDeadlineIso = formatUtcTimestampMs(acceptDeadlineMs);
    const revealDeadlineIso = formatUtcTimestampMs(revealDeadlineMs);
    const stateLabel = normalizeDisputeStateLabel(disputeCase?.state);
    if ((stateLabel === "commit_phase" || stateLabel === "reveal_phase") && revealDeadlineMs && nowMs <= revealDeadlineMs) {
      return {
        code: "dispute_replacement_round_not_ready",
        retryable: false,
        waitUntilMs: revealDeadlineMs,
        waitUntilIso: revealDeadlineIso,
        disputeCaseObjectId,
        hint:
          `Replacement is not allowed yet while the current reviewer round is still in ${stateLabel}. ` +
          `Wait until revealDeadlineMs=${revealDeadlineIso || "<unknown>"} and then rerun the same replacement publish command with the saved body file.`,
      };
    }
    if (stateLabel === "awaiting_reviewers" && acceptDeadlineMs && nowMs <= acceptDeadlineMs) {
      return {
        code: "dispute_replacement_round_not_ready",
        retryable: false,
        waitUntilMs: acceptDeadlineMs,
        waitUntilIso: acceptDeadlineIso,
        disputeCaseObjectId,
        hint:
          `Replacement is not allowed yet while the current reviewer accept window is still open. ` +
          `Wait until acceptDeadlineMs=${acceptDeadlineIso || "<unknown>"} and then reread GET /disputes/{disputeCaseId} before rerunning replacement.`,
      };
    }
    return {
      code: "dispute_replacement_round_not_ready",
      retryable: false,
      disputeCaseObjectId,
      hint:
        "Replacement is not currently allowed for this dispute state. Read GET /disputes/{disputeCaseId} and compare acceptDeadlineMs/revealDeadlineMs before retrying replacement.",
    };
  }
  return null;
}
