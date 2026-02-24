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
const { db, admin } = require("./firebase");
const razorpayInstance = require("./razorpay");
const { performCleanup, cleanupOrder } = require("./cleanup");
const { createOrder, calculateCost, generateUniquePickupCode } = require("./order");

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

// ============================================================================
// AUTOMATED CLEANUP — runs every 5 minutes, deletes orders older than 24h
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
    razorpay: !!process.env.RAZORPAY_KEY_ID,
    firebase: !!db,
    timestamp: new Date().toISOString(),
  });
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
      totalPages
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Payment details missing" });
    }

    // Verify Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString()).digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid payment signature" });
    }

    // Create Order in Firestore
    const result = await createOrder(
      printSettings,
      razorpay_order_id,
      amount,
      totalPages
    );

    // Update with payment details
    await db.collection("orders").doc(result.orderId).update({
      userId: userId || 'guest',
      razorpayPaymentId: razorpay_payment_id,
      paymentStatus: "PAID",
      status: "ACTIVE", // Order becomes active after payment
      pickupCode: await generateUniquePickupCode() // Assign pickup code only after payment
    });

    // Get final order data to return code
    const finalDoc = await db.collection("orders").doc(result.orderId).get();
    const finalData = finalDoc.data();

    res.json({
      success: true,
      orderId: result.orderId,
      pickupCode: finalData.pickupCode
    });
  } catch (error) {
    console.error("❌ Payment verification error:", error);
    next(error);
  }
});

// ============================================================================
// ENDPOINT: VERIFY PICKUP CODE (Called by Raspberry Pi)
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

    const orderRef = db.collection('orders').doc(orderId);
    const doc = await orderRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const orderData = doc.data();

    // 1. Mark as completed and revoke code
    await orderRef.update({
      status: 'completed',
      printStatus: 'printed',
      printedAt: admin.firestore.FieldValue.serverTimestamp(),
      pickupCode: null
    });

    // 2. Cleanup Cloudinary Storage
    await cleanupOrder(orderId, orderData, true); // true = keep metadata in Firestore

    res.json({ success: true, message: "Order processed and cleaned up" });
  } catch (error) {
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
╚════════════════════════════════════════════════════════════╝
  `);
});