# **Bluesky SCN HD Bot**

A Node.js script that checks the SAP Community Network (SCN) RSS feed every 60 minutes and posts new high-quality blog entries to your [Bluesky](https://bsky.app/) account. This bot uses the custom RSS proxy at `rss-scn.marianzeis.de` to fetch blog posts from the SAP Technology Blog board. Replies are automatically filtered out so only original blog posts are published.

## **Features**

- **Automated Posting**: Automatically fetches new blog posts from the SCN RSS proxy feed:
  - **SAP Technology Blog**: `https://rss-scn.marianzeis.de/api/messages?board.id=technology-blog-sap&conversation.style=blog`
- **Reply Filtering**: Automatically filters out replies (titles starting with "Re:") to only post original blog entries.
- **Metadata Inclusion**:
  - **Author**: Includes the author's name.
- **Rate Limiting**: Respects a rate limit of one post every 30 seconds.
- **Check Interval**: Checks the feed every 60 minutes.
- **Duplicate Prevention**: Maintains a local record of posted blog entries with their Bluesky post IDs to avoid duplicates.
- **Content Management**:
  - **HTML Stripping**: Strips HTML tags from descriptions to handle HTML content.
  - **Content Truncation**: Automatically truncates long posts to fit within Bluesky's character limit.

---

## **Prerequisites**

- **Node.js**: Version 18 or higher (for native `fetch` API support).
- **Bluesky Account**: A valid Bluesky username and password.

---

## **Installation**

1. **Install Dependencies**

   ```bash
   npm install
   ```

---

## **Configuration**

1. **Create a `.env` File**

   In the package directory, create a file named `.env`:

   ```bash
   touch .env
   ```

2. **Add Your Bluesky Credentials**

   Open the `.env` file and add your Bluesky username and password:

   ```env
   BLUESKY_USERNAME=your_bluesky_username
   BLUESKY_PASSWORD=your_bluesky_password
   ```

   **Note**: Replace `your_bluesky_username` and `your_bluesky_password` with your actual Bluesky credentials.

---

## **Running the Script**

### **Running Locally**

```bash
node index.js
```

### **Running in Production with PM2**

```bash
pm2 start index.js --name bluesky-scn-hd-bot
pm2 save
```

---

## **Logging and Monitoring**

- **View Logs**

  ```bash
  pm2 logs bluesky-scn-hd-bot
  ```

---

## **License**

This project is licensed under the MIT License.
