require('dotenv').config();
const { dbAdmin } = require('../firebase');

async function findShops() {
  console.log("🔍 Inspecting all shop documents in Admin Firebase...");
  const snapshot = await dbAdmin.collection('shops').get();
  console.log(`Found ${snapshot.size} shops:\n`);

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`🏬 Shop ID: ${doc.id}`);
    console.log(`   Email: ${data.email || data.userEmail}`);
    console.log(`   Shop Name: ${data.shopName}`);
    console.log(`   Wallet Balance: ${data.walletBalance}`);

    // Check orders subcollection
    const ordersSnapshot = await doc.ref.collection('orders').get();
    console.log(`   📦 Orders subcollection count: ${ordersSnapshot.size}`);
    ordersSnapshot.forEach(o => {
      const od = o.data();
      console.log(`      -> Order ID: ${o.id} | Code: ${od.orderCode} | CustomId: ${od.customId} | Status: ${od.status} / ${od.orderStatus} | Payment: ${od.paymentStatus}`);
    });
    console.log('----------------------------------------------------');
  }

  process.exit(0);
}

findShops().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
