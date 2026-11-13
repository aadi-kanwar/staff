/**
 * Where a staff member's salary is paid: a UPI ID and/or a bank account.
 * The admin sets these directly; a staff member can ask for a change, which
 * waits for an admin to approve it (staff.payoutRequest).
 */
import { v, type Infer } from "convex/values";
import { appError } from "./errors";

export const vPayoutFields = {
  upiId: v.optional(v.string()),
  accountName: v.optional(v.string()),
  accountNumber: v.optional(v.string()),
  ifsc: v.optional(v.string()),
  bankName: v.optional(v.string()),
};
export const vPayoutInput = v.object(vPayoutFields);
export type PayoutInput = Infer<typeof vPayoutInput>;

/** Saved details: what was set, when and by whom. */
export const vPayout = v.object({
  ...vPayoutFields,
  updatedAt: v.number(),
  updatedBy: v.optional(v.id("users")),
});
/** A change a staff member asked for, waiting for an admin. */
export const vPayoutRequest = v.object({
  ...vPayoutFields,
  submittedAt: v.number(),
});

const UPI = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{9,18}$/;

const blank = (s: string | undefined) => s === undefined || s.trim() === "";

/**
 * Checks and tidies details. A UPI ID, a bank account (holder's name, account
 * number and IFSC together; bank name optional), or both. `required`: at
 * least one must be given (a staff member's request); an admin may clear them.
 */
export function checkPayout(
  input: PayoutInput,
  required: boolean,
): PayoutInput {
  const out: PayoutInput = {};
  if (!blank(input.upiId)) {
    const upi = input.upiId!.trim().toLowerCase();
    if (!UPI.test(upi))
      throw appError("INVALID_INPUT", "Enter a UPI ID like name@okaxis.");
    out.upiId = upi;
  }
  const bankGiven = [
    input.accountName,
    input.accountNumber,
    input.ifsc,
    input.bankName,
  ].some((x) => !blank(x));
  if (bankGiven) {
    const name = input.accountName?.trim().replace(/\s+/g, " ") ?? "";
    const number = input.accountNumber?.replace(/[\s-]/g, "") ?? "";
    const ifsc = input.ifsc?.trim().toUpperCase() ?? "";
    if (name.length < 2 || name.length > 80)
      throw appError("INVALID_INPUT", "Enter the account holder's name.");
    if (!ACCOUNT.test(number))
      throw appError(
        "INVALID_INPUT",
        "The account number should be 9 to 18 digits.",
      );
    if (!IFSC.test(ifsc))
      throw appError(
        "INVALID_INPUT",
        "Enter an 11-character IFSC, like HDFC0001234.",
      );
    out.accountName = name;
    out.accountNumber = number;
    out.ifsc = ifsc;
    if (!blank(input.bankName)) {
      const bank = input.bankName!.trim().replace(/\s+/g, " ");
      if (bank.length > 80)
        throw appError("INVALID_INPUT", "The bank name is too long.");
      out.bankName = bank;
    }
  }
  if (required && out.upiId === undefined && out.accountNumber === undefined) {
    throw appError("INVALID_INPUT", "Give a UPI ID or bank account details.");
  }
  return out;
}

/** One line for payment screens, e.g. "UPI asha@okaxis · Bank A/c 1234567890 (HDFC0001234)". */
export function payoutSummary(p: PayoutInput | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  if (p.upiId) parts.push(`UPI ${p.upiId}`);
  if (p.accountNumber)
    parts.push(
      `Bank A/c ${p.accountNumber} (${p.ifsc}${p.bankName ? `, ${p.bankName}` : ""})`,
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Just the details (no timestamps), for comparing and showing. */
export function payoutDetails(p: PayoutInput | undefined): PayoutInput | null {
  if (!p) return null;
  const { upiId, accountName, accountNumber, ifsc, bankName } = p;
  return { upiId, accountName, accountNumber, ifsc, bankName };
}
