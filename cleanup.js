require('dotenv').config();
const { db } = require("./firebase");
const cloudinary = require("cloudinary").v2;

// ============================================================================
// CLOUDINARY CONFIGURATION
// ============================================================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,   // Use ROOT key
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============================================================================
// AUTO CLEANUP FUNCTION (Background)
// ============================================================================
async function performCleanup() {
    console.log("🧹 Starting background cleanup task...");

    try {
        const expiryTime = new Date(Date.now() - 12 * 60 * 60 * 1000);
        // Change 1 min to 12 * 60 * 60 * 1000 for 12 hours in production

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
            console.log(`☁️ Deleting ${publicIds.length} files from Cloudinary...`);

            for (const publicId of publicIds) {
                // Try deleting as image first
                let result = await cloudinary.uploader.destroy(publicId, {
                    resource_type: "image"
                });

                // If not found, try raw
                if (result.result === "not found") {
                    result = await cloudinary.uploader.destroy(publicId, {
                        resource_type: "raw"
                    });
                }

                console.log(`Delete result for ${publicId}:`, result);
            }
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
