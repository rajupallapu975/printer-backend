const { dbCustomer: db, dbAdmin, admin } = require("./firebase");
/* =================================================
   HELPERS
================================================= */

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
async function generateUniquePickupCode() {
  let code;
  let exists = true;
  const collection = "xerox_orders";
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
async function createOrder(printSettings, razorpayOrderId = null, amount = 0, totalPages = 0, printMode = 'xeroxShop', userId = 'guest_user', customId = null, userEmail = null) {
  try {
    if (!printSettings || typeof printSettings !== "object") {
      const err = new Error("Invalid printSettings");
      err.status = 400;
      throw err;
    }
    
    // Xerox Shop is now the only mode
    const customerCollection = "xerox_orders";
    const finalAmount = amount || calculateCost(printSettings);
    const xeroxCode = await generateUniquePickupCode();
    const orderId = xeroxCode;
    
    const orderData = {
      orderId,
      userId,
      userEmail: userEmail || userId, // Display email in Admin App
      printSettings,
      amount: finalAmount,
      printMode: 'xeroxShop',
      totalPages: totalPages || (printSettings.files ? printSettings.files.reduce((sum, f) => sum + (f.pageCount || 1) * (f.copies || 1), 0) : 0),
      paymentStatus: razorpayOrderId ? "PENDING" : "PAID",
      status: razorpayOrderId ? "CREATED" : "ACTIVE",
      orderStatus: "not printed yet",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // 24h expiry
      fileUrls: printSettings.files ? printSettings.files.map(f => f.url).filter(u => u !== undefined) : [],
      publicIds: [],
      razorpayOrderId: razorpayOrderId || null,
      xeroxId: printSettings.shopId || xeroxCode, // Store Firestore shop doc ID so QR scan matches
      orderCode: xeroxCode, // 6-digit display code (changed from 4-digit based on code above)
      pickupCode: xeroxCode, 
      customId: customId || null, // Sequential ID (order_1, order_2)
    };

    if (printSettings.shopId) orderData.shopId = printSettings.shopId;

    // ⚡ CUSTOMER WRITE LOGIC
    await db.collection(customerCollection).doc(orderId).set(orderData);
    
    return {
      orderId,
      pickupCode: orderData.pickupCode,
      xeroxId: orderData.xeroxId, // Firestore shop doc ID
      orderCode: xeroxCode,
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
async function syncOrderToAdmin(orderId, watermarkedResults = null) {
  try {
    const collectionName = "xerox_orders";
    const doc = await db.collection(collectionName).doc(orderId).get();
    if (!doc.exists) throw new Error(`Order ${orderId} not found in ${collectionName}`);
    
    const orderDocData = doc.data();
    const { printSettings, userId, amount: finalAmount, orderCode } = orderDocData;
    const shopId = orderDocData.shopId;
    if (!shopId) return;

    // 🌊 WATERMARK: Use newly processed results if available, else fall back to existing data
    const activeFileUrls = watermarkedResults ? watermarkedResults.map(r => r.url) : orderDocData.fileUrls;
    const activePublicIds = watermarkedResults ? watermarkedResults.map(r => r.publicId) : (orderDocData.publicIds || []);

    const { getSignedUrl, configB } = require('./cloudinary');
    
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
        const activeConfig = configB;
        const pid = activePublicIds[i] || null;
        return getSignedUrl(url, activeConfig, null, pid);
      });

      // 📥 DOWNLOAD URLs: Always signed to handle naming & attachment flag
      signedUrls = activeFileUrls.map((url, i) => {
        const activeConfig = configB;
        const pid = activePublicIds[i] || null;
        
        // 🚀 CRITICAL: For Strict Delivery PDFs, we use the API link (but without native attachment flag)
        if (url && url.includes('api.cloudinary.com') && pid) {
           const cloudinaryMod = require("cloudinary").v2;
           cloudinaryMod.config({
               cloud_name: process.env.CLOUDINARY_CLOUD_NAME_B,
               api_key: process.env.CLOUDINARY_API_KEY_B,
               api_secret: process.env.CLOUDINARY_API_SECRET_B
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
  generateUniquePickupCode
};
