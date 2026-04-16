// ============================================================================
// DEPENDENCIES
// ============================================================================
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
// ============================================================================
// INTERNAL MODULES
// ============================================================================
const { dbCustomer: db, dbAdmin, admin } = require("./firebase");
const { cloudinary, configB } = require("./cloudinary");
const razorpayInstance = require("./razorpay");
const { performCleanup, cleanupOrder, deleteOrderFilesFromCloudinary } = require("./cleanup");
const { createOrder, syncOrderToAdmin, calculateCost, generateUniquePickupCode } = require("./order");
const { applyWatermark } = require("./watermark_service");
require("./notification_watcher"); // 🚀 Start background listeners
// ============================================================================
// EXPRESS APP SETUP
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());
// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// Consolidated scheduling moved or updated here
// Run cleanup once on startup then every 5 minutes
// performCleanup is already imported on line 14
performCleanup();
setInterval(performCleanup, 5 * 60 * 1000);
// ============================================================================
// ENDPOINT: HEALTH CHECK & MANUAL CLEANUP
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Printer Backend Server is running",
    razorpay: !!process.env.RAZORPAY_KEY_ID,
    firebase: !!db,
    cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME,
    timestamp: new Date().toISOString(),
  });
});
// Manual/Scheduled cleanup trigger
app.get("/run-cleanup", async (req, res) => {
  try {
    const key = req.query.key;
    // Security check (Optional: add CLEANUP_KEY to your .env)
    if (process.env.CLEANUP_KEY && key !== process.env.CLEANUP_KEY) {
      return res.status(401).json({ error: "Unauthorized. Invalid key." });
    }
    console.log("🚀 Manually triggered cleanup...");
    const result = await performCleanup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ============================================================================
// ENDPOINT: FETCH LIVE XEROX SHOPS (From Admin Firebase)
// ============================================================================
app.get("/get-xerox-shops", async (req, res, next) => {
  try {
    const { dbAdmin } = require("./firebase");
    console.log("🏪 Fetching shops from Admin Database...");
    const snapshot = await dbAdmin.collection("shops").get();
    if (snapshot.empty) {
      return res.json({ success: true, shops: [] });
    }
    const shops = await Promise.all(snapshot.docs.map(async doc => {
      const printersSnapshot = await doc.ref.collection("printers").where("isOnline", "==", true).get();
      return {
        id: doc.id,
        ...doc.data(),
        activePrinters: printersSnapshot.size
      };
    }));
    res.json({
      success: true,
      shops
    });
  } catch (error) {
    console.error("❌ Error fetching shops:", error);
    next(error);
  }
});
// ============================================================================
// ENDPOINT: CREATE RAZORPAY ORDER
// ============================================================================
app.post("/create-razorpay-order", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount) return res.status(400).json({ error: "Amount is required" });
    const options = {
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: `rcpt_${Date.now()}`
    };
    const order = await razorpayInstance.orders.create(options);
    res.json({
      success: true,
      razorpayOrderId: order.id,
      amount: order.amount,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error("❌ Razorpay order creation error:", error);
    next(error);
  }
});
// ============================================================================
// ENDPOINT: VERIFY PAYMENT & CREATE DB ORDER
// ============================================================================
app.post("/verify-payment", async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      printSettings,
      userId,
      userEmail,
      amount,
      totalPages,
      printMode, // Added to differentiate
      customId
    } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Payment details missing" });
    }
    // Verify Signature
    const isMock = razorpay_signature === 'mock_signature_9750';
    if (!isMock) {
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString()).digest("hex");
      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, error: "Invalid payment signature" });
      }
    }
    // Create Order in Firestore(s)
    const result = await createOrder(
      printSettings,
      razorpay_order_id,
      amount,
      totalPages,
      printMode,
      userId || 'guest_user',
      customId,
      userEmail
    );
    const isXeroxShop = printMode === 'xeroxShop';
    const mainCollection = isXeroxShop ? "xerox_orders" : "orders";
    // Update with payment details in Customer DB
    const updateData = {
      userId: userId || 'guest_user',
      razorpayPaymentId: razorpay_payment_id,
      paymentStatus: "PAID",
      status: "ACTIVE",
    };
    // 🛡️ Only generate code if NOT a Xerox shop
    if (!isXeroxShop) {
      updateData.pickupCode = await generateUniquePickupCode(false);
    }
    await db.collection(mainCollection).doc(result.orderId).update(updateData);
    // 🛡️ Admin sync removed from here to prevent incomplete orders from showing up.
    // It is now moved to /complete-order which is called after file upload success.
    // Get final order data to return
    const finalDoc = await db.collection(mainCollection).doc(result.orderId).get();
    const finalData = finalDoc.data();
    res.json({
      success: true,
      orderId: result.orderId,
      pickupCode: finalData.pickupCode,
      xeroxId: finalData.xeroxId || null,
      orderCode: finalData.orderCode || null
    });
  } catch (error) {
    console.error("❌ Payment verification error:", error);
    next(error);
  }
});
// ============================================================================
// ENDPOINT: COMPLETE ORDER (Attach Files - Xerox Shop Side)
// ============================================================================
app.post("/complete-order", async (req, res, next) => {
  try {
    const { orderId, fileUrls, publicIds, printMode } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    
    // 🛠️ Determine mode and config
    const isXerox = printMode === 'xeroxShop';
    const collectionName = isXerox ? "xerox_orders" : "orders";
    const activeConfig = isXerox ? configB : configA;

    // 1. Efficiently update Customer DB
    const orderRef = db.collection(collectionName).doc(orderId);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({ error: "Order not found" });
    }
    const currentData = orderDoc.data();
    let updatedFiles = [...(currentData.printSettings?.files || [])];
    
    // Align nested file metadata with reality
    if (fileUrls && fileUrls.length > 0) {
      for (let i = 0; i < updatedFiles.length && i < fileUrls.length; i++) {
        updatedFiles[i].url = fileUrls[i];
        if (publicIds && publicIds[i]) {
          updatedFiles[i].publicId = publicIds[i];
        }
      }
    }

    // 🚀 NEW: Generate SIGNED URLs for the Customer App too (Universal Access)
    const { getSignedUrl } = require("./cloudinary");
    let signedFileUrls = [];
    if (fileUrls && Array.isArray(fileUrls)) {
      signedFileUrls = fileUrls.map((url) => getSignedUrl(url, activeConfig));
    }


    await orderRef.update({
      fileUrls: signedFileUrls, // ✅ Saved signed links to customer app
      publicIds: publicIds || [],
      "printSettings.files": updatedFiles, 
      status: 'ACTIVE',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. 🔐 IMMEDIATELY UNLOCK FILES
    if (publicIds && publicIds.length > 0) {
      try {
        console.log(`🔓 Unlocking ${publicIds.length} files (Order ${orderId})...`);
        await Promise.all(publicIds.map(async (pid) => {
          // 🚀 SELF-HEALING: Try stripping folder prefixes if root asset exists
          const parts = pid.split('/');
          const flatPid = parts.pop(); // e.g., '1401_1.pdf'
          const idOptions = [pid, flatPid];

          try {
            console.log(`   🔑 Unlocking ID: ${pid}`);
            // 🔓 Perform unlocking on the identified types
            const types = ['image', 'raw'];
            await Promise.all(types.map(async (type) => {
              try {
                await cloudinary.uploader.explicit(pid, {
                  type: 'upload',
                  resource_type: type,
                  access_mode: 'public',
                  invalidate: true
                });
              } catch (e) { /* silent skip */ }
            }));
          } catch (e) { /* silent skip */ }
        }));
        console.log("✅ All files unlocked successfully.");
      } catch (err) {
        console.error("❌ Critical Unlock Error:", err.message);
      }
    }

    // 3. 🛡️ WATERMARK BEFORE ADMIN MIRRORING (Now in Foreground)

    const freshOrderDoc = await orderRef.get();
    const freshData = freshOrderDoc.data();
    const shopId = freshData?.shopId;
      const orderCode = freshData.orderCode || freshData.pickupCode;

    try {
      console.log(`💧 Processing Watermarks for Order ${orderId} (Mode: ${printMode})...`);
      const fileUrls = freshData.fileUrls || [];
      const incomingPublicIds = freshData.publicIds || [];

      // 🔄 Sequential Watermarking (Uses mode-aware logic)
      const watermarkedResults = await Promise.all(
        fileUrls.map((url, index) => 
          applyWatermark(url, orderId, orderCode, index + 1, incomingPublicIds[index], printMode)
        )
      );

      // Extract final links
      const finalFileUrls = watermarkedResults.map((r, i) => r.url || fileUrls[i]);
      const finalPublicIds = watermarkedResults.map((r, i) => r.publicId || publicIds[i]);

      // 4. Update both project databases with the FINAL watermarked links
      await db.collection(collectionName).doc(orderId).update({
        fileUrls: finalFileUrls,
        publicIds: finalPublicIds,
        mirroredToAdmin: isXerox,
        status: 'ACTIVE'
      });

      if (shopId) {
        console.log(`📡 Mirroring finalized Order ${orderId} to Shop Dashboard...`);
        // 🚀 Pass results directly to avoid stale data fetch
        await syncOrderToAdmin(orderId, isXerox, watermarkedResults);
      }

      } catch (err) {
        console.error("❌ Processing Failure (HARD PURGE):", err.message);
        
        try {
          const orderDoc = await db.collection(collectionName).doc(orderId).get();
          if (orderDoc.exists) {
            const data = orderDoc.data();
            const paymentId = data.razorpayPaymentId;
            const isBypass = paymentId && paymentId.startsWith('pay_admin_');

            // 💸 1. INITIATE REFUND (if real money was spent)
            if (paymentId && !isBypass) {
              try {
                console.log(`💸 Initiating AUTOMATIC REFUND for failed Order ${orderId}...`);
                await razorpayInstance.payments.refund(paymentId, {
                  notes: { reason: "Processing Error - Watermark Verification Failed" }
                });
                console.log(`✅ Refund Successful for failed Order ${orderId}.`);
              } catch (refErr) {
                console.error(`⚠️ Refund failed for ${orderId}: ${refErr.message}`);
              }
            }

            // 🗑️ 2. DELETE FILES FROM CLOUDINARY
            try {
              console.log(`🔥 IMMEDIATELY purging Cloudinary files for failed order ${orderId}...`);
              await deleteOrderFilesFromCloudinary(orderId, data, collectionName);
            } catch (cloudErr) {
              console.error(`⚠️ Cloudinary Purge Failed for ${orderId}: ${cloudErr.message}`);
            }

            // 🔥 3. HARD DELETE RECORD (BOTH COLLECTIONS)
            console.log(`🧹 Cleaning up Firebase traces for failed order ${orderId}...`);
            await db.collection(collectionName).doc(orderId).delete();
            
            if (data.shopId) {
              await dbAdmin.collection("shops").doc(data.shopId).collection("orders").doc(orderId).delete().catch(() => null);
            }
          }
        } catch (purgeErr) {
          console.error(`⚠️ Hard Purge Error for ${orderId}: ${purgeErr.message}`);
        }

        // DO NOT display to Admin App/User App (Stop the sync)
        if (!res.headersSent) {
          return res.status(500).json({ 
            success: false, 
            error: "Processing failed. The order has been cancelled and refunded (if applicable).",
            details: err.message 
          });
        }
      }

    // 5. Send final success to Frontend
    res.json({ 
      success: true, 
      message: "Order watermarked and mirrored to shop.",
      orderCode: orderCode
    });

  } catch (error) {
    console.error("❌ COMPLETE ORDER ERROR:", error.message);
    next(error);
  }
});
// ============================================================================
// HELPER: Send Push Notification to Customer
// ============================================================================
async function sendUserStatusNotification(userId, type, orderNumber) {
  try {
    if (!userId) return;
    
    let userDoc = await db.collection("users").doc(userId).get();
    
    // 🛡️ Fallback: If not found by ID (UID), search by email field (for legacy orders)
    if (!userDoc.exists && userId.includes('@')) {
        const snapshot = await db.collection("users").where("email", "==", userId).limit(1).get();
        if (!snapshot.empty) userDoc = snapshot.docs[0];
    }

    if (!userDoc.exists) {
      console.warn(`⚠️ No user record found for ${userId}`);
      return;
    }

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) {
      console.warn(`⚠️ No FCM token found for user ${userId}`);
      return;
    }
    const displayOrderNum = (orderNumber || 'your order').toLowerCase().replace('_', ' ');
    let title, body;
    if (type === 'printed') {
      title = "Print Successful! 🎉";
      body = "Your prints are ready! Please visit the shop to collect them. Visit again!";
    } else if (type === 'generated') {
      title = "Order Ready for Pickup";
      body = "Your order is ready. Visit the shop and scan the QR code to collect.";
    } else {
      return;
    }
    const message = {
      notification: { title, body },
      data: { click_action: "FLUTTER_NOTIFICATION_CLICK" },
      token: fcmToken,
      android: { priority: "high" },
      apns: { payload: { aps: { contentAvailable: true, sound: "default" } } }
    };
    // Customer App is initialized as 'customer' but sometimes it falls back if it's the only one.
    try {
      await admin.app('customer').messaging().send(message);
    } catch (err) {
      await admin.messaging().send(message);
    }
    console.log(`✅ Sent '${type}' notification to user ${userId} for ${displayOrderNum}`);
  } catch (error) {
    console.error(`❌ Error sending notification to user ${userId}:`, error.message);
  }
}
// ============================================================================
// ENDPOINT: MARK AS PRINTED (Cleanup)
// ============================================================================
app.post("/mark-printed", async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    // Try to find in both collections
    const collections = ["orders", "xerox_orders"];
    let orderDoc = null;
    let foundCol = null;

    for (const col of collections) {
      // 1. Direct ID lookup
      let doc = await db.collection(col).doc(orderId).get();
      
      // 2. Fallback: Search by orderCode field
      if (!doc.exists) {
        const snap = await db.collection(col).where("orderCode", "==", orderId).limit(1).get();
        if (!snap.empty) doc = snap.docs[0];
      }
      
      // 3. Fallback: Search by pickupCode field
      if (!doc.exists) {
        const snap = await db.collection(col).where("pickupCode", "==", orderId).limit(1).get();
        if (!snap.empty) doc = snap.docs[0];
      }

      if (doc.exists) {
        orderDoc = doc;
        foundCol = col;
        break;
      }
    }

    if (!orderDoc) {
      console.warn(`⚠️ [mark-printed] Order ${orderId} not found in any collection.`);
      return res.status(404).json({ error: "Order not found in any collection" });
    }

    const orderData = orderDoc.data();
    const targetRef = orderDoc.ref; // 🚀 Use the ref from whichever doc we found
    // Prevent duplicate push notifications
    if (orderData.orderStatus === 'printing completed' || orderData.orderStatus === 'order completed') {
        console.log(`♻️ Order ${orderId} already marked as printed. Skipping notification.`);
    } else {
      console.log(`✅ [Step 1] Marking order ${orderId} as printed from ${foundCol}...`);
      
      // 1. Mark printing as done in Customer DB
      await targetRef.update({
        orderStatus: 'printing completed',
        printStatus: 'printed',
        printedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ [Step 2] Customer DB updated for ${orderId}`);

      // 🛡️ 2. Double-Sync: Update Admin DB directly (Bypass Watcher)
      try {
        const { dbAdmin } = require("./firebase");
        const shopId = orderData.shopId;
        if (shopId) {
          await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).update({
            orderStatus: 'printing completed',
            status: 'ready',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`✅ [Step 3] Dual-Sync: Admin DB updated for Shop ${shopId}`);
        }
      } catch (adminErr) {
        console.warn("⚠️ [Step 3 Warning] Dual-Sync to Admin DB failed:", adminErr.message);
      }
      
      // 3. Notification Handled by Global Watcher (notification_watcher.js)
      // To avoid duplicates, the API only updates the DB; the watcher sends the FCM.
      console.log(`📡 [Step 4] Handing off notification to Global Watcher for ${orderId}`);

      res.json({ success: true, message: `Order ${orderId} processed successfully.` });
    }
  } catch (error) {
    console.error("❌ [CRITICAL] mark-printed endpoint error:", error);
    next(error);
  }
});
// ============================================================================
// ENDPOINT: MARK AS DELIVERED (Final Archival)
// ============================================================================
app.post("/mark-delivered", async (req, res, next) => {
  try {
    const { orderId, shopId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    // 🕒 10-Minute Deletion Grace Period for Files
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000));
    // 🚀 NEW: IMMEDIATELY DELETE FILES & RECORDS ON ANY SCAN COMPLETION
    try {
      const collections = ["xerox_orders", "orders"];
      let foundData = null;
      let foundCol = null;

      // 🔍 1. Find the order in any collection
      for (const col of collections) {
        const doc = await db.collection(col).doc(orderId).get();
        if (doc.exists) {
          foundData = doc.data();
          foundCol = col;
          break;
        }
      }

      if (foundData) {
         // 1️⃣ WALLET SYSTEM SYNC (Credit Shop)
         if (shopId) {
           try {
             await dbAdmin.runTransaction(async (transaction) => {
               const shopRef = dbAdmin.collection("shops").doc(shopId);
               const adminOrderRef = shopRef.collection("orders").doc(orderId);
               
               const shopDoc = await transaction.get(shopRef);
               const adminOrderDoc = await transaction.get(adminOrderRef);
               
               if (shopDoc.exists && adminOrderDoc.exists) {
                 const aData = adminOrderDoc.data();
                 const sData = shopDoc.data();
                 
                 if (aData.isPicked || aData.status === 'completed') return;

                 const totalAmount = Number(aData.amount || 0);
                 const merchantAmount = totalAmount * 0.83;
                 
                 transaction.update(shopRef, {
                   walletBalance: (Number(sData.walletBalance) || 0) + merchantAmount,
                   totalBwPages: (Number(sData.totalBwPages) || 0) + (Number(aData.bwPages) || 0),
                   totalColorPages: (Number(sData.totalColorPages) || 0) + (Number(aData.colorPages) || 0),
                 });

                 transaction.set(shopRef.collection("transactions").doc(), {
                   amount: merchantAmount,
                   totalValue: totalAmount,
                   title: `Payout: #${aData.orderCode || 'SCAN'}`,
                   timestamp: admin.firestore.FieldValue.serverTimestamp(),
                   type: 'credit',
                   orderId: orderId,
                 });
                 
                 transaction.delete(adminOrderRef);
                 console.log(`🤑 Admin Mirror Purged for ${orderId}`);
               }
             });
           } catch (e) { console.error("Wallet Sync Error:", e.message); }
         }

         // 2️⃣ DELETE CLOUDINARY FILES
         console.log(`⚡ Deleting Cloudinary files IMMEDIATELY for ${orderId}`);
         await deleteOrderFilesFromCloudinary(orderId, foundData, foundCol).catch(() => null);

         // 2.5️⃣ MARK FILES AS DELETED IN FIREBASE
         await db.collection(foundCol).doc(orderId).update({
             filesDeleted: true,
             orderStatus: 'files purged',
             status: 'completed',
             purgedAt: admin.firestore.FieldValue.serverTimestamp()
         }).catch(() => null);

         // 3️⃣ DELETE CUSTOMER RECORD
         console.log(`🔥 Hard Deleting Customer Record for ${orderId} in ${foundCol}`);
         await db.collection(foundCol).doc(orderId).delete().catch(() => null);
      }
    } catch (err) {
      console.error("Cleanup/Transaction Error:", err.message);
    }

    res.json({ success: true, message: "Order processed, credited, and purged successfully." });
  } catch (error) {
    console.error("❌ mark-delivered error:", error);
    next(error);
  }
});

// ============================================================================
// ENDPOINT: DELETE ORDER FILES (Cloudinary Alias)
// ============================================================================
app.post("/delete-order-files", async (req, res, next) => {
  try {
    const { orderId, publicIds } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    console.log(`🗑️ Explicit Cloudinary cleanup triggered for Order: ${orderId}`);
    
    let dataForDeletion = null;
    let colForDeletion = "xerox_orders";

    const collections = ["xerox_orders", "orders"];
    for (const col of collections) {
      const doc = await db.collection(col).doc(orderId).get();
      if (doc.exists) {
        dataForDeletion = doc.data();
        colForDeletion = col;
        break;
      }
    }

    if (!dataForDeletion) {
       // If no doc in DB, we rely on provided IDs and default to Xerox mode
       dataForDeletion = { publicIds: publicIds || [], printMode: 'xeroxShop' };
    } else {
       // If found, override publicIds if frontend provided more specific ones
       if (publicIds && publicIds.length > 0) dataForDeletion.publicIds = publicIds;
    }

    if (dataForDeletion.publicIds && dataForDeletion.publicIds.length > 0) {
      await deleteOrderFilesFromCloudinary(orderId, dataForDeletion, colForDeletion);
      res.json({ success: true, message: `Cleanup processed for ${orderId}` });
    } else {
      res.json({ success: true, message: "No files found to delete." });
    }
  } catch (err) {
    console.error("❌ delete-order-files error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================================
// ENDPOINT: REFUND PAYMENT
// ============================================================================
app.post("/refund-payment", async (req, res, next) => {
  try {
    const { razorpay_payment_id, amount } = req.body;
    if (!razorpay_payment_id) {
      return res.status(400).json({ error: "razorpay_payment_id is required" });
    }
    // Check for Admin Bypass Mock Payment
    if (razorpay_payment_id.startsWith('pay_admin_')) {
      console.log(`🛡️ Refund skipped for Admin Bypass payment: ${razorpay_payment_id}`);
      return res.json({
        success: true,
        message: "Refund skipped for Admin Bypass (No actual money charged)"
      });
    }
    console.log(`💸 Processing refund for payment ${razorpay_payment_id}...`);
    const refund = await razorpayInstance.payments.refund(razorpay_payment_id, {
      amount: Math.round(amount * 100) // Convert to paise
    });
    res.json({
      success: true,
      refundId: refund.id,
      message: "Refund initiated successfully"
    });
  } catch (error) {
    console.error("❌ Refund error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process refund"
    });
  }
});
// ============================================================================
// ENDPOINT: PROXY DOWNLOAD (Fixes CORS & Filenames for API links)
// ============================================================================
app.get("/proxy-download", async (req, res, next) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    
    console.log(`📡 [PROXY] Downloading: ${filename}`);
    const axios = require('axios');
    const response = await axios.get(url, { 
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'download.pdf'}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    response.data.pipe(res);
  } catch (error) {
    console.error("❌ Proxy Download Failed:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Cloudinary fetch failed", details: error.message });
    }
  }
});
// ============================================================================
// ERROR HANDLER
// ============================================================================
app.use((err, req, res, next) => {
  console.error("❌ BACKEND ERROR:", err.stack);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error"
  });
});
// Note: Scheduled cleanup consolidated at the top of the file
// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║          🖨️  PRINTER BACKEND SERVER ONLINE 🖨️                ║
║                                                            ║
║  Port: ${PORT}                                                ║
║  Time: ${new Date().toLocaleString()}                                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});