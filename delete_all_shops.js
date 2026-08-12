const { dbCustomer, dbCustomer2, dbCustomer3, dbAdmin } = require("./firebase");

async function deleteSubcollection(docRef, subcollectionName) {
  const subRef = docRef.collection(subcollectionName);
  const snap = await subRef.get();
  for (const subDoc of snap.docs) {
    // Recursively handle any nested subcollections under subDoc if any
    const nestedSubs = await subDoc.ref.listCollections();
    for (const nested of nestedSubs) {
      await deleteSubcollection(subDoc.ref, nested.id);
    }
    await subDoc.ref.delete();
  }
}

async function deleteAllShopsAndRelatedData() {
  console.log("=================================================");
  console.log("🔥 STARTING DELETION OF ALL SHOPS & RELATED DATA");
  console.log("=================================================\n");

  const shopIdsDeleted = [];

  // 1. Delete Shops & Subcollections from dbAdmin
  try {
    const shopsSnap = await dbAdmin.collection("shops").get();
    console.log(`Found ${shopsSnap.size} document(s) in dbAdmin/shops.`);

    for (const doc of shopsSnap.docs) {
      if (doc.id === "serviceVersion") {
        console.log(` Skipping system metadata doc: ${doc.id}`);
        continue;
      }

      console.log(`\nDeleting shop '${doc.id}' (${doc.data().shopName || "Unnamed"})...`);

      // List & delete all subcollections
      const subcollections = await doc.ref.listCollections();
      for (const sub of subcollections) {
        console.log(`  - Deleting subcollection '${sub.id}'...`);
        await deleteSubcollection(doc.ref, sub.id);
      }

      // Delete main shop doc
      await doc.ref.delete();
      console.log(`  ✅ Deleted shop document: ${doc.id}`);
      shopIdsDeleted.push(doc.id);
    }
  } catch (err) {
    console.error("❌ Error deleting shops from dbAdmin:", err.message);
  }

  // Also check dbCustomer for shop docs (just in case)
  try {
    const custShopsSnap = await dbCustomer.collection("shops").get();
    for (const doc of custShopsSnap.docs) {
      if (doc.id === "serviceVersion") continue;
      console.log(`Deleting shop '${doc.id}' from dbCustomer...`);
      const subcollections = await doc.ref.listCollections();
      for (const sub of subcollections) {
        await deleteSubcollection(doc.ref, sub.id);
      }
      await doc.ref.delete();
      if (!shopIdsDeleted.includes(doc.id)) shopIdsDeleted.push(doc.id);
    }
  } catch (err) {
    console.error("❌ Error checking dbCustomer shops:", err.message);
  }

  console.log(`\nShops targeted for cleanup: [${shopIdsDeleted.join(", ")}]`);

  // 2. Delete related withdrawal_requests in dbAdmin & dbCustomer
  const dbs = [
    { name: "dbAdmin", db: dbAdmin },
    { name: "dbCustomer", db: dbCustomer },
    { name: "dbCustomer2", db: dbCustomer2 },
    { name: "dbCustomer3", db: dbCustomer3 }
  ];

  console.log("\nDeleting related withdrawal_requests...");
  for (const { name, db } of dbs) {
    if (!db) continue;
    try {
      const reqSnap = await db.collection("withdrawal_requests").get();
      for (const doc of reqSnap.docs) {
        const data = doc.data();
        if (!data.shopId || shopIdsDeleted.includes(data.shopId) || true) {
          // Delete all withdrawal requests since all shops are deleted
          await doc.ref.delete();
          console.log(`  ✅ Deleted withdrawal_request ${doc.id} from ${name}`);
        }
      }
    } catch (err) {
      console.error(`❌ Error deleting withdrawal_requests from ${name}:`, err.message);
    }
  }

  // 3. Delete related xerox_orders linked to deleted shops
  console.log("\nDeleting related xerox_orders...");
  for (const { name, db } of dbs) {
    if (!db) continue;
    try {
      const ordersSnap = await db.collection("xerox_orders").get();
      for (const doc of ordersSnap.docs) {
        const data = doc.data();
        const sId = data.shopId || data.vendorId;
        if (!sId || shopIdsDeleted.includes(sId)) {
          await doc.ref.delete();
          console.log(`  ✅ Deleted xerox_order ${doc.id} (shop: ${sId}) from ${name}`);
        }
      }
    } catch (err) {
      console.error(`❌ Error deleting xerox_orders from ${name}:`, err.message);
    }
  }

  console.log("\n=================================================");
  console.log("🎉 ALL SHOPS AND RELATED DATA DELETION COMPLETE");
  console.log("=================================================");
  process.exit(0);
}

deleteAllShopsAndRelatedData().catch((err) => {
  console.error("❌ Fatal error during shop deletion:", err);
  process.exit(1);
});
