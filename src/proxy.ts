import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/**
 * Runs before every page. Sends signed-out visitors to /signin, and signed-in
 * people away from /signin. This is only for convenience: every permission is
 * checked again by the Convex backend.
 */
const isSignInPage = createRouteMatcher(["/signin"]);
const isDesignPage = createRouteMatcher(["/design"]);

export const proxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const signedIn = await convexAuth.isAuthenticated();
  if (isSignInPage(request)) {
    return signedIn ? nextjsMiddlewareRedirect(request, "/") : undefined;
  }
  // The design reference is open without login only on a developer's machine.
  if (isDesignPage(request) && process.env.NODE_ENV === "development") return undefined;
  if (!signedIn) return nextjsMiddlewareRedirect(request, "/signin");
});

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
