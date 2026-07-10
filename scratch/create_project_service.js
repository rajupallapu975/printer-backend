const { dbCustomer, admin } = require("../firebase");

async function main() {
  const serviceId = "project_binding";
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  
  console.log(`Creating service "${serviceId}"...`);
  
  const docRef = dbCustomer.collection("services").doc(serviceId);
  
  const serviceData = {
    id: serviceId,
    name: "Project + Binding",
    description: "Project printing with options for Spiral, Thermal, or Paper bindings.",
    isActive: true,
    isDeleted: false,
    startingPrice: 10.0,
    paperSizes: ["A4", "A3", "Legal", "Bond Paper (A4)"],
    images: [
      "https://res.cloudinary.com/dpmpyvmbg/image/upload/v1783599967/services/ib2sy2ghodvxllrpxeug.png"
    ],
    customParameters: [],
    parameters: {
      "a4_color_singleSide": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      },
      "a3_color_singleSide": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      },
      "legal_color_singleSide": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      },
      "bond_paper_(a4)_color_singleSide": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      },
      "spiral_binding": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      },
      "thermal_binding": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      },
      "paper_binding": {
        "isEnabled": true,
        "commission": 0.0,
        "commissionType": "percentage"
      }
    },
    version: 1,
    schemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: "system_admin"
  };

  try {
    await docRef.set(serviceData);
    console.log("✅ Service document written successfully!");
    
    // Increment service version in shops collection to notify all client apps
    const versionRef = dbCustomer.collection("shops").doc("serviceVersion");
    await versionRef.set({
      lastUpdated: timestamp,
      version: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
    console.log("✅ Service version notification sent successfully!");
  } catch (e) {
    console.error("❌ Failed to create service:", e.message);
  }
  
  process.exit(0);
}

main().catch(console.error);
