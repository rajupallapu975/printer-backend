require('dotenv').config();
const { dbAdmin, dbCustomer } = require('../firebase');
const { syncOrderToAdmin } = require('../order');

async function syncAllActiveTestOrders() {
  console.log("🔄 Syncing existing test orders to reviewer_shop_store...");

  const customerSnapshot = await dbCustomer.collection('xerox_orders').get();
  for (const doc of customerSnapshot.docs) {
    const data = doc.data();
    const isReviewer = (data.userEmail && data.userEmail.toLowerCase().includes('reviewer')) ||
                       (data.customerName && data.customerName.toLowerCase().includes('reviewer')) ||
                       (data.userId && data.userId.toLowerCase().includes('reviewer')) ||
                       (doc.id && doc.id.toLowerCase().includes('reviewer'));
    const isCompleted = data.status === 'completed' || data.orderStatus === 'order completed';

    if (isReviewer && !isCompleted) {
      console.log(`Syncing order ${doc.id}...`);
      await syncOrderToAdmin(doc.id);
    }
  }

  console.log("✅ Sync complete!");
  process.exit(0);
}

syncAllActiveTestOrders().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
