const { dbAdmin } = require("../firebase");

/**
 * 🧹 PAYOUT DUPLICATE CLEANUP SCRIPT
 * Find pending withdrawal requests that were created by duplicate clicks (same shop, same amount, same time)
 * and keep only one.
 */

async function cleanupDuplicates() {
    console.log("🔍 Fetching pending withdrawal requests...");
    const snapshot = await dbAdmin.collection("withdrawal_requests")
        .where("status", "==", "pending")
        .get();

    if (snapshot.empty) {
        console.log("✅ No pending requests found.");
        return;
    }

    const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const grouped = {};

    // Group by ShopID and Amount
    docs.forEach(doc => {
        const key = `${doc.shopId}_${doc.amount}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(doc);
    });

    let deletedCount = 0;

    for (const key in grouped) {
        const list = grouped[key];
        if (list.length > 1) {
            // Sort by time
            list.sort((a, b) => {
                const ta = a.requestedAt ? a.requestedAt.toMillis() : 0;
                const tb = b.requestedAt ? b.requestedAt.toMillis() : 0;
                return ta - tb;
            });

            // Check for documents created within 10 seconds of each other
            for (let i = 0; i < list.length - 1; i++) {
                const current = list[i];
                const next = list[i + 1];
                const t1 = current.requestedAt ? current.requestedAt.toMillis() : 0;
                const t2 = next.requestedAt ? next.requestedAt.toMillis() : 0;

                if (Math.abs(t2 - t1) < 10000) { // 10 second window
                    console.log(`🗑️ Found duplicate: ${next.id} (Shop: ${next.shopName}, Amount: ${next.amount})`);
                    await dbAdmin.collection("withdrawal_requests").doc(next.id).delete();
                    deletedCount++;
                    
                    // Also delete the transaction record in the shop's subcollection if it exists
                    try {
                        const shopTx = await dbAdmin.collection("shops").doc(next.shopId)
                            .collection("transactions")
                            .where("requestId", "==", next.id)
                            .get();
                        
                        for (const txDoc of shopTx.docs) {
                            await txDoc.ref.delete();
                            console.log(`   - Deleted associated transaction record: ${txDoc.id}`);
                        }
                    } catch (e) {
                        console.error(`   - Failed to delete transaction record: ${e.message}`);
                    }
                }
            }
        }
    }

    console.log(`\n✨ Cleanup finished. Deleted ${deletedCount} duplicate requests.`);
}

cleanupDuplicates().catch(console.error);
