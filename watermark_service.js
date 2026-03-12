require('dotenv').config();
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

/**
 * Adds a 4-digit watermark ID to the bottom-right of a PDF or Image
 */
async function applyWatermark(fileUrl, xeroxId) {
    try {
        // Ensure environment is loaded
        if (!process.env.PORT) require('dotenv').config();
        const { configA, configB } = require('./cloudinary');

        // Select the correct Cloudinary account (Xerox is B)
        const activeConfig = process.env.CLOUDINARY_API_KEY_B ? configB : configA;

        if (!activeConfig.api_key) {
            console.error("⚠️ WATERMARK ERROR: Cloudinary API Key missing in .env!");
            return fileUrl;
        }

        // Apply config right before use
        cloudinary.config(activeConfig);

        console.log(`💧 Watermarking: ${xeroxId} | Account: ${activeConfig.cloud_name}`);
        console.log(`🔗 Target: ${fileUrl}`);

        // 1. Download the file
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const contentType = response.headers['content-type'] || '';

        let processedBuffer;

        if (contentType.includes('pdf')) {
            // --- PDF PROCESSING ---
            const pdfDoc = await PDFDocument.load(buffer);
            const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            const pages = pdfDoc.getPages();

            for (const page of pages) {
                const { width, height } = page.getSize();
                // Bottom-right corner, very small (8pt)
                page.drawText(xeroxId.toString(), {
                    x: width - 35, // Moved closer to edge
                    y: 10,        // Lowered
                    size: 8,      // Smaller font
                    font: helveticaFont,
                    color: rgb(0.5, 0.5, 0.5), // Grey to be subtle
                    opacity: 0.7,
                });
            }
            processedBuffer = Buffer.from(await pdfDoc.save());
        }
        else {
            // --- IMAGE PROCESSING (Sharp) ---
            // Create a very small SVG overlay
            const textSvg = `
                <svg width="100" height="40">
                    <text x="50" y="30" font-family="Arial" font-size="14" font-weight="bold" fill="rgba(128,128,128,0.6)" text-anchor="middle">
                        ID: ${xeroxId}
                    </text>
                </svg>`;

            processedBuffer = await sharp(buffer)
                .composite([{
                    input: Buffer.from(textSvg),
                    gravity: 'southeast',
                    blend: 'over'
                }])
                .toBuffer();
        }

        // 3. Upload Watermarked Version to Cloudinary
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'watermarked_orders',
                    resource_type: 'auto',
                    public_id: `wm_${Date.now()}`
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(processedBuffer);
        });

        return result.secure_url;

    } catch (err) {
        console.error("❌ Watermark processing failed:", err.message);
        return fileUrl; // Fallback to original if processing fails
    }
}

module.exports = { applyWatermark };
