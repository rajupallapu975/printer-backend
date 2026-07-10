const { dbCustomer, dbAdmin } = require("../firebase");

async function main() {
  const serviceDoc = {
    id: "record_binding",
    name: "Record Binding",
    startingPrice: 0,
    paperSizes: [],
    images: [],
    customParameters: [],
    parameters: {},
    description: "Only images are accepted. Contact shop for more details.",
    isDeleted: false,
    schemaVersion: 2,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  console.log("Writing to dbCustomer...");
  await dbCustomer.collection("services").doc("record_binding").set(serviceDoc);
  
  console.log("Writing to dbAdmin...");
  await dbAdmin.collection("services").doc("record_binding").set(serviceDoc);

  // Trigger service version increment
  const versionDoc = dbAdmin.collection("shops").doc("serviceVersion");
  const versionSnap = await versionDoc.get();
  const currentVersion = versionSnap.exists ? (versionSnap.data().version || 0) : 0;
  await versionDoc.set({ version: currentVersion + 1 });

  console.log("Record Binding service created successfully!");
  process.exit(0);
}

main().catch(console.error);
