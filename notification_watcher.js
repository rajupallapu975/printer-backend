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
            },
            webpush: {
                headers: { Urgency: "high" }
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
            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } },
            webpush: {
                headers: { Urgency: "high" },
                notification: { icon: "/icons/Icon-192.png", badge: "/favicon.png" }
            }
        };

        const response = await admin.app('admin').messaging().send(message);
        console.log(`✅ Order Alert sent to Shop ${shopId}:`, response);
    } catch (error) {
        console.error("❌ Shop Alert Error:", error.message);
    }
}

// 🛡️ 3. Watch for Order Completion (Customer Alert - User App)
function watchOrderCompletion() {
    console.log("📡 Listening for Order Completion (User App Alerts) across all customer databases...");
    
    const { dbCustomer, dbCustomer2, dbCustomer3 } = require("./firebase");
    
    watchOrderCompletionForDb(dbCustomer, "Primary");
    if (dbCustomer2) watchOrderCompletionForDb(dbCustomer2, "Backup 1");
    if (dbCustomer3) watchOrderCompletionForDb(dbCustomer3, "Backup 2");
}

function watchOrderCompletionForDb(dbInstance, dbName) {
    dbInstance.collection("xerox_orders")
        .where("orderStatus", "==", "printing completed")
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added" || (change.type === "modified" && change.doc.data().orderStatus === "printing completed")) {
                    const data = change.doc.data();
                    
                    // Prevent duplicate alerts (Use a 15-second freshness window)
                    const now = Date.now();
                    const updateTime = data.printedAt ? data.printedAt.toMillis() : now;
                    if (now - updateTime > 15000) return;

                    // 🛡️ 1. Transaction Deduplication Lock: atomically check and set notificationSent
                    const orderRef = dbInstance.collection("xerox_orders").doc(change.doc.id);
                    let shouldSend = false;

                    try {
                        await dbInstance.runTransaction(async (transaction) => {
                            const sfDoc = await transaction.get(orderRef);
                            if (!sfDoc.exists) return;

                            const oData = sfDoc.data();
                            if (oData.notificationSent === true) {
                                return; // Already sent by another instance
                            }

                            transaction.update(orderRef, { notificationSent: true });
                            shouldSend = true;
                        });
                    } catch (err) {
                        console.error(`⚠️ Transaction check failed for ${change.doc.id} on ${dbName}:`, err.message);
                        return;
                    }

                    if (!shouldSend) {
                        console.log(`⏭️ Duplicate alert skipped: ${change.doc.id} already processed on ${dbName}.`);
                        return;
                    }

                    // Attach orderId securely
                    data.orderId = change.doc.id;

                    console.log(`🖨️ Order Printed on ${dbName}: ${data.orderCode || data.pickupCode} (User: ${data.userId})`);
                    await sendUserCompletionAlert(data);
                }
            });
        }, (err) => console.error(`❌ [${dbName}] xerox_orders Listener Error:`, err.message));
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

        // e.g. customId = "order_3" → display as "Order #3"
        const rawCustomId = data.customId || '';
        const orderNumber = rawCustomId.replace(/^order_/i, '').trim();
        const orderLabel = orderNumber ? `Order #${orderNumber}` : `Order #${data.orderCode || data.pickupCode || orderId}`;
        const message = {
            notification: {
                title: `${orderLabel} — Print Successful! 🎉`,
                body: `Your prints for ${orderLabel} are ready! Please visit the shop to collect them.`
            },
            data: {
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                category: "order_completed",
                orderId: orderId,
                orderLabel: orderLabel
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
            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } },
            webpush: {
                headers: { Urgency: "high" },
                notification: { icon: "/icons/Icon-192.png", badge: "/favicon.png" }
            }
        };

        await admin.app('customer').messaging().send(message);
        console.log(`✅ Professional Alert sent to User ${data.userId} for Order ${orderId}`);
    } catch (error) {
        console.error("❌ User Alert Error:", error.message);
    }
}


// Start All Global Listeners
// watchPayoutRequests(); // Disconnected because Zikrint Payments app has been removed
watchShopOrders();
watchOrderCompletion();

// ============================================================================
// ⏰ AUTOMATED PRE-OPENING REMINDER TASK (10-minute Alert)
// ============================================================================

function parseOpeningTime(timeStr) {
    try {
        let hours, minutes;
        if (timeStr.includes('AM') || timeStr.includes('PM')) {
            const parts = timeStr.trim().split(/\s+/);
            const hm = parts[0].split(':');
            hours = parseInt(hm[0], 10);
            minutes = parseInt(hm[1], 10);
            const ampm = parts[1].toUpperCase();
            if (ampm === 'PM' && hours < 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
        } else {
            const hm = timeStr.trim().split(':');
            hours = parseInt(hm[0], 10);
            minutes = parseInt(hm[1], 10);
        }
        return { hours, minutes };
    } catch (e) {
        return null;
    }
}

function getISTDate() {
    const utc = new Date();
    // IST is UTC + 5.5 hours
    const ist = new Date(utc.getTime() + (5.5 * 60 * 60 * 1000));
    return ist;
}

async function checkShopOpeningNotifications() {
    try {
        const ist = getISTDate();
        const currentDateStr = `${ist.getFullYear()}-${ist.getMonth() + 1}-${ist.getDate()}`;
        const currentMinutes = ist.getHours() * 60 + ist.getMinutes();

        console.log(`⏰ [Scheduler] Running opening reminder check (IST Time: ${ist.getHours()}:${ist.getMinutes()})...`);

        const snapshot = await dbAdmin.collection("shops").get();
        if (snapshot.empty) return;

        for (const doc of snapshot.docs) {
            const shopData = doc.data();
            const openingTimeStr = shopData.openingTime;
            const fcmToken = shopData.fcmToken;

            if (!openingTimeStr || !fcmToken) continue;

            const parsed = parseOpeningTime(openingTimeStr);
            if (!parsed) continue;

            const targetMinutes = parsed.hours * 60 + parsed.minutes;
            
            // Check if current time is 10 minutes before opening time.
            // Since this runs once a minute, we check if targetMinutes - currentMinutes is exactly 10.
            const diff = targetMinutes - currentMinutes;

            if (diff === 10) {
                if (shopData.lastOpeningNotifiedDate === currentDateStr) {
                    continue; // Already notified today
                }

                console.log(`🔔 Sending 10-min pre-open alert to Shop: ${shopData.shopName || doc.id}`);
                
                // Update Firestore first to prevent duplicate notifications
                await doc.ref.update({
                    lastOpeningNotifiedDate: currentDateStr
                });

                // Send push notification
                await sendShopkeeperAlert(
                    fcmToken,
                    "🖨️ Get Ready! Shop opening soon",
                    `Your shop opens in 10 minutes (${openingTimeStr}). Please open the app and go online to get orders.`
                );
            }
        }
    } catch (error) {
        console.error("❌ Error in checkShopOpeningNotifications:", error.message);
    }
}

async function sendShopkeeperAlert(fcmToken, title, body) {
    try {
        const message = {
            notification: {
                title: title,
                body: body
            },
            data: {
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                category: "shop_reminder"
            },
            token: fcmToken,
            android: {
                priority: "high",
                notification: {
                    channelId: "admin_orders",
                    priority: "high"
                }
            },
            apns: { payload: { aps: { contentAvailable: true, sound: "default" } } },
            webpush: {
                headers: { Urgency: "high" },
                notification: { icon: "/icons/Icon-192.png", badge: "/favicon.png" }
            }
        };

        const response = await admin.app('admin').messaging().send(message);
        console.log(`✅ Alert sent to Shop Captain:`, response);
    } catch (error) {
        console.error("❌ Shopkeeper Alert Error:", error.message);
    }
}

// Start Scheduler (runs every 1 minute)
setInterval(checkShopOpeningNotifications, 60 * 1000);
// Trigger once on startup after a 5-second delay
setTimeout(checkShopOpeningNotifications, 5000);

