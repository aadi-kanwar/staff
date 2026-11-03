# Staff (by Livoza)

Attendance and salaries for our staff. Admins run everything from the admin
screens; staff sign in with their mobile number and password to see their own
attendance and money, and nothing about how pay is worked out.

Built on the same stack, tooling and design system as **MealSync** (Dine):
Next.js 16, Convex (database, functions, auth), Tailwind 4 with MealSync's
tokens, its UI components, Vitest + convex-test.

## Screens

**Admin** (`/admin`): Dashboard · Attendance (daily one-tap grid, per-person
month, change log) · Staff (list, add, detail with Profile, Salary terms,
Paydays, Ledger, Attendance, Joining Reserve, Exit) · Payroll (due and
upcoming paydays, pay several at once) · Settings (own account, staff
password resets).

**Staff** (`/me`, phone-first): Home (next payday, amount pending, Joining
Reserve) · Attendance calendar · Payments · Profile (change password).

## Setup (one time)

1. Create a Convex project at <https://dashboard.convex.dev> (e.g. `staff`).
2. Give the session a **development deploy key** as the environment variable
   `CONVEX_DEPLOY_KEY` (Convex: project → Settings → URL & Deploy Key →
   Generate Development Deploy Key). Never paste it in a chat.
3. Then (Claude can run these):
   ```bash
   npm install
   npx convex deploy                       # pushes the backend
   npx @convex-dev/auth                    # login keys (JWT_PRIVATE_KEY, JWKS, SITE_URL)
   npx convex run setup:createFirstAdmin '{"phone":"98765 43210","password":"…","name":"Your name"}'
   ```
   Or set `FIRST_ADMIN_PHONE`, `FIRST_ADMIN_PASSWORD`, `FIRST_ADMIN_NAME` on the
   deployment and run `npx convex run setup:createFirstAdmin` with no arguments.
   It works once; later admins/staff are added inside the app.
4. Sample data (development only): set `STAFF_ALLOW_DEV_SEED=true` and
   `DEV_SEED_PASSWORD` on the deployment, then `npx convex run seed:dev`.
   Admin `9000000001`; staff `9000000002`–`9000000005` (see `convex/seed.ts`).

## How pay works (admin knowledge only)

- **Company calendar** (`convex/lib/companyCalendar.ts`): every month has 30
  days. The 31st is recorded but ignored for pay; joining on the 31st counts
  as the 1st of next month. Feb 29 (non-leap) and Feb 30 are virtual, paid
  days; a payday on one is paid on 1 Mar, and the next is counted from the
  virtual date.
- **Engine** (`convex/lib/payroll.ts`): paydays are computed, never stored.
  Joining Reserve = first 10 days. Half-salary (16-day): cycles of 16 days
  from join + 10, half the salary each, paid on each cycle's 16th day itself. Monthly (10th): the first cycle to the
  30th, then whole months, paid on the 10th. Present / paid leave / week-off /
  virtual / unmarked = 1, half-day = 0.5, absent = 0. Rounded to the rupee
  only on each payday's final line.
- Revisions and mode changes start on a cycle's first day only.
- Payday lists show upcoming paydays first, soonest first, then past ones,
  newest first.

## Confidentiality

- Staff only reach `convex/staff.ts`, which returns dates, amounts, statuses
  and short labels. `convex/tests/confidentiality.test.ts` calls every staff
  query and fails on `payMode`, `rate`, `dayRate`, `cycleStart`, `cycleEnd`,
  `cycleLength` (and relatives) or pay-mode text.
- The website's JavaScript never contains the engine or the pay-mode labels
  (they come from admin-only queries); `enforcement.test.ts` checks this.

## Security model (as MealSync)

Only `convex/lib/functions.ts` may use Convex's raw builders; everything else
uses `viewerQuery`, `signedInAction`, `adminQuery/Mutation/Action`,
`staffQuery` (own data only, no staff id argument) or internal wrappers
(enforced by ESLint and a test). `attendanceLog` and `auditLog` are
append-only. No self sign-up; failed sign-ins are rate-limited.

## Commands

```bash
npm run dev           # website
npx convex dev        # backend (keeps convex/_generated fresh)
npm run lint
npm run typecheck
npm test              # engine + backend tests (no deployment needed)
npm run codegen:offline
```
