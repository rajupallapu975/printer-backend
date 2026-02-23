const { db } = require("./firebase");
const cloudinary = require("./cloudinary");

// ============================================================================
// AUTO CLEANUP FUNCTION (Background)
// ============================================================================
async function performCleanup() {
    console.log("🧹 Starting background cleanup task...");

    try {
        const expiryTime = new Date(Date.now() - 12 * 60 * 60 * 1000);


        const snapshot = await db.collection("orders")
            .where("createdAt", "<=", expiryTime)
            .get();

        if (snapshot.empty) {
            console.log("✅ No expired orders found.");
            return;
        }

        console.log(`🔍 Found ${snapshot.size} expired orders.`);

        for (const doc of snapshot.docs) {
            await cleanupOrder(doc.id, doc.data());
        }

    } catch (error) {
        console.error("❌ Cleanup task failed:", error);
    }
}

// ============================================================================
// CLEANUP SINGLE ORDER
// ============================================================================
async function cleanupOrder(orderId, orderData, keepMetadata = false) {
    try {
        const publicIds = orderData.publicIds || [];

        console.log("Public IDs from Firestore:", publicIds);

        if (publicIds.length > 0) {
            console.log(`🧹 Cleaning up ${publicIds.length} files from Cloudinary for order ${orderId}...`);
            // Bulk delete as images
            await cloudinary.api.delete_resources(publicIds, { resource_type: 'image' });
            // Bulk delete as raw (for docs)
            await cloudinary.api.delete_resources(publicIds, { resource_type: 'raw' });
            console.log(`✅ Cloudinary cleanup complete for ${orderId}`);
        }

        if (keepMetadata) {
            // Keep the document but clear file-related data to save space/cost
            await db.collection("orders").doc(orderId).update({
                fileUrls: [],
                publicIds: [],
                cleanupStatus: "CLEANED"
            });
            console.log(`🧹 Cloudinary files for order ${orderId} cleared, metadata kept.`);
        } else {
            // Delete Firestore document completely
            await db.collection("orders").doc(orderId).delete();
            console.log(`🗑️ Order ${orderId} fully deleted from database.`);
        }
    } catch (error) {
        console.error(`❌ Failed cleanup for ${orderId}:`, error);
    }
}

module.exports = {
    performCleanup,
    cleanupOrder
};
