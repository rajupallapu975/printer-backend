const { dbCustomer: db, dbAdmin, admin } = require("./firebase");
const { cloudinary, configB } = require("./cloudinary");
const razorpayInstance = require("./razorpay");

// ============================================================================
// AUTO CLEANUP FUNCTION (Background)
// ============================================================================
async function performCleanup() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 🧹 Starting background cleanup task...`);

    try {
        const now = new Date();
        const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const collections = ["xerox_orders"];
        let totalProcessed = 0;
        let totalFound = 0;

        for (const colName of collections) {
            console.log(`🔍 Checking collection: ${colName}`);
            
            // Query 1: Standard Expiry (Includes the 10-min window set during delivery)
            const snapshot = await db.collection(colName)
                .where("expiresAt", "<=", now)
                .limit(100) // Process in batches
                .get();

            if (snapshot.empty) {
                console.log(`✅ No expired/completed orders ready for cleanup in ${colName}.`);
                continue;
            }

            console.log(`🔍 Found ${snapshot.size} expired/completed orders in ${colName}. Processing...`);
            totalFound += snapshot.size;

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    
                    // Skip if already cleaned (Extra safety)
                    if (data.cleanupStatus === 'CLEANED' && !data.expiresAt) continue;

                    // Perform Cleanup
                    await cleanupOrder(doc.id, data, colName);
                    
                    // 🛡️ CRITICAL: Remove expiresAt so it doesn't get picked up again
                    await db.collection(colName).doc(doc.id).update({
                        expiresAt: null,
                        cleanupStatus: 'CLEANED',
                        cleanedAt: admin.firestore.FieldValue.serverTimestamp()
                    }).catch(() => null);

                    totalProcessed++;
                } catch (err) {
                    console.error(`❌ Failed to cleanup order ${doc.id} in ${colName}:`, err.message);
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        if (totalProcessed > 0) {
            console.log(`[${new Date().toISOString()}] ✨ Cleanup finished. Processed ${totalProcessed}/${totalFound} orders in ${duration}s.`);
        }

        // 🕵️ EXTRA: Deep Orphaned cleanup (Rare, once per cycle)
        if (Math.random() < 0.1) { // 10% chance to trigger deep cleanup during regular task
            await cleanupOrphanedCloudinaryAssets().catch(() => null);
        }

        return { success: true, processed: totalProcessed, total: totalFound };

    } catch (error) {
        console.error("❌ CRITICAL: Cleanup task failed:", error);
        return { success: false, error: error.message };
    }
}

async function deleteOrderFilesFromCloudinary(orderId, orderData, colName) {
    const publicIds = orderData.publicIds || [];
    const toDeleteIds = [];
    const displayCode = orderData.pickupCode || orderData.orderCode || orderData.id;
    console.log(`🔍 [${orderId}] Cleanup Check: publicIds=[${publicIds.join(', ')}], code=${displayCode}`);

    // 1️⃣ ID-BASED PURGE
    if (publicIds.length > 0) {
        for (const pid of publicIds) {
            let isShared = false;
            const sharingOrders = await db.collection("xerox_orders").where("publicIds", "array-contains", pid).limit(2).get();
            if (sharingOrders.size > 1) isShared = true;
            
            if (!isShared) toDeleteIds.push(pid);
        }
    }

    // 2️⃣ PREFIX-BASED PURGE (Aggressive - catches untracked files like "602862_1" or "file")
    cloudinary.config(configB);

    if (displayCode) {
        const foldersToTry = ["xerox_orders", "xerox_processed_orders", "xerox_shop"];
        for (const prefix of foldersToTry) {
            const folderPath = `${prefix}/${displayCode}`;
            console.log(`🧹 Attempting prefix-wipe for: ${folderPath}`);
            await cloudinary.api.delete_resources_by_prefix(folderPath).catch(() => null);
            await cloudinary.api.delete_folder(folderPath).catch(() => null);
        }
    }

    if (toDeleteIds.length > 0) {
        console.log(`🗑️ Deleting ${toDeleteIds.length} verified unique files for ${orderId}...`);
        await cloudinary.api.delete_resources(toDeleteIds, { resource_type: 'image' }).catch(() => null);
        await cloudinary.api.delete_resources(toDeleteIds, { resource_type: 'raw' }).catch(() => null);
    }
}

// ============================================================================
// CLEANUP SINGLE ORDER
// ============================================================================
async function cleanupOrder(orderId, orderData, colName = "xerox_orders") {
    try {
        // 🚀 1. PURGE CLOUDINARY IMMEDIATELY
        console.log(`🗑️ [${orderId}] Cleanup triggered. Purging assets...`);
        await deleteOrderFilesFromCloudinary(orderId, orderData, colName);

        const status = orderData.status || '';
        const isPrintedOrCompleted = orderData.orderStatus === 'printing completed' || orderData.orderStatus === 'order completed' || status === 'completed';

        if (!isPrintedOrCompleted) {
            // 💸 AUTO REFUND (If expired without print)
            if (orderData.razorpayPaymentId && !orderData.razorpayPaymentId.startsWith('pay_admin_')) {
                try {
                    console.log(`💸 Processing AUTO REFUND for expired order ${orderId} | ₹${orderData.amount}`);
                    await razorpayInstance.payments.refund(orderData.razorpayPaymentId, {
                        amount: Math.round(Number(orderData.amount) * 100)
                    });
                } catch(err) {
                    console.error(`❌ Refund failed for ${orderId}:`, err.message);
                }
            }
        }

        // 🚀 2. HARD DELETE IMMEDIATELY
        console.log(`🔥 [${orderId}] Assets purged. Hard deleting record from ${colName}.`);
        await db.collection(colName).doc(orderId).delete();
        
        const shopId = orderData.shopId;
        if (shopId && dbAdmin) {
            await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).delete().catch(() => null);
        }
    } catch (error) {
        console.error(`❌ Error in cleanupOrder for ${orderId}:`, error.message);
    }
}

// ============================================================================
// DEEP CLEANUP: Purge folders not found in Firestore (Orphaned Assets)
// ============================================================================
async function cleanupOrphanedCloudinaryAssets() {
    console.log("🕵️ Starting Deep Cleanup: Checking for orphaned Cloudinary assets...");
    const foldersToScan = ["xerox_orders", "xerox_processed_orders"];
    
    // Only check Xerox Account (configB)
    cloudinary.config(configB);
    
    for (const root of foldersToScan) {
        try {
            const result = await cloudinary.api.sub_folders(root).catch(() => ({ folders: [] }));
            for (const folder of result.folders) {
                const pickupCode = folder.name;
                if (!pickupCode || pickupCode.length < 4) continue;

                // 🔍 Check if any ACTIVE or PENDING order exists with this code
                const xeroxMatch = await db.collection("xerox_orders").where("pickupCode", "==", pickupCode).limit(1).get();
                const sequentialMatch = await db.collection("xerox_orders").where("orderId", "==", pickupCode).limit(1).get();

                if (xeroxMatch.empty && sequentialMatch.empty) {
                    console.log(`🧹 Purging ORPHANED Cloudinary assets in folder: ${folder.path}`);
                    
                    // 1. Delete all resources in the folder
                    await cloudinary.api.delete_resources_by_prefix(folder.path).catch(() => null);
                    // 2. Delete the folder itself
                    await cloudinary.api.delete_folder(folder.path).catch(() => null);
                }
            }
        } catch (err) {
            console.log(`⚠️ Scan failed for ${root} on Account: ${err.message}`);
        }
    }
}

module.exports = {
    performCleanup,
    cleanupOrder,
    deleteOrderFilesFromCloudinary
};
