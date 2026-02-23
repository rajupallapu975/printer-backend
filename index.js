require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

// Modular imports
const { db, admin } = require("./firebase");
const razorpayInstance = require("./razorpay");
const { createOrder, generateUniquePickupCode } = require("./order");
const { cleanupOrder } = require("./cleanup");

const PORT = process.env.PORT || 5000;

// Cloudinary Initialization
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dpmpyvmbg',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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
// ENDPOINT: HEALTH CHECK
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Printer Backend Server is running",
    razorpay: !!process.env.RAZORPAY_KEY_ID,
    cloudinary: !!process.env.CLOUDINARY_API_KEY,
    firebase: !!db
  });
});
// ============================================================================
// ENDPOINT: CREATE RAZORPAY ORDER
// ============================================================================
app.post("/create-razorpay-order", async (req, res, next) => {
  try {
    const { amount } = req.body;
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

    // Verify Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid payment signature" });
    }

    // Create Order using modular function
    const result = await createOrder(
      printSettings,
      razorpay_order_id,
      amount,
      totalPages
    );

    // Update the order with payment info (since createOrder handles the initial save)
    await db.collection("orders").doc(result.orderId).update({
      userId: userId || 'guest',
      razorpayPaymentId: razorpay_payment_id,
      paymentStatus: "PAID",
      status: "ACTIVE", // Make it active now that payment is verified
      pickupCode: await generateUniquePickupCode() // Generate code on successful payment
    });

    // Fetch the updated doc to get the code
    const updatedDoc = await db.collection("orders").doc(result.orderId).get();
    const finalData = updatedDoc.data();

    res.json({
      success: true,
      orderId: result.orderId,
      pickupCode: finalData.pickupCode
    });
  } catch (error) {
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
    console.log(`🔎 Raspberry Pi verifying code: ${pickupCode}`);
    // Check both 'ACTIVE' and 'active' for backward compatibility
    let snapshot = await db.collection('orders')
      .where('pickupCode', '==', pickupCode)
      .where('status', '==', 'ACTIVE')
      .limit(1)
      .get();
    if (snapshot.empty) {
      snapshot = await db.collection('orders')
        .where('pickupCode', '==', pickupCode)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    }
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: "Order not found or expired" });
    }
    const doc = snapshot.docs[0];
    const data = doc.data();
    // Safety checks
    if (data.printStatus === 'printed') {
      return res.status(400).json({ error: "Order already printed" });
    }
    // Check expiry
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

    // 2. Cleanup Cloudinary Storage using modular cleanup logic
    await cleanupOrder(orderId, orderData, true); // keepMetadata = true

    res.json({ success: true, message: "Order processed and cleaned up" });
  } catch (error) {
    next(error);
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
app.listen(PORT, () => {
  console.log(`🚀 Printer Backend active on port ${PORT}`);
});
