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

            pages.forEach((page, i) => {
                const { width, height } = page.getSize();
                // Bottom-right corner (Black text, slightly inset for safety)
                page.drawText(`#${xeroxId}`, {
                    x: width - 85, 
                    y: 25,
                    size: 15, // Slightly larger for better visibility
                    font: helveticaFont,
                    color: rgb(0, 0, 0), // Pure Black
                    opacity: 0.85,
                });
            });
            console.log(`   📄 PDF watermarked: ${pages.length} pages`);
            processedBuffer = Buffer.from(await pdfDoc.save());
        }
        else {
            // --- IMAGE PROCESSING (Sharp) ---
            const textSvg = `
                <svg width="400" height="100">
                    <text x="380" y="75" font-family="Arial" font-size="42" font-weight="bold" fill="rgba(0,0,0,0.8)" text-anchor="end">
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
            console.log(`   🖼️ Image watermarked: #${xeroxId}`);
        }

        const isPdfType = contentType.toLowerCase().includes('pdf');

        // 3. Upload Watermarked Version to Cloudinary (Professional Folders)
        const result = await new Promise((resolve, reject) => {
            const uploadOptions = {
                folder: `orders/${xeroxId}`,
                // Using 'image' for PDFs allows Cloudinary to treat it as a document (v/s 'raw')
                resource_type: isPdfType ? 'image' : 'image', 
                format: isPdfType ? 'pdf' : 'jpg',
                public_id: `${xeroxId}_${index}`,
                overwrite: true,
                invalidate: true // Force CDN refresh
            };

            const uploadStream = cloudinary.uploader.upload_stream(
                uploadOptions,
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(processedBuffer);
        });

        console.log(`✅ Watermark Success: ${result.secure_url} (${result.public_id}) | 💾 Size: ${processedBuffer.length} bytes`);
        
        // Ensure the returned URL has the extension for better app-side recognition
        let finalUrl = result.secure_url;
        const ext = isPdfType ? '.pdf' : '.jpg';
        if (!finalUrl.toLowerCase().endsWith(ext)) {
            finalUrl = `${finalUrl}${ext}`;
        }

        return { 
            url: finalUrl, 
            publicId: result.public_id 
        };

    } catch (err) {
        console.error("❌ Watermark processing failed:", err.message);
        console.error(err.stack); // Added more trace
        // Return original in same format for consistency
        return { url: fileUrl, publicId: null };
    }
}

module.exports = { applyWatermark };
