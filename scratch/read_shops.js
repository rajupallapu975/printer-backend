const admin = require('firebase-admin');
const fs = require('fs');

// Initialize apps
const keys = [
  { name: 'primary', path: '../serviceAccountKey.json' },
  { name: 'db2', path: '../serviceAccountKey2.json' },
  { name: 'db3', path: '../serviceAccountKey3.json' },
  { name: 'admin', path: '../adminServiceAccountKey.json' }
];

async function checkShops() {
  for (const k of keys) {
    if (!fs.existsSync(k.path)) {
      console.log(`Key not found: ${k.path}`);
      continue;
    }
    try {
      const serviceAccount = require(k.path);
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      }, k.name);
      
      const db = app.firestore();
      const snapshot = await db.collection('shops').get();
      console.log(`\n=== Database: ${k.name} (Project: ${serviceAccount.project_id}) ===`);
      console.log(`Total shops found: ${snapshot.size}`);
      
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`- Shop ID: ${doc.id}`);
        console.log(`  Name: ${data.shopName}`);
        console.log(`  isOpen: ${data.isOpen}`);
        console.log(`  isActive: ${data.isActive}`);
        console.log(`  isBlocked: ${data.isBlocked}`);
        console.log(`  isAcceptingOrders: ${data.isAcceptingOrders}`);
        console.log(`  zikrinterServices:`, JSON.stringify(data.zikrinterServices, null, 2));
      });
    } catch (e) {
      console.error(`Error reading ${k.name}:`, e);
    }
  }
}

checkShops();
