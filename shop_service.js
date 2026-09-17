/**
 * Shop Service — Multi-Shop Lifecycle & Management
 *
 * Implements permanent Shop ID management, Shop CRUD, status mutation guards,
 * analytics calculation, and QR standee metadata.
 */

const crypto = require("crypto");
const { admin, dbAdmin, dbCustomer, dbCustomer2, dbCustomer3 } = require("./firebase");
const { resolveEnvironment, getShopsCollection, getOrdersCollection } = require("./env_manager");
const { logAuditEvent } = require("./audit_service");
const { createOrUpdateShopCredentials } = require("./admin_auth");

/**
/**
 * Generates a structured permanent Shop ID.
 * Format: (zkr)(shop no)(random 3 numbers)(random 2 alphabets)(random 2 digit number)
 * Example: zkr01482xy79
 */
async function generatePermanentShopId(env = "production") {
  const isTest = resolveEnvironment(env) === "test";
  const prefix = isTest ? "zkrtest" : "zkr";

  const shopsCol = getShopsCollection(env);
  const snapshot = await shopsCol.get();

  // Count existing valid shop documents
  let validShopCount = 0;
  snapshot.forEach(doc => {
    if (doc.id !== "serviceVersion" && doc.id !== "reviewer_shop_store") {
      validShopCount++;
    }
  });

  const shopNo = String(validShopCount + 1);
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let uniqueId = null;

  while (!uniqueId) {
    const random3Numbers = String(Math.floor(100 + Math.random() * 900));
    const random2Alphabets = chars.charAt(Math.floor(Math.random() * chars.length)) +
                             chars.charAt(Math.floor(Math.random() * chars.length));
    const random2Digits = String(Math.floor(10 + Math.random() * 90));

    const candidateId = `${prefix}${shopNo}${random3Numbers}${random2Alphabets}${random2Digits}`;

    const existingDoc = await shopsCol.doc(candidateId).get();
    if (!existingDoc.exists) {
      uniqueId = candidateId;
    }
  }

  return uniqueId;
}

const defaultZikrinterServices = {
  "ZHwQd18Vy08TZkyBFXjB": {
    isEnabled: true,
    serviceName: "Documents (Xerox)",
    bulkStartPage: 5,
    bwBulkStartPage: 5,
    colorBulkStartPage: 5,
    a4_bw_singleSidePrice: 2.0,
    a4_bw_doubleSidePrice: 3.0,
    a4_bw_bulkPrintingPrice: 1.5,
    a4_bw_double_bulkPrintingPrice: 2.0,
    a4_color_singleSidePrice: 10.0,
    a4_color_doubleSidePrice: 20.0,
    a4_color_bulkPrintingPrice: 8.0,
    a4_color_double_bulkPrintingPrice: 16.0,
    bw_singleSidePrice: 2.0,
    bw_doubleSidePrice: 3.0,
    bw_bulkPrintingPrice: 1.5,
    bw_double_bulkPrintingPrice: 2.0,
    color_singleSidePrice: 10.0,
    color_doubleSidePrice: 20.0,
    color_bulkPrintingPrice: 8.0,
    color_double_bulkPrintingPrice: 16.0,
    singleSidePrice: 10.0,
    doubleSidePrice: 20.0,
    bulkPrintingPrice: 8.0,
    double_bulkPrintingPrice: 16.0,
    paperSizes: {
      a4: {
        bw: {
          singleSidePrice: 2.0,
          doubleSidePrice: 3.0,
          bulkPrintingPrice: 1.5,
          doubleBulkPrintingPrice: 2.0,
          bulkStartPage: 5,
          setPages: 5,
        },
        color: {
          singleSidePrice: 10.0,
          doubleSidePrice: 20.0,
          bulkPrintingPrice: 8.0,
          doubleBulkPrintingPrice: 16.0,
          bulkStartPage: 5,
          setPages: 5,
        }
      }
    }
  },
  "BHuFLrHX6WK0WpWDkkk6": {
    isEnabled: true,
    serviceName: "A3 Printing",
    bulkStartPage: 5,
    bwBulkStartPage: 5,
    colorBulkStartPage: 5,
    a3_bw_singleSidePrice: 5.0,
    a3_bw_doubleSidePrice: 10.0,
    a3_bw_bulkPrintingPrice: 4.0,
    a3_bw_double_bulkPrintingPrice: 8.0,
    a3_color_singleSidePrice: 20.0,
    a3_color_doubleSidePrice: 40.0,
    a3_color_bulkPrintingPrice: 15.0,
    a3_color_double_bulkPrintingPrice: 30.0,
    bw_singleSidePrice: 5.0,
    bw_doubleSidePrice: 10.0,
    bw_bulkPrintingPrice: 4.0,
    bw_double_bulkPrintingPrice: 8.0,
    color_singleSidePrice: 20.0,
    color_doubleSidePrice: 40.0,
    color_bulkPrintingPrice: 15.0,
    color_double_bulkPrintingPrice: 30.0,
    paperSizes: {
      a3: {
        bw: {
          singleSidePrice: 5.0,
          doubleSidePrice: 10.0,
          bulkPrintingPrice: 4.0,
          doubleBulkPrintingPrice: 8.0,
          bulkStartPage: 5,
          setPages: 5,
        },
        color: {
          singleSidePrice: 20.0,
          doubleSidePrice: 40.0,
          bulkPrintingPrice: 15.0,
          doubleBulkPrintingPrice: 30.0,
          bulkStartPage: 5,
          setPages: 5,
        }
      }
    }
  },
  "mqKjbpkKVYS8LCBg3kB9": {
    isEnabled: true,
    serviceName: "Legal Paper Priting",
    bulkStartPage: 5,
    bwBulkStartPage: 5,
    colorBulkStartPage: 5,
    legal_bw_singleSidePrice: 3.0,
    legal_bw_doubleSidePrice: 5.0,
    legal_bw_bulkPrintingPrice: 2.0,
    legal_bw_double_bulkPrintingPrice: 4.0,
    legal_color_singleSidePrice: 15.0,
    legal_color_doubleSidePrice: 30.0,
    legal_color_bulkPrintingPrice: 12.0,
    legal_color_double_bulkPrintingPrice: 24.0,
    bw_singleSidePrice: 3.0,
    bw_doubleSidePrice: 5.0,
    bw_bulkPrintingPrice: 2.0,
    bw_double_bulkPrintingPrice: 4.0,
    color_singleSidePrice: 15.0,
    color_doubleSidePrice: 30.0,
    color_bulkPrintingPrice: 12.0,
    color_double_bulkPrintingPrice: 24.0,
    paperSizes: {
      legal: {
        bw: {
          singleSidePrice: 3.0,
          doubleSidePrice: 5.0,
          bulkPrintingPrice: 2.0,
          doubleBulkPrintingPrice: 4.0,
          bulkStartPage: 5,
          setPages: 5,
        },
        color: {
          singleSidePrice: 15.0,
          doubleSidePrice: 30.0,
          bulkPrintingPrice: 12.0,
          doubleBulkPrintingPrice: 24.0,
          bulkStartPage: 5,
          setPages: 5,
        }
      }
    }
  },
  "nyAKL7mMnGGkTx2Ow9HA": {
    isEnabled: true,
    serviceName: "Bond Paper Printing",
    bulkStartPage: 5,
    bwBulkStartPage: 5,
    colorBulkStartPage: 5,
    a4_bw_singleSidePrice: 5.0,
    a4_bw_doubleSidePrice: 10.0,
    a4_bw_bulkPrintingPrice: 4.0,
    a4_bw_double_bulkPrintingPrice: 8.0,
    a4_color_singleSidePrice: 15.0,
    a4_color_doubleSidePrice: 30.0,
    a4_color_bulkPrintingPrice: 12.0,
    a4_color_double_bulkPrintingPrice: 24.0,
    bw_singleSidePrice: 5.0,
    bw_doubleSidePrice: 10.0,
    bw_bulkPrintingPrice: 4.0,
    bw_double_bulkPrintingPrice: 8.0,
    color_singleSidePrice: 15.0,
    color_doubleSidePrice: 30.0,
    color_bulkPrintingPrice: 12.0,
    color_double_bulkPrintingPrice: 24.0,
    paperSizes: {
      a4: {
        bw: {
          singleSidePrice: 5.0,
          doubleSidePrice: 10.0,
          bulkPrintingPrice: 4.0,
          doubleBulkPrintingPrice: 8.0,
          bulkStartPage: 5,
          setPages: 5,
        },
        color: {
          singleSidePrice: 15.0,
          doubleSidePrice: 30.0,
          bulkPrintingPrice: 12.0,
          doubleBulkPrintingPrice: 24.0,
          bulkStartPage: 5,
          setPages: 5,
        }
      }
    }
  },
  "yPiaqNqbvhABcunanu5X": {
    isEnabled: true,
    serviceName: "Passport Size Photos",
    bulkStartPage: 5,
    "4_photos_color_singleSidePrice": 40.0,
    "8_photos_color_singleSidePrice": 60.0,
    "16_photos_color_singleSidePrice": 100.0,
    "32_photos_color_singleSidePrice": 180.0,
    color_singleSidePrice: 60.0,
    paperSizes: {
      "4_photos": {
        color: {
          singleSidePrice: 40.0,
        }
      },
      "8_photos": {
        color: {
          singleSidePrice: 60.0,
        }
      }
    }
  },
  "a2Qg98wvcycUujBBsU5C": {
    isEnabled: true,
    serviceName: "Passport Size Photos",
    bulkStartPage: 5,
    "4_photos_color_singleSidePrice": 40.0,
    "8_photos_color_singleSidePrice": 60.0,
    "16_photos_color_singleSidePrice": 100.0,
    "32_photos_color_singleSidePrice": 180.0,
    color_singleSidePrice: 60.0,
    paperSizes: {
      "4_photos": {
        color: {
          singleSidePrice: 40.0,
        }
      },
      "8_photos": {
        color: {
          singleSidePrice: 60.0,
        }
      }
    }
  },
  "project_binding": {
    isEnabled: true,
    serviceName: "Project + Binding",
    bindings: {
      spiral: 30.0,
      thermal: 40.0,
      paper: 20.0
    },
    a4_color_singleSidePrice: 10.0,
    "bond_paper_(a4)_color_singleSidePrice": 15.0,
    color_singleSidePrice: 10.0,
    paperSizes: {
      a4: {
        color: {
          singleSidePrice: 10.0,
        }
      }
    }
  },
  "record_binding": {
    isEnabled: true,
    serviceName: "Record Binding",
    bindings: {
      spiral: 30.0,
      thermal: 40.0,
      paper: 20.0
    },
    a4_bw_singleSidePrice: 2.0,
    a4_color_singleSidePrice: 10.0,
    bw_singleSidePrice: 2.0,
    color_singleSidePrice: 10.0,
    paperSizes: {
      a4: {
        bw: {
          singleSidePrice: 2.0,
        },
        color: {
          singleSidePrice: 10.0,
        }
      }
    }
  },
  "t0WPkKItLqVnfX9PjXky": {
    isEnabled: true,
    serviceName: "Project Binding",
    bindings: {
      spiral: 30.0,
      thermal: 40.0,
      paper: 20.0
    },
    a4_color_singleSidePrice: 10.0,
    bond_paper_color_singleSidePrice: 15.0,
    color_singleSidePrice: 10.0,
    paperSizes: {
      a4: {
        color: {
          singleSidePrice: 10.0,
        }
      }
    }
  }
};

/**
 * Creates a new shop and provisions its admin user.
 */
async function createNewShop({
  shopName,
  ownerName = "",
  phone = "",
  email = "",
  address = "",
  latitude = 0.0,
  longitude = 0.0,
  openingTime = "09:00 AM",
  closingTime = "09:00 PM",
  initialPassword,
  environment = "production",
  actor = "Super Admin",
}) {
  const env = resolveEnvironment(environment);
  const shopId = await generatePermanentShopId(env);
  const shopsCol = getShopsCollection(env);

  const qrToken = crypto.randomBytes(8).toString("hex");

  const defaultPricing = {
    bwRate: 2.0,
    colorRate: 10.0,
    doubleSidedDiscountRate: 0.5,
    spiralBindingRate: 30.0,
    laminationRate: 20.0,
  };

  const newShopData = {
    shopId,
    shopName: shopName.trim(),
    ownerName: ownerName.trim(),
    phone: phone.trim(),
    email: email.trim().toLowerCase(),
    address: address.trim(),
    latitude: Number(latitude) || 0.0,
    longitude: Number(longitude) || 0.0,
    location: {
      latitude: Number(latitude) || 0.0,
      longitude: Number(longitude) || 0.0,
    },
    operatingHours: {
      open: openingTime,
      close: closingTime,
    },
    openingTime,
    closingTime,
    platformStatus: "active", // active | disabled | suspended | deactivated
    isOpen: true,
    isCurrentlyOpen: true,
    environment: env,
    walletBalance: 0.0,
    totalBwPages: 0,
    totalColorPages: 0,
    totalOrdersCount: 0,
    totalRevenue: 0.0,
    bulkStartPage: 5,
    bwBulkStartPage: 5,
    colorBulkStartPage: 5,
    pricing: defaultPricing,
    zikrinterServices: defaultZikrinterServices,
    qrToken,
    qrPayload: `zikrint://shop?id=${shopId}&token=${qrToken}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await shopsCol.doc(shopId).set(newShopData);

  // Mirror to all customer Firebase instances for live customer app access
  const allDatabases = [dbCustomer, dbCustomer2, dbCustomer3].filter(Boolean);
  for (const db of allDatabases) {
    try {
      await db.collection(env === "test" ? "test_shops" : "shops").doc(shopId).set(newShopData, { merge: true });
    } catch (e) {
      console.warn(`⚠️ Failed to mirror shop ${shopId} to ${db.projectId}:`, e.message);
    }
  }

  // Broadcast version bump so all customer apps recognize new shop immediately
  for (const db of [dbAdmin, ...allDatabases]) {
    try {
      await db.collection("shops").doc("serviceVersion").set({
        version: admin.firestore.FieldValue.increment(1),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      await db.collection("app_config").doc("services_version").set({
        version: admin.firestore.FieldValue.increment(1),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (_) {}
  }

  // Auto-provision shop credentials
  const effectivePassword = initialPassword || `Zikrint@${shopId.replace(/[^0-9]/g, "") || "2026"}`;
  await createOrUpdateShopCredentials({
    shopId,
    email: email || `${shopId.toLowerCase()}@zikrint.shop`,
    username: shopId.toLowerCase(),
    password: effectivePassword,
    displayName: ownerName || shopName,
    phone,
    environment: env,
    actor,
  });

  await logAuditEvent({
    actor,
    action: "SHOP_CREATED",
    shopId,
    details: { shopName, email, phone, environment: env },
    environment: env,
  });

  return {
    success: true,
    shop: {
      ...newShopData,
      initialPassword: effectivePassword,
    },
  };
}

/**
 * Lists all shops with high-level stats.
 */
async function listAllShops(opts = {}) {
  const options = typeof opts === "string" ? { environment: opts } : (opts || {});
  const { environment = "production", status = null, search = "" } = options;
  const env = resolveEnvironment(environment);
  const shopsCol = getShopsCollection(env);
  const snapshot = await shopsCol.get();

  let shops = [];
  for (const doc of snapshot.docs) {
    if (doc.id === "serviceVersion") continue;
    const data = doc.data();

    // Ignore phantom documents created by stale client heartbeats that lack real shop metadata
    if (!data.shopName && !data.pricing && !data.createdAt && !data.email) {
      continue;
    }

    // Reviewer/test isolation check
    const isTestDoc = data.environment === "test" || doc.id.includes("TEST") || doc.id === "reviewer_shop_store";
    if (env === "production" && isTestDoc) continue;
    if (env === "test" && !isTestDoc) continue;

    if (status && data.platformStatus !== status) continue;

    if (search) {
      const q = search.toLowerCase();
      const match =
        (data.shopName || "").toLowerCase().includes(q) ||
        (data.shopId || doc.id).toLowerCase().includes(q) ||
        (data.ownerName || "").toLowerCase().includes(q) ||
        (data.phone || "").includes(q);
      if (!match) continue;
    }

    let todayActiveOrders = 0;
    let todayCompletedOrders = 0;

    try {
      const ordersSnap = await shopsCol.doc(doc.id).collection("orders").get();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      ordersSnap.forEach((oDoc) => {
        const oData = oDoc.data();
        let orderTime = 0;
        if (oData.createdAt?.toDate) {
          orderTime = oData.createdAt.toDate().getTime();
        } else if (oData.createdAt?._seconds) {
          orderTime = oData.createdAt._seconds * 1000;
        } else if (oData.createdAt) {
          orderTime = new Date(oData.createdAt).getTime();
        } else if (oData.timestamp) {
          orderTime = new Date(oData.timestamp).getTime();
        }

        const isToday = orderTime >= startOfToday.getTime();
        const st = (oData.status || "pending").toLowerCase();

        if (isToday) {
          if (["completed", "delivered", "picked_up", "success"].includes(st)) {
            todayCompletedOrders++;
          } else if (!["cancelled", "rejected", "failed"].includes(st)) {
            todayActiveOrders++;
          }
        }
      });
    } catch (e) {
      // subcollection empty or uninitialized
    }

    shops.push({
      id: doc.id,
      shopId: data.shopId || doc.id,
      shopName: data.shopName || doc.id,
      ownerName: data.ownerName || "",
      phone: data.phone || "",
      email: data.email || "",
      address: data.address || "",
      platformStatus: data.platformStatus || "active",
      isOpen: data.isOpen === true,
      walletBalance: Number(data.walletBalance) || 0.0,
      todayActiveOrders,
      todayCompletedOrders,
      activeOrders: todayActiveOrders,
      completedOrders: todayCompletedOrders,
      totalBwPages: Number(data.totalBwPages) || 0,
      totalColorPages: Number(data.totalColorPages) || 0,
      totalOrdersCount: Number(data.totalOrdersCount) || 0,
      environment: data.environment || env,
      createdAt: data.createdAt,
    });
  }

  return shops;
}

/**
 * Updates shop operational / platform status (active, disabled, suspended, deactivated).
 */
async function updateShopStatus(shopId, newStatus, reason = "", actor = "Super Admin", environment = "production") {
  const validStatuses = ["active", "disabled", "suspended", "deactivated"];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(", ")}`);
  }

  const env = resolveEnvironment(environment);
  const shopRef = getShopsCollection(env).doc(shopId);
  const shopDoc = await shopRef.get();

  if (!shopDoc.exists) {
    throw new Error(`Shop ${shopId} not found in ${env}`);
  }

  const beforeData = shopDoc.data();
  const updateData = {
    platformStatus: newStatus,
    statusReason: reason || null,
    // If disabling or suspending, close shop to new orders
    isOpen: newStatus === "active" ? beforeData.isOpen : false,
    isCurrentlyOpen: newStatus === "active" ? beforeData.isCurrentlyOpen : false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await shopRef.set(updateData, { merge: true });

  await logAuditEvent({
    actor,
    action: `SHOP_STATUS_${newStatus.toUpperCase()}`,
    shopId,
    beforeState: { platformStatus: beforeData.platformStatus, isOpen: beforeData.isOpen },
    afterState: { platformStatus: newStatus, isOpen: updateData.isOpen, reason },
    details: { reason },
    environment: env,
  });

  return { success: true, shopId, platformStatus: newStatus };
}

/**
 * Computes shop-scoped or platform-wide analytics for a given time window.
 */
async function getShopAnalytics(opts = {}, maybePeriod, maybeEnv) {
  const options = typeof opts === "string" ? { shopId: opts, period: maybePeriod || "today", environment: maybeEnv || "production" } : (opts || {});
  const { shopId = null, period = "today", environment = "production" } = options;
  const env = resolveEnvironment(environment);
  const shopsCol = getShopsCollection(env);

  let targetShops = [];
  if (shopId) {
    const doc = await shopsCol.doc(shopId).get();
    if (doc.exists) targetShops.push({ id: doc.id, ...doc.data() });
  } else {
    const snap = await shopsCol.get();
    targetShops = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  let totalRevenue = 0;
  let totalBwPages = 0;
  let totalColorPages = 0;
  let totalOrders = 0;
  let activeShops = 0;

  targetShops.forEach((shop) => {
    if (shop.platformStatus === "active" && shop.isOpen === true) activeShops++;
    totalRevenue += Number(shop.walletBalance || 0);
    totalBwPages += Number(shop.totalBwPages || 0);
    totalColorPages += Number(shop.totalColorPages || 0);
    totalOrders += Number(shop.totalOrdersCount || 0);
  });

  return {
    shopId: shopId || "ALL",
    period,
    environment: env,
    metrics: {
      totalShops: targetShops.length,
      activeShops,
      totalOrders,
      totalRevenue,
      totalBwPages,
      totalColorPages,
      averageOrderValue: totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0,
    },
  };
}

async function deleteSubcollection(docRef, subcollectionName) {
  try {
    const subRef = docRef.collection(subcollectionName);
    const snap = await subRef.get();
    for (const subDoc of snap.docs) {
      const nestedSubs = await subDoc.ref.listCollections();
      for (const nested of nestedSubs) {
        await deleteSubcollection(subDoc.ref, nested.id);
      }
      await subDoc.ref.delete();
    }
  } catch (e) {
    console.warn(`⚠️ Error deleting subcollection ${subcollectionName}:`, e.message);
  }
}

async function deleteShop(shopId, environment = "production", actor = "Super Admin") {
  const env = resolveEnvironment(environment);
  const isTest = env === "test";
  const collectionName = isTest ? "test_shops" : "shops";
  const credsCollection = isTest ? "test_shop_credentials" : "shop_credentials";
  const ordersCollection = isTest ? "test_xerox_orders" : "xerox_orders";
  const withdrawalsCollection = isTest ? "test_withdrawal_requests" : "withdrawal_requests";

  const allDbs = [dbAdmin, dbCustomer, dbCustomer2, dbCustomer3].filter(Boolean);

  // 1. Delete shop document and all subcollections across all DBs
  for (const db of allDbs) {
    try {
      const docRef = db.collection(collectionName).doc(shopId);
      const doc = await docRef.get();
      if (doc.exists) {
        const subcollections = await docRef.listCollections();
        for (const sub of subcollections) {
          await deleteSubcollection(docRef, sub.id);
        }
        await docRef.delete();
      }
    } catch (e) {
      console.warn(`⚠️ Error deleting shop ${shopId} from ${db.projectId}:`, e.message);
    }
  }

  // 2. Delete shop credentials
  try {
    const credsSnap = await dbAdmin.collection(credsCollection).where("shopId", "==", shopId).get();
    for (const doc of credsSnap.docs) {
      await doc.ref.delete();
    }
  } catch (e) {
    console.warn("⚠️ Error deleting credentials:", e.message);
  }

  // 3. Delete related orders
  for (const db of allDbs) {
    try {
      const ordersSnap = await db.collection(ordersCollection).where("shopId", "==", shopId).get();
      for (const doc of ordersSnap.docs) {
        await doc.ref.delete();
      }
      const vendorOrdersSnap = await db.collection(ordersCollection).where("vendorId", "==", shopId).get();
      for (const doc of vendorOrdersSnap.docs) {
        await doc.ref.delete();
      }
    } catch (e) {
      console.warn(`⚠️ Error deleting orders for ${shopId}:`, e.message);
    }
  }

  // 4. Delete related withdrawal requests
  for (const db of allDbs) {
    try {
      const wSnap = await db.collection(withdrawalsCollection).where("shopId", "==", shopId).get();
      for (const doc of wSnap.docs) {
        await doc.ref.delete();
      }
    } catch (e) {
      console.warn(`⚠️ Error deleting withdrawals for ${shopId}:`, e.message);
    }
  }

  // 5. Bump version tokens
  const inc = admin.firestore.FieldValue.increment(1);
  for (const db of allDbs) {
    try {
      await db.collection("shops").doc("serviceVersion").set({ version: inc }, { merge: true });
      await db.collection("app_config").doc("services_version").set({ version: inc }, { merge: true });
    } catch (_) {}
  }

  await logAuditEvent({
    actor,
    action: "SHOP_DELETED",
    shopId,
    details: { shopId, environment: env },
    environment: env,
  });

  return { success: true, shopId, message: `Shop ${shopId} and all related data deleted successfully.` };
}

async function deleteAllShops(environment = "production", actor = "Super Admin") {
  const env = resolveEnvironment(environment);
  const isTest = env === "test";
  const collectionName = isTest ? "test_shops" : "shops";
  const credsCollection = isTest ? "test_shop_credentials" : "shop_credentials";
  const ordersCollection = isTest ? "test_xerox_orders" : "xerox_orders";
  const withdrawalsCollection = isTest ? "test_withdrawal_requests" : "withdrawal_requests";

  const allDbs = [dbAdmin, dbCustomer, dbCustomer2, dbCustomer3].filter(Boolean);
  const deletedShopIds = [];

  for (const db of allDbs) {
    try {
      const snap = await db.collection(collectionName).get();
      for (const doc of snap.docs) {
        if (doc.id === "serviceVersion") continue;
        if (!deletedShopIds.includes(doc.id)) deletedShopIds.push(doc.id);
        const subcollections = await doc.ref.listCollections();
        for (const sub of subcollections) {
          await deleteSubcollection(doc.ref, sub.id);
        }
        await doc.ref.delete();
      }
    } catch (e) {
      console.warn(`⚠️ Error deleting all shops from ${db.projectId}:`, e.message);
    }
  }

  // Delete all credentials
  try {
    const credSnap = await dbAdmin.collection(credsCollection).get();
    for (const doc of credSnap.docs) {
      await doc.ref.delete();
    }
  } catch (_) {}

  // Delete all orders & withdrawals in that environment
  for (const db of allDbs) {
    try {
      const ordSnap = await db.collection(ordersCollection).get();
      for (const doc of ordSnap.docs) {
        await doc.ref.delete();
      }
      const wSnap = await db.collection(withdrawalsCollection).get();
      for (const doc of wSnap.docs) {
        await doc.ref.delete();
      }
    } catch (_) {}
  }

  // Bump version tokens
  const inc = admin.firestore.FieldValue.increment(1);
  for (const db of allDbs) {
    try {
      await db.collection("shops").doc("serviceVersion").set({ version: inc }, { merge: true });
      await db.collection("app_config").doc("services_version").set({ version: inc }, { merge: true });
    } catch (_) {}
  }

  await logAuditEvent({
    actor,
    action: "ALL_SHOPS_DELETED",
    shopId: "ALL",
    details: { deletedShopIds, environment: env },
    environment: env,
  });

  return { success: true, count: deletedShopIds.length, deletedShopIds, message: "All shops and related data deleted successfully." };
}

/**
 * Synchronizes all services pricing for all existing shops across all Firebase instances.
 */
async function syncAllShopsPricing() {
  const allDbs = [dbAdmin, dbCustomer, dbCustomer2, dbCustomer3].filter(Boolean);
  const snap = await dbAdmin.collection("shops").get();

  for (const doc of snap.docs) {
    if (doc.id === "serviceVersion") continue;
    const shopId = doc.id;
    const data = doc.data();

    // Ignore phantom records
    if (!data.shopName && !data.pricing && !data.createdAt && !data.email) {
      continue;
    }

    const existingServices = data.zikrinterServices || {};
    const merged = { ...defaultZikrinterServices, ...existingServices };

    for (const [sId, defConf] of Object.entries(defaultZikrinterServices)) {
      if (existingServices[sId]) {
        merged[sId] = {
          ...defConf,
          ...existingServices[sId],
          paperSizes: {
            ...defConf.paperSizes,
            ...(existingServices[sId].paperSizes || {})
          }
        };
      }
    }

    const syncPayload = {
      zikrinterServices: merged,
      isOpen: data.isOpen !== undefined ? data.isOpen : true,
      isCurrentlyOpen: data.isCurrentlyOpen !== undefined ? data.isCurrentlyOpen : true,
      platformStatus: data.platformStatus || "active",
      bulkStartPage: 5,
      bwBulkStartPage: 5,
      colorBulkStartPage: 5,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    for (const db of allDbs) {
      try {
        await db.collection("shops").doc(shopId).set(syncPayload, { merge: true });
      } catch (err) {
        console.warn(`⚠️ Failed to sync services for ${shopId} to ${db.projectId}:`, err.message);
      }
    }
  }

  // Bump service version
  for (const db of allDbs) {
    try {
      await db.collection("shops").doc("serviceVersion").set({
        version: admin.firestore.FieldValue.increment(1),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      await db.collection("app_config").doc("services_version").set({
        version: admin.firestore.FieldValue.increment(1),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (_) {}
  }

  console.log("✅ [SHOP SYNC] All shops synchronized across all Firebase databases.");
}

module.exports = {
  generatePermanentShopId,
  createNewShop,
  listAllShops,
  updateShopStatus,
  getShopAnalytics,
  deleteShop,
  deleteAllShops,
  syncAllShopsPricing,
  defaultZikrinterServices,
};
