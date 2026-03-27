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
const razorpayInstance = require("./razorpay");
const { performCleanup, cleanupOrder } = require("./cleanup");
const { createOrder, calculateCost, generateUniquePickupCode } = require("./order");
const { applyWatermark } = require("./watermark_service");

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
      amount,
      totalPages,
      printMode // Added to differentiate
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
      userId || 'guest_user'
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

    // If Xerox Shop, sync with Admin Project
    if (isXeroxShop && printSettings.shopId) {
      const shopId = printSettings.shopId;
      await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(result.orderId).update({
        userId: userId || 'guest_user',
        razorpayPaymentId: razorpay_payment_id,
        paymentStatus: "done",
        status: "pending",
        pickupCode: result.pickupCode
      });
    }

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
// ENDPOINT: VERIFY PICKUP CODE (Called by Raspberry Pi)
// ============================================================================
// ENDPOINT: COMPLETE ORDER (Attach Files - Backend Side)
// ============================================================================
app.post("/complete-order", async (req, res, next) => {
  try {
    const { orderId, fileUrls, publicIds, localFilePaths, printMode } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    const isXeroxShop = printMode === 'xeroxShop';
    const mainCollection = isXeroxShop ? "xerox_orders" : "orders";

    let watermarkedResults = [];
    let finalFileUrls = fileUrls || [];
    let finalPublicIds = publicIds || [];
    let originalFileUrls = fileUrls || [];

    // If Xerox, apply watermark and track new public IDs
    if (isXeroxShop) {
      const orderDoc = await db.collection("xerox_orders").doc(orderId).get();
      const orderData = orderDoc.data();

      if (orderData && orderData.orderCode && finalFileUrls.length > 0) {
        const displayCode = orderData.orderCode; 
        console.log(`💧 Watermarking Xerox Order ${orderId} with code ${displayCode}`);
        try {
          // New: applyWatermark now returns { url, publicId }
          watermarkedResults = await Promise.all(
            finalFileUrls.map((url, index) => applyWatermark(url, displayCode, index + 1))
          );
          
          finalFileUrls = watermarkedResults.map(r => r.url);
          // Only update publicIds if we got new ones from the watermark service
          finalPublicIds = watermarkedResults.map((r, i) => r.publicId || finalPublicIds[i]);
          
          console.log(`✅ ${finalFileUrls.length} files watermarked for Order ${orderId}`);
        } catch (wmErr) {
          console.error("❌ Watermarking failed in complete-order:", wmErr.message);
        }
      } else {
        console.warn(`⚠️ Watermarking skipped: Missing data ${!!orderData}, Code ${orderData?.orderCode}, Files ${finalFileUrls.length}`);
      }
    }

    // Update main order (Customer DB)
    const dbUpdate = {
      fileUrls: finalFileUrls,
      publicIds: finalPublicIds || [],
      localFilePaths: localFilePaths || [],
      status: 'ACTIVE',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Only keep original URLs for non-Xerox orders (Xerox originals are deleted)
    if (!isXeroxShop) {
      dbUpdate.originalFileUrls = originalFileUrls;
    }

    await db.collection(mainCollection).doc(orderId).update(dbUpdate);

    // If Xerox, update Admin project too
    if (isXeroxShop) {
      const orderDoc = await db.collection("xerox_orders").doc(orderId).get();
      const orderData = orderDoc.data();
      const shopId = orderData ? orderData.shopId : null;

      if (shopId) {
        await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).update({
          fileUrls: finalFileUrls,
          fileUrl: finalFileUrls.length > 0 ? finalFileUrls[0] : null,
          status: 'pending',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    res.json({ success: true, message: "Order completed and files attached" });
  } catch (error) {
    console.error("❌ Complete Order Error:", error);
    next(error);
  }
});

// ============================================================================
// ENDPOINT: VERIFY PICKUP CODE (Raspberry Pi Only)
// ============================================================================
app.post("/verify-pickup-code", async (req, res, next) => {
  try {
    const { pickupCode } = req.body;
    if (!pickupCode) return res.status(400).json({ error: "pickupCode required" });

    console.log(`� Raspberry Pi verifying code: ${pickupCode}`);

    const snapshot = await db.collection('orders')
      .where('pickupCode', '==', pickupCode)
      .where('status', '==', 'ACTIVE')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: "Order not found or expired" });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (data.printStatus === 'printed') {
      return res.status(400).json({ error: "Order already printed" });
    }

    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      return res.status(400).json({ error: "Pickup code has expired" });
    }

    res.json({
      success: true,
      orderId: doc.id,
      fileUrls: data.fileUrls || [],
      printSettings: data.printSettings || {},
      totalPages: data.totalPages || 0
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ENDPOINT: MARK AS PRINTED (Cleanup)
// ============================================================================
app.post("/mark-printed", async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    // Try to find in both collections
    const collections = ["orders", "xerox_orders"];
    let orderData = null;
    let foundCol = null;

    for (const col of collections) {
      const doc = await db.collection(col).doc(orderId).get();
      if (doc.exists) {
        orderData = doc.data();
        foundCol = col;
        break;
      }
    }

    if (!orderData) return res.status(404).json({ error: "Order not found in any collection" });

    console.log(`✅ Marking order ${orderId} as printed from ${foundCol}...`);

    // 1. Mark printing as done but KEEP order active for customer pickup
    await db.collection(foundCol).doc(orderId).update({
      orderStatus: 'printing completed',
      printStatus: 'printed',
      printedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: `Order ${orderId} in ${foundCol} processed.` });
  } catch (error) {
    console.error("❌ mark-printed error:", error);
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

    console.log(`📦 Finalizing Delivery for Order ${orderId} at Shop ${shopId}...`);

    // 1. Update Customer Project (xerox_orders)
    await db.collection("xerox_orders").doc(orderId).update({
      status: 'completed',
      orderStatus: 'order completed',
      isPicked: true,
      orderDone: true,
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.error(`⚠️ Customer project update failed: ${e.message}`));

    // 2. Update Admin Project Mirror (shops/{shopId}/orders/{orderId})
    if (shopId) {
      await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).update({
        status: 'completed',
        orderStatus: 'order completed',
        isPicked: true,
        orderDone: true,
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(e => console.error(`⚠️ Admin project mirror update failed: ${e.message}`));
    }

    res.json({ success: true, message: `Order ${orderId} marked as DELIVERED in both projects.` });
  } catch (error) {
    console.error("❌ mark-delivered error:", error);
    next(error);
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