/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as access from "../access.js";
import type * as adjustments from "../adjustments.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_adminViews from "../lib/adminViews.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_companyCalendar from "../lib/companyCalendar.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_payroll from "../lib/payroll.js";
import type * as lib_settlement from "../lib/settlement.js";
import type * as lib_staffData from "../lib/staffData.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as paydays from "../paydays.js";
import type * as payments from "../payments.js";
import type * as people from "../people.js";
import type * as seed from "../seed.js";
import type * as setup from "../setup.js";
import type * as staff from "../staff.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  access: typeof access;
  adjustments: typeof adjustments;
  attendance: typeof attendance;
  auth: typeof auth;
  authLimits: typeof authLimits;
  dashboard: typeof dashboard;
  http: typeof http;
  "lib/accounts": typeof lib_accounts;
  "lib/adminViews": typeof lib_adminViews;
  "lib/audit": typeof lib_audit;
  "lib/companyCalendar": typeof lib_companyCalendar;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/inputRules": typeof lib_inputRules;
  "lib/money": typeof lib_money;
  "lib/payroll": typeof lib_payroll;
  "lib/settlement": typeof lib_settlement;
  "lib/staffData": typeof lib_staffData;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  paydays: typeof paydays;
  payments: typeof payments;
  people: typeof people;
  seed: typeof seed;
  setup: typeof setup;
  staff: typeof staff;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
