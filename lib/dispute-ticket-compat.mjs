function normalizeHexId(value) {
  return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : "";
}

export function isMissingResolveDisputeWithBindingFunctionError(message) {
  return /No function was found with function name resolve_dispute_with_binding/i.test(String(message || ""));
}

export function canonicalPackageIdFromObjectType(objectType) {
  if (typeof objectType !== "string") {
    return "";
  }
  const normalized = objectType.trim();
  const separator = normalized.indexOf("::");
  if (separator <= 0) {
    return "";
  }
  return normalizeHexId(normalized.slice(0, separator));
}

export function resolveQuorumTicketFromFinalizeTx({
  disputeCaseObjectId,
  disputeCaseType,
  resolvedEvents,
  transactionBlock,
} = {}) {
  const normalizedDisputeCaseObjectId = normalizeHexId(disputeCaseObjectId);
  const canonicalPackageId = canonicalPackageIdFromObjectType(disputeCaseType);
  if (!normalizedDisputeCaseObjectId || !canonicalPackageId) {
    return null;
  }
  const resolvedEventType = `${canonicalPackageId}::dispute_quorum::DisputeQuorumResolved`;
  const ticketIssuedEventType = `${canonicalPackageId}::dispute_quorum::QuorumResolutionTicketIssued`;
  const resolvedEvent = Array.isArray(resolvedEvents)
    ? resolvedEvents.find((entry) => {
        const type = typeof entry?.type === "string" ? entry.type : "";
        const disputeCaseId = normalizeHexId(entry?.parsedJson?.dispute_case_id);
        return type === resolvedEventType && disputeCaseId === normalizedDisputeCaseObjectId;
      })
    : null;
  if (!resolvedEvent) {
    return null;
  }
  const txDigest =
    typeof resolvedEvent?.id?.txDigest === "string"
      ? resolvedEvent.id.txDigest
      : typeof transactionBlock?.digest === "string"
        ? transactionBlock.digest
        : "";
  const finalizeSignerAddress =
    normalizeHexId(transactionBlock?.transaction?.data?.sender) || normalizeHexId(transactionBlock?.sender);
  const txEvents = Array.isArray(transactionBlock?.events) ? transactionBlock.events : [];
  const ticketIssuedEvent = txEvents.find((entry) => {
    const type = typeof entry?.type === "string" ? entry.type : "";
    return type === ticketIssuedEventType && normalizeHexId(entry?.parsedJson?.ticket_id);
  });
  const ticketObjectId = normalizeHexId(ticketIssuedEvent?.parsedJson?.ticket_id);
  if (!ticketObjectId) {
    return null;
  }
  return {
    txDigest,
    ticketObjectId,
    finalizeSignerAddress: finalizeSignerAddress || null,
  };
}
