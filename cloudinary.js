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

module.exports = { cloudinary, configA, configB };
