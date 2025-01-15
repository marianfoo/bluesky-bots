require('dotenv').config();
const fs = require('fs').promises;
const axios = require('axios');
const { createSession, sendMessage } = require('./index.js');

// Create axios instance for Bluesky API
const blueSkySocialAPI = axios.create({
  baseURL: 'https://bsky.social/xrpc',
});

async function loadApprovedFollowers() {
  try {
    const data = await fs.readFile('followers-needing-updates.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading followers:', error.message);
    return [];
  }
}

async function loadProgress() {
  try {
    const data = await fs.readFile('progress.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function getConvoForMembers(accountPDS, members) {
  const url = 'chat.bsky.convo.getConvoForMembers';

  const response = await blueSkySocialAPI.get(url, {
    params: {
      members: members,
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

async function main() {
  const isTestMode = process.argv.includes('--test');
  // Get count parameter, default to Infinity if not specified
  const countArg = process.argv.find(arg => arg.startsWith('--count='));
  const maxMessages = countArg ? parseInt(countArg.split('=')[1]) : Infinity;
  
  try {
    // Get followers needing updates
    const followers = await loadApprovedFollowers();
    const progress = await loadProgress();

    if (isTestMode) {
      // Test mode: Show sample messages and send to test bot
      const testCases = [
        { handle: 'test.user', needsDisplayNameUpdate: true, needsAvatarUpdate: true },
        { handle: 'test.user', needsDisplayNameUpdate: true, needsAvatarUpdate: false },
        { handle: 'test.user', needsDisplayNameUpdate: false, needsAvatarUpdate: true },
      ];

      console.log('Test Mode - Sample Messages:');
      testCases.forEach(testCase => {
        const message = getMessageText(testCase);
        console.log(`\nScenario: ${JSON.stringify(testCase)}`);
        console.log(`Message: ${message}`);
      });

      try {
        // Send test message to bot
        const session = await createSession();
        blueSkySocialAPI.defaults.headers.common['Authorization'] = `Bearer ${session.accessJwt}`;
        
        const pdsEndpoint = session.service[0].serviceEndpoint;
        const testBot = { 
          handle: 'ui5-versions-bot.marianzeis.de',
          did: 'did:plc:2gtexo4dtoufqyz5nrths4vs',
          needsDisplayNameUpdate: true,
          needsAvatarUpdate: true
        };

        console.log(`\nSending test message to ${testBot.handle}...`);
        const messageText = getMessageText(testBot);
        const convoResponse = await getConvoForMembers(pdsEndpoint, [session.did, testBot.did]);
        const convoId = convoResponse.convo.id;
        await sendMessage(pdsEndpoint, convoId, messageText);
        console.log('Test message sent successfully!');
      } catch (error) {
        console.error('Error in test mode:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          statusText: error.response?.statusText
        });
        process.exit(1);
      }
      return;
    }

    // Create session
    const session = await createSession();
    blueSkySocialAPI.defaults.headers.common['Authorization'] = `Bearer ${session.accessJwt}`;
    const pdsEndpoint = session.service[0].serviceEndpoint;
    
    console.log(`Found ${followers.length} followers to process`);
    console.log(`Will send maximum of ${maxMessages === Infinity ? 'unlimited' : maxMessages} messages`);

    let messagesSent = 0;

    for (const follower of followers) {
      // Stop if we've reached the maximum number of messages
      if (messagesSent >= maxMessages) {
        console.log(`Reached maximum message count of ${maxMessages}, stopping...`);
        break;
      }

      // Skip if we've already messaged them
      if (progress[follower.did]?.messageSent) {
        console.log(`Already messaged ${follower.handle}, skipping...`);
        continue;
      }

      console.log(`Processing ${follower.handle}...`);

      try {
        const messageText = getMessageText(follower);

        // Get or create conversation
        const convoResponse = await getConvoForMembers(pdsEndpoint, [session.did, follower.did]);
        const convoId = convoResponse.convo.id;

        // Send message
        await sendMessage(pdsEndpoint, convoId, messageText);
        console.log(`Message sent to ${follower.handle}`);
        messagesSent++;

        // Update progress
        progress[follower.did] = {
          ...progress[follower.did],
          messageSent: true,
          messageSentAt: new Date().toISOString()
        };
        await fs.writeFile('progress.json', JSON.stringify(progress, null, 2));

        // Add delay between messages
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing ${follower.handle}:`, error.message);
        continue;
      }
    }

    console.log(`Finished processing. Sent ${messagesSent} messages.`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// New helper function to generate message text
function getMessageText(follower) {
  const intro = "Hey, thanks for following and being part of the SAP community here on Bluesky! Together we can make this space even better.";
  const profileDesc = "A detailed profile description would also be helpful for everyone.";
  const outro = "\nRegards Marian\n\n[This is an automated message sent by a bot]";
  
  if (follower.needsDisplayNameUpdate && follower.needsAvatarUpdate) {
    return `${intro}It would be great if you used a profile picture instead of the default picture and a different display name. Of course you don't have to, but it would make it much easier to recognise each other. ${profileDesc}\n\nThanks in advance${outro}`;
  } else if (follower.needsDisplayNameUpdate) {
    return `${intro}It would be great if you used a different display name. Of course you don't have to, but it would make it much easier to recognise each other. ${profileDesc}\n\nThanks in advance${outro}`;
  } else if (follower.needsAvatarUpdate) {
    return `${intro}It would be great if you used a profile picture instead of the default picture. Of course you don't have to, but it would make it much easier to recognise each other. ${profileDesc}\nThanks in advance${outro}`;
  }
  return "";
}

if (require.main === module) {
  main();
} 