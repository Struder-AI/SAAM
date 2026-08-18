// Plan loading, validation, hashing, and approval logic for
// schemas/process-plan/process-plan.schema.json. No dependencies beyond
// the Web Crypto API (`crypto.subtle`), which is available identically
// in modern Node and in every browser — kept dependency-free on purpose
// so it can be tested with plain `node:test` and imported by anything
// that needs to reason about a process plan: the reference workbench
// (interfaces/reference-workbench/), the MCP adapter (adapters/mcp/),
// and the post-processor's own safety gate all consume this one
// implementation rather than each reimplementing it.

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "revision",
  "part",
  "machine",
  "settings",
  "operations",
  "status",
];

/**
 * A lightweight structural check, not full JSON Schema validation — good
 * enough to protect a caller from an obviously malformed plan. The
 * authoritative check is process-plan.schema.json itself;
 * tests/schema validates real fixtures against it directly.
 */
export function validatePlanShape(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["Not a JSON object."] };
  }
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in candidate)) errors.push(`Missing required field "${field}".`);
  }
  if (candidate.schemaVersion !== 1) {
    errors.push(`Unsupported schemaVersion "${candidate.schemaVersion}" (expected 1).`);
  }
  if (!Array.isArray(candidate.operations)) {
    errors.push('"operations" must be an array (empty is valid — a target-only preview with no toolpaths yet).');
  } else {
    candidate.operations.forEach((op, index) => {
      if (!op.invocationId) errors.push(`operations[${index}] is missing "invocationId".`);
      if (!op.operationId) errors.push(`operations[${index}] is missing "operationId".`);
      if (!Array.isArray(op.paths)) errors.push(`operations[${index}] is missing a "paths" array.`);
    });
  }
  return { valid: errors.length === 0, errors };
}

// Canonical (key-sorted) JSON so the same logical plan always hashes the
// same way regardless of property insertion order.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

/**
 * Hashes a plan's manufacturing content: everything except `approval`
 * (a record *about* a hash can't be part of what's hashed without
 * becoming circular) and `status` (workflow bookkeeping, not content —
 * approving a plan flips `status` to "approved", and that transition
 * must not itself change the hash the new approval is bound to).
 */
export async function hashPlan(plan) {
  const { approval, status, ...withoutApprovalOrStatus } = plan;
  const canonicalJson = JSON.stringify(canonicalize(withoutApprovalOrStatus));
  const bytes = new TextEncoder().encode(canonicalJson);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/**
 * Builds an approval record bound to the plan's *current* revision and
 * content. Per docs/authoring/process-plan-workflow.md, this is meant to
 * be called only from an explicit human interface action — never from
 * an adapter, and never inferred from chat text.
 */
export async function buildApprovalRecord(plan, { scope, approvedBy, approvedAt = new Date().toISOString() }) {
  if (!["geometry", "executable-export", "machine-control"].includes(scope)) {
    throw new Error(`Unknown approval scope "${scope}".`);
  }
  if (!approvedBy || !approvedBy.trim()) {
    throw new Error("An approval record requires who approved it.");
  }
  return {
    revision: plan.revision,
    contentHash: await hashPlan(plan),
    approvedAt,
    approvedBy: approvedBy.trim(),
    scope,
  };
}

/**
 * Returns a new plan with the approval attached and `status` updated —
 * never mutates the input.
 */
export function applyApproval(plan, approvalRecord) {
  return {
    ...plan,
    approval: approvalRecord,
    status: "approved",
  };
}

/**
 * True only when the plan's approval record matches its current
 * revision AND was granted for exactly this scope — editing a loaded
 * plan without re-approving it makes this false, and, per
 * docs/authoring/terminology.md, holding one scope of approval never
 * implies another, so this never falls back to a broader scope either.
 * A single `approval` field holds the most recent decision only; moving
 * from geometry approval to export approval means making that decision
 * again, deliberately, not inheriting it.
 */
export function hasCurrentApproval(plan, scope) {
  if (!plan.approval) return false;
  if (plan.approval.revision !== plan.revision) return false;
  return plan.approval.scope === scope;
}
