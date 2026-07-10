const { dbAdmin } = require("../firebase");

async function main() {
  const shopId = "R4BCqS1FUnY48opDD1enBQfWqhC2";
  const doc = await dbAdmin.collection("shops").doc(shopId).get();
  const data = doc.data();
  console.log("Xerox config:", JSON.stringify(data.zikrinterServices.ZHwQd18Vy08TZkyBFXjB, null, 2));
  process.exit(0);
}

main().catch(console.error);
