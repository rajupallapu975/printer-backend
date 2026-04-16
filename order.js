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
 * B/W (Single): ₹2 per page
 * B/W (Double): ₹3 per sheet (2 pages)
 */
function calculateCost(printSettings) {
  let total = 0;
  if (!printSettings.files || !Array.isArray(printSettings.files)) return 0;
  for (const file of printSettings.files) {
    const pages = file.pageCount || 1;
    const copies = file.copies || 1;
    const isColor = file.color === "COLOR";
    const isDoubleSided = !!(file.doubleSided || file.duplex);

    if (isColor) {
      total += 10 * pages * copies;
    } else {
      if (isDoubleSided && pages >= 2) {
        const doubleSheets = Math.floor(pages / 2);
        const singlePages = pages % 2;
        total += (doubleSheets * 3 + singlePages * 2) * copies;
      } else {
        total += 2 * pages * copies;
      }
    }
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
async function createOrder(printSettings, razorpayOrderId = null, amount = 0, totalPages = 0, printMode = 'autonomous', userId = 'guest_user', customId = null, userEmail = null) {
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }
    const isXeroxShop = printSettings.printerType === 'xeroxShop' || printSettings.shopId;
    const printMode = isXeroxShop ? 'xeroxShop' : 'autonomous';
    
    // Select collection in customer DB
    const customerCollection = isXeroxShop ? "xerox_orders" : "orders";
    // Use passed amount/totalPages if provided, otherwise fallback to calculations
    const finalAmount = amount || calculateCost(printSettings);
    const xeroxCode = isXeroxShop ? await generateUniquePickupCode(true) : null;
    const orderId = isXeroxShop ? xeroxCode : generateOrderId();
    const orderData = {
      orderId,
      userId,
      userEmail: userEmail || userId, // Display email in Admin App
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
      customId: customId || null, // Sequential ID (order_1, order_2)
    };
    // If it's Xerox Shop, include shopId
    if (isXeroxShop) {
      if (printSettings.shopId) orderData.shopId = printSettings.shopId;
    }
    // Generate pickup code for autonomous ONLY (Xerox already set above)
    if (!razorpayOrderId && !isXeroxShop) {
      orderData.pickupCode = await generateUniquePickupCode(false);
    }
    // ⚡ CUSTOMER WRITE LOGIC
    await db.collection(customerCollection).doc(orderId).set(orderData);
    // 🛡️ Admin Sync for Xerox Shop: Moved to separate function syncOrderToAdmin()
    // This allows verify-payment to create the customer record without making it visible to Admin 
    // until complete-order (file upload) is successful.
    
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
/**
 * 🔄 SYNC ORDER TO ADMIN PROJECT (Xerox Shop Only)
 * Transitions the order to be visible in the Shop Dashboard.
 */
/**
 * Mirror order to Admin Dashboard
 */
async function syncOrderToAdmin(orderId, isXeroxShop = true, watermarkedResults = null) {
  try {
    // 📂 SYNC: Match collection names in index.js
    const collectionName = isXeroxShop ? "xerox_orders" : "orders";
    const doc = await db.collection(collectionName).doc(orderId).get();
    if (!doc.exists) throw new Error(`Order ${orderId} not found in ${collectionName}`);
    
    const orderDocData = doc.data();
    const { printSettings, userId, amount: finalAmount, orderCode } = orderDocData;
    const shopId = orderDocData.shopId;
    if (!shopId) return;

    // 🌊 WATERMARK: Use newly processed results if available, else fall back to existing data
    const activeFileUrls = watermarkedResults ? watermarkedResults.map(r => r.url) : orderDocData.fileUrls;
    const activePublicIds = watermarkedResults ? watermarkedResults.map(r => r.publicId) : (orderDocData.publicIds || []);

    const { getSignedUrl, configA, configB } = require('./cloudinary');
    
    let signedUrls = [];
    let viewUrls = [];
    let displayFileNames = [];

    const getReadableName = (url, i) => {
      const parts = url.split('.');
      const ext = parts.length > 1 ? parts.pop() : 'pdf';
      const orderDisplay = orderCode || orderId;
      return `${orderDisplay}_${i + 1}.${ext}`;
    };

    if (activeFileUrls && Array.isArray(activeFileUrls)) {
      // 🚀 VIEW URLs: All URLs now SIGNED to handle account-level 'Authenticated' restrictions.
      viewUrls = activeFileUrls.map((url, i) => {
        const activeConfig = isXeroxShop ? configB : configA;
        const pid = activePublicIds[i] || null;
        return getSignedUrl(url, activeConfig, null, pid);
      });

      // 📥 DOWNLOAD URLs: Always signed to handle naming & attachment flag
      signedUrls = activeFileUrls.map((url, i) => {
        const activeConfig = isXeroxShop ? configB : configA;
        const pid = activePublicIds[i] || null;
        
        // 🚀 CRITICAL: For Strict Delivery PDFs, we use the API link (but without native attachment flag)
        if (url && url.includes('api.cloudinary.com') && pid) {
           const cloudinaryMod = require("cloudinary").v2;
           cloudinaryMod.config({
               cloud_name: isXeroxShop ? process.env.CLOUDINARY_CLOUD_NAME_B : process.env.CLOUDINARY_CLOUD_NAME,
               api_key: isXeroxShop ? process.env.CLOUDINARY_API_KEY_B : process.env.CLOUDINARY_API_KEY,
               api_secret: isXeroxShop ? process.env.CLOUDINARY_API_SECRET_B : process.env.CLOUDINARY_API_SECRET
           });
           
           return cloudinaryMod.utils.private_download_url(pid, 'pdf', {
               resource_type: 'image',
               type: 'upload'
           });
        }
        
        return getSignedUrl(url, activeConfig, getReadableName(url, i), pid);
      });

      displayFileNames = activeFileUrls.map((url, i) => getReadableName(url, i));
    }

    const adminOrderData = {
      id: orderId,
      customerName: orderDocData.userEmail || userId || 'Guest',
      fileName: displayFileNames[0],
      bwPages: printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.color === 'BW' ? (f.pageCount || 1) * (f.copies || 1) : 0), 0) : 0,
      colorPages: printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.color === 'COLOR' ? (f.pageCount || 1) * (f.copies || 1) : 0), 0) : 0,
      isDuplex: printSettings.files ? printSettings.files.some(f => f.doubleSided || f.duplex || f.doubleSide) : false,
      status: 'pending',
      paymentStatus: 'done',
      amount: finalAmount,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      fileUrls: signedUrls,
      viewUrls: viewUrls,
      fileUrl: signedUrls.length > 0 ? signedUrls[0] : null,
      orderId: orderId,
      orderCode: orderCode, 
      xeroxId: shopId, 
      pickupCode: orderCode, 
      shopId: shopId,
      fileNames: displayFileNames,
      copies: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].copies || 1) : 1,
      numCopies: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].copies || 1) : 1,
      orientation: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].orientation || 'portrait') : 'portrait',
      layout: printSettings.files && printSettings.files.length > 0 ? (printSettings.files[0].orientation || 'portrait') : 'portrait',
    };

    await dbAdmin.collection("shops").doc(shopId).collection("orders").doc(orderId).set(adminOrderData, { merge: true });
    console.log(`✅ Order ${orderId} successfully synced to Admin project.`);
  } catch (error) {
    console.error(`❌ Admin sync failed for ${orderId}:`, error.message);
  }
}
module.exports = {
  createOrder,
  syncOrderToAdmin,
  calculateCost,
  generateUniquePickupCode,
  generateUniqueXeroxId
};
