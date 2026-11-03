/// <reference types="vite/client" />
// Shared helpers for backend tests. The double extension keeps Convex from
// deploying this file as a backend module.
import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

export const modules = import.meta.glob("../**/*.ts");

/** Keys Convex Auth needs to issue login tokens inside tests. */
async function configureAuthEnv() {
  if (process.env.JWT_PRIVATE_KEY) return;
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
  process.env.CONVEX_SITE_URL = "https://test.convex.site";
  process.env.SITE_URL = "http://localhost:3000";
}

/** Fixes "now" (only Date; timers keep working). Noon IST on `date`. */
export function setToday(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:30:00Z`));
}

export async function setupTest(today = "2027-04-20") {
  await configureAuthEnv();
  setToday(today);
  return convexTest(schema, modules);
}

export type T = Awaited<ReturnType<typeof setupTest>>;

let phoneCounter = 0;
export function nextPhone() {
  phoneCounter += 1;
  return `+9198${String(phoneCounter).padStart(8, "0")}`;
}

/** A client signed in as `userId` (a fresh session). */
export async function signedInAs(t: T, userId: Id<"users">) {
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 }),
  );
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

export async function createAdmin(t: T, name = "Test Admin") {
  const phone = nextPhone();
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { phone, role: "admin", name }));
  return { userId, phone, as: await signedInAs(t, userId) };
}

export type Admin = Awaited<ReturnType<typeof createAdmin>>;

export const PASSWORD = "plain-tea-42";

type NewStaff = Partial<{
  name: string;
  department: string;
  joinDate: string;
  monthlySalary: number;
  payMode: "monthly_10th" | "half_16day";
  paidUpToIndex: number;
  reserveStatus: "held" | "released" | "forfeited";
  opening: { type: "advance" | "deduction" | "bonus"; amount: number; note: string };
}>;

/** A staff member created through the real admin action, already past the first-login password change. */
export async function createStaffMember(t: T, admin: Admin, details: NewStaff = {}) {
  const phone = nextPhone();
  const { staffId } = await admin.as.action(api.people.create, {
    name: details.name ?? "Test Staff",
    phone,
    department: details.department ?? "Kitchen",
    joinDate: details.joinDate ?? "2027-03-20",
    monthlySalary: details.monthlySalary ?? 30_000,
    payMode: details.payMode ?? "half_16day",
    paidUpToIndex: details.paidUpToIndex,
    reserveStatus: details.reserveStatus ?? "held",
    opening: details.opening,
    initialPassword: PASSWORD,
  });
  const userId = await t.run(async (ctx) => {
    const staff = (await ctx.db.get(staffId))!;
    await ctx.db.patch(staff.userId, { mustChangePassword: false });
    return staff.userId;
  });
  return { staffId, userId, phone, as: await signedInAs(t, userId) };
}

/** The ConvexError code thrown by `promise`, or "NO_ERROR". */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String(data.code);
    return `UNEXPECTED: ${(error as Error).message}`;
  }
}
