const { dbCustomer, dbAdmin } = require("../firebase");

async function toggleService() {
  const snapshot = await dbCustomer.collection("services").get();
  const matchedIds = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.name.toLowerCase().includes("passport")) {
      matchedIds.push(doc.id);
    }
  });

  if (matchedIds.length === 0) {
    console.log(`Could not find any service containing "passport" in name.`);
    process.exit(1);
  }

  for (const id of matchedIds) {
    const docRefCustomer = dbCustomer.collection("services").doc(id);
    const docRefAdmin = dbAdmin.collection("services").doc(id);

    await docRefCustomer.update({ isAvailable: false });
    await docRefAdmin.update({ isAvailable: false });
    console.log(`Disabled service: "${id}"`);
  }

  console.log(`\nSuccessfully disabled all ${matchedIds.length} passport size photo service documents in both databases!`);
  
  // Increment service version to trigger reload/poll sync
  try {
    const { incrementServiceVersion } = require("../index");
    await incrementServiceVersion();
  } catch (_) {
    await dbCustomer.collection("shops").doc("serviceVersion").set({
      version: Date.now().toString()
    });
    console.log("Updated serviceVersion token in shops/serviceVersion to trigger reload.");
  }
  
  process.exit(0);
}

toggleService().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
