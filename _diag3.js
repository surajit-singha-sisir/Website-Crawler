const axios = require('axios');

async function run() {
  const base = 'http://server.arrownetsylhet.com';

  // Get the asset manifest to find the real JS bundle filename
  const manifest = await axios.get(base + '/asset-manifest.json', {
    timeout: 10000, validateStatus: () => true
  });
  console.log('=== asset-manifest.json ===');
  console.log(JSON.stringify(manifest.data, null, 2));
}
run();
