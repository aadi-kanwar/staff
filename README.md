# Staff (by Livoza)

Attendance and salaries for our staff. Admins run everything from the admin
screens; staff sign in with their mobile number and password to see their own
attendance and money, and nothing about how pay is worked out.

Built on the same stack, tooling and design system as **MealSync** (Dine):
Next.js 16, Convex (database, functions, auth), Tailwind 4 with MealSync's
tokens, its UI components, Vitest + convex-test.

## Organisations and properties (as in MealSync)

- An admin's **organisation** is their business; it has one or more
  **properties** (PGs). The first time an admin signs in they name their
  organisation and its first property. More properties are added (and
  renamed) in **Settings → Organisation**.
- **Every staff member belongs to one property**: chosen when adding them,
  shown on their profile (and on the staff member's own Profile screen), and
  changeable from **Edit** on their profile. Moving someone doesn't change
  their pay or history.
- With more than one property, the header has a picker: **All properties**
  or one property. Dashboard, Attendance, Staff, Payroll, Reports and the
  password-reset list show the chosen property, or all of them with each
  row naming its property. The choice is remembered on that device.
- Organisations are completely separate: an admin never sees another
  organisation's staff, properties, attendance, money or logs
  (`convex/tests/organizations.test.ts`).

## Past payments and payment details

- **Record a past entry** (staff member → Paydays tab): a salary payment,
  bonus or deduction from before, for the dates it was for. Nothing is
  refused:
  - A payment fills the pay periods in those dates (those with at least half
    their days inside, else any that overlap), oldest first. Anything beyond
    what they owe, or all of it if the dates have no pay period, is kept as
    a past payment for those dates.
  - A bonus or deduction goes on the first pay period in those dates
    (changing what it pays); a bonus can be marked as already paid. With no
    pay period in the dates it's kept as a past entry.
  - Past entries with no pay period are history only (they never change
    what's owed or the final settlement). They show in the Ledger, on the
    staff member's Payments and as dashed green days on both calendars.
- **Salary payment details** (UPI ID and/or bank account: holder's name,
  account number, IFSC, bank): the admin sets them on the Profile tab. A
  staff member can send a change from their Profile; it waits for an admin.
  While it waits it's flagged: a badge and highlight in the Staff list, a
  notice on the Dashboard, a banner with **Approve / Reject** at the top of
  their page, and a phone notification to admins. Payroll shows "Pay to"
  with the approved details.

## Admins

- **Settings → Admins** lists everyone who manages the organisation. Every
  admin has full access (all properties, staff, pay, reports, settings).
- **Add admin:** name and mobile number; you get a temporary password, shown
  once, to give them. They sign in with it and must choose their own.
- **Reset password** and **Remove** for other admins. You can't remove
  yourself, and an organisation always keeps at least one admin. All of it
  is in the audit log (`convex/admins.ts`).
- `setup:createFirstAdmin` is only for the very first admin of a new
  deployment.

## Editing and deleting staff

- **Edit** (Profile tab): name, mobile number (also their login; the password
  stays the same), department, property and joining date.
- **Salary terms** tab: **Edit** any row (amount, pay mode, and for a later
  change the cycle it starts on) and **Remove** any change after joining.
- Changes that would move paydays (joining date, pay mode, start of a change)
  are refused while payments or adjustments sit on those paydays, so no
  money goes missing: remove them in the Ledger, make the change, record
  them again.
- **Delete staff member** (Profile tab, type their name to confirm) removes
  their login and every record for good; the audit log notes it. Use the Exit
  tab for someone who has simply left.

## Phone notifications

- After Staff is added to the home screen and opened from its icon, people
  are asked to allow notifications (also: Settings for admins, Profile for
  staff). Android Chrome, and iPhone once added to the Home Screen.
- **Admins:** one notification per person whose salary is due that day, at
  the time set (default 09:00), with what's still owed.
- **Staff:** when a payment to them is recorded (including a final
  settlement).
- **Staff who mark attendance:** at the times set (default 11:00 and 18:00),
  if anyone else at their property isn't marked yet that day.
- **Settings → Notifications:** turn each on or off, set the times, and write
  the title and message with placeholders such as `{name}`, `{amount}`,
  `{property}`, `{count}`, with a live preview.
- Sent by `convex/notifications.ts` (a job every 5 minutes; each goes out once
  per day and time) through `convex/push.ts` (Web Push). The VAPID signing
  keys are created on the Convex deployment by the Vercel build.

## Reports

**Reports** (`/admin/reports`) downloads a spreadsheet (CSV, opens in Excel or
Google Sheets) for a date range, for the property chosen at the top (or all),
and for everyone or one staff member. A preview of the totals shows first.

| Report | One row per | Longest range |
| --- | --- | --- |
| Attendance summary | person: working days, Present, Half-day, Absent, Paid leave, Week-off, not marked | 366 days |
| Attendance (day by day) | person per working day, with the mark | 100 days |
| Paydays | payday due in the range: cycle, paid days, earned, bonus, deductions, advance, net, paid, still owed | 366 days |
| Payments made | payment with a payment date in the range: amount, mode, which payday | 366 days |

Every download is written to the audit log.

## Screens

**Admin** (`/admin`): Dashboard (today's attendance, owed now, due and paid
this month (1st to the month's last day), this month's paydays, a payday
calendar marking every day someone is due to be paid, the next 7 days) · Attendance (daily one-tap grid, per-person
month, change log) · Staff (list, add, detail with Profile, Salary terms,
Paydays (the same pay calendar as the staff Home above the payday cards;
clicking a day brings that period's card into view, clicking a card turns the
calendar to it), Ledger, Attendance, Joining Reserve, Exit) · Payroll (due and
upcoming paydays, pay several at once; this month's due / pending / paid
totals; a date range of your choice; property and department filters; Owed
now, Upcoming, Paid and All tabs) · Reports (CSV downloads) · Settings
(organisation and properties, own account, staff password resets).

**Attendance marking by staff:** an admin can let a staff member mark
attendance for the other staff at their own property, with the **Can mark
attendance** box when adding them, or **Allow / Stop attendance marking** on
their Profile tab. They get a **Mark** tab (`/me/mark`): today and the last 7
days, everyone else working at their property, one tap per person, then Save.
They can't mark themselves, another property, or see anyone's pay; every
change is in the attendance log under their name (`convex/marking.ts`).

**Staff** (`/me`, phone-first): Home (amount pending and next payday, then a
**pay calendar**: each pay period shaded green and struck through when paid,
red when pending, blue for the period running now, dashed for later ones,
grey for the Joining Reserve days; ₹ marks paydays; a red **A** marks
absent days and an amber **½** half-days; tap a day for that
period's amount, line items and payments) · Attendance calendar · Payments ·
Profile (change password).

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
   It works once; later admins/staff are added inside the app. At their first
   sign-in the admin names their organisation and first property.
4. Sample data (development only): set `STAFF_ALLOW_DEV_SEED=true` and
   `DEV_SEED_PASSWORD` on the deployment, then `npx convex run seed:dev`.
   Admin `9000000001`; staff `9000000002`–`9000000005` (see `convex/seed.ts`).
   If the admin has no organisation yet, "Sample organisation" is created with
   two properties, North PG and South PG.

## Going live (production)

Convex has a separate **production** database next to the development one.
Vercel hosts the website and, on every deploy, `scripts/vercel-build.mjs`
prepares production automatically (login keys, `SITE_URL`, latest backend
code, the first admin). One time:

1. **Convex:** <https://dashboard.convex.dev> → project **staff** → switch to
   **Production** (top of the page) → **Settings → URL & Deploy Key →
   Generate Production Deploy Key** → copy it.
2. **Convex, still on Production → Settings → Environment Variables:** add
   `FIRST_ADMIN_PHONE`, `FIRST_ADMIN_PASSWORD` (8+ characters, not the phone
   number) and `FIRST_ADMIN_NAME`.
3. **Vercel:** <https://vercel.com> → **Add New… → Project** → import
   **staff** → **Environment Variables**: `CONVEX_DEPLOY_KEY` = the key from
   step 1 (Production only) → **Deploy**.
4. Open the live address, sign in with the first admin's number and
   password, name your organisation and first property. Then delete
   `FIRST_ADMIN_PASSWORD` from the Convex production settings.

After that, every push to `main` deploys automatically. Never set
`STAFF_ALLOW_DEV_SEED` on production (the build refuses to run if it is).
Data in the development deployment is not copied to production. A custom
domain is added in Vercel → Settings → Domains; the next deploy updates
`SITE_URL` to match.

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
- Payday lists (admin Paydays tab, staff Payments) show anything owed now
  first (oldest first, marked Overdue), then upcoming paydays (soonest
  first), then past ones (newest first).

## Confidentiality

- Staff only reach `convex/staff.ts`, which returns dates, amounts, statuses
  and short labels. Pay periods' first and last dates are shown on the Home
  calendar (owner's decision, Nov 2026); the pay mode, period length, rates
  and formulas are not. `convex/tests/confidentiality.test.ts` calls every staff
  query and fails on `payMode`, `rate`, `dayRate`, `cycleStart`, `cycleEnd`,
  `cycleLength` (and relatives) or pay-mode text.
- The website's JavaScript never contains the engine or the pay-mode labels
  (they come from admin-only queries); `enforcement.test.ts` checks this.

## Security model (as MealSync)

Only `convex/lib/functions.ts` may use Convex's raw builders; everything else
uses `viewerQuery`, `signedInAction`, `adminQuery/Mutation/Action` (scoped to
the admin's organisation; an optional `propertyId` narrows a screen to one
property), `orgSetupQuery/Mutation` (creating the organisation only),
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
