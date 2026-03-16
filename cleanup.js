const { dbCustomer: db } = require("./firebase");
const { cloudinary, configA, configB } = require("./cloudinary");

// ============================================================================
// AUTO CLEANUP FUNCTION (Background)
// ============================================================================
async function performCleanup() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 🧹 Starting background cleanup task...`);

    try {
        // Find orders created more than 24 hours ago
        const now = new Date();
        const collections = ["orders", "xerox_orders"];
        let totalProcessed = 0;
        let totalFound = 0;

        for (const colName of collections) {
            console.log(`🔍 Checking collection: ${colName}`);
            const snapshot = await db.collection(colName)
                .where("expiresAt", "<=", now)
                .get();

            if (snapshot.empty) {
                console.log(`✅ No expired orders in ${colName}.`);
                continue;
            }

            console.log(`🔍 Found ${snapshot.size} expired orders in ${colName}. Processing...`);
            totalFound += snapshot.size;

            for (const doc of snapshot.docs) {
                try {
                    await cleanupOrder(doc.id, doc.data(), colName);
                    totalProcessed++;
                } catch (err) {
                    console.error(`❌ Failed to cleanup order ${doc.id} in ${colName}:`, err.message);
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${new Date().toISOString()}] ✨ Cleanup finished. Processed ${totalProcessed}/${totalFound} orders in ${duration}s.`);

        return { success: true, processed: totalProcessed, total: totalFound };

    } catch (error) {
        console.error("❌ CRITICAL: Cleanup task failed:", error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// CLEANUP SINGLE ORDER
// ============================================================================
async function cleanupOrder(orderId, orderData, colName = "orders", keepMetadata = false) {
    try {
        const publicIds = orderData.publicIds || [];
        const toDeleteIds = [];

        // 🛡️ Safety check: Only delete if no OTHER order references these publicIds
        // Checks across BOTH collections
        if (publicIds.length > 0) {
            console.log(`🔍 Checking sharing status for ${publicIds.length} files of order ${orderId}...`);

            for (const pid of publicIds) {
                let isShared = false;
                const collections = ["orders", "xerox_orders"];
                
                for (const cn of collections) {
                    const sharingOrders = await db.collection(cn)
                        .where("publicIds", "array-contains", pid)
                        .limit(2)
                        .get();
                    
                    // If shared with anyone other than itself (if in same collection) or anyone in other collection
                    if (cn === colName) {
                        if (sharingOrders.size > 1) { isShared = true; break; }
                    } else {
                        if (sharingOrders.size > 0) { isShared = true; break; }
                    }
                }

                if (!isShared) {
                    toDeleteIds.push(pid);
                } else {
                    console.log(`♻️ Skipping deletion for ${pid} - shared with other orders.`);
                }
            }
        }

        if (toDeleteIds.length > 0) {
            console.log(`🗑️ Deleting ${toDeleteIds.length}/${publicIds.length} files from Cloudinary for ${orderId}...`);

            // ⚡ SWITCH TO CORRECT ACCOUNT FOR DELETION
            const isXerox = orderData.printMode === 'xeroxShop' || colName === 'xerox_orders';
            cloudinary.config(isXerox ? configB : configA);

            // Delete as image
            const imgRes = await cloudinary.api.delete_resources(toDeleteIds, { resource_type: 'image' });
            // Delete as raw (for PDFs/Docs)
            const rawRes = await cloudinary.api.delete_resources(toDeleteIds, { resource_type: 'raw' });

            console.log(`✅ Cloudinary ${isXerox ? 'B' : 'A'} result for ${orderId}:`, {
                images: imgRes.deleted,
                raw: rawRes.deleted
            });
        } else if (publicIds.length > 0) {
            console.log(`ℹ️ All files of order ${orderId} are shared. Cloudinary assets preserved.`);
        }

        if (keepMetadata) {
            await db.collection(colName).doc(orderId).update({
                fileUrls: [],
                publicIds: [],
                cleanupStatus: "CLEANED",
                cleanedAt: new Date()
            });
            console.log(`📝 Order ${orderId} metadata updated in ${colName} (files removed).`);
        } else {
            await db.collection(colName).doc(orderId).delete();
            console.log(`🔥 Order ${orderId} fully removed from ${colName}.`);
        }
    } catch (error) {
        console.error(`❌ Error in cleanupOrder for ${orderId} in ${colName}:`, error.message);
        throw error;
    }
}

module.exports = {
    performCleanup,
    cleanupOrder
};
