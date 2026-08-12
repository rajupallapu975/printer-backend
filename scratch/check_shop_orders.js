const { dbAdmin } = require('../firebase');

async function checkShopOrders() {
  const shopId = 'VJlBOdpLiuY92UOxnBzwIoHkIiP2';
  console.log(`🔍 Checking orders in shops/${shopId}/orders...`);

  const snapshot = await dbAdmin.collection('shops').doc(shopId).collection('orders').get();
  console.log(`📋 Total orders in shop '${shopId}': ${snapshot.size}`);

  snapshot.forEach((doc, i) => {
    const data = doc.data();
    console.log(`   [${i+1}] ID: ${doc.id} | Name: ${data.customerName} | Status: ${data.status} / ${data.orderStatus}`);
  });

  process.exit(0);
}

checkShopOrders().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
