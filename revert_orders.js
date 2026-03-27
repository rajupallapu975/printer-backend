
const { dbAdmin, dbCustomer } = require("./firebase");

async function revertOrders() {
  const ids = ["9710", "8342"];
  
  for (const id of ids) {
    console.log(`Reverting ${id}...`);
    try {
      // 1. Revert in root collections (Customer project)
      for (const col of ["xerox_orders", "orders"]) {
        await dbCustomer.collection(col).doc(id).update({
          orderStatus: "not printed yet",
          status: "pending"
        }).catch(() => null);
      }
      
      // 2. Revert in all shops (Admin project)
      const shopSnap = await dbAdmin.collection("shops").get();
      for (const shopDoc of shopSnap.docs) {
        const orderSnap = await shopDoc.ref.collection("orders").doc(id).get();
        if (orderSnap.exists) {
          await orderSnap.ref.update({
             orderStatus: "not printed yet",
             status: "pending"
          });
          console.log(`Successfully reverted in shop: ${shopDoc.id}`);
        }
      }
      console.log(`Done for ${id}`);
    } catch (e) {
      console.error(`Error for ${id}: ${e.message}`);
    }
  }
}

revertOrders();
