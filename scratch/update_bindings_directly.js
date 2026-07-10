const { dbAdmin } = require("../firebase");

async function main() {
  const shopId = "R4BCqS1FUnY48opDD1enBQfWqhC2";
  const bindings = {
    spiral: 45.0,
    thermal: 55.0,
    paper: 35.0
  };

  console.log(`Directly updating bindings config in Firestore for shop: ${shopId}...`);
  
  await dbAdmin.collection("shops").doc(shopId).update({
    "zikrinterServices.project_binding.bindings": bindings
  });

  // Also increment serviceVersion to notify clients of changes
  const versionDoc = dbAdmin.collection("shops").doc("serviceVersion");
  const versionSnap = await versionDoc.get();
  const currentVersion = versionSnap.exists ? (versionSnap.data().version || 0) : 0;
  await versionDoc.set({ version: currentVersion + 1 });

  console.log("Firestore updated successfully!");
  process.exit(0);
}

main().catch(console.error);
