require('dotenv').config();
const { dbCustomer: db } = require("./firebase");

async function checkFields() {
    console.log("Checking fields in orders collection...");
    const snapshot = await db.collection("orders").limit(1).get();
    if (snapshot.empty) {
        console.log("Orders collection is empty.");
    } else {
        console.log("Fields in an order document:", Object.keys(snapshot.docs[0].data()));
    }

    console.log("\nChecking fields in xerox_orders collection...");
    const snapshot2 = await db.collection("xerox_orders").limit(1).get();
    if (snapshot2.empty) {
        console.log("Xerox orders collection is empty.");
    } else {
        console.log("Fields in a xerox order document:", Object.keys(snapshot2.docs[0].data()));
    }
    process.exit(0);
}

checkFields();
