import {
  CalendarCheck,
  CalendarDays,
  House,
  IndianRupee,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** In the phone's bottom bar (default true), or under its "More" tab (false). The sidebar shows everything. */
  mobile?: boolean;
};

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/admin/staff", label: "Staff", icon: Users },
  { href: "/admin/payroll", label: "Payroll", icon: IndianRupee },
  { href: "/admin/settings", label: "Settings", icon: Settings, mobile: false },
];

/** Staff screens (bottom bar on every screen size). */
export const STAFF_NAV: NavItem[] = [
  { href: "/me", label: "Home", icon: House },
  { href: "/me/attendance", label: "Attendance", icon: CalendarDays },
  { href: "/me/payments", label: "Payments", icon: Wallet },
  { href: "/me/profile", label: "Profile", icon: UserRound },
];
