const { dbAdmin, admin } = require("./firebase");

/**
 * 🛰️ PEER-TO-PEER NOTIFICATION WATCHER
 * This script runs in the background at the server level.
 * It listens to Firestore snapshots across both Customer and Admin projects 
 * to trigger professional, real-time FCM alerts for the Captain and Shopkeepers.
 */

console.log("🚀 Starting Notification Watcher Service...");

// 🛡️ 1. Watch for New Payout Requests (Captain Alert)
function watchPayoutRequests() {
    console.log("📡 Listening for Withdrawal Requests...");
    dbAdmin.collection("withdrawal_requests")
        .where("status", "==", "pending")
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    
                    // Filter: Only alert for NEW documents (not initial snapshot)
                    const now = Date.now();
                    const reqTime = data.requestedAt ? data.requestedAt.toMillis() : now;
                    if (now - reqTime > 10000) return; // Skip if older than 10s

                    console.log(`💸 New Payout Request: ${data.shopName} (₹${data.amount})`);
                    await sendCaptainPayoutAlert(data);
                }
            });
        }, (err) => console.error("❌ Payout Listener Error:", err.message));
}

async function sendCaptainPayoutAlert(data) {
    try {
        console.log("🔍 Searching for Captain FCM token...");
        let settingsDoc = await dbAdmin.collection("admin_settings").doc("payout_alerts").get();
        let sourceDb = "admin";

        if (!settingsDoc.exists) {
            console.warn("⚠️ Not found in Admin DB. Checking Customer DB fallback...");
            const { dbCustomer } = require("./firebase");
            settingsDoc = await dbCustomer.collection("admin_settings").doc("payout_alerts").get();
            sourceDb = "customer fallback";
        }

        if (!settingsDoc.exists) {
            console.error("❌ FAILED: 'admin_settings/payout_alerts' does not exist in ANY database.");
            return;
        }

        const fcmToken = settingsDoc.data()?.captain_fcm;

        if (!fcmToken) {
            console.warn(`⚠️ FAILED: 'captain_fcm' field is missing in '${sourceDb}'.`);
            return;
        }

        console.log(`📡 Sending Alert to Captain (Source: ${sourceDb}): ${fcmToken.substring(0, 10)}...`);

        const shopName = data?.shopName || "A shop";
        const amount = data?.amount || "0";

        const message = {
            notification: {
                title: "💸 Withdrawal Request",
                body: `${shopName} has requested a payout of ₹${amount}.`
            },
            data: {
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                category: "payout_request",
                shopId: data?.shopId || "",
                requestId: data?.requestId || ""
            },
            token: fcmToken,
            android: { 
                priority: "high",
                notification: {
                    channelId: "payout_alerts",
                    priority: "high",
                    defaultSound: true,
                    notificationCount: 1
                }
            },
            apns: { 
                payload: { 
                    aps: { 
                        contentAvailable: true, 
                        sound: "default",
                        badge: 1
                    } 
                } 
            }
        };

        const response = await admin.app('admin').messaging().send(message);
        console.log("✅ Captain Payout Alert sent successfully:", response);
    } catch (error) {
        console.error("❌ Captain Alert Error:", error.message);
    }
}

// 🛡️ 2. Watch for New Shop Orders (Shopkeeper Alert)
// Note: We use xerox_orders for global shop orders to simplify cross-shop monitoring
function watchShopOrders() {
    console.log("📡 Listening for Shop Orders (User App Sync)...");
    dbAdmin.collection("xerox_orders")
        .where("status", "in", ["not printed yet", "pending"])
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    
                    const now = Date.now();
                    const orderTime = data.timestamp ? data.timestamp.toMillis() : now;
                    if (now - orderTime > 15000) return; // Skip older orders

                    console.log(`📦 New Shop Order: ${data.shopId} - Ticket ${data.orderCode}`);
                    await sendShopkeeperOrderAlert(data.shopId);
                }
            });
        }, (err) => console.error("❌ Order Listener Error:", err.message));
}

async function sendShopkeeperOrderAlert(shopId) {
    try {
        const shopDoc = await dbAdmin.collection("shops").doc(shopId).get();
        const fcmToken = shopDoc.data()?.fcmToken;

        if (!fcmToken) {
            console.warn(`⚠️ No FCM token found for Shop Captain: ${shopId}`);
            return;
        }

        const message = {
            notification: {
                title: "📦 New Order Received",
                body: "A new printing request has been received."
            },
            data: {
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                category: "new_order",
                shopId: shopId
            },
            token: fcmToken,
            android: { priority: "high" },
            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } }
        };

        const response = await admin.app('admin').messaging().send(message);
        console.log(`✅ Order Alert sent to Shop ${shopId}:`, response);
    } catch (error) {
        console.error("❌ Shop Alert Error:", error.message);
    }
}

// Start Listeners
watchPayoutRequests();
watchShopOrders();
