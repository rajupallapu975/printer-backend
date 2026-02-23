require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
// ============================================================================
// CONFIGURATION & INITIALIZATION
// ============================================================================
const PORT = process.env.PORT || 5000;
// 1. Firebase Admin
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Falls back to local file if Env Var is missing
    serviceAccount = require("./serviceAccountKey.json");
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.error("❌ Firebase Initialization Error:", error.message);
}
const db = admin.firestore();
// 2. Razorpay Initialization
// We use 'razorpayInstance' to avoid naming conflicts with the 'razorpay' package
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder'
});
// 3. Cloudinary Initialization
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
// UTILITY: CLOUDINARY CLEANUP
// ============================================================================
async function cleanupCloudinaryFiles(orderId, publicIds = []) {
  if (!publicIds || publicIds.length === 0) {
    console.log(`ℹ️ No Cloudinary files to cleanup for order ${orderId}`);
    return;
  }
  try {
    console.log(`🧹 Cleaning up ${publicIds.length} files from Cloudinary for order ${orderId}...`);
    // Attempt deletion as 'image' (includes PDFs viewable in dashboard)
    const imgResult = await cloudinary.api.delete_resources(publicIds, { resource_type: 'image' });
    // Attempt deletion as 'raw' (for Office documents like DOCX)
    const rawResult = await cloudinary.api.delete_resources(publicIds, { resource_type: 'raw' });
    console.log(`✅ Cloudinary cleanup complete for ${orderId}`);
    return { imgResult, rawResult };
  } catch (error) {
    console.error(`❌ Cloudinary cleanup error for order ${orderId}:`, error.message);
  }
}
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
    // Generate 6-digit pickup code
    const pickupCode = Math.floor(100000 + Math.random() * 900000).toString();
    // Create Official Order in Firestore
    const orderRef = db.collection('orders').doc();
    await orderRef.set({
      orderId: orderRef.id,
      userId: userId || 'guest',
      pickupCode: pickupCode,
      status: 'ACTIVE', // Standardized Uppercase
      printStatus: 'pending',
      printSettings: printSettings || {},
      amount: amount || 0,
      totalPages: totalPages || 0,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)) // 24h expiry
    });
    res.json({
      success: true,
      orderId: orderRef.id,
      pickupCode: pickupCode
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
    // 2. Cleanup Cloudinary Storage
    if (orderData.publicIds) {
      await cleanupCloudinaryFiles(orderId, orderData.publicIds);
    }
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
