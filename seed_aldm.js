const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

const deploymentData = {
  configVersion: 1,
  cacheSchemaVersion: 1,
  deploymentId: "initial_dev_deployment",
  requiredCapabilities: [],
  minimumBrowser: {
    chrome: 80,
    firefox: 75,
    safari: 13,
    edge: 80
  },
  version: {
    latestVersion: "1.0.0",
    latestBuild: 1,
    minimumSupportedVersion: "1.0.0",
    minimumSupportedBuild: 1,
    updateType: "optional",
    updateMessage: "Welcome to the latest version of Zikrint!",
    releaseNotes: ["Initial stable release of ALDM system"]
  }
};

const runtimeData = {
  rollout: {
    enabled: false,
    percentage: 100
  },
  maintenance: {
    enabled: false,
    startTime: "",
    endTime: "",
    timezone: "UTC",
    title: "Under Maintenance",
    message: "We are performing a brief scheduled system upgrade. We will be back online shortly."
  },
  emergencyShutdown: {
    enabled: false,
    title: "Emergency Shutdown",
    message: "All services are temporarily suspended due to emergency maintenance. Please try again later."
  },
  featureFlags: {
    enableCoupons: true,
    enableWallet: false,
    enableNewCheckout: true
  },
  audit: {
    updatedBy: "seeder",
    updatedAt: new Date().toISOString()
  }
};

async function seed() {
  console.log("🌱 Seeding ALDM Firestore collections for project psfc-43b5a...");

  // Seed system/health_check
  await db.collection("system").doc("health_check").set({
    status: "ok",
    lastChecked: new Date().toISOString()
  });
  console.log("✅ Seeded system/health_check");

  // Seed development configurations
  await db.collection("system").doc("deployment_development").set(deploymentData);
  await db.collection("system").doc("runtime_development").set(runtimeData);
  console.log("✅ Seeded system/deployment_development and runtime_development");

  // Seed production configurations
  await db.collection("system").doc("deployment_production").set(deploymentData);
  await db.collection("system").doc("runtime_production").set(runtimeData);
  console.log("✅ Seeded system/deployment_production and runtime_production");

  console.log("🎉 Seeding complete successfully!");
  process.exit(0);
}

seed().catch(err => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
