require('dotenv').config();
const { db } = require("./firebase");
const { cleanupOrder } = require("./cleanup");

async function manualDelete(orderId) {
    console.log(`🚀 Manually cleaning up order: ${orderId}`);

    try {
        const doc = await db.collection("orders").doc(orderId).get();

        if (!doc.exists) {
            console.log("❌ Order not found in database.");
            process.exit(0);
        }

        const data = doc.data();

        await cleanupOrder(orderId, data);

        console.log("🔥 Successfully wiped order from Cloudinary and Firestore.");
        process.exit(0);

    } catch (error) {
        console.error("❌ Error during manual cleanup:", error);
        process.exit(1);
    }
}

// Pass order ID as argument
const targetId = process.argv[2];

if (!targetId) {
    console.log("❗ Please provide an Order ID.");
    console.log("Example: node manualDelete.js ORD_123456789");
    process.exit(0);
}

manualDelete(targetId);
