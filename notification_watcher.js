const { dbAdmin, dbCustomer, admin } = require("./firebase");

/**
 * 🛰️ GLOBAL CROSS-PROJECT NOTIFICATION WATCHER
 * Listen for events across ALL apps and send push alerts to CLOSED/KILLED devices.
 */

console.log("🚀 Starting Global Notification Watcher Service...");

// 🛡️ Deduplication Cache
const payoutNotifiedRecently = new Set(); 

// 🛡️ 1. Watch for New Payout Requests (Captain Alert - Payments App)
function watchPayoutRequests() {
    console.log("📡 Listening for Withdrawal Requests...");
    dbAdmin.collection("withdrawal_requests")
        .where("status", "==", "pending")
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                // 🛡️ Only fire on NEW requests. "modified" is ignored to prevent double-firing 
                // when we update the "notified" flag in this same listener.
                if (change.type === "added") {
                    const requestId = change.doc.id;

                    // 🛡️ MEMORY CACHE (Quick exit for this process instance)
                    if (payoutNotifiedRecently.has(requestId)) return;

                    try {
                        const docRef = dbAdmin.collection("withdrawal_requests").doc(requestId);
                        
                        // 🛡️ DATABASE TRANSACTION LOCK (True atomicity across multiple backend instances)
                        const lockResult = await dbAdmin.runTransaction(async (transaction) => {
                            const doc = await transaction.get(docRef);
                            const docData = doc.data();
                            
                            // Check if document was already notified or status changed
                            if (!docData || docData.notified === true || docData.status !== "pending") {
                                return { canSend: false };
                            }
                            
                            // Check freshness (Last 2 minutes) to avoid alerting on old data on restart
                            const now = Date.now();
                            const reqTime = docData.requestedAt ? docData.requestedAt.toMillis() : now;
                            if (now - reqTime > 120000) return { canSend: false };

                            // Mark as notified IMMEDIATELY inside the atomic block
                            transaction.update(docRef, { 
                                notified: true, 
                                notifiedAt: admin.firestore.FieldValue.serverTimestamp() 
                            });
                            
                            return { canSend: true, docData: docData };
                        });

                        if (lockResult.canSend) {
                            // 🛡️ Update local cache immediately
                            payoutNotifiedRecently.add(requestId);
                            
                            console.log(`💸 Atomic Lock Secured. Sending Payout Alert: ${lockResult.docData.shopName}`);
                            
                            // 🚀 Fire and forget (don't await) to keep the listener responsive, 
                            // or await if you want strict ordering. Awaiting is safer here 
                            // as it's already guarded by the atomic lock.
                            await sendCaptainPayoutAlert(lockResult.docData, requestId);
                        }
                    } catch (err) {
                        console.error(`❌ Atomic Payout Alert Error [${requestId}]:`, err.message);
                    }
                }
            });
        }, (err) => console.error("❌ Payout Listener Error:", err.message));
}

async function sendCaptainPayoutAlert(data, requestId) {
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
            data: {
                title: "💸 Withdrawal Request",
                body: `${shopName} has requested a payout of ₹${amount}.`,
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                category: "payout_request",
                shopId: data?.shopId || "",
                requestId: data?.requestId || ""
            },
            token: fcmToken,
            android: { 
                priority: "high",
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
            android: {
                priority: "high",
                notification: {
                    channelId: "admin_orders",
                    priority: "high"
                }
            },
            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } }
        };

        const response = await admin.app('admin').messaging().send(message);
        console.log(`✅ Order Alert sent to Shop ${shopId}:`, response);
    } catch (error) {
        console.error("❌ Shop Alert Error:", error.message);
    }
}

// 🛡️ 3. Watch for Order Completion (Customer Alert - User App)
function watchOrderCompletion() {
    console.log("📡 Listening for Order Completion (User App Alerts)...");
    const collections = ["orders", "xerox_orders"];
    
    collections.forEach(col => {
        dbCustomer.collection(col)
            .where("orderStatus", "==", "printing completed")
            .onSnapshot(async (snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === "added" || (change.type === "modified" && change.doc.data().orderStatus === "printing completed")) {
                        const data = change.doc.data();
                        
                        // Prevent duplicate alerts (Use a 15-second freshness window)
                        const now = Date.now();
                        const updateTime = data.printedAt ? data.printedAt.toMillis() : now;
                        if (now - updateTime > 15000) return;

                        console.log(`🖨️ Order Printed: ${data.orderCode || data.pickupCode} (User: ${data.userId})`);
                        await sendUserCompletionAlert(data);
                    }
                });
            }, (err) => console.error(`❌ ${col} Listener Error:`, err.message));
    });
}

const notifiedRecently = new Set(); // 🛡️ Memory Cache to prevent double-firing

async function sendUserCompletionAlert(data) {
    try {
        const orderId = data.orderId || data.orderCode;
        if (!data.userId || !orderId) return;
        
        // 🛡️ 1. DEDUPLICATION: Prevent double notifications within 60 seconds
        if (notifiedRecently.has(orderId)) {
            console.log(`⏭️ Skipping duplicate alert for Order ${orderId}`);
            return;
        }
        notifiedRecently.add(orderId);
        setTimeout(() => notifiedRecently.delete(orderId), 60000); // Clear after 1 min

        let userDoc = await dbCustomer.collection("users").doc(data.userId).get();
        
        // 🛡️ Fallback: If not found by ID (UID), search by email field (for legacy orders)
        if (!userDoc.exists && data.userId.includes('@')) {
            const snapshot = await dbCustomer.collection("users").where("email", "==", data.userId).limit(1).get();
            if (!snapshot.empty) userDoc = snapshot.docs[0];
        }

        if (!userDoc.exists) {
            console.warn(`⚠️ No user record found for ${data.userId}`);
            return;
        }

        const fcmToken = userDoc.data()?.fcmToken;
        if (!fcmToken) return;

        // 🛡️ 2. PRIVACY-FIRST BODY (No Greetings, No Code Revealed)
        const message = {
            notification: {
                title: "Print Successful! 🎉",
                body: "Your prints are ready! Please visit the shop to collect them. Visit again!"
            },
            data: {
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                category: "order_completed",
                orderId: orderId
            },
            token: fcmToken,
            android: { 
                priority: "high",
                notification: {
                    channelId: "order_notifications",
                    priority: "high",
                    defaultSound: true
                }
            },
            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } }
        };

        await admin.app('customer').messaging().send(message);
        console.log(`✅ Professional Alert sent to User ${data.userId} for Order ${orderId}`);
    } catch (error) {
        console.error("❌ User Alert Error:", error.message);
    }
}


// Start All Global Listeners
watchPayoutRequests();
watchShopOrders();
watchOrderCompletion();
