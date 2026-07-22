const TX_INTENT_FIELD = /amount|asset|currency|coin|package|object|recipient|buyer|seller|owner|sender|order|listing|milestone|dispute|reviewer|vote|commit|hash|deadline|due|target|type|address|manifest|signal|payload|keyVersion|chain|network|gas/i;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

const REVIEWER_SELECTION_TX_BUILDERS = new Set([
  "disputeQuorum.openMilestoneDisputeCase",
  "disputeQuorum.startReplacementRound",
]);

function assertExactObjectFields(value, expectedFields, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(error);
  }
  const actualFields = Object.keys(value).sort();
  const normalizedExpectedFields = [...expectedFields].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(normalizedExpectedFields)) {
    throw new Error(error);
  }
}

function normalizeReviewerAddressSequence(value, error) {
  if (!Array.isArray(value)) {
    throw new Error(error);
  }
  const normalized = value.map((entry) => {
    const address = normalizeString(entry);
    if (!/^0x[a-f0-9]{64}$/i.test(address)) {
      throw new Error(error);
    }
    return address.toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("tx_plan_reviewer_selection_duplicate_reviewer");
  }
  return normalized;
}

function normalizeReviewerReceiptId(value, error) {
  const receiptId = normalizeString(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(receiptId)) {
    throw new Error(error);
  }
  return receiptId;
}

function assertExactReviewerAddressSequence(expected, actual, error) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(error);
  }
}

export function assertReviewerShortlistAuthorizationHandoff({
  payload,
  scope,
  orderId,
  milestoneId,
  disputeCaseObjectId,
}) {
  assertExactObjectFields(
    payload?.publishTarget,
    ["route", "requestPatch"],
    "reviewer_shortlist_publish_target_invalid",
  );
  assertExactObjectFields(
    payload.publishTarget.requestPatch,
    ["invitedReviewerAddresses", "reviewerSelectionReceiptId"],
    "reviewer_shortlist_request_patch_invalid",
  );
  assertExactObjectFields(
    payload?.operatorAuthorizationHandoff,
    [
      "state",
      "requiredBeforePublish",
      "custodyBoundary",
      "txBuilder",
      "receiptId",
      "orderedReviewerAddresses",
      "preparedRequest",
      "missingOperatorInputs",
    ],
    "reviewer_shortlist_operator_authorization_handoff_invalid",
  );

  const receipt = payload?.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("reviewer_shortlist_receipt_invalid");
  }
  const receiptId = normalizeReviewerReceiptId(receipt.id, "reviewer_shortlist_receipt_invalid");
  const receiptReviewers = normalizeReviewerAddressSequence(
    receipt.shortlistedReviewerAddresses,
    "reviewer_shortlist_receipt_reviewers_invalid",
  );
  const patch = payload.publishTarget.requestPatch;
  const patchReviewers = normalizeReviewerAddressSequence(
    patch.invitedReviewerAddresses,
    "reviewer_shortlist_request_patch_reviewers_invalid",
  );
  if (normalizeString(patch.reviewerSelectionReceiptId) !== receiptId) {
    throw new Error("reviewer_shortlist_receipt_mismatch");
  }
  assertExactReviewerAddressSequence(
    receiptReviewers,
    patchReviewers,
    "reviewer_shortlist_reviewer_order_mismatch",
  );

  const normalizedScope = normalizeString(scope).toUpperCase();
  const isOpen = normalizedScope === "OPEN";
  const isReplacement = normalizedScope === "REPLACEMENT";
  if (!isOpen && !isReplacement) {
    throw new Error("reviewer_shortlist_scope_invalid");
  }
  const expectedRoute = isOpen
    ? `/orders/${orderId}/milestones/${milestoneId}/disputes/open`
    : `/disputes/${disputeCaseObjectId}/reviewers/replace`;
  if (normalizeString(payload.publishTarget.route) !== expectedRoute) {
    throw new Error("reviewer_shortlist_publish_route_mismatch");
  }

  const handoff = payload.operatorAuthorizationHandoff;
  const expectedBuilder = isOpen
    ? "disputeQuorum.authorizeOrderReviewerSelection"
    : "disputeQuorum.authorizeReplacementReviewerSelection";
  if (
    handoff.state !== "BLOCKED_EXTERNAL_CUSTODY_INPUTS" ||
    handoff.requiredBeforePublish !== true ||
    handoff.custodyBoundary !== "external" ||
    handoff.txBuilder !== expectedBuilder ||
    normalizeString(handoff.receiptId) !== receiptId
  ) {
    throw new Error("reviewer_shortlist_operator_authorization_handoff_invalid");
  }
  const handoffReviewers = normalizeReviewerAddressSequence(
    handoff.orderedReviewerAddresses,
    "reviewer_shortlist_handoff_reviewers_invalid",
  );
  assertExactReviewerAddressSequence(
    receiptReviewers,
    handoffReviewers,
    "reviewer_shortlist_reviewer_order_mismatch",
  );

  const preparedRequest = handoff.preparedRequest;
  if (!preparedRequest || typeof preparedRequest !== "object" || Array.isArray(preparedRequest)) {
    throw new Error("reviewer_shortlist_prepared_request_invalid");
  }
  const requiredPreparedFields = isOpen
    ? ["orderId", "milestoneId", "invitedReviewerAddresses"]
    : ["disputeCaseObjectId", "invitedReviewerAddresses"];
  const allowedPreparedFields = new Set([
    ...requiredPreparedFields,
    "packageId",
    "disputeQuorumConfigObjectId",
    "governanceConfigObjectId",
  ]);
  if (
    requiredPreparedFields.some((field) => !Object.prototype.hasOwnProperty.call(preparedRequest, field)) ||
    Object.keys(preparedRequest).some((field) => !allowedPreparedFields.has(field))
  ) {
    throw new Error("reviewer_shortlist_prepared_request_invalid");
  }
  if (
    (isOpen &&
      (normalizeString(preparedRequest.orderId) !== orderId ||
        normalizeString(preparedRequest.milestoneId) !== milestoneId)) ||
    (isReplacement && normalizeString(preparedRequest.disputeCaseObjectId) !== disputeCaseObjectId)
  ) {
    throw new Error("reviewer_shortlist_prepared_request_context_mismatch");
  }
  for (const field of ["packageId", "disputeQuorumConfigObjectId", "governanceConfigObjectId"]) {
    if (Object.prototype.hasOwnProperty.call(preparedRequest, field) && !normalizeString(preparedRequest[field])) {
      throw new Error("reviewer_shortlist_prepared_request_invalid");
    }
  }
  const preparedReviewers = normalizeReviewerAddressSequence(
    preparedRequest.invitedReviewerAddresses,
    "reviewer_shortlist_prepared_request_reviewers_invalid",
  );
  assertExactReviewerAddressSequence(
    receiptReviewers,
    preparedReviewers,
    "reviewer_shortlist_reviewer_order_mismatch",
  );

  const commonMissingInputs = [
    ...(!Object.prototype.hasOwnProperty.call(preparedRequest, "packageId") ? ["packageId"] : []),
    ...(!Object.prototype.hasOwnProperty.call(preparedRequest, "disputeQuorumConfigObjectId")
      ? ["disputeQuorumConfigObjectId"]
      : []),
    ...(!Object.prototype.hasOwnProperty.call(preparedRequest, "governanceConfigObjectId")
      ? ["governanceConfigObjectId"]
      : []),
    "sender",
    "reviewerSelectorCapObjectId",
    "reviewerRegistryObjectId",
  ];
  const expectedMissingInputs = isOpen
    ? [
        ...commonMissingInputs,
        "bondObjectId",
        "bondCoinTypeWhenTyped",
        "escrowObjectId",
        "intendedParty",
        "expiresAtMs",
      ]
    : [
        ...commonMissingInputs,
        "intendedParty",
        "expiresAtMs",
      ];
  if (
    !Array.isArray(handoff.missingOperatorInputs) ||
    JSON.stringify(handoff.missingOperatorInputs) !== JSON.stringify(expectedMissingInputs)
  ) {
    throw new Error("reviewer_shortlist_missing_operator_inputs_invalid");
  }

  return {
    receiptId,
    orderedReviewerAddresses: [...receipt.shortlistedReviewerAddresses],
    publishRoute: expectedRoute,
    publishRequestPatch: { ...patch },
    operatorAuthorizationHandoff: handoff,
  };
}

export function assertReviewerSelectionTxPlanAuthorization(txPlan) {
  const txBuilder = normalizeString(txPlan?.txBuilder);
  if (!REVIEWER_SELECTION_TX_BUILDERS.has(txBuilder)) {
    return null;
  }

  const request = txPlan?.request;
  assertExactObjectFields(
    txPlan?.inviteBinding,
    [
      "mode",
      "invitedReviewerAddresses",
      "reviewerSelectionReceiptId",
      "postExecuteBindingRequired",
      "bindRoute",
    ],
    "tx_plan_reviewer_selection_invite_binding_invalid",
  );
  assertExactObjectFields(
    txPlan?.preExecutionRequirements,
    ["reviewerSelectionAuthorization"],
    "tx_plan_reviewer_selection_pre_execution_requirements_invalid",
  );
  const inviteBinding = txPlan.inviteBinding;
  const authorization = txPlan.preExecutionRequirements.reviewerSelectionAuthorization;
  assertExactObjectFields(
    authorization,
    ["required", "state", "reviewerSelectionReceiptId", "orderedReviewerAddresses"],
    "tx_plan_reviewer_selection_authorization_invalid",
  );
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("tx_plan_reviewer_selection_request_invalid");
  }
  if (
    inviteBinding.mode !== "selection_receipt_activation" ||
    inviteBinding.postExecuteBindingRequired !== true ||
    authorization.required !== true ||
    authorization.state !== "EXTERNAL_OPERATOR_ACTION_REQUIRED"
  ) {
    throw new Error("tx_plan_reviewer_selection_authorization_invalid");
  }

  const requestReceiptId = normalizeReviewerReceiptId(
    request.reviewerSelectionReceiptId,
    "tx_plan_reviewer_selection_receipt_mismatch",
  );
  const bindingReceiptId = normalizeReviewerReceiptId(
    inviteBinding.reviewerSelectionReceiptId,
    "tx_plan_reviewer_selection_receipt_mismatch",
  );
  const authorizationReceiptId = normalizeReviewerReceiptId(
    authorization.reviewerSelectionReceiptId,
    "tx_plan_reviewer_selection_receipt_mismatch",
  );
  if (
    requestReceiptId !== bindingReceiptId ||
    requestReceiptId !== authorizationReceiptId
  ) {
    throw new Error("tx_plan_reviewer_selection_receipt_mismatch");
  }
  if (
    normalizeString(inviteBinding.bindRoute) !==
    `/reviewer-selection-receipts/${requestReceiptId}/bind-dispute-case`
  ) {
    throw new Error("tx_plan_reviewer_selection_bind_route_mismatch");
  }

  const bindingReviewers = normalizeReviewerAddressSequence(
    inviteBinding.invitedReviewerAddresses,
    "tx_plan_reviewer_selection_invited_reviewers_invalid",
  );
  const authorizationReviewers = normalizeReviewerAddressSequence(
    authorization.orderedReviewerAddresses,
    "tx_plan_reviewer_selection_authorized_reviewers_invalid",
  );
  assertExactReviewerAddressSequence(
    bindingReviewers,
    authorizationReviewers,
    "tx_plan_reviewer_selection_reviewer_order_mismatch",
  );
  if (Object.prototype.hasOwnProperty.call(request, "invitedReviewerAddresses")) {
    const requestReviewers = normalizeReviewerAddressSequence(
      request.invitedReviewerAddresses,
      "tx_plan_reviewer_selection_request_reviewers_invalid",
    );
    assertExactReviewerAddressSequence(
      bindingReviewers,
      requestReviewers,
      "tx_plan_reviewer_selection_reviewer_order_mismatch",
    );
  } else if (bindingReviewers.length > 0) {
    throw new Error("tx_plan_reviewer_selection_request_reviewers_missing");
  }

  return {
    required: true,
    state: authorization.state,
    reviewerSelectionReceiptId: requestReceiptId,
    orderedReviewerAddresses: [...authorization.orderedReviewerAddresses],
    bindRoute: inviteBinding.bindRoute,
  };
}

export function comparableTxIntentValue(value) {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return /^0x[a-f0-9]+$/i.test(normalized) ? normalized.toLowerCase() : normalized;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(comparableTxIntentValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, comparableTxIntentValue(entry)]),
    );
  }
  return value;
}

export function assertPlanRequestContainsIntent(expected, actual, prefix = "request") {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return;
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new Error("tx_plan_request_intent_missing");
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    const fieldPath = `${prefix}.${key}`;
    if (expectedValue && typeof expectedValue === "object" && !Array.isArray(expectedValue)) {
      assertPlanRequestContainsIntent(
        expectedValue,
        Object.prototype.hasOwnProperty.call(actual, key) ? actual[key] : {},
        fieldPath,
      );
      continue;
    }
    if (!TX_INTENT_FIELD.test(key)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      throw new Error(`tx_plan_request_intent_missing:${fieldPath}`);
    }
    if (
      JSON.stringify(comparableTxIntentValue(actual[key])) !==
      JSON.stringify(comparableTxIntentValue(expectedValue))
    ) {
      throw new Error(`tx_plan_request_intent_mismatch:${fieldPath}`);
    }
  }
}

export function assertTxPlanRouteAndActorIntent({ method, rawPath, actorAddress, txPlan }) {
  const request = txPlan.request;
  const reviewerSelectionAuthorization = assertReviewerSelectionTxPlanAuthorization(txPlan);
  const requestForIntentValidation =
    reviewerSelectionAuthorization &&
    !Object.prototype.hasOwnProperty.call(request, "invitedReviewerAddresses")
      ? {
          ...request,
          invitedReviewerAddresses: [...txPlan.inviteBinding.invitedReviewerAddresses],
        }
      : request;
  assertPlanRequestContainsIntent(txPlan.originalRequest, requestForIntentValidation);
  const normalizedActor = normalizeString(actorAddress).toLowerCase();
  const sender = normalizeString(request.sender).toLowerCase();
  if (normalizedActor && sender && normalizedActor !== sender) {
    throw new Error("tx_plan_sender_auth_actor_mismatch");
  }
  const pathname = new URL(rawPath, "https://clawnera.invalid").pathname;
  for (const [pattern, field] of [
    [/\/orders\/([^/]+)/i, "orderId"],
    [/\/listings\/([^/]+)/i, "listingId"],
    [/\/milestones\/([^/]+)/i, "milestoneId"],
  ]) {
    const match = pathname.match(pattern);
    if (
      match &&
      Object.prototype.hasOwnProperty.call(request, field) &&
      comparableTxIntentValue(request[field]) !== comparableTxIntentValue(decodeURIComponent(match[1]))
    ) {
      throw new Error(`tx_plan_route_intent_mismatch:${field}`);
    }
  }
  const guardedMethod = normalizeString(txPlan.sourceGuard?.method).toUpperCase();
  const guardedPath = normalizeString(txPlan.sourceGuard?.path);
  if ((guardedMethod && guardedMethod !== method) || (guardedPath && guardedPath !== pathname)) {
    throw new Error("tx_plan_source_guard_route_mismatch");
  }
  return reviewerSelectionAuthorization;
}
