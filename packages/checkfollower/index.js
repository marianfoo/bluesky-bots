// index.js

require('dotenv').config();
const { BskyAgent } = require('@atproto/api');
const sharp = require('sharp');
const axios = require('axios');

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

(async () => {
  try {
    // Initialize the Bluesky agent
    const agent = new BskyAgent({
      service: 'https://bsky.social',
    });

    // Login to Bluesky
    await agent.login({
      identifier: BLUESKY_USERNAME,
      password: BLUESKY_PASSWORD,
    });
    console.log('Logged into Bluesky successfully.');

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

    // Process each follower
    for (const follower of followers) {
      // Only process the test account
      if (follower.did !== "did:plc:2gtexo4dtoufqyz5nrths4vs") {
        continue;
      }

      console.log('----------------------------------');
      console.log(`Processing follower: ${follower.handle}`);

      let needsAvatarUpdate = false;
      let needsDisplayNameUpdate = false;
      let needsDescriptionUpdate = false;

      // Check if displayName is empty
      if (!follower.displayName || follower.displayName.trim() === '') {
        needsDisplayNameUpdate = true;
        console.log(`User ${follower.handle} has no displayName.`);
      }

      // Check if description is empty
      if (!follower.description || follower.description.trim() === '') {
        needsDescriptionUpdate = true;
        console.log(`User ${follower.handle} has no description.`);
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

          // Read the image using sharp
          const image = sharp(response.data);

          // Resize the image to a smaller size for faster processing
          const resizedImage = image.resize(50, 50, { fit: 'fill' });

          // Get raw pixel data
          const { data, info } = await resizedImage.raw().toBuffer({ resolveWithObject: true });

          const totalPixels = info.width * info.height;
          const colorCounts = {};

          // Iterate over each pixel
          for (let idx = 0; idx < data.length; idx += info.channels) {
            const red = data[idx];
            const green = data[idx + 1];
            const blue = data[idx + 2];
            // Ignore alpha channel if present

            const colorKey = `${red},${green},${blue}`;
            colorCounts[colorKey] = (colorCounts[colorKey] || 0) + 1;
          }

          const colorKeys = Object.keys(colorCounts);
          const mostCommonColorCount = Math.max(...Object.values(colorCounts));
          const mostCommonColorPercentage = (mostCommonColorCount / totalPixels) * 100;

          if (mostCommonColorPercentage > 90 && colorKeys.length < 10) {
            // Image is mostly one color, likely a default avatar
            needsAvatarUpdate = true;
            console.log(`User ${follower.handle} has a default avatar.`);
          } else {
            console.log(`User ${follower.handle} has a custom avatar.`);
          }
        } catch (error) {
          console.error(`Error processing avatar for ${follower.handle}:`, error.message);
        }
      } else {
        // User has no avatar set
        needsAvatarUpdate = true;
        console.log(`User ${follower.handle} has no avatar.`);
      }

      needsDisplayNameUpdate = true;
      needsDescriptionUpdate = true;

      // Compose messages
      if (needsAvatarUpdate || needsDisplayNameUpdate || needsDescriptionUpdate) {
        let message = `Welcome to Bluesky, @${follower.handle}!\n\n`;
        message += `Thank you for supporting the SAP community here and contributing to it. The focus is, of course, on the exchange of information on SAP topics.\n\n`;
        message += `It is very helpful if you don't have the default avatar, have a good username (preferably your real name), and a description in your profile.\n\n`;

        let updatesList = [];

        if (needsAvatarUpdate) {
          updatesList.push('the default avatar');
        }
        if (needsDisplayNameUpdate) {
          updatesList.push('no display name');
        }
        if (needsDescriptionUpdate) {
          updatesList.push('no description in your profile');
        }

        if (updatesList.length > 0) {
          message += `I noticed that you still have ${updatesList.join(', ')}.\n\n`;
        }

        message += `You don't have to change anything, of course, but I and the SAP community here would be happy if you did.\n\n`;
        message += `Thanks in advance!\n\nBest regards,\nMarian Zeis`;

        try {
          const session = await createSession();
          const pdsEndpoint = session.service[0].serviceEndpoint;

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
    console.error('Error:', error);
  }
})();
