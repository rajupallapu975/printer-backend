/**
 * Boot-time environment validation.
 *
 * Required in index.js before anything else. The point is to fail loudly at startup
 * rather than at the first customer checkout: a process that boots with a missing
 * Razorpay secret and only discovers it mid-payment is strictly worse than one that
 * refuses to start.
 *
 * Phase 0.5.4 replaces the hand-rolled checks below with the same Zod schema layer used
 * for request validation. Kept dependency-free here so Phase 0 can ship without adding
 * packages.
 */

const fs = require("fs");
const path = require("path");

// Fail startup if absent — the service cannot function without these.
const REQUIRED = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "CLOUDINARY_CLOUD_NAME_B",
  "CLOUDINARY_API_KEY_B",
  "CLOUDINARY_API_SECRET_B",
];

// Warn but continue — features degrade rather than break.
const RECOMMENDED = {
  ADMIN_API_KEY:
    "administrative endpoints (/refund-payment, /run-cleanup) will refuse all requests",
  RAZORPAY_WEBHOOK_SECRET:
    "the Razorpay webhook receiver cannot verify signatures (Phase 1.5)",
};

// At least one credential source must resolve for each Firebase project we initialise.
const FIREBASE_CREDENTIAL_SOURCES = [
  { name: "customer", env: "FIREBASE_SERVICE_ACCOUNT", file: "serviceAccountKey.json", required: true },
  { name: "customer2", env: "FIREBASE_SERVICE_ACCOUNT_2", file: "serviceAccountKey2.json", required: false },
  { name: "customer3", env: "FIREBASE_SERVICE_ACCOUNT_3", file: "serviceAccountKey3.json", required: false },
  { name: "admin", env: "FIREBASE_SERVICE_ACCOUNT_ADMIN", file: "adminServiceAccountKey.json", required: true },
];

function validateEnvironment() {
  const errors = [];
  const warnings = [];

  for (const name of REQUIRED) {
    if (!process.env[name]) errors.push(`Missing required env var: ${name}`);
  }

  for (const [name, consequence] of Object.entries(RECOMMENDED)) {
    if (!process.env[name]) warnings.push(`${name} is not set — ${consequence}`);
  }

  for (const src of FIREBASE_CREDENTIAL_SOURCES) {
    const hasEnv = Boolean(process.env[src.env]);
    const hasFile = fs.existsSync(path.join(__dirname, src.file));
    if (!hasEnv && !hasFile) {
      const message =
        `No credentials for Firebase project '${src.name}': ` +
        `set ${src.env} or provide ${src.file}`;
      if (src.required) errors.push(message);
      else warnings.push(message + " (failover target will be unavailable)");
    } else if (!hasEnv && hasFile) {
      warnings.push(
        `Firebase project '${src.name}' is using the on-disk key ${src.file}. ` +
          `Prefer ${src.env} so the credential can be rotated without a redeploy.`
      );
    }
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS === "true") {
    errors.push("ALLOW_MOCK_PAYMENTS must never be true in production");
  }

  for (const w of warnings) console.warn(`⚠️  CONFIG: ${w}`);

  if (errors.length > 0) {
    console.error("\n❌ Refusing to start — invalid configuration:");
    for (const e of errors) console.error(`   • ${e}`);
    console.error("");
    process.exit(1);
  }

  console.log(`✅ Configuration validated (${REQUIRED.length} required vars present)`);
}

module.exports = { validateEnvironment };
