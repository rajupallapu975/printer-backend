const http = require('http');

function makeRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: 'localhost',
      port: 5001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function testApi() {
  console.log("🔍 Testing GET /auth-config...");
  let res = await makeRequest('GET', '/auth-config');
  console.log("GET Response:", res);

  console.log("\n🔒 Testing POST /auth-config without admin key (Should fail 403)...");
  res = await makeRequest('POST', '/auth-config', { showEmailLogin: false });
  console.log("POST Response (No Key):", res);

  console.log("\n🔑 Testing POST /auth-config with valid x-admin-key (Turning OFF showEmailLogin)...");
  res = await makeRequest('POST', '/auth-config', { showEmailLogin: false }, {
    'x-admin-key': 'zikrint_secret_admin_key_2026'
  });
  console.log("POST Response (Disable):", res);

  console.log("\n🔑 Testing POST /auth-config with valid x-admin-key (Turning ON showEmailLogin)...");
  res = await makeRequest('POST', '/auth-config', { showEmailLogin: true }, {
    'x-admin-key': 'zikrint_secret_admin_key_2026'
  });
  console.log("POST Response (Enable):", res);
}

testApi();
