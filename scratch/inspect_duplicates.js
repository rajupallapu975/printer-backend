const { dbCustomer } = require("../firebase");

async function main() {
  const ids = ["nyAKL7mMnGGkTx2Ow9HA", "ZHwQd18Vy08TZkyBFXjB"];
  for (const id of ids) {
    const doc = await dbCustomer.collection("services").doc(id).get();
    if (doc.exists) {
      console.log(`=== SERVICE ${id} ===`);
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.log(`Service ${id} not found`);
    }
  }
  process.exit(0);
}

main().catch(console.error);
