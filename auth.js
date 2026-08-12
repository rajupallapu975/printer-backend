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

/**
 * Optional Firebase Token Verification
 * Parses Bearer token if present without throwing 401 if missing.
 */
async function optionalFirebaseToken(req, res, next) {
  req.user = null;
  req.isReviewer = false;

  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split("Bearer ")[1].trim();
  if (!token) return next();

  try {
    const { admin } = require("./firebase");
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    req.isReviewer = decodedToken.email && decodedToken.email.toLowerCase() === "reviewer@zikrint.app";
    console.log(`🔐 Token verified for user: ${decodedToken.email || decodedToken.uid} (Reviewer: ${req.isReviewer})`);
  } catch (err) {
    console.warn(`⚠️ Optional Firebase Token verification failed: ${err.message}`);
  }
  next();
}

/**
 * Strict Firebase Token Verification
 * Requires valid Bearer ID token.
 */
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Unauthorized: Missing Authorization Bearer token" });
  }

  const token = authHeader.split("Bearer ")[1].trim();
  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized: Empty token" });
  }

  try {
    const { admin } = require("./firebase");
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    req.isReviewer = decodedToken.email && decodedToken.email.toLowerCase() === "reviewer@zikrint.app";
    console.log(`🔐 Token verified for user: ${decodedToken.email || decodedToken.uid} (Reviewer: ${req.isReviewer})`);
    next();
  } catch (err) {
    console.warn(`❌ Firebase Token verification error: ${err.message}`);
    return res.status(401).json({ success: false, error: `Unauthorized: Invalid or expired token (${err.message})` });
  }
}

module.exports = { requireAdminKey, verifyFirebaseToken, optionalFirebaseToken };

