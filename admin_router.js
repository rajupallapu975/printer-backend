/**
 * Dedicated Admin Router for Super Admin Console (Zikrinter) & Shop App (admin_zikrint)
 */

const express = require("express");
const router = express.Router();
const { requireAdminKey } = require("./auth");
const { resolveEnvironment, getShopsCollection, getOrdersCollection, getWithdrawalsCollection } = require("./env_manager");
const { createNewShop, listAllShops, updateShopStatus, getShopAnalytics, deleteShop, deleteAllShops } = require("./shop_service");
const { authenticateShopUser, createOrUpdateShopCredentials } = require("./admin_auth");
const { getAuditLogs, logAuditEvent } = require("./audit_service");
const { admin, dbAdmin } = require("./firebase");

// ============================================================================
// PUBLIC / OPERATOR AUTH ROUTE
// ============================================================================

/**
 * Shop Admin Authentication Endpoint (Used by admin_zikrint)
 */
router.post("/auth/shop-login", async (req, res) => {
  try {
    const { identifier, password, environment } = req.body;
    const result = await authenticateShopUser(identifier, password, environment);
    if (!result.success) {
      return res.status(401).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error("❌ Shop login route error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SUPER ADMIN PRIVILEGED ROUTES (Guarded by requireAdminKey)
// ============================================================================

router.use(requireAdminKey);

/**
 * GET /admin/shops — List all shops with filters
 */
router.get("/shops", async (req, res) => {
  try {
    const { environment, status, search } = req.query;
    const shops = await listAllShops({ environment, status, search });
    res.json({ success: true, count: shops.length, shops });
  } catch (error) {
    console.error("❌ GET /admin/shops error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /admin/shops — Create a new shop & provision credentials
 */
router.post("/shops", async (req, res) => {
  try {
    const result = await createNewShop({
      ...req.body,
      actor: req.headers["x-admin-actor"] || "Super Admin",
    });
    res.json(result);
  } catch (error) {
    console.error("❌ POST /admin/shops error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/shops/:shopId — Get full details of a specific shop
 */
router.get("/shops/:shopId", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { environment } = req.query;
    const env = resolveEnvironment(environment);
    const shopDoc = await getShopsCollection(env).doc(shopId).get();

    if (!shopDoc.exists) {
      return res.status(404).json({ success: false, error: `Shop ${shopId} not found` });
    }

    const shopData = shopDoc.data();
    res.json({ success: true, shop: { id: shopDoc.id, ...shopData } });
  } catch (error) {
    console.error("❌ GET /admin/shops/:shopId error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /admin/shops/:shopId/status — Enable, disable, or suspend a shop
 */
router.post("/shops/:shopId/status", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { status, reason, environment } = req.body;
    const actor = req.headers["x-admin-actor"] || "Super Admin";

    const result = await updateShopStatus(shopId, status, reason, actor, environment);
    res.json(result);
  } catch (error) {
    console.error("❌ POST /admin/shops/:shopId/status error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /admin/shops — Delete ALL shops and all related data (orders, withdrawals, credentials, subcollections)
 */
router.delete("/shops", async (req, res) => {
  try {
    const { environment } = req.query;
    const actor = req.headers["x-admin-actor"] || "Super Admin";
    const result = await deleteAllShops(environment, actor);
    res.json(result);
  } catch (error) {
    console.error("❌ DELETE /admin/shops error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /admin/shops/:shopId — Delete a specific shop and all its related data
 */
router.delete("/shops/:shopId", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { environment } = req.query;
    const actor = req.headers["x-admin-actor"] || "Super Admin";
    const result = await deleteShop(shopId, environment, actor);
    res.json(result);
  } catch (error) {
    console.error("❌ DELETE /admin/shops/:shopId error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/shops/:shopId/orders — List orders scoped strictly to this shop
 */
router.get("/shops/:shopId/orders", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { environment, limit = 50, status } = req.query;
    const env = resolveEnvironment(environment);

    const ordersCol = getShopsCollection(env).doc(shopId).collection("orders");
    let query = ordersCol.orderBy("timestamp", "desc").limit(Number(limit) || 50);

    if (status) {
      query = query.where("orderStatus", "==", status);
    }

    const snap = await query.get();
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    console.error("❌ GET /admin/shops/:shopId/orders error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/shops/:shopId/analytics — Revenue and page count metrics
 */
router.get("/shops/:shopId/analytics", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { period, environment } = req.query;
    const analytics = await getShopAnalytics({
      shopId: shopId === "ALL" ? null : shopId,
      period,
      environment,
    });
    res.json({ success: true, analytics });
  } catch (error) {
    console.error("❌ GET /admin/shops/:shopId/analytics error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/shops/:shopId/wallet — Wallet balance and immutable transaction ledger
 */
router.get("/shops/:shopId/wallet", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { environment, limit = 50 } = req.query;
    const env = resolveEnvironment(environment);

    const shopRef = getShopsCollection(env).doc(shopId);
    const shopDoc = await shopRef.get();

    if (!shopDoc.exists) {
      return res.status(404).json({ success: false, error: "Shop not found" });
    }

    const txSnap = await shopRef
      .collection("transactions")
      .orderBy("timestamp", "desc")
      .limit(Number(limit) || 50)
      .get();

    const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const shopData = shopDoc.data();

    res.json({
      success: true,
      walletBalance: Number(shopData.walletBalance) || 0.0,
      totalBwPages: Number(shopData.totalBwPages) || 0,
      totalColorPages: Number(shopData.totalColorPages) || 0,
      transactions,
    });
  } catch (error) {
    console.error("❌ GET /admin/shops/:shopId/wallet error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/shops/:shopId/qr — Get QR details & standee metadata
 */
router.get("/shops/:shopId/qr", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { environment } = req.query;
    const env = resolveEnvironment(environment);

    const shopDoc = await getShopsCollection(env).doc(shopId).get();
    if (!shopDoc.exists) {
      return res.status(404).json({ success: false, error: "Shop not found" });
    }

    const data = shopDoc.data();
    res.json({
      success: true,
      shopId,
      shopName: data.shopName,
      qrToken: data.qrToken,
      qrPayload: data.qrPayload || `zikrint://shop?id=${shopId}&token=${data.qrToken || ""}`,
    });
  } catch (error) {
    console.error("❌ GET /admin/shops/:shopId/qr error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /admin/shops/:shopId/credentials — Reset operator password
 */
router.put("/shops/:shopId/credentials", async (req, res) => {
  try {
    const { shopId } = req.params;
    const { newPassword, environment, email } = req.body;
    const actor = req.headers["x-admin-actor"] || "Super Admin";

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const result = await createOrUpdateShopCredentials({
      shopId,
      email,
      password: newPassword,
      environment,
      actor,
    });

    res.json(result);
  } catch (error) {
    console.error("❌ PUT /admin/shops/:shopId/credentials error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET & POST /admin/withdrawals — Review & approve/reject shop withdrawals
 */
router.get("/withdrawals", async (req, res) => {
  try {
    const { environment, status = "pending" } = req.query;
    const env = resolveEnvironment(environment);
    const col = getWithdrawalsCollection(env);

    let query = col.orderBy("requestedAt", "desc").limit(50);
    if (status && status !== "all") {
      query = query.where("status", "==", status);
    }

    const snap = await query.get();
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, count: requests.length, requests });
  } catch (error) {
    console.error("❌ GET /admin/withdrawals error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/withdrawals/process", async (req, res) => {
  try {
    const { requestId, action, transactionRef, notes, environment } = req.body; // action: 'approve' | 'reject'
    const actor = req.headers["x-admin-actor"] || "Super Admin";
    const env = resolveEnvironment(environment);

    if (!requestId || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, error: "requestId and valid action (approve/reject) required" });
    }

    const reqRef = getWithdrawalsCollection(env).doc(requestId);
    const reqDoc = await reqRef.get();

    if (!reqDoc.exists) {
      return res.status(404).json({ success: false, error: "Withdrawal request not found" });
    }

    const reqData = reqDoc.data();
    if (reqData.status !== "pending") {
      return res.status(400).json({ success: false, error: `Request already marked as ${reqData.status}` });
    }

    const shopRef = getShopsCollection(env).doc(reqData.shopId);

    await dbAdmin.runTransaction(async (tx) => {
      const liveShopDoc = await tx.get(shopRef);
      if (!liveShopDoc.exists) throw new Error("Target shop does not exist");

      const currentBalance = Number(liveShopDoc.data().walletBalance || 0);

      if (action === "approve") {
        if (currentBalance < reqData.amount) {
          throw new Error(`Insufficient wallet balance (Available: ₹${currentBalance}, Requested: ₹${reqData.amount})`);
        }

        // Deduct from wallet balance
        tx.update(shopRef, {
          walletBalance: currentBalance - reqData.amount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Record debit transaction in shop ledger
        tx.set(shopRef.collection("transactions").doc(), {
          amount: -reqData.amount,
          title: `Withdrawal Payout #${requestId.slice(-6)}`,
          type: "debit",
          transactionRef: transactionRef || "UPI_PAYMENT",
          notes: notes || "",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Mark request as paid
        tx.update(reqRef, {
          status: "paid",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          processedBy: actor,
          transactionRef: transactionRef || null,
          notes: notes || null,
        });
      } else {
        // Mark request as rejected (balance untouched)
        tx.update(reqRef, {
          status: "rejected",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          processedBy: actor,
          rejectionReason: notes || "Rejected by administrator",
        });
      }
    });

    await logAuditEvent({
      actor,
      action: action === "approve" ? "WITHDRAWAL_APPROVED" : "WITHDRAWAL_REJECTED",
      shopId: reqData.shopId,
      details: { requestId, amount: reqData.amount, transactionRef, notes },
      environment: env,
    });

    res.json({ success: true, message: `Withdrawal request successfully ${action}d.` });
  } catch (error) {
    console.error("❌ POST /admin/withdrawals/process error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/audit-log — Retrieve audit log trail
 */
router.get("/audit-log", async (req, res) => {
  try {
    const { shopId, environment, limit } = req.query;
    const logs = await getAuditLogs({ shopId, environment, limit });
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    console.error("❌ GET /admin/audit-log error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
