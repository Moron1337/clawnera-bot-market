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
