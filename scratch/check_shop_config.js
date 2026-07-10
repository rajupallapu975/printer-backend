const { dbAdmin } = require("../firebase");

async function main() {
  console.log("Listing shops...");
  const snapshot = await dbAdmin.collection("shops").get();
  snapshot.forEach(doc => {
    console.log(`Shop ID: ${doc.id}`);
    const data = doc.data();
    console.log(`Name: ${data.name || data.shopName || "Unnamed"}`);
    if (data.zikrinterServices) {
      console.log("Services keys:", Object.keys(data.zikrinterServices));
      // Log project_binding config
      if (data.zikrinterServices.project_binding) {
        console.log("project_binding config:", JSON.stringify(data.zikrinterServices.project_binding, null, 2));
      }
      // Log Bond Paper config
      if (data.zikrinterServices.nyAKL7mMnGGkTx2Ow9HA) {
        console.log("Bond Paper config:", JSON.stringify(data.zikrinterServices.nyAKL7mMnGGkTx2Ow9HA, null, 2));
      }
    }
    console.log("-----------------------------------------");
  });
  process.exit(0);
}

main().catch(console.error);
