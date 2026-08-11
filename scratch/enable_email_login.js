const { dbCustomer, dbCustomer2, dbCustomer3 } = require('../firebase');

async function enableEmailLogin() {
  console.log("🚀 Enabling showEmailLogin in Firestore app_config/auth...");

  const data = {
    showEmailLogin: true,
    updatedAt: new Date().toISOString()
  };

  try {
    if (dbCustomer) {
      await dbCustomer.collection('app_config').doc('auth').set(data, { merge: true });
      console.log("✅ Project 1 (psfc-43b5a): showEmailLogin set to TRUE");
    }

    if (dbCustomer2) {
      await dbCustomer2.collection('app_config').doc('auth').set(data, { merge: true });
      console.log("✅ Project 2 (zikrint-944a4): showEmailLogin set to TRUE");
    }

    if (dbCustomer3) {
      await dbCustomer3.collection('app_config').doc('auth').set(data, { merge: true });
      console.log("✅ Project 3 (think-ink): showEmailLogin set to TRUE");
    }

    console.log("🎉 Successfully enabled 'Sign in with Email' button across all projects!");
  } catch (error) {
    console.error("❌ Error enabling email login:", error);
  } finally {
    process.exit(0);
  }
}

enableEmailLogin();
