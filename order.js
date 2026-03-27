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

    // Check in Customer xerox_orders (ACTIVE)
    const snapshot = await db.collection("xerox_orders")
      .where("xeroxId", "==", code)
      .where("status", "==", "ACTIVE")
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
async function createOrder(printSettings, razorpayOrderId = null, amount = 0, totalPages = 0, printMode = 'autonomous', userId = 'guest_user') {
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }

    const isXeroxShop = printMode === 'xeroxShop';
    const xeroxCode = isXeroxShop ? (printSettings.xeroxCode || await generateUniqueXeroxId()) : null;
    const orderId = isXeroxShop ? xeroxCode : generateOrderId();

    // Select collection in customer DB
    const customerCollection = isXeroxShop ? "xerox_orders" : "orders";

    // Use passed amount/totalPages if provided, otherwise fallback to calculations
    const finalAmount = amount || calculateCost(printSettings);


    const orderData = {
      orderId,
      userId,
      printSettings,
      amount: finalAmount,
      printMode,
      totalPages: totalPages || (printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.pageCount || 1) * (f.copies || 1), 0) : 0),
      paymentStatus: razorpayOrderId ? "PENDING" : "PAID",
      status: razorpayOrderId ? "CREATED" : "ACTIVE",
      orderStatus: isXeroxShop ? "not printed yet" : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // 24h expiry
      fileUrls: printSettings.files ? printSettings.files.map(f => f.url).filter(u => u !== undefined) : [],
      publicIds: isXeroxShop ? [] : (printSettings.files ? printSettings.files.map(f => f.publicId).filter(id => id && id !== undefined) : []),
      razorpayOrderId: razorpayOrderId || null,
      xeroxId: isXeroxShop ? (printSettings.shopId || xeroxCode) : null, // Store Firestore shop doc ID so QR scan matches
      orderCode: xeroxCode, // 4-digit display code
      pickupCode: isXeroxShop ? xeroxCode : null, // 4-digit pickup code shown to customer
    };

    // If it's Xerox Shop, include shopId
    if (isXeroxShop) {
      if (printSettings.shopId) orderData.shopId = printSettings.shopId;
    }

    // Generate pickup code for autonomous ONLY (Xerox already set above)
    if (!razorpayOrderId && !isXeroxShop) {
      orderData.pickupCode = await generateUniquePickupCode(false);
    }

    // ⚡ DOUBLE WRITE LOGIC
    await db.collection(customerCollection).doc(orderId).set(orderData);

    if (isXeroxShop && printSettings.shopId) {
      const shopId = printSettings.shopId;
      const shopDoc = await dbAdmin.collection("shops").doc(shopId).get();

      if (shopDoc.exists) {
        const adminOrderData = {
          id: orderId,
          customerName: userId || 'Guest',
          fileName: printSettings.files && printSettings.files.length > 0 ? printSettings.files[0].fileName : 'document.pdf',
          bwPages: printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.color === 'BW' ? (f.pageCount || 1) * (f.copies || 1) : 0), 0) : 0,
          colorPages: printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.color === 'COLOR' ? (f.pageCount || 1) * (f.copies || 1) : 0), 0) : 0,
          isDuplex: printSettings.files ? printSettings.files.some(f => f.duplex) : false,
          status: razorpayOrderId ? 'payment_pending' : 'pending',
          paymentStatus: razorpayOrderId ? 'pending' : 'done',
          amount: finalAmount,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          fileUrls: orderData.fileUrls || [],
          fileUrl: orderData.fileUrls && orderData.fileUrls.length > 0 ? orderData.fileUrls[0] : null,
          orderId: orderId,
          orderCode: xeroxCode, // 4-digit display code
          xeroxId: shopId, // Firestore shop doc ID (matches QR)
          pickupCode: xeroxCode, // 4-digit pickup code
          shopId: shopId,
          // Sync Critical Print Specs
          copies: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].copies || 1) : 1,
          numCopies: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].copies || 1) : 1,
          orientation: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].orientation || 'portrait') : 'portrait',
          layout: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].orientation || 'portrait') : 'portrait',
        };
        await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).set(adminOrderData);
      } else {
        console.error(`❌ Security Alert: ShopId ${shopId} does not exist. Order ${orderId} aborted for Admin Sync.`);
      }
    }

    return {
      orderId,
      pickupCode: orderData.pickupCode || null,
      xeroxId: orderData.xeroxId, // Firestore shop doc ID
      orderCode: xeroxCode, // 4-digit display code
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

