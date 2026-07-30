const { dbCustomer: db, dbCustomer2, dbCustomer3 } = require("../firebase");

async function deleteAllActiveOrders() {
  console.log("💥 Deleting ALL active orders from ALL emails, users, and tester accounts...\n");

  const dbs = [
    { name: "Project 1 (psfc-43b5a)", handle: db },
    { name: "Project 2 (zikrint-944a4)", handle: dbCustomer2 },
    { name: "Project 3 (think-ink)", handle: dbCustomer3 },
  ];

  let totalDeleted = 0;

  for (const target of dbs) {
    if (!target.handle) continue;
    console.log(`========================================`);
    console.log(`📡 Database: ${target.name}`);
    console.log(`========================================`);

    const collections = ["xerox_orders", "orders"];

    for (const colName of collections) {
      try {
        const snap = await target.handle.collection(colName).get();
        let colDeleted = 0;

        for (const doc of snap.docs) {
          const data = doc.data();
          const st = (data.status || '').toString().toUpperCase();
          const ordSt = (data.orderStatus || '').toString().toLowerCase();

          // Delete all active or non-archived orders
          if (st === 'ACTIVE' || st === 'CREATED' || !data.isPicked || ordSt !== 'files purged') {
            await doc.ref.delete();
            colDeleted++;
            totalDeleted++;
            console.log(`  🗑️ [${colName}] Deleted order ${doc.id} | Email: ${data.userEmail || data.userId} | PickupCode: ${data.pickupCode}`);
          }
        }
        console.log(`👉 Deleted ${colDeleted} order(s) from collection '${colName}'`);
      } catch (err) {
        console.error(`❌ Error deleting from ${colName} in ${target.name}:`, err.message);
      }
    }
    console.log("\n");
  }

  console.log(`🎉 TOTAL ACTIVE ORDERS DELETED ACROSS ALL ACCOUNTS & DATABASES: ${totalDeleted}`);
  process.exit(0);
}

deleteAllActiveOrders();
