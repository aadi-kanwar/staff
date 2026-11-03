import { createAccount } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "../auth";

/** Creates a phone + password login (actions only). The users row gets its role afterwards. */
export async function createLogin(ctx: ActionCtx, phone: string, password: string): Promise<Id<"users">> {
  const { user } = await createAccount(ctx, {
    provider: PHONE_PASSWORD_PROVIDER,
    account: { id: phone, secret: password },
    profile: { phone },
  });
  return user._id;
}

// Letters and digits that are hard to confuse when read out (no 0/o, 1/l/i).
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** e.g. "kq7m-p3rx": 8 random characters, easy to read out loud. */
export function temporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
