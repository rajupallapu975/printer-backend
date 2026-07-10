const axios = require("axios");

async function main() {
  const url = "https://zikrint.duckdns.org/api/shop/pricing";
  const payload = {
    shopId: "R4BCqS1FUnY48opDD1enBQfWqhC2",
    serviceId: "nyAKL7mMnGGkTx2Ow9HA",
    isEnabled: true,
    pricingData: {
      a4: {
        bw: {
          singleSidePrice: 3.5,
          doubleSidePrice: 4.5,
          bulkPrintingPrice: 2.5
        },
        color: {
          singleSidePrice: 10.5,
          doubleSidePrice: 20.5,
          bulkPrintingPrice: 9.5
        }
      }
    }
  };

  console.log("Sending POST to", url);
  try {
    const res = await axios.post(url, payload);
    console.log("Status:", res.status);
    console.log("Response:", res.data);
  } catch (err) {
    console.error("API Error:", err.response ? err.response.data : err.message);
  }
}

main();
