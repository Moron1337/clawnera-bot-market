import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPlanRequestContainsIntent,
  assertReviewerShortlistAuthorizationHandoff,
  assertReviewerSelectionTxPlanAuthorization,
  assertTxPlanRouteAndActorIntent,
} from "../lib/tx-plan-guard.mjs";

const A = `0x${"a".repeat(64)}`;
const B = `0x${"b".repeat(64)}`;
const C = `0x${"c".repeat(64)}`;

function reviewerSelectionPlan(reviewers = [], { txBuilder = "disputeQuorum.openMilestoneDisputeCase" } = {}) {
  const reviewerSelectionReceiptId = "receipt-1";
  return {
    txBuilder,
    request: {
      sender: A,
      orderId: "order-1",
      milestoneId: "milestone-1",
      reviewerSelectionReceiptId,
      ...(reviewers.length > 0 ? { invitedReviewerAddresses: [...reviewers] } : {}),
    },
    inviteBinding: {
      mode: "selection_receipt_activation",
      invitedReviewerAddresses: [...reviewers],
      reviewerSelectionReceiptId,
      postExecuteBindingRequired: true,
      bindRoute: `/reviewer-selection-receipts/${reviewerSelectionReceiptId}/bind-dispute-case`,
    },
    preExecutionRequirements: {
      reviewerSelectionAuthorization: {
        required: true,
        state: "EXTERNAL_OPERATOR_ACTION_REQUIRED",
        reviewerSelectionReceiptId,
        orderedReviewerAddresses: [...reviewers],
      },
    },
  };
}

function reviewerShortlistPayload(reviewers = [B, C], { scope = "OPEN" } = {}) {
  const receiptId = "receipt-1";
  const open = scope === "OPEN";
  return {
    selectionComplete: true,
    directoryScanTruncated: false,
    receipt: {
      id: receiptId,
      shortlistedReviewerAddresses: [...reviewers],
    },
    publishTarget: {
      route: open
        ? "/orders/order-1/milestones/milestone-1/disputes/open"
        : `/disputes/${A}/reviewers/replace`,
      requestPatch: {
        invitedReviewerAddresses: [...reviewers],
        reviewerSelectionReceiptId: receiptId,
      },
    },
    operatorAuthorizationHandoff: {
      state: "BLOCKED_EXTERNAL_CUSTODY_INPUTS",
      requiredBeforePublish: true,
      custodyBoundary: "external",
      txBuilder: open
        ? "disputeQuorum.authorizeOrderReviewerSelection"
        : "disputeQuorum.authorizeReplacementReviewerSelection",
      receiptId,
      orderedReviewerAddresses: [...reviewers],
      preparedRequest: open
        ? {
            orderId: "order-1",
            milestoneId: "milestone-1",
            invitedReviewerAddresses: [...reviewers],
          }
        : {
            disputeCaseObjectId: A,
            invitedReviewerAddresses: [...reviewers],
          },
      missingOperatorInputs: open
        ? [
            "sender",
            "reviewerSelectorCapObjectId",
            "reviewerRegistryObjectId",
            "bondObjectId",
            "bondCoinTypeWhenTyped",
            "escrowObjectId",
            "intendedParty",
            "expiresAtMs",
          ]
        : [
            "sender",
            "reviewerSelectorCapObjectId",
            "reviewerRegistryObjectId",
            "intendedParty",
            "expiresAtMs",
          ],
    },
  };
}

test("plan intent accepts the exact locally requested values", () => {
  assert.doesNotThrow(() => assertPlanRequestContainsIntent(
    { amount: 1000, recipientAddress: B, currency: "SUI", metadata: "api-only" },
    { amount: "1000", recipientAddress: B.toUpperCase().replace("0X", "0x"), currency: "SUI", packageId: C },
  ));
});

test("plan intent rejects changed spend, recipient, package, object, and asset fields", () => {
  for (const [field, expected, actual] of [
    ["amount", "1000", "1001"],
    ["recipientAddress", B, C],
    ["packageId", B, C],
    ["escrowObjectId", B, C],
    ["currency", "SUI", "USDC"],
  ]) {
    assert.throws(
      () => assertPlanRequestContainsIntent({ [field]: expected }, { [field]: actual }),
      new RegExp(`tx_plan_request_intent_mismatch:request\\.${field}`),
    );
  }
  assert.throws(
    () => assertPlanRequestContainsIntent({ paymentCoinObjectId: B }, {}),
    /tx_plan_request_intent_missing:request\.paymentCoinObjectId/,
  );
});

test("plan intent rejects a missing nested parent with security-relevant descendants", () => {
  assert.throws(
    () => assertPlanRequestContainsIntent(
      {
        payment: {
          details: {
            recipientAddress: B,
            amount: "1000",
          },
        },
      },
      {},
    ),
    /tx_plan_request_intent_missing:request\.payment\.details\.recipientAddress/,
  );
  assert.doesNotThrow(() => assertPlanRequestContainsIntent(
    { presentation: { label: "not part of the transaction intent" } },
    {},
  ));
});

test("plan guard binds authenticated actor, route ids, and SourceGuard route", () => {
  const plan = {
    originalRequest: { amount: "1000" },
    request: { sender: A, orderId: "order-1", amount: "1000" },
    sourceGuard: { method: "POST", path: "/orders/order-1/escrow/release" },
  };
  assert.doesNotThrow(() => assertTxPlanRouteAndActorIntent({
    method: "POST",
    rawPath: "/orders/order-1/escrow/release",
    actorAddress: A,
    txPlan: plan,
  }));
  assert.throws(
    () => assertTxPlanRouteAndActorIntent({
      method: "POST",
      rawPath: "/orders/order-1/escrow/release",
      actorAddress: B,
      txPlan: plan,
    }),
    /tx_plan_sender_auth_actor_mismatch/,
  );
  assert.throws(
    () => assertTxPlanRouteAndActorIntent({
      method: "POST",
      rawPath: "/orders/order-2/escrow/release",
      actorAddress: A,
      txPlan: plan,
    }),
    /tx_plan_route_intent_mismatch:orderId/,
  );
  assert.throws(
    () => assertTxPlanRouteAndActorIntent({
      method: "DELETE",
      rawPath: "/orders/order-1/escrow/release",
      actorAddress: A,
      txPlan: plan,
    }),
    /tx_plan_source_guard_route_mismatch/,
  );
});

test("reviewer selection guard accepts exact empty and ordered non-empty authorization bindings", () => {
  const emptyPlan = reviewerSelectionPlan();
  assert.deepEqual(assertReviewerSelectionTxPlanAuthorization(emptyPlan), {
    required: true,
    state: "EXTERNAL_OPERATOR_ACTION_REQUIRED",
    reviewerSelectionReceiptId: "receipt-1",
    orderedReviewerAddresses: [],
    bindRoute: "/reviewer-selection-receipts/receipt-1/bind-dispute-case",
  });
  assert.doesNotThrow(() => assertTxPlanRouteAndActorIntent({
    method: "POST",
    rawPath: "/orders/order-1/milestones/milestone-1/disputes/open",
    actorAddress: A,
    txPlan: {
      ...emptyPlan,
      originalRequest: {
        invitedReviewerAddresses: [],
        reviewerSelectionReceiptId: "receipt-1",
      },
    },
  }));

  const orderedPlan = reviewerSelectionPlan([B, C]);
  assert.doesNotThrow(() => assertReviewerSelectionTxPlanAuthorization(orderedPlan));
});

test("reviewer selection guard rejects missing or non-canonical authorization metadata", () => {
  const plan = reviewerSelectionPlan([B, C]);
  for (const [field, error] of [
    ["inviteBinding", /tx_plan_reviewer_selection_invite_binding_invalid/],
    ["preExecutionRequirements", /tx_plan_reviewer_selection_pre_execution_requirements_invalid/],
  ]) {
    const changed = structuredClone(plan);
    delete changed[field];
    assert.throws(() => assertReviewerSelectionTxPlanAuthorization(changed), error);
  }

  const extraAuthorizationField = structuredClone(plan);
  extraAuthorizationField.preExecutionRequirements.reviewerSelectionAuthorization.untrusted = true;
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(extraAuthorizationField),
    /tx_plan_reviewer_selection_authorization_invalid/,
  );

  const invalidState = structuredClone(plan);
  invalidState.preExecutionRequirements.reviewerSelectionAuthorization.state = "READY";
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(invalidState),
    /tx_plan_reviewer_selection_authorization_invalid/,
  );
});

test("reviewer selection guard binds receipt, route, and exact reviewer order", () => {
  const receiptMismatch = reviewerSelectionPlan([B, C]);
  receiptMismatch.preExecutionRequirements.reviewerSelectionAuthorization.reviewerSelectionReceiptId = "receipt-2";
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(receiptMismatch),
    /tx_plan_reviewer_selection_receipt_mismatch/,
  );

  const routeMismatch = reviewerSelectionPlan([B, C]);
  routeMismatch.inviteBinding.bindRoute = "/reviewer-selection-receipts/receipt-2/bind-dispute-case";
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(routeMismatch),
    /tx_plan_reviewer_selection_bind_route_mismatch/,
  );

  const orderMismatch = reviewerSelectionPlan([B, C]);
  orderMismatch.preExecutionRequirements.reviewerSelectionAuthorization.orderedReviewerAddresses = [C, B];
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(orderMismatch),
    /tx_plan_reviewer_selection_reviewer_order_mismatch/,
  );

  const requestOrderMismatch = reviewerSelectionPlan([B, C]);
  requestOrderMismatch.request.invitedReviewerAddresses = [C, B];
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(requestOrderMismatch),
    /tx_plan_reviewer_selection_reviewer_order_mismatch/,
  );

  const duplicate = reviewerSelectionPlan([B, B]);
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(duplicate),
    /tx_plan_reviewer_selection_duplicate_reviewer/,
  );

  const missingNonEmptyRequestList = reviewerSelectionPlan([B, C]);
  delete missingNonEmptyRequestList.request.invitedReviewerAddresses;
  assert.throws(
    () => assertReviewerSelectionTxPlanAuthorization(missingNonEmptyRequestList),
    /tx_plan_reviewer_selection_request_reviewers_missing/,
  );
});

test("reviewer shortlist guard accepts the exact external-custody handoff", () => {
  const open = reviewerShortlistPayload();
  assert.deepEqual(assertReviewerShortlistAuthorizationHandoff({
    payload: open,
    scope: "OPEN",
    orderId: "order-1",
    milestoneId: "milestone-1",
    disputeCaseObjectId: "",
  }), {
    receiptId: "receipt-1",
    orderedReviewerAddresses: [B, C],
    publishRoute: "/orders/order-1/milestones/milestone-1/disputes/open",
    publishRequestPatch: open.publishTarget.requestPatch,
    operatorAuthorizationHandoff: open.operatorAuthorizationHandoff,
  });

  assert.doesNotThrow(() => assertReviewerShortlistAuthorizationHandoff({
    payload: reviewerShortlistPayload([B], { scope: "REPLACEMENT" }),
    scope: "REPLACEMENT",
    orderId: "",
    milestoneId: "",
    disputeCaseObjectId: A,
  }));
});

test("reviewer shortlist guard rejects receipt, route, ordering, and operator-input drift", () => {
  for (const [change, error] of [
    [
      (payload) => {
        delete payload.operatorAuthorizationHandoff;
      },
      /reviewer_shortlist_operator_authorization_handoff_invalid/,
    ],
    [
      (payload) => {
        payload.publishTarget.route = "/orders/order-2/milestones/milestone-1/disputes/open";
      },
      /reviewer_shortlist_publish_route_mismatch/,
    ],
    [
      (payload) => {
        payload.operatorAuthorizationHandoff.receiptId = "receipt-2";
      },
      /reviewer_shortlist_operator_authorization_handoff_invalid/,
    ],
    [
      (payload) => {
        payload.operatorAuthorizationHandoff.orderedReviewerAddresses.reverse();
      },
      /reviewer_shortlist_reviewer_order_mismatch/,
    ],
    [
      (payload) => {
        payload.operatorAuthorizationHandoff.missingOperatorInputs.pop();
      },
      /reviewer_shortlist_missing_operator_inputs_invalid/,
    ],
    [
      (payload) => {
        payload.publishTarget.requestPatch.bondObjectId = A;
      },
      /reviewer_shortlist_request_patch_invalid/,
    ],
  ]) {
    const payload = reviewerShortlistPayload();
    change(payload);
    assert.throws(() => assertReviewerShortlistAuthorizationHandoff({
      payload,
      scope: "OPEN",
      orderId: "order-1",
      milestoneId: "milestone-1",
      disputeCaseObjectId: "",
    }), error);
  }
});
