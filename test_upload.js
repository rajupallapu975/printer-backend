require('dotenv').config();
const { cloudinary, configB } = require("./cloudinary");
const https = require("https");

function testFetch(url) {
    return new Promise((resolve) => {
        const req = https.get(url, { timeout: 5000 }, (res) => {
            resolve({ status: res.statusCode, contentType: res.headers["content-type"] });
        });
        req.on("error", (err) => {
            resolve({ status: null, error: err.message });
        });
        req.on("timeout", () => {
            req.destroy();
            resolve({ status: null, error: "timeout" });
        });
    });
}

async function run() {
    try {
        const publicId = "xerox_processed_orders/542574_cover";
        const version = "1783340693";
        
        const testOptionsList = [
            { name: "Raw URL (unsigned)", options: null, unsigned: true },
            { name: "Default SDK URL generation", options: { secure: true } },
            { name: "Sign URL only", options: { sign_url: true, secure: true } },
            { name: "Sign URL + format", options: { sign_url: true, secure: true, format: "pdf" } },
            { name: "Sign URL + version + format", options: { sign_url: true, secure: true, version, format: "pdf" } },
            { name: "Sign URL + resource_type + type", options: { sign_url: true, secure: true, resource_type: "image", type: "upload" } },
            { name: "Sign URL + resource_type + type + format", options: { sign_url: true, secure: true, resource_type: "image", type: "upload", format: "pdf" } },
            { name: "Sign URL + resource_type + type + version + format", options: { sign_url: true, secure: true, resource_type: "image", type: "upload", version, format: "pdf" } },
            { name: "Sign URL (type: authenticated)", options: { sign_url: true, secure: true, resource_type: "image", type: "authenticated", version, format: "pdf" } },
            { name: "Sign URL (type: private)", options: { sign_url: true, secure: true, resource_type: "image", type: "private", version, format: "pdf" } },
            { name: "Sign URL (type: authenticated, no version)", options: { sign_url: true, secure: true, resource_type: "image", type: "authenticated", format: "pdf" } },
            { name: "Sign URL (type: private, no version)", options: { sign_url: true, secure: true, resource_type: "image", type: "private", format: "pdf" } },
            { name: "private_download_url helper", useHelper: true }
        ];

        cloudinary.config(configB);

        for (const test of testOptionsList) {
            let url;
            if (test.unsigned) {
                url = `https://res.cloudinary.com/doymq9qhk/image/upload/v${version}/${publicId}.pdf`;
            } else if (test.useHelper) {
                url = cloudinary.utils.private_download_url(publicId, "pdf", {
                    resource_type: "image",
                    type: "upload"
                });
            } else {
                url = cloudinary.url(publicId, test.options);
            }
            
            const res = await testFetch(url);
            console.log(`\nTest: ${test.name}`);
            console.log(`URL: ${url}`);
            if (res.status === 200) {
                console.log(`👉 SUCCESS! Status: 200, Content-Type: ${res.contentType}`);
            } else {
                console.log(`❌ FAILED! Status: ${res.status || res.error}`);
            }
        }
    } catch (e) {
        console.error("❌ Outer Error:", e.message);
    }
}

run();
