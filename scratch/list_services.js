const { dbCustomer } = require("../firebase");

async function main() {
  const snap = await dbCustomer.collection("services").get();
  console.log("=== BUILT-IN SERVICES ===");
  let count = 0;
  snap.forEach(doc => {
    const data = doc.data();
    if (data.isDeleted !== true) {
      count++;
      console.log(`- [${doc.id}] ${data.name} (Active: ${data.isActive})`);
    }
  });
  console.log(`Total Services: ${count}`);
  process.exit(0);
}

main().catch(console.error);
