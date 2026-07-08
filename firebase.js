const admin = require("firebase-admin");

// 🌐 CUSTOMER FIREBASE (Main App - Project 1)
let customerApp;
if (!admin.apps.some(app => app.name === 'customer')) {
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      serviceAccount = require("./serviceAccountKey.json");
    }

    customerApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    }, 'customer');
    console.log("✅ Customer Firebase Project 1 initialized");
  } catch (error) {
    console.error("❌ Customer Firebase Project 1 Error:", error.message);
  }
} else {
  customerApp = admin.app('customer');
}

// 🌐 CUSTOMER FIREBASE (Backup 1 - Project 2)
let customerApp2;
let dbCustomer2 = null;
if (!admin.apps.some(app => app.name === 'customer2')) {
  try {
    const serviceAccount2 = require("./serviceAccountKey2.json");
    customerApp2 = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount2)
    }, 'customer2');
    dbCustomer2 = customerApp2.firestore();
    dbCustomer2.settings({ ignoreUndefinedProperties: true });
    console.log("✅ Customer Firebase Project 2 initialized");
  } catch (error) {
    console.warn("⚠️ Customer Firebase Project 2 not loaded:", error.message);
  }
} else {
  try {
    customerApp2 = admin.app('customer2');
    dbCustomer2 = customerApp2.firestore();
  } catch (_) {}
}

// 🌐 CUSTOMER FIREBASE (Backup 2 - Project 3)
let customerApp3;
let dbCustomer3 = null;
if (!admin.apps.some(app => app.name === 'customer3')) {
  try {
    const serviceAccount3 = require("./serviceAccountKey3.json");
    customerApp3 = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount3)
    }, 'customer3');
    dbCustomer3 = customerApp3.firestore();
    dbCustomer3.settings({ ignoreUndefinedProperties: true });
    console.log("✅ Customer Firebase Project 3 initialized");
  } catch (error) {
    console.warn("⚠️ Customer Firebase Project 3 not loaded:", error.message);
  }
} else {
  try {
    customerApp3 = admin.app('customer3');
    dbCustomer3 = customerApp3.firestore();
  } catch (_) {}
}

// 🏢 ADMIN FIREBASE (Xerox Shop Features)
let adminApp;
if (!admin.apps.some(app => app.name === 'admin')) {
  try {
    const adminServiceAccount = require("./adminServiceAccountKey.json");
    adminApp = admin.initializeApp({
      credential: admin.credential.cert(adminServiceAccount)
    }, 'admin');
    console.log("✅ Admin Firebase initialized");
  } catch (error) {
    console.error("❌ Admin Firebase Error:", error.message);
  }
} else {
  adminApp = admin.app('admin');
}

const dbCustomer = customerApp.firestore();
const dbAdmin = adminApp.firestore();

dbCustomer.settings({ ignoreUndefinedProperties: true });
dbAdmin.settings({ ignoreUndefinedProperties: true });

// Dynamic Search Helpers
async function findCustomerOrder(orderId) {
  if (!orderId) return { doc: null, db: null, projectId: null };

  // Try Project 1
  try {
    const doc = await dbCustomer.collection("xerox_orders").doc(orderId).get();
    if (doc.exists) return { doc, db: dbCustomer, projectId: 'psfc-43b5a' };
  } catch (e) { /* skip */ }

  // Try Project 2
  if (dbCustomer2) {
    try {
      const doc = await dbCustomer2.collection("xerox_orders").doc(orderId).get();
      if (doc.exists) return { doc, db: dbCustomer2, projectId: 'zikrint-944a4' };
    } catch (e) { /* skip */ }
  }

  // Try Project 3
  if (dbCustomer3) {
    try {
      const doc = await dbCustomer3.collection("xerox_orders").doc(orderId).get();
      if (doc.exists) return { doc, db: dbCustomer3, projectId: 'think-ink' };
    } catch (e) { /* skip */ }
  }

  return { doc: null, db: null, projectId: null };
}

async function findCustomerOrderByIdOrCode(orderId) {
  if (!orderId) return { doc: null, db: null, projectId: null };

  // Search DB 1
  try {
    let doc = await dbCustomer.collection("xerox_orders").doc(orderId).get();
    if (doc.exists) return { doc, db: dbCustomer, projectId: 'psfc-43b5a' };
    
    let snap = await dbCustomer.collection("xerox_orders").where("orderCode", "==", orderId).limit(1).get();
    if (!snap.empty) return { doc: snap.docs[0], db: dbCustomer, projectId: 'psfc-43b5a' };
    
    snap = await dbCustomer.collection("xerox_orders").where("pickupCode", "==", orderId).limit(1).get();
    if (!snap.empty) return { doc: snap.docs[0], db: dbCustomer, projectId: 'psfc-43b5a' };
  } catch (e) { /* skip */ }

  // Search DB 2
  if (dbCustomer2) {
    try {
      let doc = await dbCustomer2.collection("xerox_orders").doc(orderId).get();
      if (doc.exists) return { doc, db: dbCustomer2, projectId: 'zikrint-944a4' };
      
      let snap = await dbCustomer2.collection("xerox_orders").where("orderCode", "==", orderId).limit(1).get();
      if (!snap.empty) return { doc: snap.docs[0], db: dbCustomer2, projectId: 'zikrint-944a4' };
      
      snap = await dbCustomer2.collection("xerox_orders").where("pickupCode", "==", orderId).limit(1).get();
      if (!snap.empty) return { doc: snap.docs[0], db: dbCustomer2, projectId: 'zikrint-944a4' };
    } catch (e) { /* skip */ }
  }

  // Search DB 3
  if (dbCustomer3) {
    try {
      let doc = await dbCustomer3.collection("xerox_orders").doc(orderId).get();
      if (doc.exists) return { doc, db: dbCustomer3, projectId: 'think-ink' };
      
      let snap = await dbCustomer3.collection("xerox_orders").where("orderCode", "==", orderId).limit(1).get();
      if (!snap.empty) return { doc: snap.docs[0], db: dbCustomer3, projectId: 'think-ink' };
      
      snap = await dbCustomer3.collection("xerox_orders").where("pickupCode", "==", orderId).limit(1).get();
      if (!snap.empty) return { doc: snap.docs[0], db: dbCustomer3, projectId: 'think-ink' };
    } catch (e) { /* skip */ }
  }

  return { doc: null, db: null, projectId: null };
}

module.exports = {
  db: dbCustomer, // For backwards compatibility
  dbCustomer,
  dbCustomer2,
  dbCustomer3,
  dbAdmin,
  findCustomerOrder,
  findCustomerOrderByIdOrCode,
  admin
};
