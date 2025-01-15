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
  return response.data;
}

async function sendMessage(accountPDS, convoId, message) {
  const url = 'chat.bsky.convo.sendMessage';

  await blueSkySocialAPI.post(
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
module.exports = { isDefaultAvatar };

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

      // Fetch all conversations once
      const session = await createSession();
      const pdsEndpoint = session.service[0].serviceEndpoint;
      const conversations = await listConvos(pdsEndpoint);
      console.log(`Fetched ${conversations.convos.length} total conversations`);

      // Process each follower
      for (const follower of followers) {
        // Only process the test account
      //   if (follower.did !== "did:plc:2gtexo4dtoufqyz5nrths4vs") {
      //     continue;
      //   }

        console.log('----------------------------------');
        console.log(`Processing follower: ${follower.handle}`);

        // Check if conversation already exists
        const existingConvo = conversations.convos.find(convo => 
          convo.members.some(member => member.did === follower.did)
        );

        if (existingConvo) {
          console.log(`Skipping ${follower.handle} - conversation already exists`);
          continue;
        }

        const checkResults = {
          handle: follower.handle,
          needsAvatarUpdate: false,
          needsDisplayNameUpdate: false,
          needsDescriptionUpdate: false
        };

        // Check if displayName is empty
        if (!follower.displayName || follower.displayName.trim() === '') {
          checkResults.needsDisplayNameUpdate = true;
          console.log(`User ${follower.handle} has no displayName.`);
        }

        // Check Avatar
        if (follower.avatar) {
          try {
            // Download the avatar image
            const response = await axios({
              method: 'get',
              url: follower.avatar,
              responseType: 'arraybuffer',
            });

            const isDefault = await isDefaultAvatar(response.data);
            
            if (isDefault) {
              // Image is mostly one color, likely a default avatar
              checkResults.needsAvatarUpdate = true;
              console.log(`User ${follower.handle} has a default avatar.`);
            } else {
              console.log(`User ${follower.handle} has a custom avatar.`);
            }
          } catch (error) {
            console.error(`Error processing avatar for ${follower.handle}:`, error.message);
          }
        } else {
          // User has no avatar set
          checkResults.needsAvatarUpdate = true;
          console.log(`User ${follower.handle} has no avatar.`);
        }

        // Save progress after checks
        await saveProgress(follower.did, checkResults);

        // Only send message if updates are needed
        if (checkResults.needsAvatarUpdate || 
            checkResults.needsDisplayNameUpdate) {
          
          try {
            let message = `Welcome to Bluesky, @${follower.handle}!\n\n`;
            message += `Thank you for supporting the SAP community here and contributing to it. The focus is, of course, on the exchange of information on SAP topics.\n\n`;
            message += `It is very helpful if you don't have the default avatar and have a good username (preferably your real name).\n\n`;

            let updatesList = [];

            if (checkResults.needsAvatarUpdate) {
              updatesList.push('the default avatar');
            }
            if (checkResults.needsDisplayNameUpdate) {
              updatesList.push('no display name');
            }

            if (updatesList.length > 0) {
              message += `I noticed that you still have ${updatesList.join(', ')}.\n\n`;
            }

            message += `You don't have to change anything, of course, but I and the SAP community here would be happy if you did.\n\n`;
            message += `Thanks in advance!\n\nBest regards,\nMarian Zeis`;
            message += `\n\n[This is an automated message sent by a bot]`;

            // Get or create conversation
            const convo = await getConvoForMembers(pdsEndpoint, [session.did, follower.did]);

            // Send message using the conversation ID
            await sendMessage(pdsEndpoint, convo.convo.id, message);
            console.log(`Sent a private message to @${follower.handle}`);
          } catch (error) {
            console.error(`Error sending message to @${follower.handle}:`, error.message);
          }

          // Add a delay between messages to respect rate limits
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Optional: Add a delay between requests to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms
      }
    } catch (error) {
      console.error('Error:', error.message);
      if (error.status === 429) {
        console.error('Script stopped due to rate limiting.');
      }
      process.exit(1);
    }
  })();
}
