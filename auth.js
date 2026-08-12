const crypto = require("crypto");

/**
 * Authentication guards.
 *
 * Phase 0 ships requireAdminKey only. requireUser / requireShop (Firebase ID token
 * verification) land in Phase 1 alongside the coordinated client release that starts
 * sending Authorization headers — adding them here before the clients send tokens
 * would return 401 to every user in the field.
 *
 * The shared admin key is an interim measure. Phase 6.10 replaces it with per-operator
 * Firebase identities carrying a role claim, so that access is attributable and
 * revoking one operator does not require rotating a secret for everyone.
 */

/**
 * Server-to-server / owner console guard.
 *
 * Fails closed when ADMIN_API_KEY is unset: an unconfigured deployment must not expose
 * money-moving routes, and a 403 with an explicit reason is easier to diagnose than a
 * route that silently disappeared.
 */
function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    console.error("❌ ADMIN_API_KEY is not configured; refusing privileged request to " + req.path);
    return res.status(503).json({
      error: "Administrative endpoints are disabled: ADMIN_API_KEY is not configured on this server.",
    });
  }

  const provided = req.headers["x-admin-key"];
  // Compare in constant time. Length is checked first because timingSafeEqual throws
  // on buffers of differing length.
  const valid =
    typeof provided === "string" &&
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

  if (!valid) {
    console.warn(`⚠️ Rejected privileged request to ${req.path} (bad or missing x-admin-key)`);
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

module.exports = { requireAdminKey };
