const { db } = require("./firebase");
const cloudinary = require("./cloudinary");

// ============================================================================
// AUTO CLEANUP FUNCTION (Background)
// ============================================================================
async function performCleanup() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 🧹 Starting background cleanup task...`);

    try {
        // Find orders created more than 12 hours ago
        const expiryTime = new Date(Date.now() - 12 * 60 * 60 * 1000);

        const snapshot = await db.collection("orders")
            .where("createdAt", "<=", expiryTime)
            .get();

        if (snapshot.empty) {
            console.log(`[${new Date().toISOString()}] ✅ No expired orders found (older than 12h).`);
            return { success: true, count: 0 };
        }

        console.log(`[${new Date().toISOString()}] 🔍 Found ${snapshot.size} expired orders. Processing...`);

        let successCount = 0;
        for (const doc of snapshot.docs) {
            try {
                await cleanupOrder(doc.id, doc.data());
                successCount++;
            } catch (err) {
                console.error(`❌ Failed to cleanup order ${doc.id}:`, err.message);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${new Date().toISOString()}] ✨ Cleanup finished. Processed ${successCount}/${snapshot.size} orders in ${duration}s.`);

        return { success: true, processed: successCount, total: snapshot.size };

    } catch (error) {
        console.error("❌ CRITICAL: Cleanup task failed:", error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// CLEANUP SINGLE ORDER
// ============================================================================
async function cleanupOrder(orderId, orderData, keepMetadata = false) {
    try {
        const publicIds = orderData.publicIds || [];
        const toDeleteIds = [];

        // 🛡️ Safety check: Only delete if no OTHER order references these publicIds
        // (Necessary for Reprints which share the same file assets)
        if (publicIds.length > 0) {
            console.log(`🔍 Checking sharing status for ${publicIds.length} files of order ${orderId}...`);

            for (const pid of publicIds) {
                // Check if any other order uses this specific publicId
                const sharingOrders = await db.collection("orders")
                    .where("publicIds", "array-contains", pid)
                    .limit(2) // We only care if there resides at least one OTHER order
                    .get();

                // If only 1 order found (this one), it's safe to delete. 
                // If more than 1 found, it's a shared resource (reprint case)
                if (sharingOrders.size <= 1) {
                    toDeleteIds.push(pid);
                } else {
                    console.log(`♻️ Skipping deletion for ${pid} - shared with other orders.`);
                }
            }
        }

        if (toDeleteIds.length > 0) {
            console.log(`🗑️ Deleting ${toDeleteIds.length}/${publicIds.length} files from Cloudinary for ${orderId}...`);

            // Delete as image
            const imgRes = await cloudinary.api.delete_resources(toDeleteIds, { resource_type: 'image' });
            // Delete as raw (for PDFs/Docs)
            const rawRes = await cloudinary.api.delete_resources(toDeleteIds, { resource_type: 'raw' });

            console.log(`✅ Cloudinary result for ${orderId}:`, {
                images: imgRes.deleted,
                raw: rawRes.deleted
            });
        } else if (publicIds.length > 0) {
            console.log(`ℹ️ All files of order ${orderId} are shared. Cloudinary assets preserved.`);
        }

        if (keepMetadata) {
            await db.collection("orders").doc(orderId).update({
                fileUrls: [],
                publicIds: [],
                cleanupStatus: "CLEANED",
                cleanedAt: new Date()
            });
            console.log(`📝 Order ${orderId} metadata updated (files removed).`);
        } else {
            await db.collection("orders").doc(orderId).delete();
            console.log(`🔥 Order ${orderId} fully removed from Firestore.`);
        }
    } catch (error) {
        console.error(`❌ Error in cleanupOrder for ${orderId}:`, error.message);
        throw error;
    }
}

module.exports = {
    performCleanup,
    cleanupOrder
};
