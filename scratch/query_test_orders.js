const { dbCustomer: db } = require("../firebase");

async function checkPickupCode() {
  console.log("🔍 Checking Firestore for pickupCode = '7974' or reviewer orders...\n");

  const snap1 = await db.collection("xerox_orders").where("pickupCode", "==", "7974").get();
  console.log(`👉 Docs with pickupCode == '7974': ${snap1.size}`);
  snap1.forEach(d => console.log(`  DocID: ${d.id}`, d.data()));

  const snap2 = await db.collection("xerox_orders").where("userEmail", "==", "reviewer@zikrint.app").get();
  console.log(`👉 Docs with userEmail == 'reviewer@zikrint.app': ${snap2.size}`);
  snap2.forEach(d => console.log(`  DocID: ${d.id}`, d.data()));

  process.exit(0);
}

checkPickupCode();
