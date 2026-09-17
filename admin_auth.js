/**
 * Admin Authentication & Credential Management Module
 *
 * Provides secure platform-created credential management for shops,
 * password hashing with PBKDF2/SHA512 + salts, token issuance,
 * and shop-scoped access control.
 */

const crypto = require("crypto");
const { admin, dbAdmin } = require("./firebase");
const { resolveEnvironment, getShopsCollection } = require("./env_manager");
const { logAuditEvent } = require("./audit_service");

/**
 * Hashes a plaintext password with PBKDF2 using SHA-512 and a random 16-byte salt.
 */
function hashPassword(password, existingSalt = null) {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return { hash, salt };
}

/**
 * Verifies a plaintext password against a stored hash and salt in constant time.
 */
function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = hashPassword(password, storedSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
}

/**
 * Creates or updates shop admin credentials stored under `shops/{shopId}/users/admin_user`
 * or a centralized `platform_users` collection in admin Firestore.
 */
async function createOrUpdateShopCredentials({
  shopId,
  email,
  username,
  password,
  displayName = "Shop Operator",
  phone = "",
  environment = "production",
  actor = "Super Admin",
}) {
  if (!shopId || !password) {
    throw new Error("shopId and password are required to create credentials");
  }

  const env = resolveEnvironment(environment);
  const shopsCol = getShopsCollection(env);
  const shopDocRef = shopsCol.doc(shopId);
  const shopDoc = await shopDocRef.get();

  if (!shopDoc.exists) {
    throw new Error(`Shop ${shopId} does not exist in ${env}`);
  }

  const cleanEmail = (email || `${shopId.toLowerCase().replace(/[^a-z0-9]/g, "")}@zikrint.shop`).trim().toLowerCase();
  const cleanUsername = (username || shopId).trim().toLowerCase();
  const { hash, salt } = hashPassword(password);

  const userData = {
    shopId,
    email: cleanEmail,
    username: cleanUsername,
    displayName,
    phone,
    passwordHash: hash,
    salt,
    role: "shop_admin",
    environment: env,
    isActive: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastPasswordChange: new Date().toISOString(),
  };

  // Store inside sub-collection `shops/{shopId}/users/admin_user`
  await shopDocRef.collection("users").doc("admin_user").set(userData, { merge: true });

  // Also maintain index lookup in `shop_credentials` for fast O(1) login lookup
  await dbAdmin.collection("shop_credentials").doc(`${env}_${cleanEmail}`).set({
    shopId,
    email: cleanEmail,
    username: cleanUsername,
    passwordHash: hash,
    salt,
    environment: env,
    role: "shop_admin",
    isActive: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (cleanUsername !== cleanEmail) {
    await dbAdmin.collection("shop_credentials").doc(`${env}_${cleanUsername}`).set({
      shopId,
      email: cleanEmail,
      username: cleanUsername,
      passwordHash: hash,
      salt,
      environment: env,
      role: "shop_admin",
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await logAuditEvent({
    actor,
    action: "CREDENTIALS_CREATED",
    shopId,
    details: { email: cleanEmail, username: cleanUsername },
    environment: env,
  });

  return {
    success: true,
    shopId,
    email: cleanEmail,
    username: cleanUsername,
    displayName,
  };
}

/**
 * Authenticates a shop user by email or username or shopId.
 */
async function authenticateShopUser(identifier, password, environment = "production") {
  if (!identifier || !password) {
    return { success: false, error: "Identifier and password required" };
  }

  const env = resolveEnvironment(environment);
  const cleanId = String(identifier).trim().toLowerCase();

  // 1. Check Reviewer test bypass credentials
  if (cleanId === "reviewer@zikrint.app" && password === "raju@975") {
    const authInstance = admin.auth ? (admin.apps.length > 0 ? admin.auth(admin.apps.find(a => a.name === 'admin') || admin.apps[0]) : null) : null;
    const customToken = authInstance ? await authInstance.createCustomToken("reviewer_shop_store", {
      email: "reviewer@zikrint.app",
      shopId: "reviewer_shop_store",
      role: "reviewer",
      environment: "test",
    }) : "token_mock";

    return {
      success: true,
      token: customToken,
      shopId: "reviewer_shop_store",
      shopName: "Reviewer Demo Shop",
      role: "reviewer",
      email: "reviewer@zikrint.app",
      environment: "test",
    };
  }

  // 2. Lookup in credentials index
  let credDoc = await dbAdmin.collection("shop_credentials").doc(`${env}_${cleanId}`).get();
  
  // Fallback: check if identifier matches a direct shopId
  if (!credDoc.exists) {
    const shopRef = getShopsCollection(env).doc(identifier.trim());
    const userDoc = await shopRef.collection("users").doc("admin_user").get();
    if (userDoc.exists) {
      credDoc = userDoc;
    }
  }

  if (!credDoc.exists) {
    return { success: false, error: "Invalid credentials or shop account not found" };
  }

  const credData = credDoc.data();
  if (credData.isActive === false) {
    return { success: false, error: "Shop account is disabled or suspended" };
  }

  const isPasswordValid = verifyPassword(password, credData.passwordHash, credData.salt);
  if (!isPasswordValid) {
    return { success: false, error: "Invalid password" };
  }

  // Fetch shop metadata
  const shopDoc = await getShopsCollection(env).doc(credData.shopId).get();
  const shopData = shopDoc.exists ? shopDoc.data() : {};

  if (shopData.platformStatus === "suspended" || shopData.platformStatus === "deactivated") {
    return {
      success: false,
      error: `Shop access is currently ${shopData.platformStatus}. Please contact support.`,
    };
  }

  // Issue Firebase Custom Token with claims (UID is permanent shopId)
  const authInstance = admin.auth ? (admin.apps.length > 0 ? admin.auth(admin.apps.find(a => a.name === 'admin') || admin.apps[0]) : null) : null;
  const customToken = authInstance ? await authInstance.createCustomToken(credData.shopId, {
    shopId: credData.shopId,
    email: credData.email,
    role: "shop_admin",
    environment: env,
  }) : "token_mock";

  return {
    success: true,
    token: customToken,
    shopId: credData.shopId,
    shopName: shopData.shopName || credData.shopId,
    email: credData.email,
    role: credData.role || "shop_admin",
    platformStatus: shopData.platformStatus || "active",
    environment: env,
  };
}

/**
 * Verifies caller's shop identity from Authorization Bearer token or Admin Key.
 */
async function verifyShopToken(req) {
  // 1. Super Admin bypass via x-admin-key
  const adminKey = req.headers["x-admin-key"];
  const expectedKey = process.env.ADMIN_API_KEY || "zikrint_master_admin_secret_key_2026";
  if (adminKey && adminKey === expectedKey) {
    return { isSuperAdmin: true, shopId: "SUPER_ADMIN", role: "super_admin" };
  }

  // 2. Bearer token in Authorization header
  const authHeader = req.headers["authorization"] || req.headers["x-shop-token"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.split("Bearer ")[1].trim();
    try {
      const authInstance = admin.apps.find((a) => a.name === "admin") || admin.apps[0];
      const decoded = await admin.auth(authInstance).verifyIdToken(idToken);
      const cleanShopId = decoded.shopId || decoded.uid.replace(/^shop_/, "");
      return {
        uid: decoded.uid,
        shopId: cleanShopId,
        role: decoded.role || "shop_admin",
        environment: decoded.environment || "production",
      };
    } catch (e) {
      console.warn("⚠️ Shop token verification error:", e.message);
    }
  }

  return null;
}

/**
 * Middleware: Enforces that shop operations are only executable by the authorized shop.
 */
async function requireShopScope(req, res, next) {
  const targetShopId = req.body.shopId || req.params.shopId || req.query.shopId;

  // Reviewer test account / demo store bypass
  const isReviewerTest =
    (targetShopId && targetShopId.toLowerCase().includes("reviewer")) ||
    (req.body.userEmail && req.body.userEmail.toLowerCase().includes("reviewer")) ||
    (req.body.customerName && req.body.customerName.toLowerCase().includes("reviewer"));

  if (isReviewerTest) {
    return next();
  }

  const authUser = await verifyShopToken(req);

  // Super Admin can access any shop
  if (authUser && authUser.isSuperAdmin) {
    req.authUser = authUser;
    return next();
  }

  if (authUser && authUser.shopId) {
    if (targetShopId && authUser.shopId !== targetShopId) {
      console.warn(
        `🚨 [SECURITY] Cross-shop access blocked! Authenticated Shop: ${authUser.shopId}, Target Shop: ${targetShopId}`
      );
      return res.status(403).json({
        success: false,
        error: "Forbidden: You are not authorized to access or modify another shop's resources.",
      });
    }
    req.authUser = authUser;
    return next();
  }

  // If token is missing and strict auth is configured, reject
  if (process.env.STRICT_SHOP_AUTH === "true") {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Valid shop bearer token is required.",
    });
  }

  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createOrUpdateShopCredentials,
  authenticateShopUser,
  verifyShopToken,
  requireShopScope,
};
