require('dotenv').config();
const { dbCustomer: db, dbCustomer2, dbCustomer3, dbAdmin } = require("../firebase");
const { deleteOrderFilesFromCloudinary } = require("../cleanup");

async function deleteAllActiveDeliveries() {
  console.log("\n=======================================================");
  console.log("🚀 STARTING PURGE OF ALL ACTIVE DELIVERIES & ORDERS...");
  console.log("=======================================================\n");

  const customerDbs = [
    { name: "Customer DB 1 (psfc-43b5a)", handle: db },
    { name: "Customer DB 2 (zikrint-944a4)", handle: dbCustomer2 },
    { name: "Customer DB 3 (think-ink)", handle: dbCustomer3 },
  ];

  let totalCustomerDeleted = 0;
  let totalAdminDeleted = 0;

  // 1. Delete active orders from Customer DBs
  for (const target of customerDbs) {
    if (!target.handle) continue;
    console.log(`----------------------------------------`);
    console.log(`📡 Checking ${target.name}...`);
    console.log(`----------------------------------------`);

    for (const colName of ["xerox_orders", "orders"]) {
      try {
        const snap = await target.handle.collection(colName).get();
        for (const doc of snap.docs) {
          const data = doc.data() || {};
          const status = (data.status || '').toString().toUpperCase();
          const orderStatus = (data.orderStatus || '').toString().toLowerCase();

          // Target active/pending deliveries (not completed and not purged)
          const isActiveDelivery = status === 'ACTIVE' || 
                                   status === 'CREATED' || 
                                   status === 'PENDING' || 
                                   !data.isPicked || 
                                   (orderStatus !== 'order completed' && orderStatus !== 'files purged');

          if (isActiveDelivery) {
            // Attempt Cloudinary cleanup
            try {
              await deleteOrderFilesFromCloudinary(doc.id, data, colName).catch(() => null);
            } catch (_) {}

            await doc.ref.delete();
            totalCustomerDeleted++;
            console.log(`  🗑️ [${target.name} > ${colName}] Deleted active order ${doc.id} (Code: ${data.orderCode || data.pickupCode || 'N/A'}, Customer: ${data.customerName || data.userEmail || 'N/A'})`);
          }
        }
      } catch (err) {
        console.error(`❌ Error scanning ${colName} in ${target.name}:`, err.message);
      }
    }
  }

  // 2. Delete active orders from Admin DB (shops/{shopId}/orders)
  if (dbAdmin) {
    console.log(`\n----------------------------------------`);
    console.log(`🏪 Checking Admin Shop Databases...`);
    console.log(`----------------------------------------`);
    try {
      const shopsSnap = await dbAdmin.collection("shops").get();
      for (const shopDoc of shopsSnap.docs) {
        const shopId = shopDoc.id;
        const ordersSnap = await dbAdmin.collection("shops").doc(shopId).collection("orders").get();

        for (const doc of ordersSnap.docs) {
          const data = doc.data() || {};
          const status = (data.status || '').toString().toLowerCase();

          // Active/pending delivery in shop app (status != completed / fulfilled)
          if (status !== 'completed' && status !== 'fulfilled') {
            await doc.ref.delete();
            totalAdminDeleted++;
            console.log(`  🗑️ [Shop: ${shopId}] Deleted shop order ${doc.id} (Code: ${data.orderCode || 'N/A'}, Customer: ${data.customerName || 'N/A'})`);
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error purging Admin Shop orders:`, err.message);
    }
  }

  console.log("\n=======================================================");
  console.log(`🎉 PURGE COMPLETE!`);
  console.log(`   Customer Active Orders Deleted: ${totalCustomerDeleted}`);
  console.log(`   Admin Shop Orders Deleted:     ${totalAdminDeleted}`);
  console.log("=======================================================\n");
  process.exit(0);
}

deleteAllActiveDeliveries();
