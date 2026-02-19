// ============================================================================
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
// ============================================================================
// FIREBASE INITIALIZATION
// ============================================================================
const { db } = require("./firebase");
const { performCleanup, cleanupOrder } = require("./cleanup");

// Run cleanup task every hour
setInterval(performCleanup, 30 * 1000);
// Initial cleanup on server start
performCleanup();

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================
const app = express();
// Middleware
app.use(cors());
app.use(express.json());
// ============================================================================
// ENDPOINT: HEALTH CHECK
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Printer Backend Server is running",
    timestamp: new Date().toISOString()
  });
});


// ============================================================================
// ENDPOINT: CREATE ORDER
// ============================================================================
const { createOrder } = require("./order");

app.post("/create-order", async (req, res) => {
  try {
    const { printSettings, userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required"
      });
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
// ============================================================================
// Called by Raspberry Pi to verify a 6-digit pickup code
// Returns: order details with Cloudinary file URLs
// ============================================================================
app.post("/verify-pickup-code", async (req, res) => {
  try {
    const { pickupCode } = req.body;
    // Validate input
    if (!pickupCode) {
      return res.status(400).json({
        success: false,
        error: "pickupCode is required"
      });
    }
    console.log(`🔍 Verifying pickup code: ${pickupCode}`);
    // Query Firestore for active orders with this pickup code
    const ordersRef = db.collection('orders');
    const snapshot = await ordersRef
      .where('pickupCode', '==', pickupCode)
      .where('status', '==', 'ACTIVE')
      .limit(1)
      .get();
    // Check if order exists
    if (snapshot.empty) {
      console.log(`❌ No active order found for code: ${pickupCode}`);
      return res.status(404).json({
        success: false,
        error: "Invalid or expired pickup code"
      });
    }
    // Get order data
    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    const orderId = orderDoc.id;
    // Check if order has already been printed
    if (orderData.printStatus === 'PRINTED') {
      console.log(`⚠️ Order ${orderId} already printed`);
      return res.status(400).json({
        success: false,
        error: "This order has already been printed"
      });
    }
    // Check if order has expired
    const expiresAt = orderData.expiresAt?.toDate();
    if (expiresAt && expiresAt < new Date()) {
      console.log(`⚠️ Order ${orderId} has expired`);
      return res.status(400).json({
        success: false,
        error: "This pickup code has expired"
      });
    }
    // Extract file URLs (from Cloudinary)
    const fileUrls = orderData.fileUrls || [];
    if (fileUrls.length === 0) {
      console.log(`⚠️ Order ${orderId} has no files`);
      return res.status(400).json({
        success: false,
        error: "No files found for this order"
      });
    }
    console.log(`✅ Order verified: ${orderId} (${fileUrls.length} files)`);
    // Return order details
    res.json({
      success: true,
      orderId: orderId,
      fileUrls: fileUrls,
      printSettings: orderData.printSettings || {},
      totalPages: orderData.totalPages || 0,
      totalPrice: orderData.totalPrice || 0
    });
  } catch (error) {
    console.error("❌ Verify code error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});
// ============================================================================
// ENDPOINT: MARK ORDER AS PRINTED
// ============================================================================
// Called by Raspberry Pi after successful printing
// Updates order status and revokes the pickup code
// ============================================================================
app.post("/mark-printed", async (req, res) => {
  try {
    const { orderId } = req.body;
    // Validate input
    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "orderId is required"
      });
    }
    console.log(`📝 Marking order as printed: ${orderId}`);
    // Update order in Firestore
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'COMPLETED',
      printStatus: 'PRINTED',
      printedAt: admin.firestore.FieldValue.serverTimestamp(),
      pickupCode: null // Revoke the code
    });

    // 🔥 NEW: Instantly cleanup Cloudinary storage after successful print
    const orderDoc = await orderRef.get();
    if (orderDoc.exists) {
      const orderData = orderDoc.data();
      // Delete from Cloudinary but keep metadata in Firestore history
      await cleanupOrder(orderId, orderData);
    }

    console.log(`✅ Order ${orderId} marked as printed`);
    res.json({
      success: true,
      message: "Order marked as printed successfully"
    });
  } catch (error) {
    console.error("❌ Mark printed error:", error);
    // Check if order doesn't exist
    if (error.code === 5) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});
// ============================================================================
// ENDPOINT: GET ORDER STATUS (Optional - for debugging)
// ============================================================================
app.get("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }
    res.json({
      success: true,
      order: orderDoc.data()
    });
  } catch (error) {
    console.error("❌ Get order error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});
// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║          🖨️  PRINTER BACKEND SERVER ONLINE 🖨️              ║
║                                                            ║
║  Port: ${PORT}                                           ║
║  Time: ${new Date().toLocaleString()}                     ║
║                                                            ║
║  Endpoints:                                                ║
║  - POST /verify-pickup-code                                ║
║  - POST /mark-printed                                      ║
║  - GET  /order/:orderId                                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});
// raju
