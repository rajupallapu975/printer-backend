const { dbCustomer: db, dbCustomer2, dbCustomer3, dbAdmin } = require("../firebase");

async function purgeAllTestOrders() {
  console.log("🧹 Purging ALL reviewer & test orders from Customer DBs and Admin Shop DBs...\n");

  const customerDbs = [
    { name: "Customer DB - Project 1 (psfc-43b5a)", handle: db },
    { name: "Customer DB - Project 2 (zikrint-944a4)", handle: dbCustomer2 },
    { name: "Customer DB - Project 3 (think-ink)", handle: dbCustomer3 },
  ];

  let totalCustomerDeleted = 0;
  let totalAdminDeleted = 0;

  // Helper to check if string contains reviewer or test keyword
  const isTestOrReviewer = (str) => {
    if (!str || typeof str !== 'string') return false;
    const lower = str.toLowerCase();
    return lower.includes('reviewer') || lower.includes('test_user') || lower.includes('reviewer_user');
  };

  // 1. Purge from Customer Databases
  for (const target of customerDbs) {
    if (!target.handle) continue;
    try {
      const snap = await target.handle.collection("xerox_orders").get();
      let dbDeleted = 0;
      for (const doc of snap.docs) {
        const data = doc.data() || {};
        const match = isTestOrReviewer(doc.id) ||
                      isTestOrReviewer(data.userEmail) ||
                      isTestOrReviewer(data.customerName) ||
                      isTestOrReviewer(data.userId) ||
                      isTestOrReviewer(data.customId) ||
                      isTestOrReviewer(data.orderCode);
        if (match) {
          await doc.ref.delete();
          console.log(`  ❌ Deleted customer order [${doc.id}] (${data.customerName || data.userEmail}) from ${target.name}`);
          dbDeleted++;
        }
      }
      console.log(`✅ ${target.name}: Purged ${dbDeleted} test orders.\n`);
      totalCustomerDeleted += dbDeleted;
    } catch (err) {
      console.error(`⚠️ Error purging from ${target.name}:`, err.message);
    }
  }

  // 2. Purge from Admin Shop Databases (shops/{shopId}/orders and shops/{shopId}/history)
  if (dbAdmin) {
    try {
      console.log("🏪 Scanning Admin Shops collection for test orders...");
      const shopsSnap = await dbAdmin.collection("shops").get();
      
      for (const shopDoc of shopsSnap.docs) {
        const shopId = shopDoc.id;
        
        // Check shops/{shopId}/orders
        const ordersSnap = await dbAdmin.collection("shops").doc(shopId).collection("orders").get();
        for (const doc of ordersSnap.docs) {
          const data = doc.data() || {};
          const match = isTestOrReviewer(doc.id) ||
                        isTestOrReviewer(data.userEmail) ||
                        isTestOrReviewer(data.customerName) ||
                        isTestOrReviewer(data.userId) ||
                        isTestOrReviewer(data.customId) ||
                        isTestOrReviewer(data.orderCode);
          if (match) {
            await doc.ref.delete();
            console.log(`  ❌ Deleted shop order [${doc.id}] (${data.customerName || data.userEmail}) from shop ${shopId}/orders`);
            totalAdminDeleted++;
          }
        }

        // Check shops/{shopId}/history
        const historySnap = await dbAdmin.collection("shops").doc(shopId).collection("history").get();
        for (const doc of historySnap.docs) {
          const data = doc.data() || {};
          const match = isTestOrReviewer(doc.id) ||
                        isTestOrReviewer(data.userEmail) ||
                        isTestOrReviewer(data.customerName) ||
                        isTestOrReviewer(data.userId) ||
                        isTestOrReviewer(data.customId) ||
                        isTestOrReviewer(data.orderCode);
          if (match) {
            await doc.ref.delete();
            console.log(`  ❌ Deleted shop history order [${doc.id}] (${data.customerName || data.userEmail}) from shop ${shopId}/history`);
            totalAdminDeleted++;
          }
        }
      }
      console.log(`✅ Admin DB: Purged ${totalAdminDeleted} test orders across all shops.\n`);
    } catch (err) {
      console.error("⚠️ Error purging from Admin DB:", err.message);
    }
  }

  console.log("==========================================");
  console.log(`🎉 PURGE COMPLETE!`);
  console.log(`   Customer Orders Deleted: ${totalCustomerDeleted}`);
  console.log(`   Admin Shop Orders Deleted: ${totalAdminDeleted}`);
  console.log("==========================================");
  process.exit(0);
}

purgeAllTestOrders();
