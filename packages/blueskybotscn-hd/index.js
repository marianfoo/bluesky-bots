// Required modules
require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const fs = require('fs');
const path = require('path');

// For Node.js versions prior to 18.x, install and uncomment the following line
// const fetch = require('node-fetch');

// Configuration from environment variables
const BLUESKY_USERNAME = process.env.BLUESKY_USERNAME;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;

// SAP Community search API base URL
const BASE_API_URL = 'https://community.sap.com/api/2.0/search';

// Minimum kudos (likes) required for a post to be published (per board)
const DEFAULT_MIN_KUDOS = 9;
const BOARD_MIN_KUDOS = {
  'technology-blog-sap': 15, // High-volume board — stricter filter
};

// Board IDs to monitor for high-quality blog posts
const BOARD_IDS = [
  'technology-blog-sap',
  'technology-blog-members',
  'aiblog-board',
  'capblog-board',
  'data-analyticsblog-board',
  'toolingblog-board',
  'integrationblog-board',
  'frontend-ui5-fioriblog-board',
  'devops-sysadminblog-board',
  'developer-news'
];

// Helper to get the min kudos threshold for a board
function getMinKudos(boardId) {
  return BOARD_MIN_KUDOS[boardId] ?? DEFAULT_MIN_KUDOS;
}

const CHECK_INTERVAL = 60 * 60 * 1000; // Check every 60 minutes
const RATE_LIMIT_INTERVAL = 30 * 1000; // 1 post per 30 seconds
const POSTED_IDS_FILE = path.join(__dirname, 'posted_ids.json');

// Initialize the Bluesky agent
const agent = new BskyAgent({
  service: 'https://bsky.social',
});

// Strip HTML tags and decode common HTML entities
function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
        .replace(/&amp;/g, '&') // Replace &amp; with &
        .replace(/&lt;/g, '<') // Replace &lt; with <
        .replace(/&gt;/g, '>') // Replace &gt; with >
        .replace(/&quot;/g, '"') // Replace &quot; with "
        .trim();
}

// Helper function to get the blog source label from board ID
function getBlogSource(boardId) {
  if (boardId === 'technology-blog-sap') return 'by SAP';
  if (boardId === 'technology-blog-members') return 'by Members';
  if (boardId === 'aiblog-board') return 'AI';
  if (boardId === 'capblog-board') return 'CAP';
  if (boardId === 'data-analyticsblog-board') return 'Data & Analytics';
  if (boardId === 'toolingblog-board') return 'Tooling';
  if (boardId === 'integrationblog-board') return 'Integration';
  if (boardId === 'frontend-ui5-fioriblog-board') return 'UI5 & Fiori';
  if (boardId === 'devops-sysadminblog-board') return 'DevOps';
  if (boardId === 'developer-news') return 'Developer News';
  return '';
}

// Build a LiQL query for the SAP Community search API
// Looks back LOOKBACK_DAYS with a larger limit so posts that slowly accumulate
// kudos over time are picked up as soon as they cross the MIN_KUDOS threshold.
const LOOKBACK_DAYS = 365;
const QUERY_LIMIT = 500;

function buildQuery(boardId) {
  // Calculate the lookback date (365 days ago) — LiQL requires unquoted ISO dates with >
  const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace(/\.\d{3}Z$/, ''); // e.g. 2025-02-16T09:00:00

  const select = "select id, subject, view_href, search_snippet, body, post_time, author.login, author.view_href, metrics.views from messages";
  const where = [
    `board.id = '${boardId}'`,
    `conversation.style = 'blog'`,
    `depth = 0`,                        // Only original posts, no replies
    `kudos.sum(weight) >= ${getMinKudos(boardId)}`, // Minimum kudos filter (per board)
    `post_time > ${lookbackDate}`        // Only posts from the last 365 days (unquoted date)
  ].join(' AND ');
  return `${select} WHERE ${where} ORDER BY id DESC LIMIT ${QUERY_LIMIT}`;
}

// Timestamped logging helper
function log(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  if (isError) {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

// Main function
(async () => {
  try {
    // Login to Bluesky
    await agent.login({
      identifier: BLUESKY_USERNAME,
      password: BLUESKY_PASSWORD,
    });
    console.log('Logged into Bluesky successfully.');

    // Load or initialize the list of posted IDs
    let postedIds = {};
    if (fs.existsSync(POSTED_IDS_FILE)) {
      const data = fs.readFileSync(POSTED_IDS_FILE, 'utf8');
      postedIds = JSON.parse(data);
      // If postedIds is an array (from an old format), convert it to an object
      if (Array.isArray(postedIds)) {
        const tempPostedIds = {};
        for (const id of postedIds) {
          tempPostedIds[id] = null;
        }
        postedIds = tempPostedIds;
      }
    } else {
      fs.writeFileSync(POSTED_IDS_FILE, JSON.stringify(postedIds, null, 2));
    }

    let lastPostTime = 0;

    // Function to check all boards via the SAP Community API
    const checkFeeds = async () => {
      try {
        log('Checking SAP Community API...');

        // Iterate over each board ID
        for (const boardId of BOARD_IDS) {
          log(`Processing board: ${boardId}`);

          // Build the LiQL query
          const query = buildQuery(boardId);
          const queryParams = new URLSearchParams();
          queryParams.append('q', query);
          const apiUrl = `${BASE_API_URL}?${queryParams.toString()}`;

          // Fetch data from the SAP Community API
          const response = await fetch(apiUrl);
          const data = await response.json();

          if (data.status !== 'success') {
            log(`API error for board ${boardId}: ${JSON.stringify(data)}`, true);
            continue;
          }

          const items = data.data.items || [];

          const newItems = items.filter(item => {
            const uniqueId = `${boardId}::${item.id}`;
            return !postedIds.hasOwnProperty(uniqueId);
          });
          log(`Found ${newItems.length} new posts out of ${items.length} total for board ${boardId}`);

          // Process items from oldest to newest (API returns newest first)
          for (const item of [...items].reverse()) {
            const uniqueId = `${boardId}::${item.id}`;

            // Skip if already posted
            if (postedIds.hasOwnProperty(uniqueId)) {
              continue;
            }

            log(`Processing new post: "${item.subject}"`);

            // Enforce rate limit
            const now = Date.now();
            const timeSinceLastPost = now - lastPostTime;
            if (timeSinceLastPost < RATE_LIMIT_INTERVAL) {
              const waitTime = RATE_LIMIT_INTERVAL - timeSinceLastPost;
              console.log(
                `Rate limit in effect. Waiting ${waitTime / 1000} seconds...`
              );
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }

            // Extract metadata
            const author = item.author?.login || 'Unknown Author';
            const blogSource = getBlogSource(boardId);
            const postUrl = item.view_href;
            const title = item.subject;
            const description = stripHtml(item.search_snippet || item.body || '');

            // Calculate maximum title length to ensure total post stays within limit
            const baseText = `👤 Post by ${author} (${blogSource}):\n""\n🔗 Link: ${postUrl}`;
            log(`Base text length: ${baseText.length} characters`);
            const maxTitleLength = 290 - baseText.length;
            const truncatedTitle = title.length > maxTitleLength 
                ? title.slice(0, maxTitleLength - 1) + '…' 
                : title;

            let postText = `👤 Post by ${author} (${blogSource}):\n"${truncatedTitle}"\n🔗 Link: ${postUrl}`;
            log(`Truncated post length: ${postText.length} characters`);
            log(`Post text: ${postText}`);

            // Create a RichText instance
            let rt = new RichText({ text: postText });
            await rt.detectFacets(agent);

            let embed = null;

            // If post is still too long, remove the link and use embed instead
            if (rt.text.length > 300) {
                // Create shorter post text without the link
                const finalPostText = `👤 Post by ${author} (${blogSource}):\n"${title}"`;
                rt = new RichText({ text: finalPostText });
                await rt.detectFacets(agent);

                // Create the embed object
                embed = {
                    $type: 'app.bsky.embed.external',
                    external: {
                        uri: postUrl,
                        title: title,
                        description: description,
                    },
                };
            }

            // Post to Bluesky
            try {
                let postResponse;
                if (embed === null) {
                    postResponse = await agent.post({
                        text: rt.text,
                        facets: rt.facets,
                        createdAt: new Date().toISOString(),
                    });
                } else {
                    postResponse = await agent.post({
                        text: rt.text,
                        facets: rt.facets,
                        embed: embed,
                        createdAt: new Date().toISOString(),
                    });
                }

                log(`Posted to Bluesky: "${title}"`);
                
                // Update last post time and posted IDs
                lastPostTime = Date.now();

                // Save the Bluesky post ID (URI)
                const blueskyPostId = postResponse.uri;

                // Update postedIds with the mapping
                postedIds[uniqueId] = blueskyPostId;
                fs.writeFileSync(
                    POSTED_IDS_FILE,
                    JSON.stringify(postedIds, null, 2)
                );
            } catch (postError) {
                log(`Failed to post "${title}". Error: ${postError.message}`, true);
                log(`Post content: ${rt.text}`, true);
                if (embed) {
                    log(`Embed content: ${JSON.stringify(embed)}`, true);
                }
                
                // Update last post time to maintain rate limiting
                lastPostTime = Date.now();
                
                // Continue with the next item
                continue;
            }
          }
        }
      } catch (error) {
        console.error('Error checking feeds:', error);
      }
    };

    // Initial feed check
    await checkFeeds();

    // Schedule the feed check every 60 minutes
    setInterval(checkFeeds, CHECK_INTERVAL);
  } catch (error) {
    console.error('Error initializing the script:', error);
  }
})();
