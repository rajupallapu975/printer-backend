require('dotenv').config();
const { dbAdmin } = require('../firebase');

async function inspectReviewerOrders() {
  console.log("🔍 Inspecting all documents in shops/reviewer_shop_store/orders...");

  const snapshot = await dbAdmin.collection('shops').doc('reviewer_shop_store').collection('orders').get();
  console.log(`Found ${snapshot.size} documents:\n`);

  snapshot.forEach((doc, i) => {
    const d = doc.data();
    console.log(`[${i+1}] Doc ID: ${doc.id}`);
    console.log(`    orderCode: ${d.orderCode}`);
    console.log(`    customId: ${d.customId}`);
    console.log(`    customerName: ${d.customerName}`);
    console.log(`    paymentStatus: ${d.paymentStatus}`);
    console.log(`    status: ${d.status}`);
    console.log(`    orderStatus: ${d.orderStatus}`);
    console.log(`    timestamp: ${d.timestamp}`);
    console.log('----------------------------------------------------');
  });

  process.exit(0);
}

inspectReviewerOrders().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
