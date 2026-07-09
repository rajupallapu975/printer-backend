const { dbCustomer } = require("../firebase");

async function main() {
  const ids = ["ZHwQd18Vy08TZkyBFXjB", "a2Qg98wvcycUujBBsU5C"];
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
