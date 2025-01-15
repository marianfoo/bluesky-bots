const fs = require('fs').promises;
const path = require('path');
const { isDefaultAvatar } = require('../index');

describe('Avatar Tests', () => {
  let testUser;
  
  beforeAll(() => {
    testUser = {
      did: "did:plc:vf2flcoh42ttpdhay4s76me7",
      handle: "ufuksezgin.bsky.social",
      displayName: "",
      avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:vf2flcoh42ttpdhay4s76me7/bafkreibggfw2oz2uf7y4shtilsex5xzdojmzj7cb2p5cptiv564mvqhvbq@jpeg",
      viewer: {
        muted: false,
        blockedBy: false,
        followedBy: "at://did:plc:vf2flcoh42ttpdhay4s76me7/app.bsky.graph.follow/3lfrbkarbeb2j",
      },
      labels: [],
      createdAt: "2025-01-15T07:46:36.812Z",
      indexedAt: "2025-01-15T07:46:36.812Z",
    };
  });

  test('User object has required avatar properties', () => {
    expect(testUser).toHaveProperty('avatar');
    expect(typeof testUser.avatar).toBe('string');
    expect(testUser.avatar).toMatch(/^https?:\/\//);
  });

  test('Avatar URL is properly formatted', () => {
    const avatarUrl = new URL(testUser.avatar);
    expect(avatarUrl.protocol).toMatch(/^https?:/);
    expect(avatarUrl.hostname).toBeTruthy();
    expect(avatarUrl.pathname).toBeTruthy();
  });

  test('Default avatars are correctly identified', async () => {
    const defaultPicturesPath = path.join(__dirname, 'default_pictures');
    const files = await fs.readdir(defaultPicturesPath);
    const imageFiles = files.filter(file => /\.(jpg|jpeg|png)$/i.test(file));
    
    expect(imageFiles.length).toBeGreaterThan(0, 'No default avatar images found for testing');

    for (const file of imageFiles) {
      const imagePath = path.join(defaultPicturesPath, file);
      const imageBuffer = await fs.readFile(imagePath);
      const result = await isDefaultAvatar(imageBuffer);
      
      console.log(`Testing default avatar: ${file}`);
      console.log(`Result: ${result ? 'Default' : 'Custom'}`);
      
      if (!result) {
        console.log(`❌ Failed: ${file} was incorrectly identified as a custom avatar`);
      } else {
        console.log(`✅ Passed: ${file} was correctly identified as a default avatar`);
      }
      
      expect(result).toBe(true, `Failed to identify ${file} as a default avatar`);
    }
  }, 30000);

  test('Custom avatars are correctly identified', async () => {
    const newPicturesPath = path.join(__dirname, 'new_pictures');
    const files = await fs.readdir(newPicturesPath);
    const imageFiles = files.filter(file => /\.(jpg|jpeg|png)$/i.test(file));
    
    expect(imageFiles.length).toBeGreaterThan(0, 'No custom avatar images found for testing');

    for (const file of imageFiles) {
      const imagePath = path.join(newPicturesPath, file);
      const imageBuffer = await fs.readFile(imagePath);
      const result = await isDefaultAvatar(imageBuffer);
      
      console.log(`Testing custom avatar: ${file}`);
      console.log(`Result: ${result ? 'Default' : 'Custom'}`);
      
      if (result) {
        console.log(`❌ Failed: ${file} was incorrectly identified as a default avatar`);
      } else {
        console.log(`✅ Passed: ${file} was correctly identified as a custom avatar`);
      }
      
      expect(result).toBe(false, `Failed to identify ${file} as a custom avatar`);
    }
  }, 30000);

  test('Handles invalid image data', async () => {
    const invalidBuffer = Buffer.from('not an image');
    await expect(isDefaultAvatar(invalidBuffer)).rejects.toThrow();
  });
}); 