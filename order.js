const { dbCustomer: db, dbAdmin, admin } = require("./firebase");

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
/**
 * Generate UNIQUE 4-digit Xerox Shop identification code
 */
async function generateUniqueXeroxId() {
  let code;
  let exists = true;

  while (exists) {
    code = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digits

    // Check in Admin orders (LIVE_ORDER)
    const snapshot = await dbAdmin.collection("orders")
      .where("xeroxId", "==", code)
      .where("status", "==", "LIVE_ORDER")
      .limit(1)
      .get();

    exists = !snapshot.empty;
  }

  return code;
}

async function generateUniquePickupCode(isXerox = false) {
  let code;
  let exists = true;
  const collection = isXerox ? "xerox_orders" : "orders";

  while (exists) {
    code = Math.floor(100000 + Math.random() * 900000).toString();

    const snapshot = await db.collection(collection)
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
async function createOrder(printSettings, razorpayOrderId = null, amount = 0, totalPages = 0, printMode = 'autonomous') {
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }

    const orderId = generateOrderId();
    const isXeroxShop = printMode === 'xeroxShop';

    // Select collection in customer DB
    const customerCollection = isXeroxShop ? "xerox_orders" : "orders";

    // Use passed amount/totalPages if provided, otherwise fallback to calculations
    const finalAmount = amount || calculateCost(printSettings);

    const orderData = {
      orderId,
      printSettings,
      amount: finalAmount,
      printMode, // important for routing logic later
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

    // If it's Xerox Shop, include shopId and generate unique 4-digit ID
    if (isXeroxShop) {
      if (printSettings.shopId) orderData.shopId = printSettings.shopId;
      orderData.xeroxId = await generateUniqueXeroxId();
    }

    // If it's already paid (direct create), generate code now
    if (!razorpayOrderId) {
      orderData.pickupCode = await generateUniquePickupCode(isXeroxShop);
    }

    // ⚡ DOUBLE WRITE LOGIC
    // 1. Write to Customer Project (main tracking)
    await db.collection(customerCollection).doc(orderId).set(orderData);

    // 2. Write to Admin Project (if xeroxShop)
    if (isXeroxShop) {
      // Admin project uses 'orders' collection exclusively for their dashboard
      await dbAdmin.collection("orders").doc(orderId).set({
        ...orderData,
        status: razorpayOrderId ? "PAYMENT_PENDING" : "LIVE_ORDER",
      });
    }

    return {
      orderId,
      pickupCode: orderData.pickupCode || null,
      xeroxId: orderData.xeroxId || null,
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
  generateUniquePickupCode,
  generateUniqueXeroxId
};

