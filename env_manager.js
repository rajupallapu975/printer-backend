/**
 * Environment Manager — Production & Test Separation
 * 
 * Enforces strict data and operational boundaries between Production and Test.
 * Test orders, metrics, simulated wallets, and shops never cross into Production.
 */

const { dbAdmin, dbCustomer } = require("./firebase");

const ENVIRONMENTS = {
  PRODUCTION: "production",
  TEST: "test",
};

/**
 * Normalizes input environment string. Defaults to 'production' unless explicitly 'test'.
 */
function resolveEnvironment(envStr) {
  if (!envStr) return ENVIRONMENTS.PRODUCTION;
  const clean = String(envStr).trim().toLowerCase();
  return clean === "test" || clean === "sandbox" ? ENVIRONMENTS.TEST : ENVIRONMENTS.PRODUCTION;
}

/**
 * Returns collection name or path scoped to the environment if applicable,
 * or returns Firestore database instances configured for the requested environment.
 */
function getShopsCollection(env = ENVIRONMENTS.PRODUCTION) {
  const isTest = resolveEnvironment(env) === ENVIRONMENTS.TEST;
  return dbAdmin.collection(isTest ? "test_shops" : "shops");
}

function getOrdersCollection(env = ENVIRONMENTS.PRODUCTION) {
  const isTest = resolveEnvironment(env) === ENVIRONMENTS.TEST;
  return dbCustomer.collection(isTest ? "test_xerox_orders" : "xerox_orders");
}

function getWithdrawalsCollection(env = ENVIRONMENTS.PRODUCTION) {
  const isTest = resolveEnvironment(env) === ENVIRONMENTS.TEST;
  return dbAdmin.collection(isTest ? "test_withdrawal_requests" : "withdrawal_requests");
}

function getAuditLogsCollection(env = ENVIRONMENTS.PRODUCTION) {
  const isTest = resolveEnvironment(env) === ENVIRONMENTS.TEST;
  return dbAdmin.collection(isTest ? "test_audit_logs" : "audit_logs");
}

module.exports = {
  ENVIRONMENTS,
  resolveEnvironment,
  getShopsCollection,
  getOrdersCollection,
  getWithdrawalsCollection,
  getAuditLogsCollection,
};
