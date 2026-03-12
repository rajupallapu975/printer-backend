const admin = require("firebase-admin");

// 🌐 CUSTOMER FIREBASE (Main App)
let customerApp;
if (!admin.apps.some(app => app.name === 'customer')) {
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      // Fallback to local file
      serviceAccount = require("./serviceAccountKey.json");
    }

    customerApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    }, 'customer');
    console.log("✅ Customer Firebase initialized");
  } catch (error) {
    console.error("❌ Customer Firebase Error:", error.message);
  }
} else {
  customerApp = admin.app('customer');
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

module.exports = {
  db: dbCustomer, // For backwards compatibility
  dbCustomer,
  dbAdmin,
  admin
};
