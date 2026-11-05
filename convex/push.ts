"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./lib/functions";

/**
 * Sends notifications through Web Push, signed with the VAPID keys on the
 * Convex deployment (created by scripts/vercel-build.mjs). Each message goes
 * to its own devices; devices that no longer exist are removed.
 */
export const send = internalAction({
  args: {
    messages: v.array(
      v.object({
        devices: v.array(
          v.object({
            subscriptionId: v.id("pushSubscriptions"),
            endpoint: v.string(),
            p256dh: v.string(),
            auth: v.string(),
          }),
        ),
        title: v.string(),
        body: v.string(),
        url: v.string(),
        /** Notifications with the same tag replace each other on a phone. */
        tag: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      console.error(
        "Notifications not sent: VAPID keys are missing on this deployment.",
      );
      return { delivered: 0, removed: 0 };
    }
    webpush.setVapidDetails(
      process.env.SITE_URL ?? "https://stafflivoza.vercel.app",
      publicKey,
      privateKey,
    );
    const gone = new Set<Id<"pushSubscriptions">>();
    let delivered = 0;
    await Promise.all(
      args.messages.flatMap((message) =>
        message.devices.map(async (device) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: device.endpoint,
                keys: { p256dh: device.p256dh, auth: device.auth },
              },
              JSON.stringify({
                title: message.title,
                body: message.body,
                url: message.url,
                tag: message.tag,
              }),
              { TTL: 12 * 60 * 60 },
            );
            delivered += 1;
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410)
              gone.add(device.subscriptionId);
            else
              console.error(
                "Notification failed for one device",
                status ?? error,
              );
          }
        }),
      ),
    );
    if (gone.size > 0)
      await ctx.runMutation(internal.notifications.removeSubscriptions, {
        ids: [...gone],
      });
    return { delivered, removed: gone.size };
  },
});
