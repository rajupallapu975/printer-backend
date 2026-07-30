const { dbAdmin, findCustomerOrder, dbCustomer } = require("../firebase");
const { createOrder, syncOrderToAdmin } = require("../order");

async function runTestOrderIsolationVerification() {
  console.log("🧪 CREATING A TEST ORDER & VERIFYING ZERO DATA COLLISION...\n");

  const targetRealShopId = "real_shop_sample_999";
  const reviewerEmail = "reviewer@zikrint.app";
  const reviewerName = "Reviewer Test User";

  // 1. Simulate print settings targeted at a real shop
  const printSettings = {
    shopId: targetRealShopId,
    shopName: "Sample Real Shop",
    paperSize: "A4",
    files: [
      { fileName: "test_doc.pdf", pageCount: 2, copies: 1, color: "BW", doubleSided: false, url: "https://res.cloudinary.com/demo/image/upload/v1/sample.pdf" }
    ]
  };

  try {
    // 2. Create Order (simulating /verify-payment & /complete-order for reviewer)
    console.log(`📦 Creating order for ${reviewerEmail} targeting shop: ${targetRealShopId}...`);
    const createResult = await createOrder(
      printSettings,
      "pay_reviewer_test_12345",
      10.0,
      2,
      "xeroxShop",
      "reviewer_user_id",
      "order_test_1",
      reviewerEmail,
      reviewerName
    );

    const orderId = createResult.orderId;
    console.log(`✅ Customer Order Created with ID: ${orderId}`);

    // Update payment status to paid
    await createResult.db.collection("xerox_orders").doc(orderId).update({
      paymentStatus: "PAID",
      status: "ACTIVE"
    });

    // 3. Mirror/Sync Order to Admin Dashboard
    console.log(`🔄 Syncing order to Admin Dashboard...`);
    await syncOrderToAdmin(orderId, [
      { url: "https://res.cloudinary.com/demo/image/upload/v1/sample.pdf", publicId: "sample_pid" }
    ]);

    console.log("\n==================================================");
    console.log("🔍 CHECKING FOR DATA COLLISION ACROSS SHOPS:");
    console.log("==================================================");

    // 4. Check Real Shop's collection (real_shop_sample_999/orders)
    const realShopDoc = await dbAdmin.collection("shops").doc(targetRealShopId).collection("orders").doc(orderId).get();
    const leakedInTargetRealShop = realShopDoc.exists;
    console.log(`  Target Real Shop (${targetRealShopId}): ${leakedInTargetRealShop ? "🔴 LEAKED / COLLIDED!" : "✅ CLEAN (0 orders found)"}`);

    // 5. Scan ALL other real shops in dbAdmin
    const allShops = await dbAdmin.collection("shops").get();
    let collisionCount = 0;

    for (const shopDoc of allShops.docs) {
      if (shopDoc.id === "reviewer_shop_store") continue;

      const checkDoc = await dbAdmin.collection("shops").doc(shopDoc.id).collection("orders").doc(orderId).get();
      if (checkDoc.exists) {
        console.log(`  🔴 COLLISION DETECTED in shop: ${shopDoc.id}`);
        collisionCount++;
      }
    }
    console.log(`  All Real Shops Scan: ${collisionCount === 0 ? "✅ ZERO COLLISIONS across all real shops" : `🔴 ${collisionCount} collisions detected!`}`);

    // 6. Check Dedicated Tester Store (reviewer_shop_store/orders)
    const reviewerShopDoc = await dbAdmin.collection("shops").doc("reviewer_shop_store").collection("orders").doc(orderId).get();
    const storedInTesterStore = reviewerShopDoc.exists;
    console.log(`  Dedicated Tester Store (reviewer_shop_store): ${storedInTesterStore ? "✅ STORED PROPERLY IN TESTER STORE" : "🔴 MISSING FROM TESTER STORE"}`);

    console.log("\n==================================================");
    if (!leakedInTargetRealShop && collisionCount === 0 && storedInTesterStore) {
      console.log("🎉 VERIFICATION PASSED: ZERO DATA COLLISION!");
      console.log("   The test order was routed exclusively to 'reviewer_shop_store'.");
      console.log("   No real shop accounts received or collided with this test order.");
    } else {
      console.log("🔴 VERIFICATION FAILED! Please inspect output above.");
    }
    console.log("==================================================");

    // Cleanup the verification test order
    await dbCustomer.collection("xerox_orders").doc(orderId).delete().catch(() => null);
    await dbAdmin.collection("shops").doc("reviewer_shop_store").collection("orders").doc(orderId).delete().catch(() => null);
    console.log(`\n🧹 Cleaned up temporary verification test order ${orderId}.`);

  } catch (err) {
    console.error("❌ Test order verification error:", err.message);
  }

  process.exit(0);
}

runTestOrderIsolationVerification();
