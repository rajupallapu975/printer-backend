const { dbCustomer } = require("../firebase");

async function main() {
  console.log("Listing services from dbCustomer...");
  const snapshot = await dbCustomer.collection("services").get();
  snapshot.forEach(doc => {
    console.log(`Service ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
    console.log("-----------------------------------------");
  });
  process.exit(0);
}

main().catch(console.error);
