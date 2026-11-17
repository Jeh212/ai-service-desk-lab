import {
  CancellationProposal,
  CancellationResult,
  CancellationTerms,
  HumanReviewRequest,
  type Proposal,
} from "../contracts/index.js";
import { AppError } from "../core/errors.js";
import { id, isStaff, requireStaff, type Auth } from "../core/security.js";
import { Repositories } from "../repositories/repos.js";
import type { Subscription } from "./models.js";
const DAY = 86_400_000;
// Match Python's round-to-even so the currency calculation survives the migration.
export function roundEven(value: number) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}
export class Services {
  constructor(readonly repos: Repositories) {}
  async subscription(
    auth: Auth,
    subscription_id: string | null = null,
  ): Promise<Subscription> {
    if (subscription_id) {
      const sub = await this.repos.subscriptions.findOne({
        org_id: auth.org_id,
        subscription_id,
      });
      if (!sub)
        throw new AppError(
          "subscription_not_found",
          "That subscription was not found.",
        );
      if (sub.user_id !== auth.user_id && !isStaff(auth))
        throw new AppError(
          "cross_tenant_access",
          "You are not allowed to access this subscription.",
        );
      return sub;
    }
    const subs = await this.repos.subscriptions.find({
      org_id: auth.org_id,
      user_id: auth.user_id,
    });
    const sub = subs.find((s) => s.status === "active") ?? subs[0];
    if (!sub)
      throw new AppError(
        "subscription_not_found",
        "You don't have a subscription on file.",
      );
    return sub;
  }
  async billing(auth: Auth, limit = 20) {
    return this.repos.billing.find(
      { org_id: auth.org_id, user_id: auth.user_id },
      { sort: [["created_at", -1]], limit },
    );
  }
  async terms(auth: Auth, subscription: Subscription, now: Date) {
    const policy = await this.repos.latestPolicy(auth.org_id, "cancellation");
    if (!policy)
      throw new AppError(
        "policy_not_found",
        "No cancellation policy is configured.",
      );
    const effective =
      policy.notice_days <= 0
        ? now.toISOString()
        : subscription.current_period_end;
    // Bind the charge to the subscription owner and subscription, including staff access.
    const history = await this.repos.billing.find(
      {
        org_id: auth.org_id,
        user_id: subscription.user_id,
        subscription_id: subscription.subscription_id,
      },
      { sort: [["created_at", -1]], limit: 1 },
    );
    const last = history[0];
    let refund = 0;
    if (policy.prorate_refund && last?.status === "paid") {
      const elapsed = Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(last.created_at)) / DAY),
      );
      if (elapsed <= policy.refund_window_days) {
        const days = Math.max(
          1,
          Math.floor(
            (Date.parse(subscription.current_period_end) -
              Date.parse(subscription.started_at)) /
              DAY,
          ) || 30,
        );
        refund = roundEven(
          last.amount_cents * Math.max(0, (days - elapsed) / days),
        );
      }
    }
    const penalty = Math.max(0, policy.cancellation_fee_cents),
      net = Math.max(0, refund - penalty),
      currency = last?.currency ?? "USD";
    return CancellationTerms.parse({
      effective_date: effective,
      retains_access_until: effective,
      refund_amount_cents: net,
      penalty_cents: penalty,
      currency,
      policy_id: policy.policy_id,
      policy_version: policy.version,
      summary: `Cancellation effective ${effective.slice(0, 10)}. Refund: ${(net / 100).toFixed(2)} ${currency}. Fee: ${(penalty / 100).toFixed(2)}. Policy v${policy.version}.`,
    });
  }
  async prepare(
    auth: Auth,
    subscription_id: string | null = null,
    now = new Date(),
  ) {
    const sub = await this.subscription(auth, subscription_id);
    if (sub.status !== "active")
      throw new AppError(
        "operation_not_allowed",
        "This subscription is not active, so it cannot be cancelled.",
      );
    const proposal = CancellationProposal.parse({
      proposal_id: id("prop"),
      org_id: auth.org_id,
      user_id: auth.user_id,
      subscription_id: sub.subscription_id,
      terms: await this.terms(auth, sub, now),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
    });
    await this.repos.proposals.insert(proposal);
    return proposal;
  }
  async proposal(auth: Auth, proposal_id: string): Promise<Proposal> {
    const proposal = await this.repos.proposals.findOne({
      org_id: auth.org_id,
      proposal_id,
    });
    if (!proposal)
      throw new AppError(
        "proposal_not_found",
        "Cancellation proposal not found.",
      );
    if (proposal.user_id !== auth.user_id)
      throw new AppError(
        "proposal_mismatch",
        "This proposal does not belong to you.",
      );
    return proposal;
  }
  async validateProposal(auth: Auth, proposal_id: string, now = new Date()) {
    const proposal = await this.proposal(auth, proposal_id);
    if (proposal.status === "executed" || proposal.status === "confirmed")
      throw new AppError(
        "duplicate_operation",
        "This cancellation was already completed or is being processed.",
      );
    if (["expired", "abandoned"].includes(proposal.status))
      throw new AppError(
        "proposal_expired",
        "This proposal is no longer valid.",
      );
    if (now.getTime() >= Date.parse(proposal.expires_at)) {
      await this.repos.proposals.update(
        { org_id: auth.org_id, proposal_id, status: "pending" },
        { status: "expired" },
      );
      throw new AppError(
        "proposal_expired",
        "This proposal has expired. Please start again.",
      );
    }
    return proposal;
  }
  async abandon(auth: Auth, proposal_id: string, now = new Date()) {
    await this.validateProposal(auth, proposal_id, now);
    if (
      !(await this.repos.proposals.update(
        {
          org_id: auth.org_id,
          user_id: auth.user_id,
          proposal_id,
          status: "pending",
        },
        { status: "abandoned" },
      ))
    )
      throw new AppError(
        "duplicate_operation",
        "This proposal has already been processed.",
      );
  }
  async execute(auth: Auth, proposal_id: string, now = new Date()) {
    const proposal = await this.validateProposal(auth, proposal_id, now);
    const sub = await this.subscription(auth, proposal.subscription_id);
    if (sub.status !== "active")
      throw new AppError(
        "operation_not_allowed",
        "Subscription is not active; nothing to cancel.",
      );
    // Compare-and-set prevents concurrent confirmations from creating duplicate actions.
    if (
      !(await this.repos.proposals.update(
        {
          org_id: auth.org_id,
          user_id: auth.user_id,
          proposal_id,
          status: "pending",
        },
        { status: "confirmed" },
      ))
    )
      throw new AppError(
        "duplicate_operation",
        "This proposal has already been processed.",
      );
    if (
      !(await this.repos.subscriptions.update(
        {
          org_id: auth.org_id,
          subscription_id: sub.subscription_id,
          status: "active",
        },
        {
          status: "cancelled",
          cancelled_at: now.toISOString(),
          cancel_effective_at: proposal.terms.effective_date,
        },
      ))
    )
      throw new AppError(
        "operation_not_allowed",
        "Subscription is not active; nothing to cancel.",
      );
    await this.repos.proposals.update(
      { org_id: auth.org_id, proposal_id },
      { status: "executed" },
    );
    const audit_id = id("aud");
    await this.repos.audit.insert({
      audit_id,
      org_id: auth.org_id,
      user_id: auth.user_id,
      action: "subscription.cancelled",
      target_id: sub.subscription_id,
      actor: auth.user_id,
      metadata: {
        proposal_id,
        refund_cents: proposal.terms.refund_amount_cents,
        policy_version: proposal.terms.policy_version,
      },
      created_at: now.toISOString(),
    });
    return CancellationResult.parse({
      proposal_id,
      subscription_id: sub.subscription_id,
      status: "cancelled",
      effective_date: proposal.terms.effective_date,
      refund_amount_cents: proposal.terms.refund_amount_cents,
      audit_id,
      executed_at: now.toISOString(),
    });
  }
  async searchKnowledge(
    auth: Auth,
    query: string,
    category: string | null = null,
    limit = 3,
  ) {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 5)
      .map(escape);
    return this.repos.knowledge.find(
      {
        org_id: auth.org_id,
        published: true,
        ...(category ? { category } : {}),
        ...(query
          ? {
              content: {
                $regex: terms.join("|") || escape(query),
                $options: "i",
              },
            }
          : {}),
      },
      { limit },
    );
  }
  async createReview(
    auth: Auth,
    reason: string,
    summary: string,
    conversation_id: string | null = null,
    now = new Date(),
  ) {
    const review = HumanReviewRequest.parse({
      review_id: id("rev"),
      org_id: auth.org_id,
      user_id: auth.user_id,
      reason,
      summary,
      conversation_id,
      created_at: now.toISOString(),
    });
    await this.repos.reviews.insert(review);
    return review;
  }
  async listReviews(auth: Auth, pending = false) {
    requireStaff(auth);
    return this.repos.reviews.find(
      { org_id: auth.org_id, ...(pending ? { status: "pending" } : {}) },
      { sort: [["created_at", -1]] },
    );
  }
  async decideReview(
    auth: Auth,
    review_id: string,
    approve: boolean,
    note = "",
    now = new Date(),
  ) {
    requireStaff(auth);
    const review = await this.repos.reviews.findOne({
      org_id: auth.org_id,
      review_id,
    });
    if (!review)
      throw new AppError("proposal_not_found", "Review request not found.");
    const fields = {
      status: approve ? "approved" : "rejected",
      decided_at: now.toISOString(),
      decided_by: auth.user_id,
      decision_note: note,
    };
    if (
      !(await this.repos.reviews.update(
        { org_id: auth.org_id, review_id, status: "pending" },
        fields,
      ))
    )
      throw new AppError(
        "duplicate_operation",
        "This review has already been decided.",
      );
    await this.repos.audit.insert({
      audit_id: id("aud"),
      org_id: auth.org_id,
      user_id: review.user_id,
      action: `review.${fields.status}`,
      target_id: review_id,
      actor: `agent:${auth.user_id}`,
      metadata: { note, reason: review.reason },
      created_at: now.toISOString(),
    });
    return HumanReviewRequest.parse({ ...review, ...fields });
  }
}
