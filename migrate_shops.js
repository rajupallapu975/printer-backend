/**
 * Migration Script — Ensure all existing shops have a permanent shopId and credentials
 */

require("dotenv").config();
const { dbAdmin, admin } = require("./firebase");
const { createOrUpdateShopCredentials } = require("./admin_auth");

async function migrateShops() {
  console.log("🚀 Starting shop migration...");
  const snapshot = await dbAdmin.collection("shops").get();
  console.log(`Found ${snapshot.size} shop documents to inspect.`);

  let migratedCount = 0;
  for (const doc of snapshot.docs) {
    if (doc.id === "serviceVersion") continue;
    const data = doc.data();
    const docId = doc.id;

    const isTest = docId.includes("TEST") || docId === "reviewer_shop_store" || data.isTestShop === true;
    const environment = isTest ? "test" : "production";
    const shopId = data.shopId || docId;

    const updates = {};
    if (!data.shopId) updates.shopId = shopId;
    if (!data.environment) updates.environment = environment;
    if (!data.platformStatus) updates.platformStatus = "active";
    if (typeof data.walletBalance !== "number") updates.walletBalance = 0.0;
    if (typeof data.totalBwPages !== "number") updates.totalBwPages = 0;
    if (typeof data.totalColorPages !== "number") updates.totalColorPages = 0;

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await doc.ref.set(updates, { merge: true });
      console.log(`✅ Updated shop document: ${docId} with ${JSON.stringify(updates)}`);
      migratedCount++;
    }

    // Ensure credentials exist for the shop
    try {
      const userDoc = await doc.ref.collection("users").doc("admin_user").get();
      if (!userDoc.exists) {
        const defaultPassword = `Zikrint@${shopId.replace(/[^0-9]/g, "") || "2026"}`;
        await createOrUpdateShopCredentials({
          shopId,
          email: data.email || `${shopId.toLowerCase()}@zikrint.shop`,
          username: shopId.toLowerCase(),
          password: defaultPassword,
          displayName: data.shopName || data.ownerName || "Shop Operator",
          environment,
          actor: "Migration Script",
        });
        console.log(`🔑 Generated credentials for shop ${shopId} (User: ${shopId.toLowerCase()}, Pass: ${defaultPassword})`);
      }
    } catch (err) {
      console.warn(`⚠️ Credential setup skipped for ${shopId}:`, err.message);
    }
  }

  console.log(`🎉 Shop migration completed. Migrated: ${migratedCount} shops.`);
}

if (require.main === module) {
  migrateShops()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration error:", err);
      process.exit(1);
    });
}

module.exports = { migrateShops };
