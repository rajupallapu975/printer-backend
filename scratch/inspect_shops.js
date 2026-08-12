const { dbCustomer, dbCustomer2, dbCustomer3, dbAdmin } = require('../firebase');

async function inspect() {
  console.log("=== INSPECTING SHOPS & RELATED DATA ===");
  
  const dbs = [
    { name: "dbAdmin", db: dbAdmin },
    { name: "dbCustomer", db: dbCustomer },
    { name: "dbCustomer2", db: dbCustomer2 },
    { name: "dbCustomer3", db: dbCustomer3 }
  ];

  for (const item of dbs) {
    if (!item.db) continue;
    console.log(`\n--- ${item.name} ---`);
    try {
      // Check shops collection
      const shopsSnap = await item.db.collection('shops').get();
      console.log(`Shops count in ${item.name}: ${shopsSnap.size}`);
      shopsSnap.forEach(doc => {
        console.log(`  Shop ID: ${doc.id}, Data:`, doc.data());
      });

      // Check withdrawal_requests
      const reqSnap = await item.db.collection('withdrawal_requests').get();
      console.log(`Withdrawal requests count in ${item.name}: ${reqSnap.size}`);
      reqSnap.forEach(doc => {
        console.log(`  Req ID: ${doc.id}, Data:`, doc.data());
      });

      // Check xerox_orders
      const orderSnap = await item.db.collection('xerox_orders').get();
      console.log(`Xerox orders count in ${item.name}: ${orderSnap.size}`);
      orderSnap.forEach(doc => {
        const d = doc.data();
        console.log(`  Order ID: ${doc.id}, ShopId: ${d.shopId || d.vendorId}, Status: ${d.status}`);
      });
    } catch (err) {
      console.error(`Error inspecting ${item.name}:`, err.message);
    }
  }

  process.exit(0);
}

inspect();
