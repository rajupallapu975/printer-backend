const { dbCustomer, admin } = require("../firebase");

async function main() {
  const serviceId = "project_binding";
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  
  console.log(`Deleting service "${serviceId}" from database...`);
  
  const docRef = dbCustomer.collection("services").doc(serviceId);

  try {
    await docRef.delete();
    console.log("✅ Service document deleted successfully!");
    
    // Increment service version in shops collection to notify all client apps
    const versionRef = dbCustomer.collection("shops").doc("serviceVersion");
    await versionRef.set({
      lastUpdated: timestamp,
      version: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
    console.log("✅ Service version notification sent successfully!");
  } catch (e) {
    console.error("❌ Failed to delete service:", e.message);
  }
  
  process.exit(0);
}

main().catch(console.error);
