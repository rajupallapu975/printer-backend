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


/* =================================================
   CREATE ORDER
================================================= */

<<<<<<< HEAD
async function createOrder(printSettings, userId, razorpayOrderId = null) {
=======
async function createOrder(printSettings, userId, amount = 0, totalPages = 0) {
>>>>>>> 4a92448 (live mode api keys initialization)
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }

    const orderId = generateOrderId();
    const totalPrice = calculateCost(printSettings);

    const orderData = {
      orderId,
<<<<<<< HEAD
      userId,
=======
      pickupCode,
      userId,
      totalPrice: amount,
      totalPages: totalPages,

>>>>>>> 4a92448 (live mode api keys initialization)
      printSettings,
      totalPrice,
      paymentStatus: razorpayOrderId ? "PENDING" : "PAID", // If we have a Razorpay ID, it's pending payment
      status: razorpayOrderId ? "CREATED" : "ACTIVE",
      printStatus: "READY",
      printedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      fileUrls: [],
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
      totalPrice
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

