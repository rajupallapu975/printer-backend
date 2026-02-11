const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

/**
 * Initialize Firebase Admin SDK
 * - Firestore ONLY
 * - No Firebase Storage (Option 2)
 */
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/**
 * Firestore (database)
 */
const db = admin.firestore();

module.exports = {
  db,
};
