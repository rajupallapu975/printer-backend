const { dbCustomer, dbCustomer2, dbCustomer3 } = require('../firebase');

async function disableEmailLogin() {
  console.log("🛑 Disabling showEmailLogin in Firestore app_config/auth...");

  const data = {
    showEmailLogin: false,
    updatedAt: new Date().toISOString()
  };

  try {
    if (dbCustomer) {
      await dbCustomer.collection('app_config').doc('auth').set(data, { merge: true });
      console.log("✅ Project 1 (psfc-43b5a): showEmailLogin set to FALSE");
    }

    if (dbCustomer2) {
      await dbCustomer2.collection('app_config').doc('auth').set(data, { merge: true });
      console.log("✅ Project 2 (zikrint-944a4): showEmailLogin set to FALSE");
    }

    if (dbCustomer3) {
      await dbCustomer3.collection('app_config').doc('auth').set(data, { merge: true });
      console.log("✅ Project 3 (think-ink): showEmailLogin set to FALSE");
    }

    console.log("🎉 Successfully HIDDEN 'Sign in with Email' button across all projects!");
  } catch (error) {
    console.error("❌ Error disabling email login:", error);
  } finally {
    process.exit(0);
  }
}

disableEmailLogin();
