const { deleteAllShops } = require('./shop_service');

async function main() {
  console.log('?? Deleting all shops and related data across all environments...');
  const prodResult = await deleteAllShops('production', 'Super Admin CLI');
  console.log('Production Result:', prodResult);
  const testResult = await deleteAllShops('test', 'Super Admin CLI');
  console.log('Test Result:', testResult);
  console.log('? ALL SHOPS AND RELATED DATA DELETED CLEANLY');
  process.exit(0);
}

main().catch(err => {
  console.error('? Error during complete deletion:', err);
  process.exit(1);
});
