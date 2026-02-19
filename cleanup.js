const admin = require("firebase-admin");
const { db } = require("./firebase");
const cloudinary = require("cloudinary").v2;

// ============================================================================
// CLOUDINARY CONFIGURATION (REPLACE WITH YOUR KEYS)
// ============================================================================
cloudinary.config({
    cloud_name: 'dpmpyvmbg',
    api_key: '239257584915646', // From your screenshot
    api_secret: 'NjymN68_G7QXwbB6YfSR1x9kU7g' // 🔑 NEED THIS
});

/**
 * Cleanup function to find expired orders and delete cloud files
 */
async function performCleanup() {
    console.log("🧹 Starting background cleanup task...");

    try {
        const twelveHoursAgo = new Date(Date.now() - 1 * 60 * 1000);

        // Find ACTIVE orders older than 12 hours
        const snapshot = await db.collection("orders")
            .where("status", "==", "ACTIVE")
            .where("createdAt", "<=", twelveHoursAgo)
            .get();

        if (snapshot.empty) {
            console.log("✅ No matching orders found for cleanup.");
            return;
        }

        console.log(`🔍 Found ${snapshot.size} expired orders for cleanup.`);

        for (const doc of snapshot.docs) {
            const orderData = doc.data();
            const orderId = doc.id;

            await cleanupOrder(orderId, orderData);
        }

    } catch (error) {
        console.error("❌ Cleanup task failed:", error);
    }
}

/**
 * Clean up a specific order: Delete from Cloudinary and archive in Firestore
 */
async function cleanupOrder(orderId, orderData) {
    try {
        const publicIds = orderData.publicIds || [];

        // 1. Delete from Cloudinary
        if (publicIds.length > 0) {
            console.log(`☁️ Deleting ${publicIds.length} files from Cloudinary for order ${orderId}...`);
            await cloudinary.api.delete_resources(publicIds);
        }

        // 2. Clear sensitive cloud info but KEEP metadata in history
        await db.collection("orders").doc(orderId).update({
            status: "EXPIRED",
            fileUrls: [], // Remove URLs
            publicIds: [], // Remove IDs
            pickupCode: null, // Revoke code
            cleanedUpAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`✅ Order ${orderId} moved to history and cloud files deleted.`);
    } catch (error) {
        console.error(`❌ Failed to cleanup order ${orderId}:`, error);
    }
}

module.exports = {
    performCleanup,
    cleanupOrder
};
