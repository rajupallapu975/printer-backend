require('dotenv').config();
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

/**
 * Adds a watermark to a PDF or Image using explicit Order ID and Order Code
 */
async function applyWatermark(fileUrl, orderId, orderCode, index = 1, explicitPublicId = null) {
    try {
        const { configB, getSignedUrl } = require('./cloudinary');
        cloudinary.config(configB);

        const isPdfDetected = fileUrl.toLowerCase().includes('.pdf');

        // 📂 FOLDER SETTINGS
        const folderName = 'xerox_processed_orders';
        const fileName = `${orderCode}_${index}`;
        const finalPublicIdWithFolder = `${folderName}/${fileName}`;

        const isRaw = fileUrl.toLowerCase().includes('/raw/upload/');
        let discoveredResourceType = isRaw ? 'raw' : 'image';

        // 🚀 Resolve ORIGINAL Public ID for fetching & deletion
        let fetchPublicId = explicitPublicId;
        if (!fetchPublicId) {
            const uploadSplit = fileUrl.split('/upload/');
            if (uploadSplit.length > 1) {
                const pathSegments = uploadSplit[1].split('?')[0].split('/');
                const cleanSegments = pathSegments.filter(p => !p.startsWith('s--') && !/^v\d+$/.test(p));
                fetchPublicId = cleanSegments.join('/');
            }
        }
        if (!isRaw && fetchPublicId && fetchPublicId.includes('.')) {
            fetchPublicId = fetchPublicId.split('.').slice(0, -1).join('.');
        }

        console.log(`💧 Watermarking [Xerox Shop]: Order=${orderId}, Target=${finalPublicIdWithFolder}`);
        
        let response;
        try {
            const authenticatedUrl = cloudinary.utils.private_download_url(fetchPublicId, isPdfDetected ? 'pdf' : null, {
                resource_type: discoveredResourceType,
                type: 'upload'
            });
            response = await axios.get(authenticatedUrl, { responseType: 'arraybuffer' });
        } catch (e) {
            response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        }

        const buffer = Buffer.from(response.data);
        const contentType = response.headers['content-type'] || '';
        const isPdfType = contentType.includes('pdf') || isPdfDetected;

        let processedBuffer;

        if (isPdfType) {
            const pdfDoc = await PDFDocument.load(buffer);
            const newPdfDoc = await PDFDocument.create();
            const helveticaFont = await newPdfDoc.embedFont(StandardFonts.HelveticaBold);
            const LETTER_WIDTH = 612;
            const LETTER_HEIGHT = 792;
            const copiedPages = await newPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
            const embeddedPages = await newPdfDoc.embedPages(copiedPages);

            for (let i = 0; i < embeddedPages.length; i++) {
                const embeddedPage = embeddedPages[i];
                const { width, height } = embeddedPage;
                const newPage = newPdfDoc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
                const scaleX = (LETTER_WIDTH - 20) / width;
                const scaleY = (LETTER_HEIGHT - 40) / height;
                const finalScale = Math.min(scaleX, scaleY, 1.0); 
                const finalWidth = width * finalScale;
                const finalHeight = height * finalScale;
                const x = (LETTER_WIDTH - finalWidth) / 2;
                const y = (LETTER_HEIGHT - finalHeight) / 2; 

                newPage.drawPage(embeddedPage, { x, y, width: finalWidth, height: finalHeight });
                newPage.drawText(`#${orderCode}`, {
                    x: LETTER_WIDTH - 45, y: 10, size: 9, font: helveticaFont,
                    color: rgb(0, 0, 0), opacity: 0.8,
                });
            }
            processedBuffer = Buffer.from(await newPdfDoc.save());
        }
        else {
            const textSvg = `<svg width="400" height="100"><text x="390" y="90" font-family="Arial" font-size="24" font-weight="bold" fill="rgba(0,0,0,0.8)" text-anchor="end">#${orderCode}</text></svg>`;
            processedBuffer = await sharp(buffer)
                .resize(1800, 2400, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
                .composite([{ input: Buffer.from(textSvg), gravity: 'southeast', blend: 'over' }])
                .toBuffer();
        }

        // 📤 UPLOAD
        const result = await new Promise((resolve, reject) => {
            const uploadOptions = {
                folder: folderName,
                public_id: fileName, // Cloudinary combines folder + public_id automatically
                resource_type: discoveredResourceType, 
                access_mode: 'public', 
                overwrite: true,
                invalidate: true 
            };
            if (isPdfType) uploadOptions.format = 'pdf';
            const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
                if (error) reject(error);
                else resolve(result);
            });
            uploadStream.end(processedBuffer);
        });

        // 🔓 FORCE PUBLIC
        try {
            await cloudinary.uploader.explicit(result.public_id, {
                type: 'upload',
                resource_type: discoveredResourceType,
                access_mode: 'public',
                invalidate: true
            });
        } catch (forceErr) {
            console.warn(`⚠️ Force public failed: ${forceErr.message}`);
        }

        // 🗑️ CLEANUP: Delete ORIGINAL
        if (fetchPublicId && fetchPublicId !== result.public_id) {
            try {
                console.log(`🗑️ Deleting Original Asset: ${fetchPublicId} (Type: ${discoveredResourceType})`);
                await cloudinary.uploader.destroy(fetchPublicId, { 
                    resource_type: discoveredResourceType,
                    invalidate: true 
                });
            } catch (delErr) {
                console.log(`⚠️ Cleanup skipped: ${delErr.message}`);
            }
        }

        let finalUrl = result.secure_url;
        
        // 🚀 LIVE PING: Check the URL using Private API Download (since Strict Delivery blocks CDN even when signed)
        const testUrlOrigin = cloudinary.utils.private_download_url(result.public_id, isPdfType ? 'pdf' : null, {
            resource_type: discoveredResourceType,
            type: 'upload'
        });
        console.log(`📡 Verifying Accessibility (Private API): ${testUrlOrigin.split('?')[0]}...`);
        try {
            await axios.get(testUrlOrigin, { responseType: 'stream', timeout: 8000 });
            console.log(`✅ URL Verified: 200 OK`);
        } catch (pingErr) {
            const status = pingErr.response?.status || 'Timeout';
            console.error(`❌ URL VERIFICATION FAILED (Status: ${status}).`);
            throw new Error(`Verification Failure: Document was not accessible (Status: ${status})`);
        }

        console.log(`✅ Watermark Saved. Replacing CDN link with API Access link for strict delivery compatibility.`);
        
        // Feed the Private Access URL directly back to the database instead of the blocked CDN URL
        let exportUrl = isPdfType ? testUrlOrigin : finalUrl;
            
        return { url: exportUrl, publicId: result.public_id };

    } catch (err) {
        console.error("❌ Watermarking Failure:", err.message);
        throw err; 
    }
}

module.exports = { applyWatermark };
