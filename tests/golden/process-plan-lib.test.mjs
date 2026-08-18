import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePlanShape,
  hashPlan,
  buildApprovalRecord,
  applyApproval,
  hasCurrentApproval,
} from "../../schemas/process-plan/plan-lib.mjs";

function samplePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 1,
    part: { shape: "box", width: 10, depth: 10, height: 1 },
    machine: { id: "reference-dobot-mg400-struderbot", profileRevision: "1" },
    settings: { layerHeight: 1, beadWidth: 0.83 },
    operations: [
      {
        invocationId: "op-1",
        operationId: "layer-filling",
        operationVersion: "0.1.0",
        parameters: {},
        paths: [],
        provenance: { generatedBy: "layer-filling@0.1.0", generatedAt: "2026-08-17T00:00:00Z" },
      },
    ],
    status: "preview-only",
    approval: null,
    ...overrides,
  };
}

test("validatePlanShape: accepts a well-formed plan", () => {
  assert.deepEqual(validatePlanShape(samplePlan()), { valid: true, errors: [] });
});

test("validatePlanShape: rejects a non-object", () => {
  assert.equal(validatePlanShape(null).valid, false);
  assert.equal(validatePlanShape("not a plan").valid, false);
});

test("validatePlanShape: reports every missing required field", () => {
  const result = validatePlanShape({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("schemaVersion")));
  assert.ok(result.errors.some((e) => e.includes("machine")));
});

test("validatePlanShape: rejects an operation missing invocationId or paths", () => {
  const plan = samplePlan({ operations: [{ operationId: "layer-filling" }] });
  const result = validatePlanShape(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("invocationId")));
  assert.ok(result.errors.some((e) => e.includes("paths")));
});

test("hashPlan: is stable for the same content and order-independent across key order", async () => {
  const plan = samplePlan();
  const reordered = { revision: plan.revision, schemaVersion: plan.schemaVersion, ...plan };
  const [a, b] = await Promise.all([hashPlan(plan), hashPlan(reordered)]);
  assert.equal(a, b);
});

test("hashPlan: changes when the plan's content changes", async () => {
  const a = await hashPlan(samplePlan());
  const b = await hashPlan(samplePlan({ revision: 2 }));
  assert.notEqual(a, b);
});

test("hashPlan: ignores the approval field itself (no circularity)", async () => {
  const plan = samplePlan();
  const withApproval = { ...plan, approval: { revision: 1, contentHash: "irrelevant", approvedAt: "x", approvedBy: "x", scope: "geometry" } };
  assert.equal(await hashPlan(plan), await hashPlan(withApproval));
});

test("buildApprovalRecord: rejects an unknown scope", async () => {
  await assert.rejects(() => buildApprovalRecord(samplePlan(), { scope: "not-a-scope", approvedBy: "x" }));
});

test("buildApprovalRecord: requires a non-empty approvedBy", async () => {
  await assert.rejects(() => buildApprovalRecord(samplePlan(), { scope: "geometry", approvedBy: "  " }));
});

test("buildApprovalRecord + applyApproval: produces a plan whose approval matches its current revision", async () => {
  const plan = samplePlan();
  const record = await buildApprovalRecord(plan, { scope: "geometry", approvedBy: "operator" });
  const approved = applyApproval(plan, record);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.revision, approved.revision);
  assert.equal(await hashPlan(approved), record.contentHash);
});

test("applyApproval: does not mutate the input plan", async () => {
  const plan = samplePlan();
  const record = await buildApprovalRecord(plan, { scope: "geometry", approvedBy: "operator" });
  applyApproval(plan, record);
  assert.equal(plan.approval, null);
});

test("hasCurrentApproval: false with no approval", () => {
  assert.equal(hasCurrentApproval(samplePlan(), "geometry"), false);
});

test("hasCurrentApproval: false when the plan's revision has moved past the approval", async () => {
  const plan = samplePlan();
  const record = await buildApprovalRecord(plan, { scope: "geometry", approvedBy: "operator" });
  const approved = applyApproval(plan, record);
  const edited = { ...approved, revision: approved.revision + 1 };
  assert.equal(hasCurrentApproval(edited, "geometry"), false);
});

test("hasCurrentApproval: scopes never imply each other", async () => {
  const plan = samplePlan();
  const record = await buildApprovalRecord(plan, { scope: "geometry", approvedBy: "operator" });
  const approved = applyApproval(plan, record);
  assert.equal(hasCurrentApproval(approved, "geometry"), true);
  assert.equal(hasCurrentApproval(approved, "executable-export"), false);
  assert.equal(hasCurrentApproval(approved, "machine-control"), false);
});
