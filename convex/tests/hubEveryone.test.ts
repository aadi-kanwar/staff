import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { PASSWORD, createAdmin, createStaffMember, errorCode, setupTest, type T } from "./harness.test-utils";

/** The Livoza Hub for everyone: tickets for any profile type, sync, export, hub-only sign-in. */

const HUB = "https://hub.example.test";
let hubKey: CryptoKey;

beforeAll(async () => {
  const hub = await generateKeyPair("EdDSA", { extractable: true });
  hubKey = hub.privateKey;
  process.env.HUB_SSO_PUBLIC_KEY = (await exportSPKI(hub.publicKey)).trim().replace(/\n/g, "\\n");
  process.env.HUB_ORIGIN = HUB;
});

afterEach(() => {
  delete process.env.HUB_ONLY;
});

let counter = 0;
async function sign(claims: JWTPayload, audience: string, sub: string) {
  const now = Math.floor(Date.now() / 1000);
  counter += 1;
  return await new SignJWT({ ...claims, iss: HUB, aud: audience, sub, jti: `j-${counter}`, iat: now, exp: now + 60 })
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(hubKey);
}

const person = (overrides: JWTPayload = {}) => ({
  phone: "+919822222222",
  name: "Sam Staff",
  profileType: "staff",
  role: "staff",
  properties: [{ id: "hubP1", name: "Main PG" }],
  ...overrides,
});

const ssoSignIn = async (t: T, claims: JWTPayload, sub = "hubU1") =>
  t.action(api.auth.signIn, { provider: "hub-sso", params: { ticket: await sign(claims, "staff", sub) } });

async function postSync(t: T, claims: JWTPayload, sub: string) {
  const token = await sign(claims, "staff-sync", sub);
  return await t.fetch("/sso/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

const userByPhone = (t: T, phone: string) =>
  t.run(async (ctx) => ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).first());

describe("staff added in the hub", () => {
  test("get an account at once; the admin then adds their pay details with the same number", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    expect((await postSync(t, { kind: "person", ...person(), active: true, revoke: false }, "hubU1")).status).toBe(200);
    const user = (await userByPhone(t, "+919822222222"))!;
    expect(user).toMatchObject({ role: "staff", hubUserId: "hubU1", organizationId: admin.organizationId });
    // The hub's property was linked to the app's one with the same name.
    expect((await t.run((ctx) => ctx.db.get(admin.propertyId)))?.hubPropertyId).toBe("hubP1");

    const { staffId } = await admin.as.action(api.people.create, {
      propertyId: admin.propertyId,
      name: "Sam Staff",
      phone: "98222 22222",
      department: "Kitchen",
      joinDate: "2027-04-01",
      monthlySalary: 20_000,
      payMode: "half_16day",
      reserveStatus: "held",
      initialPassword: PASSWORD,
    });
    const record = await t.run((ctx) => ctx.db.get(staffId));
    expect(record?.userId).toBe(user._id);
    expect((await t.run((ctx) => ctx.db.get(user._id)))?.mustChangePassword).toBeUndefined();

    expect((await ssoSignIn(t, person())).tokens?.token).toBeTruthy();
  });

  test("the hub moves a staff record to its property and can switch the account off", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const staff = await createStaffMember(t, admin, { name: "Kiran" });
    await postSync(
      t,
      { kind: "person", ...person({ phone: staff.phone, name: "Kiran", properties: [{ id: "hubP2", name: "Second PG" }] }), active: true, revoke: true },
      "hubK",
    );
    const record = (await t.run((ctx) => ctx.db.get(staff.staffId)))!;
    const moved = (await t.run((ctx) => ctx.db.get(record.propertyId)))!;
    expect(moved).toMatchObject({ name: "Second PG", hubPropertyId: "hubP2" });

    await postSync(t, { kind: "person", ...person({ phone: staff.phone, name: "Kiran" }), active: false, revoke: true }, "hubK");
    expect((await t.run((ctx) => ctx.db.get(staff.userId)))?.disabled).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", staff.userId)).collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(staff.staffId))).not.toBeNull();
  });
});

test("a hub admin ticket makes an admin; a role this app doesn't have is refused", async () => {
  const t = await setupTest();
  await createAdmin(t);
  expect((await ssoSignIn(t, person({ phone: "+919833333333", profileType: "admin", role: "admin", properties: "*" }), "hubA")).tokens?.token).toBeTruthy();
  expect(await userByPhone(t, "+919833333333")).toMatchObject({ role: "admin" });
  expect(await errorCode(ssoSignIn(t, person({ profileType: "warden", role: "manager" })))).toBe("SSO_LINK_EXPIRED");
});

test("export lists admins and working staff with hub types", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const staff = await createStaffMember(t, admin, { name: "Kiran" });
  const token = await sign({}, "staff-export", "import");
  const body = await (await t.fetch("/sso/export", { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
  expect(body.ok).toBe(true);
  expect(body.properties).toEqual([{ toolPropertyId: admin.propertyId, name: "Main PG", hubPropertyId: null }]);
  expect(body.people).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ phone: admin.phone, hubType: "admin" }),
      expect.objectContaining({ phone: staff.phone, hubType: "staff", toolPropertyIds: [admin.propertyId], name: "Kiran" }),
    ]),
  );
  expect(body.people.find((p: { phone: string }) => p.phone === staff.phone).passwordHash).toEqual(expect.any(String));
  expect((await t.fetch("/sso/export", { method: "POST" })).status).toBe(401);
});

test("with HUB_ONLY, the app's own sign-in sends people to the hub", async () => {
  const t = await setupTest();
  process.env.HUB_ONLY = "true";
  expect(
    await errorCode(t.action(api.auth.signIn, { provider: "phone-password", params: { phone: "+919822222222", password: PASSWORD } })),
  ).toBe("USE_HUB");
  expect(await t.query(api.sso.hubSettings, {})).toEqual({ hubOnly: true, openUrl: `${HUB}/open/staff` });
});
