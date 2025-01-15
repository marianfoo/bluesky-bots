// index.js

require('dotenv').config();
const { BskyAgent } = require('@atproto/api');
const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs').promises;

const BLUESKY_USERNAME = process.env.BLUESKY_USERNAME;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;

// Create axios instance for Bluesky API
const blueSkySocialAPI = axios.create({
  baseURL: 'https://bsky.social/xrpc',
});

async function createSession() {
  const { data } = await blueSkySocialAPI.post(
    'com.atproto.server.createSession',
    {
      identifier: BLUESKY_USERNAME,
      password: BLUESKY_PASSWORD,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }
  );

  blueSkySocialAPI.defaults.headers.common['Authorization'] = `Bearer ${data.accessJwt}`;
  return {
    did: data.did,
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    service: data.didDoc.service,
  };
}

async function getConvoForMembers(accountPDS, members) {
  const url = 'chat.bsky.convo.getConvoForMembers';

  const response = await blueSkySocialAPI.get(url, {
    params: {
      members: members, // Array of DIDs
    },
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Atproto-Proxy': 'did:web:api.bsky.chat#bsky_chat',
    },
    baseURL: `${accountPDS}/xrpc`,
  });
  
  checkRateLimit(response.headers);
  return response.data;
}

async function sendMessage(accountPDS, convoId, message) {
  const url = 'chat.bsky.convo.sendMessage';

  try {
    const response = await blueSkySocialAPI.post(
      url,
      {
        convoId: convoId,
        message: {
          text: message,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Atproto-Proxy': 'did:web:api.bsky.chat#bsky_chat',
        },
        baseURL: `${accountPDS}/xrpc`,
      }
    );
    
    checkRateLimit(response.headers);
    return response.data;
  } catch (error) {
    if (error.response) {
      checkRateLimit(error.response.headers);
    }
    throw error;
  }
}

async function loadProgress() {
  try {
    const data = await fs.readFile('progress.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or is invalid, return empty object
    return {};
  }
}

async function saveProgress(did, checkResults, messageStatus = null) {
  const progress = await loadProgress();
  progress[did] = {
    ...checkResults,
    lastChecked: new Date().toISOString(),
    messageSent: messageStatus
  };
  await fs.writeFile('progress.json', JSON.stringify(progress, null, 2));
}

async function listConvos(accountPDS, limit = 100) {
  const url = 'chat.bsky.convo.listConvos';
  let allConvos = [];
  let cursor = null;

  do {
    const response = await blueSkySocialAPI.get(url, {
      params: { limit, cursor },
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Atproto-Proxy': 'did:web:api.bsky.chat#bsky_chat',
      },
      baseURL: `${accountPDS}/xrpc`,
    });
    
    checkRateLimit(response.headers);
    allConvos = allConvos.concat(response.data.convos);
    cursor = response.data.cursor;
    
    console.log(`Fetched ${response.data.convos.length} conversations`);
  } while (cursor);

  return { convos: allConvos };
}

// Add helper function
function checkRateLimit(headers) {
  if (headers['ratelimit-remaining'] === '0') {
    const resetTime = new Date(headers['ratelimit-reset'] * 1000);
    const waitTime = resetTime - new Date();
    throw new Error(`Rate limit exceeded. Reset at ${resetTime.toLocaleString()} (in ${Math.ceil(waitTime / 1000 / 60)} minutes)`);
  }
}

// Separate the avatar checking logic completely
async function isDefaultAvatar(imageBuffer) {
  try {
    const image = sharp(imageBuffer);
    const resizedImage = image.resize(50, 50, { fit: 'fill' });
    const { data, info } = await resizedImage.raw().toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    const colorCounts = {};

    for (let idx = 0; idx < data.length; idx += info.channels) {
      const red = data[idx];
      const green = data[idx + 1];
      const blue = data[idx + 2];
      const colorKey = `${red},${green},${blue}`;
      colorCounts[colorKey] = (colorCounts[colorKey] || 0) + 1;
    }

    const colorKeys = Object.keys(colorCounts);
    const mostCommonColorCount = Math.max(...Object.values(colorCounts));
    const mostCommonColorPercentage = (mostCommonColorCount / totalPixels) * 100;

    return mostCommonColorPercentage > 75; // Slightly relaxed criteria
  } catch (error) {
    throw new Error(`Error processing image: ${error.message}`);
  }
}

// Only export what's needed for testing
module.exports = { 
  isDefaultAvatar,
  createSession,
  getConvoForMembers,
  sendMessage
};

// Only run the main script if this file is being run directly
if (require.main === module) {
  (async () => {
    try {
      // Initialize the Bluesky agent
      const agent = new BskyAgent({
        service: 'https://bsky.social',
      });

      // Login to Bluesky
      try {
        const loginResponse = await agent.login({
          identifier: BLUESKY_USERNAME,
          password: BLUESKY_PASSWORD,
        });
        checkRateLimit(loginResponse.headers);
        console.log('Logged into Bluesky successfully.');
      } catch (error) {
        if (error.status === 429) {
          console.error('Rate limit exceeded during login.');
          console.error(`Limit will reset at: ${new Date(error.headers['ratelimit-reset'] * 1000).toLocaleString()}`);
          process.exit(1);
        }
        throw error;
      }

      // Get your own DID (Decentralized Identifier)
      const myDid = agent.session.did;
      console.log(`Your DID: ${myDid}`);

      // Fetch your followers
      let followers = [];
      let cursor = null;
      const limit = 100; // Maximum number of followers per request

      do {
        const response = await agent.getFollowers({
          actor: myDid,
          limit,
          cursor,
        });

        followers = followers.concat(response.data.followers);
        cursor = response.data.cursor;

        console.log(`Fetched ${response.data.followers.length} followers.`);
      } while (cursor);

      console.log(`Total followers fetched: ${followers.length}`);

      // Create an array to store followers needing updates
      const followersNeedingUpdates = [];

      // Process each follower
      for (const follower of followers) {
        console.log('----------------------------------');
        console.log(`Processing follower: ${follower.handle}`);

        const checkResults = {
          handle: follower.handle,
          did: follower.did,
          needsAvatarUpdate: false,
          needsDisplayNameUpdate: false,
          avatarUrl: follower.avatar
        };

        // Check if displayName is empty
        if (!follower.displayName || follower.displayName.trim() === '') {
          checkResults.needsDisplayNameUpdate = true;
          console.log(`User ${follower.handle} has no displayName.`);
        }

        // Check Avatar
        if (follower.avatar) {
          try {
            const response = await axios({
              method: 'get',
              url: follower.avatar,
              responseType: 'arraybuffer',
            });

            const isDefault = await isDefaultAvatar(response.data);
            
            if (isDefault) {
              checkResults.needsAvatarUpdate = true;
              console.log(`User ${follower.handle} has a default avatar.`);
            }
          } catch (error) {
            console.error(`Error processing avatar for ${follower.handle}:`, error.message);
          }
        } else {
          checkResults.needsAvatarUpdate = true;
          checkResults.avatarUrl = null;
          console.log(`User ${follower.handle} has no avatar.`);
        }

        // Save progress after checks
        await saveProgress(follower.did, checkResults);

        // Add to list if updates are needed
        if (checkResults.needsAvatarUpdate || checkResults.needsDisplayNameUpdate) {
          followersNeedingUpdates.push(checkResults);
        }

        // Optional: Add a delay between requests to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Output results
      console.log('\n=== Followers Needing Updates ===');
      followersNeedingUpdates.forEach(follower => {
        console.log(`\nHandle: @${follower.handle}`);
        console.log(`DID: ${follower.did}`);
        console.log(`Needs Avatar Update: ${follower.needsAvatarUpdate}`);
        console.log(`Needs Display Name Update: ${follower.needsDisplayNameUpdate}`);
      });

      // Save results to a file
      await fs.writeFile(
        'followers-needing-updates.json', 
        JSON.stringify(followersNeedingUpdates, null, 2)
      );
      console.log('\nResults saved to followers-needing-updates.json');

    } catch (error) {
      console.error('Error:', error.message);
      if (error.status === 429) {
        console.error('Script stopped due to rate limiting.');
      }
      process.exit(1);
    }
  })();
}
