require('dotenv').config();
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

/**
 * Adds a 4-digit watermark ID to the bottom-right of a PDF or Image
 */
async function applyWatermark(fileUrl, xeroxId, index = 1) {
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

        console.log(`💧 Watermarking: ${xeroxId} | File #${index} | Account: ${activeConfig.cloud_name}`);
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
                // Bottom-right corner (Black text, slightly inset for safety)
                page.drawText(`${xeroxId}`, {
                    x: width - 70, 
                    y: 30,
                    size: 14, // Clear but not overbearing
                    font: helveticaFont,
                    color: rgb(0, 0, 0), // Pure Black for maximum compatibility
                    opacity: 0.8,
                });
            }
            processedBuffer = Buffer.from(await pdfDoc.save());
        }
        else {
            // --- IMAGE PROCESSING (Sharp) ---
            const textSvg = `
                <svg width="200" height="60">
                    <text x="180" y="45" font-family="Arial" font-size="24" font-weight="bold" fill="rgba(0,0,0,0.8)" text-anchor="end">
                        #${xeroxId}
                    </text>
                </svg>`;

            processedBuffer = await sharp(buffer)
                .jpeg({ quality: 90 }) // Force JPEG for consistency
                .composite([{
                    input: Buffer.from(textSvg),
                    gravity: 'southeast',
                    blend: 'over'
                }])
                .toBuffer();
        }

        const isPdfType = contentType.includes('pdf');

        // 3. Upload Watermarked Version to Cloudinary (Professional Folders)
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: `orders/${xeroxId}`,
                    resource_type: isPdfType ? 'image' : 'image', // Consistent with frontend
                    public_id: `${xeroxId}_${index}`,
                    overwrite: true,
                    invalidate: true // Force CDN refresh
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(processedBuffer);
        });

        console.log(`✅ Watermark Success: ${result.secure_url}`);
        return result.secure_url;

    } catch (err) {
        console.error("❌ Watermark processing failed:", err.message);
        return fileUrl; // Fallback to original if processing fails
    }
}

module.exports = { applyWatermark };
