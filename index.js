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
const { db, dbCustomer, dbAdmin, admin } = require("./firebase");
const { cloudinary, configB } = require("./cloudinary");
const razorpayInstance = require("./razorpay");
const { performCleanup, cleanupOrder, deleteOrderFilesFromCloudinary } = require("./cleanup");
const { createOrder, syncOrderToAdmin, generateUniquePickupCode } = require("./order");
const { applyWatermark } = require("./watermark_service");
const { generateCoverPage } = require("./cover_page_service");
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

    const shops = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const printersSnapshot = await doc.ref
          .collection("printers")
          .where("isOnline", "==", true)
          .get();

        return {
          id: doc.id,
          ...doc.data(),
          activePrinters: printersSnapshot.size,
        };
      })
    );

    res.json({
      success: true,
      shops,
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
      customId
    } = req.body;

    console.log(`\n💳 [Verify Payment Step]`);
    console.log(`   - Selected Shop ID: ${printSettings.shopId} (${printSettings.shopName})`);
    console.log(`   - Custom ID: ${customId}`);
    console.log(`   - Total Paid Amount: ₹${amount}`);
    console.log(`   - Total Pages: ${totalPages}`);
    console.log(`   - User ID: ${userId || 'guest_user'}`);
    console.log(`   - User Email: ${userEmail || 'N/A'}`);
    if (printSettings.files && Array.isArray(printSettings.files)) {
      console.log(`   - Files:`);
      printSettings.files.forEach(f => {
        console.log(`     * ${f.fileName} (${f.paperSize}, ${f.pageCount} pages, ${f.copies} copies, ${f.color}, ${f.doubleSided ? 'Double Sided' : 'Single Sided'})`);
      });
    }

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
    // Create Order in Firestore
    const result = await createOrder(
      printSettings,
      razorpay_order_id,
      amount,
      totalPages,
      'xeroxShop',
      userId || 'guest_user',
      customId,
      userEmail
    );
    const mainCollection = "xerox_orders";
    // Update with payment details in Customer DB
    const updateData = {
      userId: userId || 'guest_user',
      razorpayPaymentId: razorpay_payment_id,
      paymentStatus: "PAID",
      status: "ACTIVE",
    };
    await result.db.collection(mainCollection).doc(result.orderId).update(updateData);
    // 🛡️ Admin sync removed from here to prevent incomplete orders from showing up.
    // It is now moved to /complete-order which is called after file upload success.
    // Get final order data to return
    const finalDoc = await result.db.collection(mainCollection).doc(result.orderId).get();
    const finalData = finalDoc.data();
    res.json({
      success: true,
      orderId: result.orderId,
      pickupCode: finalData.pickupCode,
      xeroxId: finalData.xeroxId || null,
      orderCode: finalData.orderCode || null,
      projectId: result.projectId
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
    
    console.log(`\n📂 [File Upload Completion Step]`);
    console.log(`   - Order ID: ${orderId}`);
    console.log(`   - Print Mode: ${printMode}`);
    if (fileUrls && Array.isArray(fileUrls)) {
      console.log(`   - Uploaded Cloudinary URLs:`);
      fileUrls.forEach((url, i) => {
        console.log(`     * File ${i+1}: ${url}`);
      });
    }

    if (!orderId) return res.status(400).json({ error: "orderId required" });
    
    // 🛠️ Collection and config
    const collectionName = "xerox_orders";
    const activeConfig = configB;
    const { findCustomerOrder } = require("./firebase");
    const { doc: orderDoc, db: targetDb } = await findCustomerOrder(orderId);
    
    if (!orderDoc || !orderDoc.exists) {
      return res.status(404).json({ error: "Order not found" });
    }
    const orderRef = targetDb.collection(collectionName).doc(orderId);
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
        const { getConfigForUrl } = require("./cloudinary");
        const firstUrl = fileUrls && fileUrls.length > 0 ? fileUrls[0] : null;
        const resolvedConfig = getConfigForUrl(firstUrl);
        cloudinary.config(resolvedConfig);

        console.log(`🔓 Unlocking ${publicIds.length} files (Order ${orderId}) on account ${resolvedConfig.cloud_name}...`);
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
      const fileUrls = freshData.fileUrls || [];
      const incomingPublicIds = freshData.publicIds || [];
      const files = freshData.printSettings?.files || [];
      const totalPrintablePages = files.reduce((sum, f) => sum + (Number(f.pageCount) || 1) * (Number(f.copies) || 1), 0);
      
      const generateCoverPageEnabled = totalPrintablePages > 5;
      
      let finalFileUrls = [];
      let finalPublicIds = [];
      let coverPageUrl = null;
      let coverPagePublicId = null;
      let printSequence = [];

      if (generateCoverPageEnabled) {
        console.log(`📄 Generating Cover Page for Order ${orderId} (Total pages: ${totalPrintablePages} > 5)...`);
        
        const formattedFiles = files.map((f, i) => ({
          fileName: f.fileName || `File ${i+1}`,
          copies: Number(f.copies) || 1,
          pageCount: Number(f.pageCount) || 1,
          price: Number(f.price) || 0.0,
        }));

        const coverPageBuffer = await generateCoverPage({
          orderCode,
          customId: freshData.customId || null,
          customerName: freshData.userEmail || freshData.userId || 'Guest User',
          files: formattedFiles,
          coverPageCharge: 2.0,
          platformFee: Number(freshData.platformCommission || freshData.printSettings?.commissionAmount || 2.0)
        });

        const folderName = 'xerox_processed_orders';
        const coverFileName = `${orderCode}_cover`;
        
        console.log(`📤 Uploading cover page to Cloudinary...`);
        const { getConfigForUrl } = require("./cloudinary");
        const firstUrl = fileUrls && fileUrls.length > 0 ? fileUrls[0] : null;
        const resolvedConfig = getConfigForUrl(firstUrl);
        cloudinary.config(resolvedConfig);

        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream({
                folder: folderName,
                public_id: coverFileName,
                resource_type: 'image',
                access_mode: 'public',
                overwrite: true,
                invalidate: true,
                format: 'pdf',
            }, (error, result) => {
                if (error) reject(error);
                else resolve(result);
            });
            uploadStream.end(coverPageBuffer);
        });

        try {
            await cloudinary.uploader.explicit(uploadResult.public_id, {
                type: 'upload',
                resource_type: 'image',
                access_mode: 'public',
                invalidate: true
            });
        } catch (e) {
            console.warn(`⚠️ Force public for cover page failed: ${e.message}`);
        }

        coverPageUrl = uploadResult.secure_url;
        coverPagePublicId = uploadResult.public_id;
        
        const coverPageSignedUrl = getSignedUrl(coverPageUrl, activeConfig, null, coverPagePublicId);
        
        finalFileUrls = [coverPageSignedUrl, ...fileUrls];
        finalPublicIds = [coverPagePublicId, ...incomingPublicIds];
        printSequence = ["coverPage", ...files.map((f, i) => `file${i+1}`)];
      } else {
        console.log(`💧 Processing Watermarks for Order ${orderId} (Total pages: ${totalPrintablePages} <= 5)...`);
        
        // 🔄 Sequential Watermarking (Uses mode-aware logic)
        const watermarkedResults = await Promise.all(
          fileUrls.map((url, index) => 
            applyWatermark(url, orderId, orderCode, index + 1, incomingPublicIds[index], printMode)
          )
        );

        finalFileUrls = watermarkedResults.map((r, i) => r.url || fileUrls[i]);
        finalPublicIds = watermarkedResults.map((r, i) => r.publicId || publicIds[i]);
        printSequence = files.map((f, i) => `file${i+1}`);
      }

      // Update project databases with the FINAL watermarked/prepend links and cover page metadata
      const updateData = {
        fileUrls: finalFileUrls,
        publicIds: finalPublicIds,
        mirroredToAdmin: true,
        status: 'ACTIVE',
        generateCoverPage: generateCoverPageEnabled,
        coverPageCharge: generateCoverPageEnabled ? 2.0 : 0.0,
        coverPageUrl: coverPageUrl,
        coverPagePublicId: coverPagePublicId,
        printSequence: printSequence,
        generatedCoverPage: generateCoverPageEnabled,
      };

      await orderRef.update(updateData);

      if (shopId) {
        console.log(`📡 Mirroring finalized Order ${orderId} to Shop Dashboard...`);
        const watermarkedResults = finalFileUrls.map((url, idx) => ({
            url: url,
            publicId: finalPublicIds[idx]
        }));
        await syncOrderToAdmin(orderId, watermarkedResults);
      }

      } catch (err) {
        console.error("❌ Processing Failure (HARD PURGE):", err.message);
        
        try {
          const orderDoc = await orderRef.get();
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
            await orderRef.delete();
            
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
// ENDPOINT: MARK AS PRINTED (Cleanup)
// ============================================================================
app.post("/mark-printed", async (req, res, next) => {
  try {
    const { orderId, shopId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    
    let customerDocUpdated = false;
    let adminDocUpdated = false;

    // 1. Try to update Customer DB
    try {
      const { findCustomerOrderByIdOrCode } = require("./firebase");
      const { doc: orderDoc } = await findCustomerOrderByIdOrCode(orderId);

      if (orderDoc.exists) {
        const orderData = orderDoc.data();
        await orderDoc.ref.update({
          orderStatus: 'printing completed',
          printStatus: 'printed',
          printedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        customerDocUpdated = true;
        console.log(`✅ Customer DB updated for ${orderId}`);
        
        const resolvedShopId = shopId || orderData.shopId;
        if (resolvedShopId) {
          await dbAdmin.collection("shops").doc(resolvedShopId).collection("orders").doc(orderId).update({
            orderStatus: 'printing completed',
            status: 'ready',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          adminDocUpdated = true;
          console.log(`✅ Admin DB updated for ${orderId} (Shop ${resolvedShopId})`);
        }
      }
    } catch (err) {
      console.warn("⚠️ Customer DB update error in /mark-printed:", err.message);
    }

    // 2. If Admin DB was not updated and shopId is available, update it directly
    if (!adminDocUpdated && shopId) {
      try {
        const adminOrderRef = dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId);
        const adminOrderDoc = await adminOrderRef.get();
        if (adminOrderDoc.exists) {
          await adminOrderRef.update({
            orderStatus: 'printing completed',
            status: 'ready',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          adminDocUpdated = true;
          console.log(`✅ Admin DB updated directly for ${orderId} (Shop ${shopId})`);
        }
      } catch (err) {
        console.warn("⚠️ Admin DB direct update error in /mark-printed:", err.message);
      }
    }

    // Return success if at least one document was updated
    if (customerDocUpdated || adminDocUpdated) {
      return res.json({ success: true, message: `Order ${orderId} processed successfully.` });
    } else {
      console.warn(`⚠️ [mark-printed] Order ${orderId} not found in Customer DB or Admin DB.`);
      return res.status(404).json({ error: "Order not found" });
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
      const collection = "xerox_orders";
      let foundData = null;
      let foundCol = collection;

      // 🔍 1. Find the order in customer databases
      const { findCustomerOrder } = require("./firebase");
      const { doc, db: targetDb } = await findCustomerOrder(orderId);
      if (doc && doc.exists) {
        foundData = doc.data();
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
                 const coverPageCharge = Number(aData.coverPageCharge || 0);

                 // Try to determine platform commission from available fields (platformEarnings or platformCommission)
                 let platformEarnings = aData.platformEarnings !== undefined
                    ? Number(aData.platformEarnings)
                    : (aData.platformCommission !== undefined
                        ? Number(aData.platformCommission)
                        : 0.0);
                 
                 // Add cover page charge to platform/admin earnings
                 platformEarnings += coverPageCharge;

                 // Try to determine merchant earnings from available fields (shopkeeperEarnings or printingCost)
                 const merchantAmount = aData.shopkeeperEarnings !== undefined
                    ? Number(aData.shopkeeperEarnings)
                    : (aData.printingCost !== undefined
                        ? Number(aData.printingCost)
                        : totalAmount - platformEarnings);
                 
                 transaction.update(shopRef, {
                   walletBalance: (Number(sData.walletBalance) || 0) + merchantAmount,
                   totalBwPages: (Number(sData.totalBwPages) || 0) + (Number(aData.bwPages) || 0),
                   totalColorPages: (Number(sData.totalColorPages) || 0) + (Number(aData.colorPages) || 0),
                 });

                 transaction.set(shopRef.collection("transactions").doc(), {
                   amount: merchantAmount,
                   totalValue: totalAmount,
                   platformCommission: platformEarnings,
                   title: `Payout: #${aData.orderCode || 'SCAN'}`,
                   timestamp: admin.firestore.FieldValue.serverTimestamp(),
                   type: 'credit',
                   orderId: orderId,
                 });
                 
                 const historyRef = shopRef.collection("history").doc(orderId);
                 transaction.set(historyRef, {
                   orderId: orderId,
                   orderCode: aData.orderCode || orderId,
                   customerName: aData.customerName || 'Guest',
                   amount: totalAmount,
                   printingCost: merchantAmount,
                   platformCommission: platformEarnings,
                   bwPages: Number(aData.bwPages || 0),
                   colorPages: Number(aData.colorPages || 0),
                   isDuplex: aData.isDuplex === true,
                   copies: Number(aData.copies || 1),
                   serviceName: aData.serviceName || 'Documents (Xerox)',
                   fileName: 'Files Purged',
                   fileUrls: [],
                   viewUrls: [],
                   fileNames: [],
                   collectedAt: admin.firestore.FieldValue.serverTimestamp(),
                   timestamp: aData.timestamp || admin.firestore.FieldValue.serverTimestamp(),
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
         await targetDb.collection(foundCol).doc(orderId).update({
             filesDeleted: true,
             orderStatus: 'files purged',
             status: 'completed',
             purgedAt: admin.firestore.FieldValue.serverTimestamp()
         }).catch(() => null);

         // 3️⃣ DELETE CUSTOMER RECORD
         console.log(`🔥 Hard Deleting Customer Record for ${orderId} in ${foundCol}`);
         await targetDb.collection(foundCol).doc(orderId).delete().catch(() => null);
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

    // Check xerox_orders
    const { findCustomerOrder } = require("./firebase");
    const { doc } = await findCustomerOrder(orderId);
    if (doc && doc.exists) {
        dataForDeletion = doc.data();
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
// ENDPOINT: SET SHOP STATUS (Online/Offline)
// ============================================================================
app.post("/set-shop-status", async (req, res, next) => {
  try {
    const { shopId, isOpen } = req.body;
    if (!shopId) return res.status(400).json({ error: "shopId required" });
    
    await dbAdmin.collection("shops").doc(shopId).update({
      isOpen: isOpen === true || isOpen === 'true',
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`🏪 Shop ${shopId} marked as ${isOpen ? 'ONLINE' : 'OFFLINE'}`);
    res.json({ success: true, message: `Shop ${shopId} is now ${isOpen ? 'online' : 'offline'}.` });
  } catch (error) {
    console.error("❌ Error setting shop status:", error);
    next(error);
  }
});

// ============================================================================
// ENDPOINT: CONFIGURATION VERSION API
// ============================================================================
async function incrementServiceVersion() {
  const increment = admin.firestore.FieldValue.increment(1);
  await dbCustomer.collection("shops").doc("serviceVersion").set({ version: increment }, { merge: true });
  await dbAdmin.collection("shops").doc("serviceVersion").set({ version: increment }, { merge: true });
}

app.get("/api/config/version", async (req, res, next) => {
  try {
    const docRef = dbCustomer.collection("shops").doc("serviceVersion");
    const doc = await docRef.get();
    if (!doc.exists) {
      await docRef.set({ version: 1 });
      return res.json({ success: true, version: 1 });
    }
    res.json({ success: true, version: doc.data().version || 1 });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ENDPOINTS: SERVICE MANAGEMENT CATALOG APIs (Used by Zikrinter Service Panel)
// ============================================================================
app.get("/api/services", async (req, res, next) => {
  try {
    const snapshot = await dbCustomer.collection("services").get();
    const services = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.isDeleted !== true) {
        services.push({ id: doc.id, ...data });
      }
    });
    res.json({ success: true, services });
  } catch (error) {
    next(error);
  }
});

app.get("/api/services/:id", async (req, res, next) => {
  try {
    const doc = await dbCustomer.collection("services").doc(req.params.id).get();
    if (!doc.exists || doc.data().isDeleted === true) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }
    res.json({ success: true, service: { id: doc.id, ...doc.data() } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/services", async (req, res, next) => {
  try {
    const serviceData = req.body;
    if (!serviceData.name) {
      return res.status(400).json({ success: false, error: "Service name is required" });
    }

    const docId = serviceData.id || dbCustomer.collection("services").doc().id;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const newService = {
      id: docId,
      name: serviceData.name,
      images: serviceData.images || [],
      isActive: serviceData.isActive !== false,
      parameters: serviceData.parameters || {},
      customParameters: serviceData.customParameters || [],
      startingPrice: Number(serviceData.startingPrice) || 0.0,
      description: serviceData.description || "",
      paperSizes: serviceData.paperSizes || ["A4"],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      schemaVersion: 2,
      isDeleted: false,
      updatedBy: serviceData.updatedBy || "system_admin",
    };

    await dbCustomer.collection("services").doc(docId).set(newService);
    await dbAdmin.collection("services").doc(docId).set(newService);

    await dbCustomer.collection("service_audit_logs").add({
      serviceId: docId,
      action: "CREATE",
      timestamp: timestamp,
      updatedBy: newService.updatedBy,
      details: "Created service centralized",
    });

    await incrementServiceVersion();

    res.json({ success: true, service: newService });
  } catch (error) {
    next(error);
  }
});

app.put("/api/services/:id", async (req, res, next) => {
  try {
    const docId = req.params.id;
    const serviceData = req.body;

    const docRef = dbCustomer.collection("services").doc(docId);
    const docSnapshot = await docRef.get();
    if (!docSnapshot.exists) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }

    const currentData = docSnapshot.data();
    const currentVersion = Number(currentData.version) || 1;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const updatedService = {
      ...currentData,
      name: serviceData.name !== undefined ? serviceData.name : currentData.name,
      images: serviceData.images !== undefined ? serviceData.images : currentData.images,
      isActive: serviceData.isActive !== undefined ? serviceData.isActive : currentData.isActive,
      parameters: serviceData.parameters !== undefined ? serviceData.parameters : currentData.parameters,
      customParameters: serviceData.customParameters !== undefined ? serviceData.customParameters : currentData.customParameters,
      startingPrice: serviceData.startingPrice !== undefined ? Number(serviceData.startingPrice) : currentData.startingPrice,
      description: serviceData.description !== undefined ? serviceData.description : currentData.description,
      paperSizes: serviceData.paperSizes !== undefined ? serviceData.paperSizes : currentData.paperSizes,
      updatedAt: timestamp,
      version: currentVersion + 1,
      isDeleted: serviceData.isDeleted !== undefined ? serviceData.isDeleted : currentData.isDeleted,
      updatedBy: serviceData.updatedBy || "system_admin",
    };

    await dbCustomer.collection("services").doc(docId).set(updatedService);
    await dbAdmin.collection("services").doc(docId).set(updatedService);

    await dbCustomer.collection("service_audit_logs").add({
      serviceId: docId,
      action: "UPDATE",
      timestamp: timestamp,
      updatedBy: updatedService.updatedBy,
      details: "Updated service centralized",
    });

    await incrementServiceVersion();

    res.json({ success: true, service: updatedService });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/services/:id", async (req, res, next) => {
  try {
    const docId = req.params.id;
    const docRef = dbCustomer.collection("services").doc(docId);
    const docSnapshot = await docRef.get();
    if (!docSnapshot.exists) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }

    const currentData = docSnapshot.data();
    const currentVersion = Number(currentData.version) || 1;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const deletedService = {
      ...currentData,
      isActive: false,
      isDeleted: true,
      updatedAt: timestamp,
      version: currentVersion + 1,
    };

    await dbCustomer.collection("services").doc(docId).set(deletedService);
    await dbAdmin.collection("services").doc(docId).set(deletedService);

    await dbCustomer.collection("service_audit_logs").add({
      serviceId: docId,
      action: "DELETE",
      timestamp: timestamp,
      updatedBy: "system_admin",
      details: "Soft deleted service centralized",
    });

    await incrementServiceVersion();

    res.json({ success: true, message: "Service deleted successfully (soft delete)." });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ENDPOINTS: SHOP AVAILABILITY & CONFIGURATION APIs (Used by Customer/Captain Apps)
// ============================================================================
app.get("/api/services/:id/shops", async (req, res, next) => {
  try {
    const serviceId = req.params.id;
    const paperSize = req.query.paperSize;
    if (!paperSize) {
      return res.status(400).json({ success: false, error: "paperSize query parameter is required" });
    }
    const sizeKey = paperSize.toLowerCase();

    const snapshot = await dbAdmin.collection("shops").get();

    const serviceDoc = await dbCustomer.collection("services").doc(serviceId).get();
    if (!serviceDoc.exists || serviceDoc.data().isDeleted === true) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }
    const globalParams = serviceDoc.data().parameters || {};

    console.log(`\n🔍 [Shop Search] Querying eligible shops for Service ID: ${serviceId}, Paper Size: ${paperSize}`);
    const eligibleShops = [];
    for (const doc of snapshot.docs) {
      const shopData = doc.data();
      const shopName = shopData.shopName || "Unknown Shop";
      const zikrinterServices = shopData.zikrinterServices || {};
      const serviceConfig = zikrinterServices[serviceId];

      const isBlocked = shopData.isBlocked === true;
      const isAcceptingOrders = shopData.isAcceptingOrders !== false;
      const isOpen = shopData.isOpen === true;

      if (shopData.isActive === false) {
        console.log(` ❌ Shop [${shopName}] is deactivated.`);
        continue;
      }
      if (!isOpen) {
        console.log(` ❌ Shop [${shopName}] is offline (isOpen = false).`);
        continue;
      }
      if (isBlocked) {
        console.log(` ❌ Shop [${shopName}] is blocked.`);
        continue;
      }
      if (!isAcceptingOrders) {
        console.log(` ❌ Shop [${shopName}] is not accepting orders.`);
        continue;
      }
      if (!serviceConfig) {
        console.log(` ❌ Shop [${shopName}] has not configured this service.`);
        continue;
      }
      if (serviceConfig.isEnabled !== true) {
        console.log(` ❌ Shop [${shopName}] has disabled this service.`);
        continue;
      }

      const paperSizesConfig = serviceConfig.paperSizes || {};
      const sizeConfig = paperSizesConfig[sizeKey];

      let bwPrice = 0.0;
      let colorPrice = 0.0;
      if (sizeConfig) {
        bwPrice = Number(sizeConfig.bw?.singleSidePrice) || 0.0;
        colorPrice = Number(sizeConfig.color?.singleSidePrice) || 0.0;
      } else {
        bwPrice = Number(serviceConfig[`${sizeKey}_bw_singleSidePrice`]) || 0.0;
        colorPrice = Number(serviceConfig[`${sizeKey}_color_singleSidePrice`]) || 0.0;
        if (sizeKey === 'a4') {
          bwPrice = Number(serviceConfig.bw_singleSidePrice) || bwPrice;
          colorPrice = Number(serviceConfig.color_singleSidePrice) || Number(serviceConfig.singleSidePrice) || colorPrice;
        }
      }

      const bwSingleGlobal = globalParams[`${sizeKey}_bw_singleSide`] || globalParams.bw_singleSide || {};
      const colorSingleGlobal = globalParams[`${sizeKey}_color_singleSide`] || globalParams.color_singleSide || {};
      const isBwEnabledGlobally = bwSingleGlobal.isEnabled === true || globalParams.bw_singleSide?.isEnabled === true;
      const isColorEnabledGlobally = colorSingleGlobal.isEnabled === true || globalParams.color_singleSide?.isEnabled === true;

      const isBwConfigured = !isBwEnabledGlobally || bwPrice > 0.0;
      const isColorConfigured = !isColorEnabledGlobally || colorPrice > 0.0;

      if (isBwConfigured && isColorConfigured && (bwPrice > 0.0 || colorPrice > 0.0)) {
        const printersSnapshot = await doc.ref.collection("printers").where("isOnline", "==", true).get();
        
        console.log(` ✅ Shop [${shopName}] is ELIGIBLE. BW Price: ₹${bwPrice}, Color Price: ₹${colorPrice}, Active Printers: ${printersSnapshot.size}`);

        eligibleShops.push({
          id: doc.id,
          ...shopData,
          activePrinters: printersSnapshot.size,
        });
      } else {
        console.log(` ❌ Shop [${shopName}] - Pricing not fully configured for paper size [${sizeKey}].`);
      }
    }
    console.log(`🔍 [Shop Search] Query complete. Found ${eligibleShops.length} eligible shop(s).\n`);

    res.json({ success: true, shops: eligibleShops });
  } catch (error) {
    next(error);
  }
});

app.get("/api/shop/services", async (req, res, next) => {
  try {
    const shopId = req.query.shopId;
    if (!shopId) return res.status(400).json({ success: false, error: "shopId required" });

    const shopDoc = await dbAdmin.collection("shops").doc(shopId).get();
    if (!shopDoc.exists) return res.status(404).json({ success: false, error: "Shop not found" });

    const shopData = shopDoc.data();
    const zikrinterServices = shopData.zikrinterServices || {};

    const snapshot = await dbCustomer.collection("services").get();
    const services = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.isDeleted !== true) {
        services.push({
          id: doc.id,
          ...data,
          shopConfig: zikrinterServices[doc.id] || null,
        });
      }
    });

    res.json({ success: true, shop: { id: shopDoc.id, ...shopData }, services });
  } catch (error) {
    next(error);
  }
});

app.get("/api/shop/:id/status", async (req, res, next) => {
  try {
    const shopDoc = await dbAdmin.collection("shops").doc(req.params.id).get();
    if (!shopDoc.exists) {
      return res.status(404).json({ success: false, isOpen: false, error: "Shop not found" });
    }
    const data = shopDoc.data();
    res.json({
      success: true,
      isOpen: data.isOpen === true,
      isAcceptingOrders: data.isAcceptingOrders !== false,
      isBlocked: data.isBlocked === true,
      isActive: data.isActive !== false
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/shop/pending-paper-sizes", async (req, res, next) => {
  try {
    const shopId = req.query.shopId;
    if (!shopId) return res.status(400).json({ success: false, error: "shopId required" });

    const shopDoc = await dbAdmin.collection("shops").doc(shopId).get();
    if (!shopDoc.exists) return res.status(404).json({ success: false, error: "Shop not found" });

    const shopData = shopDoc.data();
    const zikrinterServices = shopData.zikrinterServices || {};

    const snapshot = await dbCustomer.collection("services").get();
    const pending = {};

    snapshot.forEach(doc => {
      const serviceId = doc.id;
      const data = doc.data();
      if (data.isDeleted === true) return;

      const globalSizes = data.paperSizes || ["A4"];
      const globalParams = data.parameters || {};
      const shopConfig = zikrinterServices[serviceId];

      if (shopConfig && shopConfig.isEnabled === true) {
        const missing = [];
        for (const size of globalSizes) {
          const sizeKey = size.toLowerCase();
          
          const bwSingleGlobal = globalParams[`${sizeKey}_bw_singleSide`] || globalParams.bw_singleSide || {};
          const colorSingleGlobal = globalParams[`${sizeKey}_color_singleSide`] || globalParams.color_singleSide || {};
          const isBwEnabledGlobally = bwSingleGlobal.isEnabled === true || globalParams.bw_singleSide?.isEnabled === true;
          const isColorEnabledGlobally = colorSingleGlobal.isEnabled === true || globalParams.color_singleSide?.isEnabled === true;

          const sizeConfig = shopConfig.paperSizes?.[sizeKey];
          let bwPrice = 0.0;
          let colorPrice = 0.0;
          if (sizeConfig) {
            bwPrice = Number(sizeConfig.bw?.singleSidePrice) || 0.0;
            colorPrice = Number(sizeConfig.color?.singleSidePrice) || 0.0;
          } else {
            bwPrice = Number(shopConfig[`${sizeKey}_bw_singleSidePrice`]) || 0.0;
            colorPrice = Number(shopConfig[`${sizeKey}_color_singleSidePrice`]) || 0.0;
            if (sizeKey === 'a4') {
              bwPrice = Number(shopConfig.bw_singleSidePrice) || bwPrice;
              colorPrice = Number(shopConfig.color_singleSidePrice) || Number(shopConfig.singleSidePrice) || colorPrice;
            }
          }

          const isBwMissing = isBwEnabledGlobally && bwPrice <= 0.0;
          const isColorMissing = isColorEnabledGlobally && colorPrice <= 0.0;

          if (isBwMissing || isColorMissing) {
            missing.push(size);
          }
        }
        if (missing.length > 0) {
          pending[serviceId] = missing;
        }
      }
    });

    res.json({ success: true, pending });
  } catch (error) {
    next(error);
  }
});

app.post("/api/shop/pricing", async (req, res, next) => {
  try {
    const { shopId, serviceId, isEnabled, pricingData } = req.body;
    if (!shopId || !serviceId) {
      return res.status(400).json({ success: false, error: "shopId and serviceId are required" });
    }

    const updateData = {};
    if (isEnabled !== undefined) {
      updateData[`zikrinterServices.${serviceId}.isEnabled`] = isEnabled;
    }

    if (pricingData) {
      Object.keys(pricingData).forEach(sizeKey => {
        const config = pricingData[sizeKey];
        updateData[`zikrinterServices.${serviceId}.paperSizes.${sizeKey}`] = config;

        const bwSingle = Number(config.bw?.singleSidePrice) || 0.0;
        const bwDouble = Number(config.bw?.doubleSidePrice) || 0.0;
        const bwBulk = Number(config.bw?.bulkPrintingPrice) || 0.0;

        const colorSingle = Number(config.color?.singleSidePrice) || 0.0;
        const colorDouble = Number(config.color?.doubleSidePrice) || 0.0;
        const colorBulk = Number(config.color?.bulkPrintingPrice) || 0.0;

        updateData[`zikrinterServices.${serviceId}.${sizeKey}_bw_singleSidePrice`] = bwSingle;
        updateData[`zikrinterServices.${serviceId}.${sizeKey}_bw_doubleSidePrice`] = bwDouble;
        updateData[`zikrinterServices.${serviceId}.${sizeKey}_bw_bulkPrintingPrice`] = bwBulk;
        updateData[`zikrinterServices.${serviceId}.${sizeKey}_color_singleSidePrice`] = colorSingle;
        updateData[`zikrinterServices.${serviceId}.${sizeKey}_color_doubleSidePrice`] = colorDouble;
        updateData[`zikrinterServices.${serviceId}.${sizeKey}_color_bulkPrintingPrice`] = colorBulk;

        if (sizeKey === 'a4') {
          updateData[`zikrinterServices.${serviceId}.bw_singleSidePrice`] = bwSingle;
          updateData[`zikrinterServices.${serviceId}.bw_doubleSidePrice`] = bwDouble;
          updateData[`zikrinterServices.${serviceId}.bw_bulkPrintingPrice`] = bwBulk;
          updateData[`zikrinterServices.${serviceId}.color_singleSidePrice`] = colorSingle;
          updateData[`zikrinterServices.${serviceId}.color_doubleSidePrice`] = colorDouble;
          updateData[`zikrinterServices.${serviceId}.color_bulkPrintingPrice`] = colorBulk;
          updateData[`zikrinterServices.${serviceId}.singleSidePrice`] = colorSingle;
          updateData[`zikrinterServices.${serviceId}.doubleSidePrice`] = colorDouble;
          updateData[`zikrinterServices.${serviceId}.bulkPrintingPrice`] = colorBulk;
        }
      });
    }

    updateData[`zikrinterServices.${serviceId}.updatedAt`] = admin.firestore.FieldValue.serverTimestamp();

    await dbAdmin.collection("shops").doc(shopId).update(updateData);
    
    await incrementServiceVersion();

    res.json({ success: true, message: "Shop pricing configured successfully" });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ENDPOINT: DYNAMIC PRICING CALCULATION API
// ============================================================================
app.post("/api/pricing/calculate", async (req, res, next) => {
  try {
    const { shopId, serviceId, paperSize, copies, pages, printType, isPortrait, isColor } = req.body;
    if (!shopId || !serviceId || !paperSize) {
      return res.status(400).json({ success: false, error: "shopId, serviceId, and paperSize are required" });
    }

    const numCopies = Number(copies) || 1;
    const numPages = Number(pages) || 1;
    const sizeKey = paperSize.toLowerCase();

    const shopDoc = await dbAdmin.collection("shops").doc(shopId).get();
    if (!shopDoc.exists) return res.status(404).json({ success: false, error: "Shop not found" });

    const shopData = shopDoc.data();
    const zikrinterServices = shopData.zikrinterServices || {};
    const serviceConfig = zikrinterServices[serviceId] || {};

    const serviceDoc = await dbCustomer.collection("services").doc(serviceId).get();
    if (!serviceDoc.exists || serviceDoc.data().isDeleted === true) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }
    const globalParams = serviceDoc.data().parameters || {};

    const paperSizesConfig = serviceConfig.paperSizes || {};
    const sizeConfig = paperSizesConfig[sizeKey];

    let bwSingle = 2.0;
    let bwDouble = 3.0;
    let bwBulk = 1.5;

    let colorSingle = 10.0;
    let colorDouble = 15.0;
    let colorBulk = 8.0;

    if (sizeConfig) {
      bwSingle = Number(sizeConfig.bw?.singleSidePrice) || bwSingle;
      bwDouble = Number(sizeConfig.bw?.doubleSidePrice) || bwDouble;
      bwBulk = Number(sizeConfig.bw?.bulkPrintingPrice) || bwBulk;

      colorSingle = Number(sizeConfig.color?.singleSidePrice) || colorSingle;
      colorDouble = Number(sizeConfig.color?.doubleSidePrice) || colorDouble;
      colorBulk = Number(sizeConfig.color?.bulkPrintingPrice) || colorBulk;
    } else {
      bwSingle = Number(serviceConfig[`${sizeKey}_bw_singleSidePrice`]) || bwSingle;
      bwDouble = Number(serviceConfig[`${sizeKey}_bw_doubleSidePrice`]) || bwDouble;
      bwBulk = Number(serviceConfig[`${sizeKey}_bw_bulkPrintingPrice`]) || bwBulk;

      colorSingle = Number(serviceConfig[`${sizeKey}_color_singleSidePrice`]) || colorSingle;
      colorDouble = Number(serviceConfig[`${sizeKey}_color_doubleSidePrice`]) || colorDouble;
      colorBulk = Number(serviceConfig[`${sizeKey}_color_bulkPrintingPrice`]) || colorBulk;

      if (sizeKey === 'a4') {
        bwSingle = Number(serviceConfig.bw_singleSidePrice) || bwSingle;
        bwDouble = Number(serviceConfig.bw_doubleSidePrice) || bwDouble;
        bwBulk = Number(serviceConfig.bw_bulkPrintingPrice) || bwBulk;
        colorSingle = Number(serviceConfig.color_singleSidePrice) || Number(serviceConfig.singleSidePrice) || colorSingle;
        colorDouble = Number(serviceConfig.color_doubleSidePrice) || colorDouble;
        colorBulk = Number(serviceConfig.color_bulkPrintingPrice) || colorBulk;
      }
    }

    let rate = isColor ? colorSingle : bwSingle;
    if (printType === 'doubleSide') {
      rate = isColor ? colorDouble : bwDouble;
    }

    const bwBulkStart = Number(globalParams[`${sizeKey}_bw_bulkStartPages`] || globalParams.bw_bulkStartPages || 10);
    const colorBulkStart = Number(globalParams[`${sizeKey}_color_bulkStartPages`] || globalParams.color_bulkStartPages || 10);
    const bulkStart = isColor ? colorBulkStart : bwBulkStart;
    const bulkRate = isColor ? colorBulk : bwBulk;

    if (numPages >= bulkStart && bulkRate > 0) {
      rate = bulkRate;
    }

    const baseCost = rate * numPages * numCopies;

    const bwSingleGlobal = globalParams[`${sizeKey}_bw_singleSide`] || globalParams.bw_singleSide || {};
    const colorSingleGlobal = globalParams[`${sizeKey}_color_singleSide`] || globalParams.color_singleSide || {};
    
    let commType = serviceDoc.data().commissionType || 'percentage';
    let commVal = Number(serviceDoc.data().commissionValue) || 0.0;

    if (serviceDoc.data().commissionValue === undefined) {
      const selectedGlobal = isColor ? colorSingleGlobal : bwSingleGlobal;
      commType = selectedGlobal.commissionType || commType;
      commVal = Number(selectedGlobal.commission) || commVal;
    }

    let commission = 0.0;
    if (commType === 'percentage') {
      commission = baseCost * (commVal / 100);
    } else {
      commission = commVal * numPages * numCopies;
    }

    const platformFee = 1.0;
    const extraPageFee = numPages > 5 ? 2.0 * numCopies : 0.0;
    const finalAmount = baseCost + commission + platformFee + extraPageFee;

    const totalPrintablePages = numPages * numCopies;
    const generateCoverPage = totalPrintablePages > 5;
    const coverPageCharge = generateCoverPage ? 2.0 : 0.0;

    res.json({
      success: true,
      totalPrintablePages,
      generateCoverPage,
      coverPageCharge,
      breakdown: {
        paperSize,
        copies: numCopies,
        pages: numPages,
        printType,
        isPortrait,
        isColor,
        rate,
        baseCost,
        commissionType: commType,
        commissionValue: commVal,
        commission,
        platformFee,
        finalAmount,
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// 404 HANDLER (MUST BE LAST)
// ============================================================================
app.use((req, res) => {
  console.log(`⚠️ 404 NOT FOUND: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.url} not found on this server.`
  });
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
// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;

async function printActiveShopsOnStartup() {
  try {
    const servicesSnapshot = await dbCustomer.collection("services").get();
    const activeServiceIds = new Set();
    servicesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.isDeleted !== true) {
        activeServiceIds.add(doc.id);
      }
    });

    const snapshot = await dbAdmin.collection("shops").get();
    console.log("\n🏪 ================= ACTIVE SHOPS SUMMARY =================");
    snapshot.forEach(doc => {
      const data = doc.data();
      if (doc.id === "serviceVersion") return;
      const isOpen = data.isOpen === true;
      const services = Object.keys(data.zikrinterServices || {})
        .filter(id => data.zikrinterServices[id].isEnabled === true && activeServiceIds.has(id));
      if (isOpen) {
        console.log(` 🟢 Shop: ${data.shopName || doc.id} is ONLINE. Enabled Services: [${services.join(", ")}]`);
      } else {
        console.log(` 🔴 Shop: ${data.shopName || doc.id} is OFFLINE.`);
      }
    });
    console.log("============================================================\n");
  } catch (err) {
    console.error("Error printing active shops summary:", err.message);
  }
}

// 🏪 SHOP HEARTBEAT AUTO-OFFLINE SWEEPER
// Sweeps all shops once every 30 seconds and sets them offline if they haven't sent a heartbeat in the last 45 seconds
setInterval(async () => {
  try {
    const cutoffTime = new Date(Date.now() - 45 * 1000); // 45 seconds ago
    const querySnapshot = await dbAdmin.collection("shops")
      .where("isOpen", "==", true)
      .get();

    const batch = dbAdmin.batch();
    let count = 0;
    
    querySnapshot.forEach(doc => {
      const data = doc.data();
      const lastActive = data.lastActive ? data.lastActive.toDate() : null;
      
      // If lastActive is missing or older than 45 seconds, mark offline
      if (!lastActive || lastActive < cutoffTime) {
        batch.update(doc.ref, {
          isOpen: false,
          lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        count++;
        console.log(`🏪 Auto-Offline: Shop ${doc.id} (${data.shopName || 'Unnamed'}) marked offline due to inactivity.`);
      }
    });

    if (count > 0) {
      await batch.commit();
    }
  } catch (error) {
    console.error("❌ Shop Heartbeat Sweeper Error:", error.message);
  }
}, 30 * 1000);

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
  printActiveShopsOnStartup();
});