require('dotenv').config();
const { dbAdmin } = require("../firebase");

async function verifyIntegration() {
  console.log("🧪 Verifying Reviewer Test Shop Integration in Database...");

  try {
    const testShopDoc = await dbAdmin.collection("shops").doc("reviewer_shop_store").get();
    if (testShopDoc.exists) {
      console.log("✅ Persistent Test Shop document exists in Admin Firestore:");
      console.log("   ", JSON.stringify(testShopDoc.data(), null, 2));
    } else {
      console.log("⚠️ Test Shop document 'reviewer_shop_store' not found. Creating it now...");
      await dbAdmin.collection("shops").doc("reviewer_shop_store").set({
        uid: "reviewer_shop_store",
        shopName: "Zikrint Reviewer Test Shop",
        location: "Test Kiosk Environment",
        pincode: "530068",
        openingTime: "08:00 AM",
        closingTime: "11:00 PM",
        isOpen: true,
        isAcceptingOrders: true,
        isBlocked: false,
        isActive: true,
        isTestShop: true,
        createdAt: new Date().toISOString(),
        walletBalance: 0.0,
        totalBwPages: 0,
        totalColorPages: 0,
      });
      console.log("✅ 'reviewer_shop_store' document created.");
    }
  } catch (err) {
    console.error("❌ Verification Error:", err.message);
  }

  process.exit(0);
}

verifyIntegration();
