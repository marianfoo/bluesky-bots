// Required modules
require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// For Node.js versions prior to 18.x, install and uncomment the following line
// const fetch = require('node-fetch');

// Configuration from environment variables
const BLUESKY_USERNAME = process.env.BLUESKY_USERNAME;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;

// Array of RSS feed URLs
const RSS_FEED_URLS = [
  'https://community.sap.com/khhcw49343/rss/board?board.id=technology-blog-sap',
  'https://community.sap.com/khhcw49343/rss/board?board.id=technology-blog-members',
  'https://community.sap.com/khhcw49343/rss/board?board.id=aiblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=capblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=data-analyticsblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=toolingblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=integrationblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=frontend-ui5-fioriblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=devops-sysadminblog-board',
  'https://community.sap.com/khhcw49343/rss/board?board.id=developer-news'
];

// New feeds added on 2026-01-26 - only publish items from this date onwards
const NEW_FEEDS_CUTOFF_DATE = new Date('2026-01-26T00:00:00Z');
const NEW_FEED_IDS = [
  'aiblog-board',
  'capblog-board',
  'data-analyticsblog-board',
  'toolingblog-board',
  'integrationblog-board',
  'frontend-ui5-fioriblog-board',
  'devops-sysadminblog-board',
  'developer-news'
];

const CHECK_INTERVAL = 60 * 60 * 1000; // Check every 60 minutes
const RATE_LIMIT_INTERVAL = 30 * 1000; // 1 post per 30 seconds
const POSTED_IDS_FILE = path.join(__dirname, 'posted_ids.json');

// Initialize the Bluesky agent
const agent = new BskyAgent({
  service: 'https://bsky.social',
});

// Add this function near the top of the file, after the imports
function stripHtml(html) {
    if (!html) return '';
    // Remove HTML tags and decode HTML entities
    return html
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
        .replace(/&amp;/g, '&') // Replace &amp; with &
        .replace(/&lt;/g, '<') // Replace &lt; with <
        .replace(/&gt;/g, '>') // Replace &gt; with >
        .replace(/&quot;/g, '"') // Replace &quot; with "
        .trim();
}

// Add this near the top of the file, after the imports
function log(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  if (isError) {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

// Helper function to check if a feed URL is one of the new feeds
function isNewFeed(feedUrl) {
  return NEW_FEED_IDS.some(feedId => feedUrl.includes(feedId));
}

// Helper function to get the blog source name from feed URL
function getBlogSource(feedUrl) {
  if (feedUrl.includes('technology-blog-sap')) return 'by SAP';
  if (feedUrl.includes('technology-blog-members')) return 'by Members';
  if (feedUrl.includes('aiblog-board')) return 'AI';
  if (feedUrl.includes('capblog-board')) return 'CAP';
  if (feedUrl.includes('data-analyticsblog-board')) return 'Data & Analytics';
  if (feedUrl.includes('toolingblog-board')) return 'Tooling';
  if (feedUrl.includes('integrationblog-board')) return 'Integration';
  if (feedUrl.includes('frontend-ui5-fioriblog-board')) return 'UI5 & Fiori';
  if (feedUrl.includes('devops-sysadminblog-board')) return 'DevOps';
  if (feedUrl.includes('developer-news')) return 'Developer News';
  return '';
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
      // If postedIds is an array (from the old format), convert it to an object
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

    // Initialize XML parser
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    let lastPostTime = 0;

    // Function to check the RSS feeds
    const checkFeeds = async () => {
      try {
        log('Checking RSS feeds...');

        // Iterate over each RSS feed URL
        for (const feedUrl of RSS_FEED_URLS) {
          log(`Processing feed: ${feedUrl}`);

          // Fetch the RSS feed
          const response = await fetch(feedUrl);
          const xmlData = await response.text();

          // Parse the XML
          const jsonObj = parser.parse(xmlData);

          // Extract items from the feed
          const items = jsonObj.rss.channel.item;

          // Ensure items is an array
          const feedItems = Array.isArray(items) ? items : [items];

          const newItems = feedItems.filter(item => {
            const id = item.guid || item.link;
            const uniqueId = `${feedUrl}::${id}`;
            
            // Skip if already posted
            if (postedIds.hasOwnProperty(uniqueId)) {
              return false;
            }
            
            // For new feeds, skip items published before the cutoff date
            if (isNewFeed(feedUrl) && item.pubDate) {
              const itemDate = new Date(item.pubDate);
              if (itemDate < NEW_FEEDS_CUTOFF_DATE) {
                return false;
              }
            }
            
            return true;
          });
          log(`Found ${newItems.length} new posts in feed`);

          // Process items from oldest to newest
          for (const item of feedItems.reverse()) {
            const id = item.guid || item.link;
            // Create a unique key combining feed URL and item ID to avoid conflicts
            const uniqueId = `${feedUrl}::${id}`;

            // Skip if already posted
            if (postedIds.hasOwnProperty(uniqueId)) {
              continue;
            }

            // For new feeds, skip items published before the cutoff date
            if (isNewFeed(feedUrl) && item.pubDate) {
              const itemDate = new Date(item.pubDate);
              if (itemDate < NEW_FEEDS_CUTOFF_DATE) {
                log(`Skipping old item from new feed: "${item.title}" (${item.pubDate})`);
                continue;
              }
            }

            log(`Processing new post: "${item.title}"`);

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

            // Create post content with metadata (excluding the link)
            const author =
              item['dc:creator'] || item['creator'] || 'Unknown Author';

            // Determine the blog source from the feed URL
            const blogSource = getBlogSource(feedUrl);

            // Calculate maximum title length to ensure total post stays within limit
            const baseText = `👤 Post by ${author} (${blogSource}):\n""\n🔗 Link: ${item.link}`;
            log(`Base text length: ${baseText.length} characters`);
            const maxTitleLength = 290 - baseText.length;
            const truncatedTitle = item.title.length > maxTitleLength 
                ? item.title.slice(0, maxTitleLength - 1) + '…' 
                : item.title;

            let postText = `👤 Post by ${author} (${blogSource}):\n"${truncatedTitle}"\n🔗 Link: ${item.link}`;
            log(`Truncated post length: ${postText.length} characters`);
            log(`Post text: ${postText}`);

            // Create a RichText instance
            let rt = new RichText({ text: postText });
            await rt.detectFacets(agent);

            let finalPostText = postText;
            let embed = null;

            // If post is still too long, remove the link and use embed instead
            if (rt.text.length > 300) {
                // Create shorter post text without the link
                finalPostText = `👤 Post by ${author} (${blogSource}):\n"${item.title}"`;
                rt = new RichText({ text: finalPostText });
                await rt.detectFacets(agent);

                // Create the embed object
                embed = {
                    $type: 'app.bsky.embed.external',
                    external: {
                        uri: item.link,
                        title: item.title,
                        description: stripHtml(item.description) || '',
                    },
                };
            }

            // Post to Bluesky
            try {
                let postResponse;  // Declare the variable outside the if/else blocks
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

                log(`Posted to Bluesky: "${item.title}"`);
                
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
                log(`Failed to post "${item.title}". Error: ${postError.message}`, true);
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

    // Schedule the feed check every 5 minutes
    setInterval(checkFeeds, CHECK_INTERVAL);
  } catch (error) {
    console.error('Error initializing the script:', error);
  }
})();
