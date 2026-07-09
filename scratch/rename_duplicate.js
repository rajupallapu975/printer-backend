const { dbCustomer, dbCustomer2, dbCustomer3, admin } = require("../firebase");

async function main() {
  const serviceId = "a2Qg98wvcycUujBBsU5C";
  const newName = "Passport Size Photos";
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  
  console.log(`Starting rename of service ${serviceId} to "${newName}"...`);
  
  const dbs = [
    { name: "Project 1 (psfc)", db: dbCustomer },
    { name: "Project 2 (zikrint-944a4)", db: dbCustomer2 },
    { name: "Project 3 (think-ink)", db: dbCustomer3 }
  ];

  for (const item of dbs) {
    if (!item.db) {
      console.log(`⚠️ ${item.name} not initialized, skipping.`);
      continue;
    }
    
    try {
      const docRef = item.db.collection("services").doc(serviceId);
      const snapshot = await docRef.get();
      if (!snapshot.exists) {
        console.log(`❌ Document ${serviceId} not found in ${item.name}`);
        continue;
      }
      
      // Update service name
      await docRef.update({
        name: newName,
        updatedAt: timestamp,
        updatedBy: "system_admin"
      });
      console.log(`✅ Updated service name in ${item.name}`);
      
      // Update service version to notify listener apps to reload in real-time
      const versionRef = item.db.collection("shops").doc("serviceVersion");
      await versionRef.set({
        lastUpdated: timestamp,
        version: admin.firestore.FieldValue.increment(1)
      }, { merge: true });
      console.log(`✅ Bumped service version in ${item.name}`);
      
    } catch (e) {
      console.error(`❌ Error updating ${item.name}:`, e.message);
    }
  }
  
  console.log("Rename complete.");
  process.exit(0);
}

main().catch(console.error);
