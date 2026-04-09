const cloudinary = require("cloudinary").v2;

// Primary Cloudinary (Autonomous)
const configA = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
};

// Secondary Cloudinary (Xerox Shop)
const configB = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME_B,
    api_key: process.env.CLOUDINARY_API_KEY_B,
    api_secret: process.env.CLOUDINARY_API_SECRET_B
};

function getSignedUrl(url, config, downloadName = null, explicitPublicId = null, explicitVersion = null) {
    if (!url || (!url.includes('api.cloudinary.com') && !url.includes('res.cloudinary.com'))) return url;
    if (url.includes('api.cloudinary.com')) return url; // Do not attempt to sign API links with CDN signatures
    try {
        const cloudinary = require("cloudinary").v2;
        cloudinary.config({
            cloud_name: config.cloud_name,
            api_key: config.api_key,
            api_secret: config.api_secret
        });

        // 🚀 RESOLVE: Get the clean Public ID
        let publicId = explicitPublicId;
        let isRaw = url.toLowerCase().includes('/raw/upload/');
        let format = null;
        let version = explicitVersion;
        
        if (!publicId) {
            const uploadSplit = url.split('/upload/');
            if (uploadSplit.length >= 2) {
                let segments = uploadSplit[1].split('/');
                while (segments.length > 0 && (
                    segments[0].startsWith('s--') || 
                    /^v\d+$/.test(segments[0]) || 
                    segments[0].includes(',') ||
                    segments[0].startsWith('fl_')
                )) {
                    // Try to catch version if we don't have one
                    if (/^v\d+$/.test(segments[0])) version = segments[0].substring(1);
                    segments.shift();
                }
                const fullPath = segments.join('/').split('?')[0];
                if (fullPath.includes('.')) {
                    const parts = fullPath.split('.');
                    format = parts.pop();
                    publicId = parts.join('.');
                } else {
                    publicId = fullPath;
                }
            }
        } else {
            // Find version from URL if not explicit
            if (!version && url.includes('/v')) {
                const parts = url.split('/v');
                if (parts.length > 1) version = parts[1].split('/')[0];
            }
            if (url.includes('.')) {
                format = url.split('.').pop().split('?')[0];
                if (publicId.endsWith('.' + format)) {
                    publicId = publicId.substring(0, publicId.lastIndexOf('.'));
                }
            }
        }

        if (!publicId) return url;

        const options = {
            sign_url: true,
            secure: true,
            resource_type: isRaw ? 'raw' : 'image',
            type: 'upload',
            analytics: false
        };

        if (format) options.format = format;
        if (version) options.version = version; // 🛡️ CRITICAL: Match the exact version for the signature

        if (downloadName) {
            const safeName = downloadName.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9_\-]/gi, '_');
            options.transformation = [
                { flags: `attachment:${safeName}` }
            ];
        }

        return cloudinary.url(publicId, options);

    } catch (e) {
        console.error("❌ getSignedUrl Fail:", e.message);
        return url;
    }
}

module.exports = { cloudinary, configA, configB, getSignedUrl };
