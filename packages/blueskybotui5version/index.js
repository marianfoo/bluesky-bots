// Required modules
require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const fs = require('fs');
const path = require('path');
const semver = require('semver'); // For version comparison
const { XMLParser } = require('fast-xml-parser'); // For parsing RSS feeds

// Configuration from environment variables
const BLUESKY_USERNAME = process.env.BLUESKY_USERNAME;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;

// Constants
const CHECK_INTERVAL = 60 * 60 * 1000; // Check every 60 minutes
const BLUESKY_RATE_LIMIT_INTERVAL = 1000; // 1 post per 1 second
const POSTED_VERSIONS_FILE = path.join(__dirname, 'posted_versions.json');

// RSS Feed URLs
const UI5_VERSIONS = [
  {
    type: 'SAPUI5',
    rssUrl: 'https://marianfoo.github.io/ui5-lib-diff/rss_feed_SAPUI5.xml',
    versionJsonUrl: 'https://sapui5.hana.ondemand.com/version.json?sap-ui-config-patches=true&sap-ui-config-showall=true',
  },
  {
    type: 'OpenUI5',
    rssUrl: 'https://marianfoo.github.io/ui5-lib-diff/rss_feed_OpenUI5.xml',
    versionJsonUrl: 'https://openui5.hana.ondemand.com/version.json?sap-ui-config-patches=true&sap-ui-config-showall=true',
  },
];

// Initialize the Bluesky agent
const agent = new BskyAgent({
  service: 'https://bsky.social',
});

// Main function
(async () => {
  try {
    // Login to Bluesky
    await agent.login({
      identifier: BLUESKY_USERNAME,
      password: BLUESKY_PASSWORD,
    });
    console.log('Logged into Bluesky successfully.');

    // Load or initialize the list of posted versions
    let postedVersions = {};
    if (fs.existsSync(POSTED_VERSIONS_FILE)) {
      const data = fs.readFileSync(POSTED_VERSIONS_FILE, 'utf8');
      postedVersions = JSON.parse(data);
    } else {
      fs.writeFileSync(POSTED_VERSIONS_FILE, JSON.stringify(postedVersions, null, 2));
    }

    let lastPostTime = 0;

    // Function to check for UI5 updates
    const checkUI5Versions = async () => {
      try {
        console.log('Checking UI5 versions...');

        for (const ui5 of UI5_VERSIONS) {
          const { type, rssUrl, versionJsonUrl } = ui5;

          // Fetch the RSS feed
          const response = await fetch(rssUrl);
          if (!response.ok) {
            console.error(`Failed to fetch ${type} RSS feed: ${response.statusText}`);
            continue;
          }
          const rssText = await response.text();

          // Parse the RSS feed
          const parser = new XMLParser();
          const rssData = parser.parse(rssText);

          // Extract versions from the RSS feed
          let items = rssData.rss.channel.item;
          if (!Array.isArray(items)) {
            items = [items];
          }

          // Fetch version.json to get all available versions
          const versionJsonResponse = await fetch(versionJsonUrl);
          if (!versionJsonResponse.ok) {
            console.error(`Failed to fetch ${type} version.json: ${versionJsonResponse.statusText}`);
            continue;
          }
          const versionData = await versionJsonResponse.json();

          // Build a set of all available versions
          const versionsSet = new Set();
          for (const key in versionData) {
            if (versionData[key].patches && Array.isArray(versionData[key].patches)) {
              for (const ver of versionData[key].patches) {
                if (semver.valid(ver)) {
                  versionsSet.add(ver);
                }
              }
            } else if (versionData[key].version && semver.valid(versionData[key].version)) {
              versionsSet.add(versionData[key].version);
            }
          }

          // Process each item in the RSS feed
          for (const item of items) {
            const title = item.title;
            const versionMatch = title.match(/Version (\d+\.\d+\.\d+) Changes/);
            if (!versionMatch) {
              console.error(`Failed to parse version from title: ${title}`);
              continue;
            }
            const latestVersion = versionMatch[1];

            // Initialize postedVersions[type] if not present
            if (!postedVersions[type]) {
              postedVersions[type] = {};
            }

            // Check if already posted
            if (postedVersions[type][latestVersion]) {
              console.log(`No new version for ${type}. Latest version ${latestVersion} already posted.`);
              continue;
            }

            // Determine previous version based on the change type
            let previousVersion = null;

            const major = semver.major(latestVersion);
            const minor = semver.minor(latestVersion);
            const patch = semver.patch(latestVersion);

            // Try to determine the change type by checking previous versions
            let changeType = 'initial release';

            // For patch changes
            if (patch > 0) {
              previousVersion = `${major}.${minor}.${patch - 1}`;
              changeType = 'patch';
            } else if (minor > 0) {
              // For minor changes
              previousVersion = `${major}.${minor - 1}.0`;
              changeType = 'minor';
            } else if (major > 0) {
              // For major changes
              previousVersion = `${major - 1}.0.0`;
              changeType = 'major';
            } else {
              previousVersion = '0.0.0';
            }

            // Ensure previousVersion exists in versionsSet
            if (!versionsSet.has(previousVersion)) {
              // If the computed previousVersion doesn't exist, find the closest lower version
              const allVersions = Array.from(versionsSet).filter(ver => semver.lt(ver, latestVersion));
              allVersions.sort(semver.rcompare); // Sort in descending order
              previousVersion = allVersions[0] || previousVersion;
            }

            // Generate the comparison link
            const compareLink = `https://marianfoo.github.io/ui5-lib-diff/?versionFrom=${latestVersion}&ui5Type=${type}&versionTo=${previousVersion}`;

            // Generate the documentation link based on UI5 type
            const docsLink =
              type === 'SAPUI5'
                ? `https://ui5.sap.com/${latestVersion}/#/`
                : `https://sdk.openui5.org/${latestVersion}/#/`;

            // Prepare the post text
            const postText = `🚀 New ${type} version released: ${latestVersion}\nChange type: ${changeType}\n🔗 What's new: ${compareLink}\n📚 Documentation: ${docsLink}`;

            // Enforce Bluesky rate limit
            const now = Date.now();
            const timeSinceLastPost = now - lastPostTime;
            if (timeSinceLastPost < BLUESKY_RATE_LIMIT_INTERVAL) {
              const waitTime = BLUESKY_RATE_LIMIT_INTERVAL - timeSinceLastPost;
              console.log(`Rate limit in effect. Waiting ${waitTime / 1000} seconds...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }

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
              console.log('Post content was too long and has been truncated.');
            }

            // Post to Bluesky
            const postResponse = await agent.post({
              text: rt.text,
              facets: rt.facets,
              createdAt: new Date().toISOString(),
            });

            console.log(`Posted to Bluesky: ${type} ${latestVersion}`);

            // Update last post time and posted versions
            lastPostTime = Date.now();

            // Save the Bluesky post ID (URI)
            const blueskyPostId = postResponse.uri;

            // Update postedVersions
            postedVersions[type][latestVersion] = {
              blueskyPostId: blueskyPostId,
            };
            fs.writeFileSync(POSTED_VERSIONS_FILE, JSON.stringify(postedVersions, null, 2));

            // Wait a bit before processing the next version to respect rate limits
            await new Promise((resolve) => setTimeout(resolve, BLUESKY_RATE_LIMIT_INTERVAL));
          }
        }
      } catch (error) {
        console.error('Error checking UI5 versions:', error);
      }
    };

    // Initial check
    await checkUI5Versions();

    // Schedule the check at the specified interval
    setInterval(checkUI5Versions, CHECK_INTERVAL);
  } catch (error) {
    console.error('Error initializing the script:', error);
  }
})();
