const { dbAdmin, dbCustomer } = require('../firebase');

async function checkTestOrders() {
  console.log("🔍 Checking active orders for Test User & Test Admin...");

  // 1. Check customer xerox_orders collection
  const customerSnapshot = await dbCustomer.collection('xerox_orders').get();
  console.log(`\n📋 Total documents in customer 'xerox_orders': ${customerSnapshot.size}`);

  const activeCustomerOrders = [];
  customerSnapshot.forEach(doc => {
    const data = doc.data();
    const isReviewer = (data.userEmail && data.userEmail.toLowerCase().includes('reviewer')) ||
                       (data.customerName && data.customerName.toLowerCase().includes('reviewer')) ||
                       (data.userId && data.userId.toLowerCase().includes('reviewer')) ||
                       (doc.id && doc.id.toLowerCase().includes('reviewer'));
    const isCompleted = data.status === 'completed' || data.orderStatus === 'order completed' || data.isPicked === true || data.orderDone === true;
    
    if (!isCompleted) {
      activeCustomerOrders.push({
        id: doc.id,
        customId: data.customId,
        userEmail: data.userEmail,
        customerName: data.customerName,
        status: data.status,
        orderStatus: data.orderStatus,
        shopId: data.shopId,
        isReviewer
      });
    }
  });

  console.log(`\n🟢 Active (non-completed) customer orders in 'xerox_orders': ${activeCustomerOrders.length}`);
  activeCustomerOrders.forEach((o, i) => {
    console.log(`   [${i+1}] ID: ${o.id} | CustomID: ${o.customId} | Email: ${o.userEmail} | Name: ${o.customerName} | Status: ${o.status} / ${o.orderStatus} | Shop: ${o.shopId}`);
  });

  // 2. Check admin reviewer_shop_store orders
  const adminSnapshot = await dbAdmin.collection('shops').doc('reviewer_shop_store').collection('orders').get();
  console.log(`\n🏬 Total orders in admin 'shops/reviewer_shop_store/orders': ${adminSnapshot.size}`);

  const activeAdminOrders = [];
  adminSnapshot.forEach(doc => {
    const data = doc.data();
    const isCompleted = data.status === 'completed' || data.orderStatus === 'order completed';
    if (!isCompleted) {
      activeAdminOrders.push({
        id: doc.id,
        customId: data.customId,
        userEmail: data.userEmail,
        customerName: data.customerName,
        status: data.status,
        orderStatus: data.orderStatus,
      });
    }
  });

  console.log(`\n🟢 Active (non-completed) orders in Admin 'reviewer_shop_store': ${activeAdminOrders.length}`);
  activeAdminOrders.forEach((o, i) => {
    console.log(`   [${i+1}] ID: ${o.id} | CustomID: ${o.customId} | Email: ${o.userEmail} | Name: ${o.customerName} | Status: ${o.status} / ${o.orderStatus}`);
  });

  process.exit(0);
}

checkTestOrders().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
