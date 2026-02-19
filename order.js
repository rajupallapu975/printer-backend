const { db } = require("./firebase");
const admin = require("firebase-admin");

/* =================================================
   HELPERS
================================================= */

function generateOrderId() {
  return "ORD_" + Date.now();
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

async function createOrder(printSettings, userId) {
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }

    const orderId = generateOrderId();
    const pickupCode = await generateUniquePickupCode();

    await db.collection("orders").doc(orderId).set({
      orderId,
      pickupCode,
      userId, // 🔥 ADD THIS

      printSettings,
      paymentStatus: "PAID",
      status: "ACTIVE",
      printStatus: "READY",
      printedAt: null,

      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),

      fileUrls: [],
    });


    return { orderId, pickupCode };

  } catch (err) {
    console.error("❌ CREATE ORDER DB ERROR:", err.message);
    throw err;
  }
}

module.exports = {
  createOrder,
};
