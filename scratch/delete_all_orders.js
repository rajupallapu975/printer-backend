const { dbCustomer, dbCustomer2, dbCustomer3, dbAdmin } = require("../firebase");

async function deleteCollection(db, collectionName, dbLabel) {
  if (!db) {
    console.log(`⚠️ Skipping ${dbLabel} - Database not initialized`);
    return 0;
  }

  try {
    const snapshot = await db.collection(collectionName).get();
    if (snapshot.empty) {
      console.log(`ℹ️ [${dbLabel}] ${collectionName}: 0 orders to delete.`);
      return 0;
    }

    console.log(`🗑️ [${dbLabel}] Deleting ${snapshot.size} documents in '${collectionName}'...`);
    const batchSize = 400;
    let deletedCount = 0;

    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      const chunk = snapshot.docs.slice(i, i + batchSize);
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deletedCount += chunk.length;
    }

    console.log(`✅ [${dbLabel}] ${collectionName}: Successfully deleted ${deletedCount} documents.`);
    return deletedCount;
  } catch (e) {
    console.error(`❌ [${dbLabel}] Error deleting '${collectionName}':`, e.message);
    return 0;
  }
}

async function deleteAllOrders() {
  console.log("\n=======================================================");
  console.log("🚀 STARTING COMPLETE DELETION OF ALL EXISTING ORDERS...");
  console.log("=======================================================\n");

  let totalDeleted = 0;

  const dbs = [
    { db: dbCustomer, name: "Customer DB 1 (psfc-43b5a)" },
    { db: dbCustomer2, name: "Customer DB 2 (zikrint-944a4)" },
    { db: dbCustomer3, name: "Customer DB 3 (think-ink)" },
    { db: dbAdmin, name: "Admin DB" },
  ];

  for (const { db, name } of dbs) {
    totalDeleted += await deleteCollection(db, "orders", name);
    totalDeleted += await deleteCollection(db, "xerox_orders", name);
  }

  // Also clean up print_jobs subcollections in shops if any
  if (dbAdmin) {
    try {
      const shopsSnap = await dbAdmin.collection("shops").get();
      for (const shopDoc of shopsSnap.docs) {
        const printersSnap = await shopDoc.ref.collection("printers").get();
        for (const printerDoc of printersSnap.docs) {
          totalDeleted += await deleteCollection(dbAdmin, `shops/${shopDoc.id}/printers/${printerDoc.id}/print_jobs`, `Admin Shop Printer (${printerDoc.id})`);
        }
      }
    } catch (e) {
      console.error("⚠️ Error cleaning printer subcollections:", e.message);
    }
  }

  console.log("\n=======================================================");
  console.log(`🎉 DELETION COMPLETE! Total order documents deleted: ${totalDeleted}`);
  console.log("=======================================================\n");
  process.exit(0);
}

deleteAllOrders();
