/**
 * MAIN BACKEND – SINGLE SERVER (index.js)
 * PRODUCTION + RASPBERRY PI SAFE
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const { createOrder } = require("./order");
const { db } = require("./firebase");
const upload = require("./upload");
const { downloadFile } = require("./utils");

const app = express();

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 5000;
const PRINTER_KEY = process.env.PRINTER_KEY || "LOCAL_PRINTER";
const UPLOAD_DIR = path.join(__dirname, "uploads");
const AUTO_PRINT_DIR = path.join(__dirname, "auto-print");

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(AUTO_PRINT_DIR)) fs.mkdirSync(AUTO_PRINT_DIR);

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* ================= ASYNC ERROR WRAPPER ================= */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.send("✅ Backend is running");
});

/* =================================================
   CREATE ORDER
================================================= */
app.post(
  "/create-order",
  asyncHandler(async (req, res) => {
    const { printSettings } = req.body;

    if (!printSettings) {
      const err = new Error("printSettings required");
      err.status = 400;
      throw err;
    }

    const order = await createOrder(printSettings);

    res.json({
      success: true,
      orderId: order.orderId,
      pickupCode: order.pickupCode,
    });
  })
);

/* =================================================
   UPLOAD FILES (ORDER VALIDATED)
================================================= */
app.post(
  "/upload-files",
  upload.array("files"),
  asyncHandler(async (req, res) => {
    const { orderId } = req.body;

    if (!orderId) {
      const err = new Error("orderId required");
      err.status = 400;
      throw err;
    }

    if (!req.files || req.files.length === 0) {
      const err = new Error("No files uploaded");
      err.status = 400;
      throw err;
    }

    const ref = db.collection("orders").doc(orderId);
    const snap = await ref.get();

    if (!snap.exists) {
      const err = new Error("Order not found");
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      fileCount: req.files.length,
    });
  })
);

/* =================================================
   FINALIZE ORDER (Cloudinary URLs)
================================================= */
app.post(
  "/finalize-order",
  asyncHandler(async (req, res) => {
    const { orderId, fileUrls } = req.body;

    if (!orderId || !fileUrls) {
      const err = new Error("orderId and fileUrls required");
      err.status = 400;
      throw err;
    }

    await db.collection("orders").doc(orderId).update({
      fileUrls: fileUrls,
      printStatus: "READY_TO_PRINT",
    });

    console.log(`✅ Order ${orderId} finalized with ${fileUrls.length} Cloudinary URLs`);

    res.json({ success: true });
  })
);

/* =================================================
   VERIFY PICKUP CODE (LOCK PRINT)
================================================= */
app.post(
  "/verify-pickup-code",
  asyncHandler(async (req, res) => {
    if (req.headers["x-printer-key"] !== PRINTER_KEY) {
      const err = new Error("Unauthorized printer");
      err.status = 403;
      throw err;
    }

    const { pickupCode } = req.body;
    if (!pickupCode) {
      const err = new Error("pickupCode required");
      err.status = 400;
      throw err;
    }

    const snap = await db
      .collection("orders")
      .where("pickupCode", "==", pickupCode)
      .limit(1)
      .get();

    if (snap.empty) {
      const err = new Error("Invalid or expired code");
      err.status = 404;
      throw err;
    }

    const doc = snap.docs[0];
    const ref = doc.ref;
    const orderData = doc.data();

    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();

      // Allow re-printing for testing
      if (!data.printStatus) { // Only strict check if status is missing/null
        const err = new Error("Order status invalid");
        err.status = 400;
        throw err;
      }

      console.log(`ℹ️ Order ${data.orderId} status: ${data.printStatus} (Allowing reprint)`);

      tx.update(ref, { printStatus: "PRINTING" });
    });

    // 📥 DOWNLOAD FILES FROM CLOUDINARY IF URLs EXIST
    if (orderData.fileUrls && orderData.fileUrls.length > 0) {
      const dir = path.join(__dirname, "uploads", orderData.orderId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      console.log(`🌐 Downloading ${orderData.fileUrls.length} files for order ${orderData.orderId}...`);

      for (let i = 0; i < orderData.fileUrls.length; i++) {
        const url = orderData.fileUrls[i];
        // Generate filename from URL or index
        let fileName = url.split("/").pop().split("?")[0];
        if (!fileName.includes(".")) fileName = `file_${i + 1}.pdf`;

        const dest = path.join(dir, fileName);
        await downloadFile(url, dest);
        console.log(`  ✅ Downloaded: ${fileName}`);
      }
    }

    res.json({
      success: true,
      orderId: orderData.orderId,
      printSettings: orderData.printSettings,
    });
  })
);

/* =================================================
   GET ORDER (For Kiosk Interface)
================================================= */
app.post(
  "/get-order",
  asyncHandler(async (req, res) => {
    const { pickupCode } = req.body;
    if (!pickupCode) {
      return res.status(400).json({ success: false, message: "pickupCode required" });
    }

    const snap = await db
      .collection("orders")
      .where("pickupCode", "==", pickupCode)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = snap.docs[0].data();
    res.json({
      success: true,
      data: {
        orderId: order.orderId,
        pickupCode: order.pickupCode,
        totalPages: order.totalPages || 0,
        totalPrice: order.totalPrice || 0,
        status: order.printStatus || "Ready",
        createdAt: order.createdAt
      }
    });
  })
);

/* =================================================
   TRIGGER PRINT (Download + Copy to Auto-Print)
================================================= */
app.post(
  "/trigger-print",
  asyncHandler(async (req, res) => {
    const { pickupCode } = req.body;
    if (!pickupCode) {
      return res.status(400).json({ success: false, message: "pickupCode required" });
    }

    const snap = await db
      .collection("orders")
      .where("pickupCode", "==", pickupCode)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const orderDoc = snap.docs[0];
    const order = orderDoc.data();
    const orderId = order.orderId;
    const fileUrls = order.fileUrls || [];

    // 1. Create directory in auto-print
    const orderFolder = `${pickupCode}_${orderId}`;
    const autoPrintPath = path.join(AUTO_PRINT_DIR, orderFolder);
    if (!fs.existsSync(autoPrintPath)) {
      fs.mkdirSync(autoPrintPath, { recursive: true });
    }

    let filesPrepared = 0;

    // 2. Download from Cloudinary
    if (fileUrls.length > 0) {
      console.log(`🌐 Downloading ${fileUrls.length} files for print...`);
      for (let i = 0; i < fileUrls.length; i++) {
        const url = fileUrls[i];
        let fileName = url.split("/").pop().split("?")[0];
        if (!fileName.includes(".")) fileName = `file_${i + 1}.pdf`;

        const dest = path.join(autoPrintPath, fileName);
        try {
          await downloadFile(url, dest);
          filesPrepared++;
        } catch (err) {
          console.error(`❌ Download failed for ${url}:`, err.message);
        }
      }
    }

    if (filesPrepared === 0) {
      return res.status(404).json({ success: false, message: "No files found to print" });
    }

    // 3. Create metadata file for Raspberry Pi
    const metadata = {
      pickupCode,
      orderId,
      totalPages: order.totalPages || 0,
      totalPrice: order.totalPrice || 0,
      printSettings: order.printSettings,
      triggeredAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(autoPrintPath, "order_metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    // 4. Update status in Firebase
    await orderDoc.ref.update({ printStatus: "PRINTING" });

    res.json({
      success: true,
      message: "Print job triggered successfully",
      filesCount: filesPrepared
    });
  })
);

/* =================================================
   LIST FILES (NON-BLOCKING)
================================================= */
app.get(
  "/api/get-files/:orderId",
  asyncHandler(async (req, res) => {
    const dir = path.join(__dirname, "uploads", req.params.orderId);

    if (!fs.existsSync(dir)) {
      const err = new Error("Files not found");
      err.status = 404;
      throw err;
    }

    const files = fs.readdirSync(dir);
    res.json({ success: true, files });
  })
);

/* =================================================
   DOWNLOAD FILE (SECURE)
================================================= */
app.get(
  "/api/download/:orderId/:fileName",
  asyncHandler(async (req, res) => {
    const filePath = path.join(
      __dirname,
      "uploads",
      req.params.orderId,
      req.params.fileName
    );

    const safePath = path.normalize(filePath);
    const baseDir = path.join(__dirname, "uploads");

    if (!safePath.startsWith(baseDir)) {
      const err = new Error("Invalid path");
      err.status = 400;
      throw err;
    }

    if (!fs.existsSync(safePath)) {
      const err = new Error("File not found");
      err.status = 404;
      throw err;
    }

    res.sendFile(safePath);
  })
);

/* =================================================
   MARK ORDER AS PRINTED (CLEANUP)
================================================= */
app.post(
  "/mark-printed",
  asyncHandler(async (req, res) => {
    if (req.headers["x-printer-key"] !== PRINTER_KEY) {
      const err = new Error("Unauthorized printer");
      err.status = 403;
      throw err;
    }

    const { orderId } = req.body;
    if (!orderId) {
      const err = new Error("orderId required");
      err.status = 400;
      throw err;
    }

    await db.collection("orders").doc(orderId).update({
      printStatus: "PRINTED",
      printedAt: new Date(),
      pickupCode: null,
    });

    const dir = path.join(__dirname, "uploads", orderId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    res.json({ success: true });
  })
);

/* =================================================
   GLOBAL ERROR HANDLER (API ERROR RESPONSE)
================================================= */
app.use((err, req, res, next) => {
  console.error("🔥 API ERROR:", {
    api: req.originalUrl,
    method: req.method,
    message: err.message,
  });

  res.status(err.status || 500).json({
    success: false,
    api: req.originalUrl,
    error: "API error",
    message: err.message || "Internal Server Error",
  });
});

/* ================= PROCESS SAFETY ================= */
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

/* ================= START SERVER ================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
