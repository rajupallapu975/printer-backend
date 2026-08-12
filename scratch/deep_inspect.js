const { dbCustomer, dbCustomer2, dbCustomer3, dbAdmin } = require('../firebase');

async function deepInspect() {
  console.log("=== DEEP INSPECTION OF SHOP SUBCOLLECTIONS AND RELATED DATA ===");
  
  const dbs = [
    { name: "dbAdmin", db: dbAdmin },
    { name: "dbCustomer", db: dbCustomer },
    { name: "dbCustomer2", db: dbCustomer2 },
    { name: "dbCustomer3", db: dbCustomer3 }
  ];

  for (const item of dbs) {
    if (!item.db) continue;
    console.log(`\n=================== ${item.name} ===================`);
    
    // Check shops
    try {
      const shopsSnap = await item.db.collection('shops').get();
      console.log(`[${item.name}] Total 'shops' docs: ${shopsSnap.size}`);
      
      for (const doc of shopsSnap.docs) {
        console.log(`\n  Shop ID: ${doc.id}`);
        console.log(`  Shop Data:`, JSON.stringify(doc.data(), null, 2));

        // List subcollections for this shop doc
        const subcollections = await doc.ref.listCollections();
        console.log(`  Subcollections for ${doc.id}: ${subcollections.map(c => c.id).join(', ') || 'None'}`);

        for (const sub of subcollections) {
          const subSnap = await sub.get();
          console.log(`    Subcollection '${sub.id}' count: ${subSnap.size}`);
          subSnap.forEach(sDoc => {
            console.log(`      SubDoc ${sDoc.id}:`, sDoc.data());
          });
        }
      }
    } catch (e) {
      console.error(`Error inspecting shops in ${item.name}:`, e.message);
    }

    // Check withdrawal_requests
    try {
      const reqSnap = await item.db.collection('withdrawal_requests').get();
      console.log(`\n[${item.name}] Total 'withdrawal_requests' docs: ${reqSnap.size}`);
      reqSnap.forEach(d => {
        console.log(`  Req ${d.id}:`, d.data());
      });
    } catch (e) {
      console.error(`Error inspecting withdrawal_requests in ${item.name}:`, e.message);
    }

    // Check xerox_orders
    try {
      const ordersSnap = await item.db.collection('xerox_orders').get();
      console.log(`\n[${item.name}] Total 'xerox_orders' docs: ${ordersSnap.size}`);
      ordersSnap.forEach(d => {
        console.log(`  Order ${d.id}: shopId=${d.data().shopId || d.data().vendorId}, status=${d.data().status}`);
      });
    } catch (e) {
      console.error(`Error inspecting xerox_orders in ${item.name}:`, e.message);
    }
  }

  process.exit(0);
}

deepInspect();
