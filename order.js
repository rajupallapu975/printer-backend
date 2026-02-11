const { db } = require("./firebase");

/* =================================================
   HELPERS
================================================= */

/**
 * Generate unique order ID
 */
function generateOrderId() {
  return "ORD_" + Date.now();
}

/**
 * Generate 6-digit pickup code (ONE-TIME)
 */
function generatePickupCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* =================================================
   CREATE ORDER
   - Called only after payment confirmation
   - pickupCode generated here
   - printSettings stored safely
================================================= */
async function createOrder(printSettings) {
  try {
    // 🔐 Validate input
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }

    const orderId = generateOrderId();
    const pickupCode = generatePickupCode();

    await db.collection("orders").doc(orderId).set({
      orderId,
      pickupCode,

      // 🔑 MAIN DATA
      printSettings, // stored once, immutable for printing

      paymentStatus: "PAID",
      printStatus: "READY_TO_PRINT",
      printedAt: null,

      createdAt: new Date(),
    });

    return { orderId, pickupCode };
  } catch (err) {
    console.error("❌ CREATE ORDER DB ERROR:", {
      message: err.message,
    });

    /*
      Bubble error up to index.js global handler
      (Never swallow DB errors)
    */
    throw err;
  }
}

/* =================================================
   EXPORTS
================================================= */
module.exports = {
  createOrder,
};
