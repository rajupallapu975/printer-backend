const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require('./adminServiceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function listShops() {
    try {
        const snapshot = await db.collection('shops').get();
        if (snapshot.empty) {
            console.log('No shops found in the Admin Firebase.');
            return;
        }

        console.log('--- Current Xerox Shops in Admin Firebase ---');
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`ID: ${doc.id}`);
            console.log(`Name: ${data.shopName || 'N/A'}`);
            console.log(`Address: ${data.address || 'N/A'}`);
            console.log(`Timing: ${data.openingTime || '?'} - ${data.closingTime || '?'}`);
            console.log('-------------------------------------------');
        });
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

listShops();
