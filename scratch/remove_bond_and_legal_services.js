const { dbCustomer, dbCustomer2, dbCustomer3, dbAdmin } = require("../firebase");
const admin = require("firebase-admin");

async function main() {
  const dbs = [dbCustomer, dbCustomer2, dbCustomer3, dbAdmin].filter(Boolean);
  const targetServiceIds = ["mqKjbpkKVYS8LCBg3kB9", "nyAKL7mMnGGkTx2Ow9HA"];

  console.log("=== REMOVING BOND & LEGAL PAPER PRINTING SERVICES ===");

  for (const db of dbs) {
    console.log(`\nProcessing DB (${db.projectId || "default"})...`);
    for (const serviceId of targetServiceIds) {
      try {
        const docRef = db.collection("services").doc(serviceId);
        const doc = await docRef.get();
        if (doc.exists) {
          console.log(`Found [${serviceId}] ${doc.data().name || doc.data().serviceName} in DB, marking isDeleted: true and deleting...`);
          await docRef.update({
            isDeleted: true,
            isActive: false,
            deletedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          // Also delete directly so it does not appear in raw collections
          await docRef.delete();
          console.log(`✅ Successfully removed [${serviceId}] from DB (${db.projectId})`);
        } else {
          console.log(`ℹ️ [${serviceId}] does not exist in DB (${db.projectId})`);
        }
      } catch (err) {
        console.error(`❌ Error removing [${serviceId}] in DB (${db.projectId}):`, err.message);
      }
    }

    // Increment serviceVersion
    try {
      const increment = admin.firestore.FieldValue.increment(1);
      await db.collection("shops").doc("serviceVersion").set({
        version: increment,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      await db.collection("app_config").doc("services_version").set({
        version: increment,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log(`🔄 Incremented serviceVersion in DB (${db.projectId})`);
    } catch (err) {
      console.warn(`⚠️ Failed to increment serviceVersion in DB (${db.projectId}):`, err.message);
    }
  }

  console.log("\n=== COMPLETED SERVICE REMOVAL ===");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
