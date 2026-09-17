/**
 * Audit & Activity Logging Service
 *
 * Records tamper-evident chronological logs of all administrative actions.
 */

const { admin } = require("./firebase");
const { getAuditLogsCollection, resolveEnvironment } = require("./env_manager");

async function logAuditEvent({
  actor = "Super Admin",
  action,
  shopId = null,
  orderId = null,
  details = {},
  beforeState = null,
  afterState = null,
  ip = null,
  environment = "production",
}) {
  try {
    const env = resolveEnvironment(environment);
    const auditCol = getAuditLogsCollection(env);
    const logDoc = auditCol.doc();

    const logEntry = {
      logId: logDoc.id,
      actor,
      action,
      shopId: shopId || null,
      orderId: orderId || null,
      details: typeof details === "object" ? details : { raw: details },
      beforeState: beforeState || null,
      afterState: afterState || null,
      ip: ip || null,
      environment: env,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    };

    await logDoc.set(logEntry);
    console.log(`📝 [AUDIT] ${action} logged for Shop: ${shopId || "ALL"} by ${actor}`);
    return logEntry;
  } catch (error) {
    console.error("❌ Failed to record audit log:", error);
    // Audit log failures should not crash business operations, but should log prominently
    return null;
  }
}

async function getAuditLogs({ shopId = null, environment = "production", limit = 50 }) {
  try {
    const env = resolveEnvironment(environment);
    const auditCol = getAuditLogsCollection(env);
    let query = auditCol.orderBy("timestamp", "desc").limit(Number(limit) || 50);

    if (shopId) {
      query = query.where("shopId", "==", shopId);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data());
  } catch (error) {
    console.error("❌ Failed to query audit logs:", error);
    return [];
  }
}

module.exports = {
  logAuditEvent,
  getAuditLogs,
};
