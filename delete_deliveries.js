const admin = require("firebase-admin");
const path = require("path");

// ----------------------------------------------------------------------------
// 1. Initialise BOTH Projects
// ----------------------------------------------------------------------------

// A. ThinkInk Admin (Main Project)
const adminApp = admin.initializeApp({
  credential: admin.credential.cert(require("./adminServiceAccountKey.json")),
}, "admin");

// B. PSFC (Secondary Project)
const psfcApp = admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
}, "psfc");

const dbAdmin = adminApp.firestore();
const dbPsfc = psfcApp.firestore();

async function deleteAllDeliveries() {
    console.log("🧹 Starting mass deletion of all completed/delivery orders...");

    try {
        // 🏗️ 1. Find all shop documents
        const shopsSnapshot = await dbAdmin.collection("shops").get();
        console.log(`🔍 Found ${shopsSnapshot.size} shops.`);

        for (const shopDoc of shopsSnapshot.docs) {
            const shopUid = shopDoc.id;
            console.log(`📦 Checking deliveries for shop: ${shopUid}`);

            const deliveriesSnapshot = await dbAdmin.collection("shops").doc(shopUid).collection("orders")
                .where("status", "in", ["completed", "ready"])
                .get();

            if (deliveriesSnapshot.empty) {
                console.log(`✅ No deliveries found for shop ${shopUid}.`);
                continue;
            }

            console.log(`🔥 Deleting ${deliveriesSnapshot.size} orders for shop ${shopUid}...`);

            for (const orderDoc of deliveriesSnapshot.docs) {
                const orderId = orderDoc.id;
                console.log(`🗑️ Processing Order: ${orderId}`);

                // A. Delete from Shop subcollection
                await dbAdmin.collection("shops").doc(shopUid).collection("orders").doc(orderId).delete();

                // B. Cascade delete from PSFC (Customer Project)
                const psfcCols = ["xerox_shop_orders", "xerox_orders", "orders"];
                for (const col of psfcCols) {
                    await dbPsfc.collection(col).doc(orderId).delete().catch(() => null);
                }
                
                console.log(`✅ Deleted ${orderId} from all sync points.`);
            }
        }

        console.log("\n✨ Mass deletion complete. All 'Deliveries' have been wiped.");
        process.exit(0);
    } catch (error) {
        console.error("❌ ERROR during deletion:", error);
        process.exit(1);
    }
}

deleteAllDeliveries();
