const { dbCustomer, dbCustomer2, dbCustomer3 } = require("../firebase");

async function listProject(name, db) {
  if (!db) {
    console.log(`=== ${name}: not initialized ===`);
    return;
  }
  const snap = await db.collection("services").get();
  console.log(`=== ${name} ===`);
  snap.forEach(doc => {
    const data = doc.data();
    if (data.isDeleted !== true) {
      console.log(`- [${doc.id}] ${data.name} (Active: ${data.isActive})`);
    }
  });
}

async function main() {
  await listProject("Project 1 (psfc)", dbCustomer);
  await listProject("Project 2 (zikrint-944a4)", dbCustomer2);
  await listProject("Project 3 (think-ink)", dbCustomer3);
  process.exit(0);
}

main().catch(console.error);
