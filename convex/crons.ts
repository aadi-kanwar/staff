import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 5 minutes, send the payday (admins) and attendance (markers)
// notifications whose time, set in Settings → Notifications, has come.
// Each goes out at most once per organisation, day and time.
crons.interval(
  "send due notifications",
  { minutes: 5 },
  internal.notifications.sendDue,
  {},
);

// Every 5 minutes, forget Admin Hub sign-in tickets used more than 10
// minutes ago (they expire after 60 seconds, so they can't be reused anyway).
crons.interval("forget used admin hub tickets", { minutes: 5 }, internal.sso.deleteOldTickets, {});

export default crons;
