const cloudinary = require("cloudinary").v2;

// Credentials come from the environment only. Never hardcode a fallback secret here —
// a committed default cannot be rotated and silently outlives every key rotation.
function requireEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

// Suffix '' is the legacy (account A) variable naming: CLOUDINARY_CLOUD_NAME etc.
function loadConfig(suffix, { required = false } = {}) {
    const names = {
        cloud_name: `CLOUDINARY_CLOUD_NAME${suffix}`,
        api_key: `CLOUDINARY_API_KEY${suffix}`,
        api_secret: `CLOUDINARY_API_SECRET${suffix}`,
    };
    if (required) {
        return {
            cloud_name: requireEnv(names.cloud_name),
            api_key: requireEnv(names.api_key),
            api_secret: requireEnv(names.api_secret),
        };
    }
    const values = {
        cloud_name: process.env[names.cloud_name],
        api_key: process.env[names.api_key],
        api_secret: process.env[names.api_secret],
    };
    if (!values.cloud_name || !values.api_key || !values.api_secret) {
        console.warn(`⚠️ Cloudinary account '${suffix || 'A'}' not configured; URLs on that account will fall back to account B.`);
        return null;
    }
    return values;
}

// B is the active account (see cloudinary.config below), so it is the only hard requirement.
// A, C and D are legacy accounts that only need to resolve for pre-existing asset URLs.
const configB = loadConfig('_B', { required: true });
const configA = loadConfig('');
const configC = loadConfig('_C');
const configD = loadConfig('_D');

cloudinary.config(configB);

// Maps a stored asset URL back to the account that hosts it. Any account that is not
// configured resolves to B rather than undefined, so a missing legacy credential
// degrades to a failed signature instead of a TypeError.
function getConfigForUrl(url) {
    if (!url || typeof url !== 'string') return configB;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes(configB.cloud_name)) return configB;
    if (configC && lowerUrl.includes(configC.cloud_name)) return configC;
    if (configD && lowerUrl.includes(configD.cloud_name)) return configD;
    if (configA && lowerUrl.includes(configA.cloud_name)) return configA;
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
