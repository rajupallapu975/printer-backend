const cloudinary = require("cloudinary").v2;

const configA = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dpmpyvmbg',
    api_key: process.env.CLOUDINARY_API_KEY || '194276163111927',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'sPSxs3tCdPiSLL_osGPLRoWEvhI'
};

const configB = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME_B || 'doymq9qhk',
    api_key: process.env.CLOUDINARY_API_KEY_B || '662529823584638',
    api_secret: process.env.CLOUDINARY_API_SECRET_B || 'FqATV3gRRcCX9nQsuM-sB66BPYU'
};

const configC = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME_C || 'irtchxuf',
    api_key: process.env.CLOUDINARY_API_KEY_C || '258315148822261',
    api_secret: process.env.CLOUDINARY_API_SECRET_C || 'MixGRPAiS5TTNiHL9PtZkavZAdk'
};

const configD = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME_D || 'xinscuby',
    api_key: process.env.CLOUDINARY_API_KEY_D || '721284446485429',
    api_secret: process.env.CLOUDINARY_API_SECRET_D || 'NlAe-fbZfCmCb16gfUjzMJJUJWE'
};

cloudinary.config(configB);

function getConfigForUrl(url) {
    if (!url || typeof url !== 'string') return configB;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('doymq9qhk')) return configB;
    if (lowerUrl.includes('irtchxuf')) return configC;
    if (lowerUrl.includes('xinscuby')) return configD;
    if (lowerUrl.includes('dpmpyvmbg')) return configA;
    return configB; // fallback to B
}

function getSignedUrl(url, config, downloadName = null, explicitPublicId = null, explicitVersion = null) {
    if (!url || (!url.includes('api.cloudinary.com') && !url.includes('res.cloudinary.com'))) return url;
    if (url.includes('api.cloudinary.com')) return url; // Do not attempt to sign API links with CDN signatures
    try {
        const resolvedConfig = getConfigForUrl(url);
        const cloudinary = require("cloudinary").v2;
        cloudinary.config({
            cloud_name: resolvedConfig.cloud_name,
            api_key: resolvedConfig.api_key,
            api_secret: resolvedConfig.api_secret
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

        if (format === 'pdf') {
            return cloudinary.utils.private_download_url(publicId, 'pdf', {
                resource_type: isRaw ? 'raw' : 'image',
                type: 'upload'
            });
        }

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

module.exports = { cloudinary, configB, configA, configC, configD, getConfigForUrl, getSignedUrl };
