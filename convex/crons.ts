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

export default crons;
