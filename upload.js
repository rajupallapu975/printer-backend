const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* =================================================
   CONFIG
================================================= */

const UPLOAD_BASE_DIR = path.join(__dirname, "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (Pi-safe)

/* =================================================
   HELPERS
================================================= */

// Prevent path traversal & strange filenames
function sanitizeFilename(filename) {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
}

/* =================================================
   STORAGE
================================================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const { orderId } = req.body;

      if (!orderId) {
        const err = new Error("orderId required for file upload");
        err.status = 400;
        return cb(err);
      }

      const dir = path.join(UPLOAD_BASE_DIR, orderId);

      // Extra safety check
      if (!dir.startsWith(UPLOAD_BASE_DIR)) {
        const err = new Error("Invalid upload path");
        err.status = 400;
        return cb(err);
      }

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      cb(null, dir);
    } catch (err) {
      err.status = 500;
      cb(err);
    }
  },

  filename: (req, file, cb) => {
    const safeName = sanitizeFilename(file.originalname);
    cb(null, safeName);
  },
});

/* =================================================
   FILE FILTER (OPTIONAL BUT SAFE)
================================================= */

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  const allowed = [".pdf", ".png", ".jpg", ".jpeg"];
  if (!allowed.includes(ext)) {
    const err = new Error("Unsupported file type");
    err.status = 400;
    return cb(err);
  }

  cb(null, true);
}

/* =================================================
   MULTER INSTANCE
================================================= */

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

module.exports = upload;
