"use client";

import { useMutation } from "convex/react";
import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { useQuery } from "@/lib/convex";

type Support = "checking" | "unsupported" | "needs-home-screen" | "supported";

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function detectSupport(): Support {
  if (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
    return "supported";
  return isIos() && !isStandalone() ? "needs-home-screen" : "unsupported";
}
const noSubscription = () => () => {};

/** This browser's notification state, and turning notifications on or off. */
export function usePhoneNotifications() {
  const detected = useSyncExternalStore(
    noSubscription,
    detectSupport,
    (): Support => "checking",
  );
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const support: Support = failed ? "unsupported" : detected;
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const key = useQuery(api.notifications.publicKey, {});
  const subscribed = useQuery(
    api.notifications.isSubscribed,
    endpoint === null ? "skip" : { endpoint },
  );
  const subscribe = useMutation(api.notifications.subscribe);
  const unsubscribe = useMutation(api.notifications.unsubscribe);

  useEffect(() => {
    if (detected !== "supported") return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        setPermission(Notification.permission);
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        setEndpoint(sub?.endpoint ?? null);
        setReady(true);
      })
      .catch(() => setFailed(true));
  }, [detected]);

  /**
   * Turns notifications on for this device. `quiet`: only if notifications are
   * already allowed (no permission question, no messages), e.g. after
   * signing in again on a phone that had them on.
   */
  const turnOn = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!key?.publicKey) {
        if (!quiet)
          toast.error("Notifications aren't set up on the server yet.");
        return;
      }
      if (quiet && Notification.permission !== "granted") return;
      setBusy(true);
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== "granted") return;
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(key.publicKey),
          }));
        const json = sub.toJSON();
        await subscribe({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        });
        setEndpoint(sub.endpoint);
        if (!quiet) toast.success("Notifications are on for this phone.");
      } catch (error) {
        if (!quiet) toast.error(friendlyError(error));
      } finally {
        setBusy(false);
      }
    },
    [key, subscribe],
  );

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub !== null) {
        await unsubscribe({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      toast.success("Notifications are off for this phone.");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }, [unsubscribe]);

  const on =
    support === "supported" && permission === "granted" && subscribed === true;
  const loading =
    support === "checking" ||
    (support === "supported" &&
      (!ready ||
        key === undefined ||
        (endpoint !== null && subscribed === undefined)));
  return { support, permission, on, loading, busy, turnOn, turnOff };
}

/** What each kind of account is notified about (shown in the prompt and the card). */
export function notificationPurpose(
  role: "admin" | "staff",
  canMarkAttendance: boolean,
): string {
  if (role === "admin")
    return "A notification for each person whose salary is due that day.";
  return canMarkAttendance
    ? "A notification when a payment to you is recorded, and a reminder when attendance at your property isn't marked yet."
    : "A notification when a payment to you is recorded.";
}

/** Settings / Profile card: turn notifications on or off for this device. */
export function PhoneNotificationsCard({ purpose }: { purpose: string }) {
  const r = usePhoneNotifications();
  if (r.support === "checking" || r.loading) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Icon
          icon={r.on ? Bell : BellOff}
          className="mt-0.5 text-foreground-secondary"
        />
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="font-medium">Phone notifications</h2>
          <p className="text-sm text-foreground-secondary">
            {r.support === "needs-home-screen"
              ? "On iPhone, first add Staff to your Home Screen: tap Share, then “Add to Home Screen”. Open Staff from there and turn notifications on."
              : r.support === "unsupported"
                ? "This browser can't show notifications. Try Chrome on Android, or Staff added to the Home Screen on iPhone."
                : r.permission === "denied"
                  ? "Notifications are blocked for Staff. Allow them in your browser or phone settings, then come back."
                  : r.on
                    ? `On for this phone. ${purpose}`
                    : purpose}
          </p>
        </div>
      </div>
      {r.support === "supported" && r.permission !== "denied" ? (
        r.on ? (
          <Button variant="secondary" onClick={r.turnOff} disabled={r.busy}>
            Turn off notifications
          </Button>
        ) : (
          <Button onClick={() => r.turnOn()} disabled={r.busy}>
            <Icon icon={Bell} />
            Turn on notifications
          </Button>
        )
      ) : null}
    </Card>
  );
}
