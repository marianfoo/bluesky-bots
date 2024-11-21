require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const snoowrap = require('snoowrap');
const fs = require('fs');
const path = require('path');

// Configuration from environment variables
const BLUESKY_USERNAME = process.env.BLUESKY_USERNAME;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD;

// Constants
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const BLUESKY_RATE_LIMIT_INTERVAL = 1000; // 1 post per second
const POSTED_IDS_FILE = path.join(__dirname, 'posted_reddit_posts.json');
const SUBREDDITS = ['SAP', 'abap', 'sapui5']; // Add array of subreddits to monitor

// Initialize the Bluesky agent
const agent = new BskyAgent({
  service: 'https://bsky.social',
});

// Initialize Reddit client
const reddit = new snoowrap({
  userAgent: 'YourBotName/1.0 (by u/your_reddit_username)',
  clientId: REDDIT_CLIENT_ID,
  clientSecret: REDDIT_CLIENT_SECRET,
  username: REDDIT_USERNAME,
  password: REDDIT_PASSWORD,
});

(async () => {
  try {
    // Login to Bluesky
    await agent.login({
      identifier: BLUESKY_USERNAME,
      password: BLUESKY_PASSWORD,
    });
    console.log('Logged into Bluesky successfully.');

    // Load or initialize the list of posted Reddit post IDs
    let postedIds = new Set();
    if (fs.existsSync(POSTED_IDS_FILE)) {
      const data = fs.readFileSync(POSTED_IDS_FILE, 'utf8');
      postedIds = new Set(JSON.parse(data));
    } else {
      fs.writeFileSync(POSTED_IDS_FILE, JSON.stringify([...postedIds], null, 2));
    }

    let lastPostTime = 0;

    // Function to check for new Reddit posts
    const checkRedditPosts = async () => {
      try {
        console.log('Checking Reddit for new posts...');

        // Fetch new posts from all subreddits
        for (const subredditName of SUBREDDITS) {
          console.log(`Checking r/${subredditName}...`);
          const subreddit = await reddit.getSubreddit(subredditName);
          const newPosts = await subreddit.getNew({ limit: 10 });

          if (!newPosts || newPosts.length === 0) {
            console.log(`No new posts found in r/${subredditName}`);
            continue;
          }

          // Process each post
          for (const post of newPosts) {
            const postId = post.id;

            // Check if we've already posted this Reddit post
            if (postedIds.has(postId)) {
              continue;
            }

            // Enforce Bluesky rate limit
            const now = Date.now();
            const timeSinceLastPost = now - lastPostTime;
            if (timeSinceLastPost < BLUESKY_RATE_LIMIT_INTERVAL) {
              const waitTime = BLUESKY_RATE_LIMIT_INTERVAL - timeSinceLastPost;
              console.log(`Rate limit in effect. Waiting ${waitTime / 1000} seconds...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }

            // Prepare the post text and embed content
            const postLink = `https://www.reddit.com${post.permalink}`;
            let postText;
            let embed = undefined;

            if (post.selftext) {
              // If there's selftext, use embed and keep post text minimal
              postText = `New post in r/${subredditName} by u/${post.author.name}:\n🔗 Link: ${postLink}`;
              embed = {
                $type: 'app.bsky.embed.external',
                external: {
                  uri: postLink,
                  title: post.title,
                  description: post.selftext.length > 300 
                    ? post.selftext.substring(0, 297) + '...' 
                    : post.selftext
                }
              };
            } else {
              // If no selftext, include the title in the post text
              const baseText = `New post in r/${subredditName} by u/${post.author.name}:\n📝 `;
              const suffix = `\n🔗 Link: ${postLink}`;
              const maxTitleLength = 290 - (baseText.length + suffix.length);
              
              const truncatedTitle = post.title.length > maxTitleLength 
                ? post.title.substring(0, maxTitleLength - 3) + '...'
                : post.title;
              
              postText = baseText + truncatedTitle + suffix;
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
              embed: embed,
              createdAt: new Date().toISOString(),
            });

            console.log(`Posted to Bluesky: Reddit post ID ${postId}`);

            // Update last post time and posted IDs
            lastPostTime = Date.now();

            // Add the post ID to the posted IDs set and save
            postedIds.add(postId);
            fs.writeFileSync(POSTED_IDS_FILE, JSON.stringify([...postedIds], null, 2));

            // Wait a bit before processing the next post to respect rate limits
            await new Promise((resolve) => setTimeout(resolve, BLUESKY_RATE_LIMIT_INTERVAL));
          }
        }
      } catch (error) {
        console.error('Error checking Reddit posts:', error);
      }
    };

    // Initial check
    await checkRedditPosts();

    // Schedule the check at the specified interval
    setInterval(checkRedditPosts, CHECK_INTERVAL);
  } catch (error) {
    console.error('Error initializing the script:', error);
  }
})();
