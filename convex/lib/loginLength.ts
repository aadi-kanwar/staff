/**
 * How long a login lasts: members sign in once a week. The login stays on
 * the phone even when the app is closed, and ends 7 days after signing in.
 * (Admin Hub logins keep their own 12 hours: see lib/ssoTicket.ts.)
 */
export const LOGIN_DAYS = 7;
export const LOGIN_MS = LOGIN_DAYS * 24 * 60 * 60 * 1000;
