const { dbCustomer: db, dbAdmin, admin } = require("./firebase");
const { cloudinary, configB, getConfigForUrl } = require("./cloudinary");
const razorpayInstance = require("./razorpay");

// ============================================================================
// AUTO CLEANUP FUNCTION (Background)
// ============================================================================
async function performCleanup() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 🧹 Starting background cleanup task...`);

    try {
        // 🕵️ Deep Orphaned Cloudinary cleanup (10% chance per cycle)
        //
        // ⛔ DISABLED (Phase 0.5). cleanupOrphanedCloudinaryAssets decides a Cloudinary
        // folder is orphaned by querying ONLY customer project 1, but createOrder fails
        // over across three projects. Every live order that landed on project 2 or 3 looks
        // orphaned to this sweep and has its files deleted while the customer is waiting
        // for them.
        //
        // Re-enable only after Phase 3.1 makes the check consult all three projects AND
        // treat a query error as "unknown" rather than "absent". Set
        // CLEANUP_ORPHAN_SWEEP_ENABLED=true to opt back in (replaced by the Firestore
        // feature-flag service in Phase 0.5.6).
        const orphanSweepEnabled = process.env.CLEANUP_ORPHAN_SWEEP_ENABLED === 'true';
        if (orphanSweepEnabled && Math.random() < 0.1) {
            await cleanupOrphanedCloudinaryAssets().catch(() => null);
        }

        return { success: true, processed: 0, total: 0, orphanSweepEnabled };

    } catch (error) {
        console.error("❌ CRITICAL: Cleanup task failed:", error);
        return { success: false, error: error.message };
    }
}

async function deleteOrderFilesFromCloudinary(orderId, orderData, colName) {
    const publicIds = [...(orderData.publicIds || [])];
    const displayCode = orderData.pickupCode || orderData.orderCode || orderData.id;
    console.log(`🔍 [${orderId}] Cleanup Check: publicIds=[${publicIds.join(', ')}], code=${displayCode}`);

    // Extract any additional publicIds from printSettings.files or fileUrls
    if (orderData.printSettings?.files && Array.isArray(orderData.printSettings.files)) {
        for (const f of orderData.printSettings.files) {
            if (f.publicId && !publicIds.includes(f.publicId)) publicIds.push(f.publicId);
        }
    }
    if (orderData.coverPagePublicId && !publicIds.includes(orderData.coverPagePublicId)) {
        publicIds.push(orderData.coverPagePublicId);
    }

    const firstUrl = orderData.fileUrls && orderData.fileUrls.length > 0 ? orderData.fileUrls[0] : null;
    const resolvedConfig = getConfigForUrl(firstUrl);
    cloudinary.config(resolvedConfig);

    // 1️⃣ ID-BASED PURGE
    if (publicIds.length > 0) {
        console.log(`🗑️ Deleting ${publicIds.length} verified IDs for ${orderId}...`);
        await cloudinary.api.delete_resources(publicIds, { resource_type: 'image' }).catch(() => null);
        await cloudinary.api.delete_resources(publicIds, { resource_type: 'raw' }).catch(() => null);
    }

    // 2️⃣ PREFIX-BASED PURGE (Catches flat files like "xerox_processed_orders/981314_1" and folders "xerox_orders/981314/...")
    if (displayCode) {
        const prefixesToTry = [
            `xerox_orders/${displayCode}`,
            `xerox_orders/${displayCode}_`,
            `xerox_processed_orders/${displayCode}`,
            `xerox_processed_orders/${displayCode}_`,
            `xerox_shop/${displayCode}`,
        ];
        for (const pfx of prefixesToTry) {
            await cloudinary.api.delete_resources_by_prefix(pfx, { resource_type: 'image' }).catch(() => null);
            await cloudinary.api.delete_resources_by_prefix(pfx, { resource_type: 'raw' }).catch(() => null);
            await cloudinary.api.delete_folder(pfx).catch(() => null);
        }
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
