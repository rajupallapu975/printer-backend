const fs = require("fs");
const path = require("path");
const https = require("https");

/**
 * Downloads a file from a URL to a local destination
 * @param {string} url - The Cloudinary secure URL
 * @param {string} dest - Local destination path
 */
async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download file: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve();
            });
        }).on("error", (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

module.exports = {
    downloadFile,
};
