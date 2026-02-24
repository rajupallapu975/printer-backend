const { db } = require("./firebase");
const admin = require("firebase-admin");

/* =================================================
   HELPERS
================================================= */

function generateOrderId() {
  return "ORD_" + Date.now();
}

/**
 * Calculate cost based on print settings
 * Color: ₹10 per page
 * B/W: ₹3 per page
 */
function calculateCost(printSettings) {
  let total = 0;
  if (!printSettings.files || !Array.isArray(printSettings.files)) return 0;

  for (const file of printSettings.files) {
    const unitPrice = file.color === "COLOR" ? 10 : 3;
    const pages = file.pageCount || 1;
    const copies = file.copies || 1;
    total += unitPrice * pages * copies;
  }
  return total;
}

/**
 * Generate UNIQUE 6-digit pickup code
 */
async function generateUniquePickupCode() {
  let code;
  let exists = true;

  while (exists) {
    code = Math.floor(100000 + Math.random() * 900000).toString();

    const snapshot = await db.collection("orders")
      .where("pickupCode", "==", code)
      .limit(1)
      .get();

    exists = !snapshot.empty;
  }

  return code;
}


/**
 * CREATE ORDER
 */
async function createOrder(printSettings, razorpayOrderId = null, amount = 0, totalPages = 0) {
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }

    const orderId = generateOrderId();

    // Use passed amount/totalPages if provided, otherwise fallback to calculations
    const finalAmount = amount || calculateCost(printSettings);

    const orderData = {
      orderId,
      printSettings,
      amount: finalAmount,
      totalPages: totalPages || (printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.pageCount || 1) * (f.copies || 1), 0) : 0),
      paymentStatus: razorpayOrderId ? "PENDING" : "PAID",
      status: razorpayOrderId ? "CREATED" : "ACTIVE",
      printStatus: "pending",
      printedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // 24h expiry
      fileUrls: printSettings.files ? printSettings.files.map(f => f.url).filter(u => u !== undefined) : [],
      publicIds: printSettings.files ? printSettings.files.map(f => f.publicId).filter(id => id && id !== undefined) : [],
      razorpayOrderId: razorpayOrderId || null,
    };

    // If it's already paid (direct create), generate code now
    if (!razorpayOrderId) {
      orderData.pickupCode = await generateUniquePickupCode();
    }

    await db.collection("orders").doc(orderId).set(orderData);

    return {
      orderId,
      pickupCode: orderData.pickupCode || null,
      amount: finalAmount
    };

  } catch (err) {
    console.error("❌ CREATE ORDER DB ERROR:", err.message);
    throw err;
  }
}

module.exports = {
  createOrder,
  calculateCost,
  generateUniquePickupCode
};

