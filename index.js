// ============================================================================
// DEPENDENCIES
// ============================================================================
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ============================================================================
// INTERNAL MODULES
// ============================================================================
const { db } = require("./firebase");
const { performCleanup, cleanupOrder } = require("./cleanup");
const { createOrder, calculateCost, generateUniquePickupCode } = require("./order");
const razorpay = require("./razorpay");
const crypto = require("crypto");

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// AUTOMATED CLEANUP — runs every 5 minutes, deletes orders older than 12h
// ============================================================================
performCleanup();                              // Run once on startup
setInterval(performCleanup, 5 * 60 * 1000);   // Then every 5 minutes

// ============================================================================
// ENDPOINT: HEALTH CHECK
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Printer Backend Server is running",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// ENDPOINT: CREATE RAZORPAY ORDER
// 1. Calculates cost
// 2. Creates Razorpay Order
// 3. Creates PENDING Firestore Order
// ============================================================================
app.post("/razorpay/create-order", async (req, res) => {
  try {
    const { printSettings, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // 1. Calculate Cost
    const totalAmount = calculateCost(printSettings);
    if (totalAmount <= 0) {
      return res.status(400).json({ error: "Invalid print settings or no pages detected" });
    }

    console.log(`DEBUG: Creating Razorpay Order for User: ${userId}, Amount: ₹${totalAmount}`);

    // 2. Create Razorpay Order
    const options = {
      amount: totalAmount * 100, // Amount in paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const rzpOrder = await razorpay.orders.create(options);

    // 3. Create PENDING Order in Firestore
    const appOrder = await createOrder(printSettings, userId, rzpOrder.id);

    // 4. Return to Frontend (Simplified)
    res.json({
      success: true,
      razorpayOrder: rzpOrder,
      orderId: appOrder.orderId,
      totalPrice: totalAmount
    });

  } catch (err) {
    console.error("❌ Razorpay Create Order Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Alias for robustness
app.post("/create-razorpay-order", (req, res) => {
  console.log("DEBUG: Using alias /create-razorpay-order");
  return app._router.handle(req, res, () => { });
});


// ============================================================================
// ENDPOINT: VERIFY RAZORPAY PAYMENT
// 1. Verifies Signature
// 2. Generates Pickup Code
// 3. Sets App Order to ACTIVE
// ============================================================================
app.post("/razorpay/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    // 1. Verify Signature
    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid payment signature" });
    }

    // 2. Generate Pickup Code
    const pickupCode = await generateUniquePickupCode();

    // 3. Update Firestore
    const orderRef = db.collection("orders").doc(orderId);
    await orderRef.update({
      paymentStatus: "PAID",
      status: "ACTIVE",
      razorpayPaymentId: razorpay_payment_id,
      pickupCode: pickupCode,
      paidAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: "Payment verified successfully",
      pickupCode
    });

  } catch (err) {
    console.error("❌ Payment Verification Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ENDPOINT: LEGACY / DIRECT CREATE (Optional - maybe for internal use)
// ============================================================================
app.post("/create-order", async (req, res) => {
  try {
    const { printSettings, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const result = await createOrder(printSettings, userId);

    res.json({
      orderId: result.orderId,
      pickupCode: result.pickupCode,
    });
  } catch (err) {
    console.error("❌ Create order error:", err.message);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  }
});


// ============================================================================
// ENDPOINT: VERIFY PICKUP CODE
// Called by the Raspberry Pi to verify a 6-digit pickup code.
// Returns order details including Cloudinary file URLs.
// ============================================================================
app.post("/verify-pickup-code", async (req, res) => {
  try {
    const { pickupCode } = req.body;

    if (!pickupCode) {
      return res.status(400).json({
        success: false,
        error: "pickupCode is required",
      });
    }

    console.log(`🔍 Verifying pickup code: ${pickupCode}`);

    // Query Firestore for an active order with this pickup code
    const snapshot = await db.collection("orders")
      .where("pickupCode", "==", pickupCode)
      .where("status", "==", "ACTIVE")
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.log(`❌ No active order found for code: ${pickupCode}`);
      return res.status(404).json({
        success: false,
        error: "Invalid or expired pickup code",
      });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    const orderId = orderDoc.id;

    // Guard: already printed
    if (orderData.printStatus === "PRINTED") {
      console.log(`⚠️ Order ${orderId} already printed`);
      return res.status(400).json({
        success: false,
        error: "This order has already been printed",
      });
    }

    // Guard: expired
    const expiresAt = orderData.expiresAt?.toDate();
    if (expiresAt && expiresAt < new Date()) {
      console.log(`⚠️ Order ${orderId} has expired`);
      return res.status(400).json({
        success: false,
        error: "This pickup code has expired",
      });
    }

    // Guard: no files
    const fileUrls = orderData.fileUrls || [];
    if (fileUrls.length === 0) {
      console.log(`⚠️ Order ${orderId} has no files`);
      return res.status(400).json({
        success: false,
        error: "No files found for this order",
      });
    }

    console.log(`✅ Order verified: ${orderId} (${fileUrls.length} files)`);

    res.json({
      success: true,
      orderId,
      fileUrls,
      printSettings: orderData.printSettings || {},
      totalPages: orderData.totalPages || 0,
      totalPrice: orderData.totalPrice || 0,
    });
  } catch (error) {
    console.error("❌ Verify code error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ============================================================================
// ENDPOINT: MARK ORDER AS PRINTED
// Called by the Raspberry Pi after successful printing.
// Updates order status, revokes the pickup code, and cleans up Cloudinary files.
// ============================================================================
app.post("/mark-printed", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "orderId is required",
      });
    }

    console.log(`📝 Marking order as printed: ${orderId}`);

    const orderRef = db.collection("orders").doc(orderId);

    await orderRef.update({
      status: "COMPLETED",
      printStatus: "PRINTED",
      printedAt: admin.firestore.FieldValue.serverTimestamp(),
      pickupCode: null, // Revoke the pickup code
    });

    // Immediately clean up Cloudinary storage after successful print
    const orderDoc = await orderRef.get();
    if (orderDoc.exists) {
      await cleanupOrder(orderId, orderDoc.data());
    }

    console.log(`✅ Order ${orderId} marked as printed`);
    res.json({ success: true, message: "Order marked as printed successfully" });
  } catch (error) {
    console.error("❌ Mark printed error:", error);

    if (error.code === 5) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ============================================================================
// ENDPOINT: GET ORDER STATUS  (debug / admin use)
// ============================================================================
app.get("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderDoc = await db.collection("orders").doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    res.json({ success: true, order: orderDoc.data() });
  } catch (error) {
    console.error("❌ Get order error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// 404 Handler for Debugging
app.use((req, res) => {
  console.log(`⚠️ 404 NOT FOUND: ${req.method} ${req.originalUrl}`);
  res.status(404).send(`Cannot ${req.method} ${req.originalUrl}`);
});

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║          🖨️  PRINTER BACKEND SERVER ONLINE 🖨️             ║
║                                                            ║
║  Port: ${PORT}                                             ║
║  Time: ${new Date().toLocaleString()}                      ║
║                                                            ║
║  Endpoints:                                                ║
║  POST /create-order                                        ║
║  POST /verify-pickup-code                                  ║
║  POST /mark-printed                                        ║
║  GET  /order/:orderId                                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});