const { generateCoverPage } = require("./cover_page_service");
const fs = require("fs");

async function run() {
    try {
        const buffer = await generateCoverPage({
            orderCode: "542574",
            customerName: "Test User",
            files: [
                { fileName: "96222.jpg", copies: 1, pageCount: 10, price: 20.0 }
            ],
            coverPageCharge: 2.0
        });
        fs.writeFileSync("test_cover.pdf", buffer);
        console.log("✅ test_cover.pdf written successfully!");
    } catch (e) {
        console.error("❌ Error generating cover page:", e);
    }
}

run();
