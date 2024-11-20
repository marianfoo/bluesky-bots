// Required modules
require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const fs = require('fs');
const path = require('path');
const RateLimiter = require('limiter').RateLimiter;

// Configuration from environment variables
const BLUESKY_USERNAME = process.env.BLUESKY_USERNAME;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;

// URLs of the sources.json files
const SOURCES_JSON_URLS = [
  'https://raw.githubusercontent.com/marianfoo/bestofcapjs-data/main/sources.json',
  'https://raw.githubusercontent.com/ui5-community/bestofui5-data/main/sources.json',
];

// Constants
const CHECK_INTERVAL = 60 * 60 * 1000; // Check every 60 minutes
const NPM_RATE_LIMIT_INTERVAL = 1000; // 1 request per second
const BLUESKY_RATE_LIMIT_INTERVAL = 1000; // 1 post per 1 second
const POSTED_IDS_FILE = path.join(__dirname, 'posted_packages.json');
const NOT_FOUND_PACKAGES_FILE = path.join(__dirname, 'not_found_packages.json');

// Initialize the Bluesky agent
const agent = new BskyAgent({
  service: 'https://bsky.social',
});

// Rate limiter for npm API
const npmLimiter = new RateLimiter({ tokensPerInterval: 1, interval: NPM_RATE_LIMIT_INTERVAL });

// Add this helper function near the top of the file, after the constants
const getTimestamp = () => new Date().toISOString();

// Main function
(async () => {
  try {
    // Login to Bluesky
    await agent.login({
      identifier: BLUESKY_USERNAME,
      password: BLUESKY_PASSWORD,
    });
    console.log(`[${getTimestamp()}] Logged into Bluesky successfully.`);

    // Load or initialize the list of posted packages and versions
    let postedPackages = {};
    if (fs.existsSync(POSTED_IDS_FILE)) {
      const data = fs.readFileSync(POSTED_IDS_FILE, 'utf8');
      postedPackages = JSON.parse(data);
    } else {
      fs.writeFileSync(POSTED_IDS_FILE, JSON.stringify(postedPackages, null, 2));
    }

    // Load or initialize the list of not-found packages
    let notFoundPackages = new Set();
    if (fs.existsSync(NOT_FOUND_PACKAGES_FILE)) {
      const data = fs.readFileSync(NOT_FOUND_PACKAGES_FILE, 'utf8');
      notFoundPackages = new Set(JSON.parse(data));
    }

    let lastPostTime = 0;

    // Function to fetch the list of @sap packages
    const fetchSapPackages = async () => {
      console.log(`[${getTimestamp()}] Fetching @sap, @sap-ux, @sap-cloud-sdk, @cap-js, and @cap-js-community packages...`);
      const sapPackages = [];
      let hasMore = true;
      let from = 0;
      const size = 250; // Max size per request
      
      // Search for all SAP-related packages
      for (const searchTerm of ['@sap', '@sap-ux', '@sap-cloud-sdk', '@cap-js', '@cap-js-community']) {
        from = 0;
        hasMore = true;
        while (hasMore) {
          // Wait for rate limiter
          await npmLimiter.removeTokens(1);

          const searchUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(searchTerm)}&size=${size}&from=${from}`;
          const response = await fetch(searchUrl);
          const data = await response.json();

          sapPackages.push(...data.objects.map((obj) => obj.package.name));
          from += size;
          hasMore = data.objects.length > 0;
        }
      }
      console.log(`[${getTimestamp()}] Fetched ${sapPackages.length} SAP-related packages.`);
      return [...new Set(sapPackages)]; // Remove any duplicates
    };

    // Function to fetch packages from sources.json files
    const fetchSourcesPackages = async () => {
      console.log(`[${getTimestamp()}] Fetching packages from sources.json files...`);
      const packages = [];
      for (const url of SOURCES_JSON_URLS) {
        // Wait for rate limiter
        await npmLimiter.removeTokens(1);
        const response = await fetch(url);
        const data = await response.json();

        data.forEach((item) => {
          if (item.subpackages && Array.isArray(item.subpackages)) {
            item.subpackages.forEach((subpkg) => {
              if (subpkg.name) {
                packages.push(subpkg.name);
              }
            });
          } else if (item.repo) {
            // Use the repo name as the package name
            packages.push(item.repo);
          }
        });
      }
      console.log(`[${getTimestamp()}] Fetched ${packages.length} packages from sources.json files.`);
      return packages;
    };

    // Function to check for package updates
    const checkPackages = async () => {
      try {
        console.log(`[${getTimestamp()}] Checking for package updates...`);

        // Fetch package lists
        const sapPackages = await fetchSapPackages();
        const sourcesPackages = await fetchSourcesPackages();
        const allPackages = [...new Set([...sapPackages, ...sourcesPackages])]; // Remove duplicates

        console.log(`[${getTimestamp()}] Total packages to check: ${allPackages.length}`);

        // Process each package
        for (const pkgName of allPackages) {
          // Skip if package was previously not found
          if (notFoundPackages.has(pkgName)) {
            console.log(`[${getTimestamp()}] ⏭️ Skipping ${pkgName} - previously not found on npm`);
            continue;
          }

          console.log(`[${getTimestamp()}] \n📋 Processing package: ${pkgName}`);
          
          // Enforce npm API rate limit
          await npmLimiter.removeTokens(1);
          console.log(`[${getTimestamp()}] 🔄 Fetching npm registry data for ${pkgName}...`);

          // Fetch package info from npm registry
          const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}`);
          if (!response.ok) {
            console.error(`[${getTimestamp()}] ❌ Failed to fetch package ${pkgName}: ${response.statusText}`);
            // Add to not found packages and save
            notFoundPackages.add(pkgName);
            fs.writeFileSync(NOT_FOUND_PACKAGES_FILE, JSON.stringify([...notFoundPackages], null, 2));
            continue;
          }
          const data = await response.json();

          const latestVersion = data['dist-tags'] && data['dist-tags'].latest;
          if (!latestVersion) {
            console.error(`[${getTimestamp()}] ⚠️ No latest version found for package ${pkgName}`);
            continue;
          }
          console.log(`[${getTimestamp()}] 📦 Latest version found: ${latestVersion}`);

          const packageId = `${pkgName}@${latestVersion}`;

          // Skip if already posted
          if (postedPackages.hasOwnProperty(packageId)) {
            console.log(`[${getTimestamp()}] ⏭️ Skipping ${packageId} - already posted`);
            continue;
          }
          console.log(`[${getTimestamp()}] ✨ New version detected: ${packageId}`);

          // Enforce Bluesky rate limit
          const now = Date.now();
          const timeSinceLastPost = now - lastPostTime;
          if (timeSinceLastPost < BLUESKY_RATE_LIMIT_INTERVAL) {
            const waitTime = BLUESKY_RATE_LIMIT_INTERVAL - timeSinceLastPost;
            console.log(`[${getTimestamp()}] ⏳ Rate limit in effect. Waiting ${waitTime / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }

          // Prepare the post content
          const postText = `📦 New version of ${pkgName}\nVersion updated to ${latestVersion}\n🔗 Link to npm package: https://www.npmjs.com/package/${pkgName}`;

          // Create a RichText instance
          const rt = new RichText({ text: postText });

          // Detect facets (links, mentions, hashtags)
          await rt.detectFacets(agent);

          // Check if the content exceeds the limit
          const { charactersRemaining } = rt;
          if (charactersRemaining < 0) {
            // Truncate the text and re-detect facets
            rt.setText(rt.text.slice(0, rt.text.length + charactersRemaining - 1) + '…');
            await rt.detectFacets(agent);
            console.log(`[${getTimestamp()}] Post content was too long and has been truncated.`);
          }

          // Post to Bluesky
          const postResponse = await agent.post({
            text: rt.text,
            facets: rt.facets,
            createdAt: new Date().toISOString(),
          });

          console.log(`[${getTimestamp()}] Posted to Bluesky: "${pkgName}@${latestVersion}"`);

          // Update last post time and posted packages
          lastPostTime = Date.now();

          // Save the Bluesky post ID (URI)
          const blueskyPostId = postResponse.uri;

          // Update postedPackages with the mapping
          postedPackages[packageId] = blueskyPostId;
          fs.writeFileSync(POSTED_IDS_FILE, JSON.stringify(postedPackages, null, 2));
        }
      } catch (error) {
        console.error(`[${getTimestamp()}] Error checking packages:`, error);
      }
    };

    // Initial package check
    await checkPackages();

    // Schedule the package check at the specified interval
    setInterval(checkPackages, CHECK_INTERVAL);
  } catch (error) {
    console.error(`[${getTimestamp()}] Error initializing the script:`, error);
  }
})();
