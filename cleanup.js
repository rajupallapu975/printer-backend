const { dbCustomer: db, dbAdmin, admin } = require("./firebase");
const { cloudinary, configA, configB } = require("./cloudinary");
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
        const collections = ["orders", "xerox_orders"];
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

        return { success: true, processed: totalProcessed, total: totalFound };

    } catch (error) {
        console.error("❌ CRITICAL: Cleanup task failed:", error);
        return { success: false, error: error.message };
    }
}

async function deleteOrderFilesFromCloudinary(orderId, orderData, colName) {
    const publicIds = orderData.publicIds || [];
    const toDeleteIds = [];

    // 🛡️ Safety check: Only delete if no OTHER order references these publicIds
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

        // 📂 CLEANUP EMPTY FOLDERS (As requested to avoid confusion)
        // Folders can only be deleted if they are empty
        try {
            // Determine potential folder paths
            const code = orderData.pickupCode || orderData.orderCode;
            const pathPrefix = "xerox_orders"; // Unified Storage Path

            if (code && code !== '000000') {
                const folderPath = `${pathPrefix}/${code}`;
                console.log(`📁 Attempting to remove Cloudinary folder: ${folderPath}`);
                
                // We wait a tiny bit to ensure resources are fully purged from CDN
                await new Promise(r => setTimeout(r, 1000));
                
                await cloudinary.api.delete_folder(folderPath).catch(e => {
                    console.log(`ℹ️ Folder cleanup skipped (might have other files): ${e.message}`);
                });

                // Also try the Xerox mirror folder if it's a Xerox order (orderCode vs pickupCode)
                if (isXerox && orderData.orderCode && orderData.orderCode !== code) {
                   const altPath = `xerox_orders/${orderData.orderCode}`;
                   await cloudinary.api.delete_folder(altPath).catch(() => null);
                }
            }
        } catch (folderErr) {
            console.warn(`⚠️ Folder removal error for ${orderId}: ${folderErr.message}`);
        }
    } else if (publicIds.length > 0) {
        console.log(`ℹ️ All files of order ${orderId} are shared. Cloudinary assets preserved.`);
    }
}

// ============================================================================
// CLEANUP SINGLE ORDER
// ============================================================================
async function cleanupOrder(orderId, orderData, colName = "orders") {
    try {
        await deleteOrderFilesFromCloudinary(orderId, orderData, colName);

        // 🔥 FULL DELETE Logic: As requested, fully remove order from Firestore after grace period
        if (orderData.status === 'completed' || orderData.orderDone) {
            try {
                // Send Delayed "Order Completed" Notification (10 mins later)
                const userId = orderData.userId;
                if (userId) {
                    const userDoc = await db.collection("users").doc(userId).get();
                    if (userDoc.exists && userDoc.data().fcmToken) {
                        const message = {
                            notification: { 
                                title: "✅ Order Completed", 
                                body: "Greetings for your order completion. Visit again!" 
                            },
                            data: { click_action: "FLUTTER_NOTIFICATION_CLICK" },
                            token: userDoc.data().fcmToken,
                            android: { priority: "high" },
                            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } }
                        };
                        try {
                            await admin.app('customer').messaging().send(message);
                        } catch(e) {
                            await admin.messaging().send(message);
                        }
                        console.log(`✅ Sent delayed 'Completed' notification to user ${userId}`);
                    }
                }
            } catch (err) {
                console.error(`⚠️ Failed to send delayed notification: ${err.message}`);
            }
        } else {
            // 💸 AUTO REFUND Logic: If order expired but was NOT completed/printed...
            const isPrintedOrCompleted = orderData.orderStatus === 'printing completed' || orderData.orderStatus === 'order completed' || orderData.status === 'completed';
            
            if (!isPrintedOrCompleted) {
                if (orderData.razorpayPaymentId) {
                    try {
                        console.log(`💸 Processing AUTO REFUND for expired order ${orderId} | ₹${orderData.amount}`);
                        await razorpayInstance.payments.refund(orderData.razorpayPaymentId, {
                            amount: Math.round(Number(orderData.amount) * 100) // Razorpay expects paise
                        });
                        console.log(`✅ Refund successful for ${orderId}`);
                    } catch(err) {
                        console.error(`❌ Refund failed for ${orderId}:`, err.error ? err.error.description : err.message);
                        // We still proceed to delete the order so it isn't stuck forever.
                    }
                } else {
                    console.log(`ℹ️ No razorpayPaymentId found for expired order ${orderId}. Skipping refund.`);
                }
            }
        }

        await db.collection(colName).doc(orderId).delete();
        console.log(`🔥 Order ${orderId} fully removed from ${colName}.`);
        
        // Mirror Delete (Admin Project)
        const shopId = orderData.shopId;
        if (shopId && dbAdmin) {
            try {
                await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).delete();
            } catch (_) {}
        }
    } catch (error) {
        console.error(`❌ Error in cleanupOrder for ${orderId} in ${colName}:`, error.message);
        throw error;
    }
}

module.exports = {
    performCleanup,
    cleanupOrder,
    deleteOrderFilesFromCloudinary
};
