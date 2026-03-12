const Razorpay = require("razorpay");
require('dotenv').config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

async function testRazorpay() {
    console.log("🚀 Starting Razorpay Connection Test...");
    console.log("Using Key ID:", process.env.RAZORPAY_KEY_ID);

    try {
        // 1. Test Order Creation
        console.log("\n1. Testing Order Creation...");
        const order = await razorpay.orders.create({
            amount: 100, // ₹1
            currency: "INR",
            receipt: "test_receipt_" + Date.now()
        });
        console.log("✅ Order Created successfully:", order.id);

        // 2. Test QR Code API (Optional)
        console.log("\n2. Testing QR Code API (Merchant QR)...");
        try {
            const qr = await razorpay.qrCode.create({
                type: "upi_qr",
                name: "Test Store",
                usage: "single_use",
                fixed_amount: true,
                payment_amount: 100,
                description: "Test QR"
            });
            console.log("✅ QR Code API is ENABLED for this account.");
            console.log("QR Image URL:", qr.image_url);
        } catch (qrErr) {
            console.log("❌ QR Code API is NOT ENABLED for this account or failed.");
            console.log("Reason:", qrErr.error ? qrErr.error.description : qrErr.message);
        }

        // 3. Test Payment Link API
        console.log("\n3. Testing Payment Link API (Fallback)...");
        try {
            const link = await razorpay.paymentLink.create({
                amount: 100,
                currency: "INR",
                description: "Test Payment Link",
                customer: {
                    name: "Test User",
                    email: "test@example.com",
                    contact: "919999999999"
                }
            });
            console.log("✅ Payment Link API is working.");
            console.log("Short URL:", link.short_url);
        } catch (linkErr) {
            console.log("❌ Payment Link API failed.");
            console.log("Reason:", linkErr.error ? linkErr.error.description : linkErr.message);
        }

        console.log("\n✨ Test Complete. If Order Creation worked, your basic Razorpay setup is correct.");

    } catch (err) {
        console.error("💥 CRITICAL ERROR:", err.error ? err.error.description : err.message);
    }
}

testRazorpay();
