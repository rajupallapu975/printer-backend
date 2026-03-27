const admin = require("firebase-admin");

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

async function wipeAllSystems() {
    console.log("🧨 CRITICAL: Starting total system-wide order wipe...");

    try {
        // 🏗️ 1. Wipe Admin Project (Shops subcollections)
        const shopsSnapshot = await dbAdmin.collection("shops").get();
        console.log(`🔍 Scanning ${shopsSnapshot.size} shops for orders...`);

        for (const shopDoc of shopsSnapshot.docs) {
            const shopUid = shopDoc.id;
            const ordersSnapshot = await dbAdmin.collection("shops").doc(shopUid).collection("orders").get();
            
            if (!ordersSnapshot.empty) {
                console.log(`🔥 Deleting ${ordersSnapshot.size} orders from Shop ${shopUid}...`);
                const batch = dbAdmin.batch();
                ordersSnapshot.docs.forEach(doc => {
                    const ref = dbAdmin.collection("shops").doc(shopUid).collection("orders").doc(doc.id);
                    batch.delete(ref);
                });
                await batch.commit();
            }
        }

        // 🏗️ 2. Wipe PSFC Project (Central User Collections)
        const userCols = ["xerox_shop_orders", "xerox_orders", "orders", "notifications"];
        for (const col of userCols) {
            const snapshot = await dbPsfc.collection(col).get();
            if (!snapshot.empty) {
                console.log(`🔥 Deleting ${snapshot.size} documents from PSFC collection: ${col}...`);
                
                // Firestore batches are limited to 500 ops
                const docs = snapshot.docs;
                for (let i = 0; i < docs.length; i += 500) {
                    const batch = dbPsfc.batch();
                    docs.slice(i, i + 500).forEach(doc => {
                        const ref = dbPsfc.collection(col).doc(doc.id);
                        batch.delete(ref);
                    });
                    await batch.commit();
                }
            }
        }

        console.log("\n✅ TOTAL WIPE COMPLETE. All orders and notifications have been cleared.");
        process.exit(0);
    } catch (error) {
        console.error("❌ CRITICAL ERROR during wipe:", error);
        process.exit(1);
    }
}

wipeAllSystems();
