const { dbCustomer: db, dbCustomer2, dbCustomer3 } = require("../firebase");

async function deleteTestOrders() {
  console.log("🗑️ Deleting all reviewer test orders from Firestore...\n");

  const dbs = [
    { name: "Project 1 (psfc-43b5a)", handle: db },
    { name: "Project 2 (zikrint-944a4)", handle: dbCustomer2 },
    { name: "Project 3 (think-ink)", handle: dbCustomer3 },
  ];

  let deletedCount = 0;

  for (const target of dbs) {
    if (!target.handle) continue;
    
    try {
      // 1. Find by userEmail
      const snap1 = await target.handle.collection("xerox_orders")
        .where("userEmail", "==", "reviewer@zikrint.app")
        .get();

      // 2. Find by customerName
      const snap2 = await target.handle.collection("xerox_orders")
        .where("customerName", "==", "Reviewer User")
        .get();

      // 3. Find by userId
      const snap3 = await target.handle.collection("xerox_orders")
        .where("userId", "==", "reviewer_user")
        .get();

      const docsToDelete = new Map();
      snap1.forEach(doc => docsToDelete.set(doc.id, doc.ref));
      snap2.forEach(doc => docsToDelete.set(doc.id, doc.ref));
      snap3.forEach(doc => docsToDelete.set(doc.id, doc.ref));

      for (const [id, ref] of docsToDelete.entries()) {
        await ref.delete();
        console.log(`✅ Deleted order ${id} from ${target.name}`);
        deletedCount++;
      }
    } catch (err) {
      console.error(`❌ Error deleting from ${target.name}:`, err.message);
    }
  }

  console.log(`\n🎉 Total test orders deleted: ${deletedCount}`);
  process.exit(0);
}

deleteTestOrders();
