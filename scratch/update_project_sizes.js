const { dbCustomer, admin } = require("../firebase");

async function main() {
  const serviceId = "project_binding";
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  
  console.log(`Updating paperSizes for "${serviceId}"...`);
  
  const docRef = dbCustomer.collection("services").doc(serviceId);

  try {
    const doc = await docRef.get();
    if (!doc.exists) {
      console.log(`❌ Service document ${serviceId} not found!`);
      process.exit(1);
    }
    
    await docRef.update({
      paperSizes: ["A4", "A3", "Legal", "Bond Paper (A4)"],
      updatedAt: timestamp,
      updatedBy: "system_admin"
    });
    console.log("✅ Service document paperSizes updated successfully!");
    
    // Increment service version in shops collection to notify all client apps
    const versionRef = dbCustomer.collection("shops").doc("serviceVersion");
    await versionRef.set({
      lastUpdated: timestamp,
      version: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
    console.log("✅ Service version notification sent successfully!");
  } catch (e) {
    console.error("❌ Failed to update service:", e.message);
  }
  
  process.exit(0);
}

main().catch(console.error);
