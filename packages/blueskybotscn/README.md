# **Bluesky SCN Bot**

A Node.js script that checks the SAP Community Network (SCN) RSS feeds every 60 minutes and posts new blog entries to your [Bluesky](https://bsky.app/) account. The bot includes metadata like the blog source (by SAP or by Members), author, and maintains a local list of posted entries to avoid duplicates. It respects Bluesky's rate limits and supports automated deployment via GitHub Actions.

## **Table of Contents**

- [**Bluesky SCN Bot**](#bluesky-scn-bot)
  - [**Table of Contents**](#table-of-contents)
  - [**Features**](#features)
  - [**Prerequisites**](#prerequisites)
  - [**Installation**](#installation)
  - [**Configuration**](#configuration)
  - [**Running the Script**](#running-the-script)
    - [**Running Locally**](#running-locally)
    - [**Running in Production**](#running-in-production)
      - [**1. Install PM2 Globally**](#1-install-pm2-globally)
      - [**2. Start the Script with PM2**](#2-start-the-script-with-pm2)
      - [**3. Configure PM2 to Run on Startup**](#3-configure-pm2-to-run-on-startup)
      - [**4. Save the PM2 Process List**](#4-save-the-pm2-process-list)
  - [**Automated Deployment**](#automated-deployment)
    - [**Setup**](#setup)
    - [**Usage**](#usage)
  - [**Updating the Script in Production**](#updating-the-script-in-production)
    - [**1. SSH into Your Server**](#1-ssh-into-your-server)
    - [**2. Navigate to Your Project Directory**](#2-navigate-to-your-project-directory)
    - [**3. Stop the Running Script**](#3-stop-the-running-script)
    - [**4. Pull the Latest Changes from GitHub**](#4-pull-the-latest-changes-from-github)
    - [**5. Install Updated Dependencies**](#5-install-updated-dependencies)
    - [**6. Restart the Script with PM2**](#6-restart-the-script-with-pm2)
    - [**7. Save the PM2 Process List**](#7-save-the-pm2-process-list)
  - [**Logging and Monitoring**](#logging-and-monitoring)
  - [**License**](#license)
  - [**Additional Information**](#additional-information)
  - [**Contact**](#contact)
  - [**Summary**](#summary)

---

## **Features**

- **Automated Posting**: Automatically fetches new blog posts from two SCN RSS feeds:
  - **SAP Technology Blog**: `https://community.sap.com/khhcw49343/rss/board?board.id=technology-blog-sap`
  - **Community Member Technology Blog**: `https://community.sap.com/khhcw49343/rss/board?board.id=technology-blog-members`
- **Metadata Inclusion**:
  - **Blog Source**: Indicates whether the post is by SAP or by Members.
  - **Author**: Includes the author's name.
- **Rate Limiting**: Respects a rate limit of one post every 30 seconds.
- **Check Interval**: Checks feeds every 60 minutes.
- **Duplicate Prevention**: Maintains a local record of posted blog entries with their Bluesky post IDs to avoid duplicates.
- **Content Management**:
  - **HTML Stripping**: Strips HTML tags from descriptions to handle HTML content.
  - **Content Truncation**: Automatically truncates long posts to fit within Bluesky's character limit.
- **Automated Deployment**:
  - Uses GitHub Actions workflow for automated deployment to your server via SSH.

---

## **Prerequisites**

- **Node.js**: Version 14 or higher (Node.js 18+ recommended for native `fetch` API support).
- **Bluesky Account**: A valid Bluesky username and password.
- **Git**: For cloning the repository and updating the script.
- **PM2**: For process management in production.
- **SSH Access**: For automated deployments using GitHub Actions.
- **Server**: A server (e.g., VPS) where the bot will run continuously.

---

## **Installation**

1. **Clone the Repository**

   ```bash
   git clone https://github.com/marianfoo/bluesky-rss-bot.git
   cd bluesky-rss-bot
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

---

## **Configuration**

1. **Create a `.env` File**

   In the project root directory, create a file named `.env`:

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

3. **Secure the `.env` File**

   Ensure the `.env` file is not tracked by Git by adding it to `.gitignore`:

   ```bash
   echo '.env' >> .gitignore
   ```

4. **Configure GitHub Secrets** (For Automated Deployment)

   If using the automated GitHub Actions deployment, set up the following secrets in your GitHub repository settings:

   - `SSH_IP`: Your server's IP address.
   - `SSH_USER`: SSH username (e.g., `root` or another user with deployment permissions).
   - `SSH_PRIVATE_KEY`: Your SSH private key (ensure it is properly formatted).

---

## **Running the Script**

### **Running Locally**

1. **Start the Script**

   ```bash
   node index.js
   ```

2. **Verify Output**

   The script should log messages indicating it has logged into Bluesky and is checking the RSS feeds.

### **Running in Production**

For production environments, it's recommended to use a process manager like **PM2** to keep the script running continuously.

#### **1. Install PM2 Globally**

```bash
npm install -g pm2
```

#### **2. Start the Script with PM2**

```bash
pm2 start index.js --name bluesky-scn-bot
```

#### **3. Configure PM2 to Run on Startup**

```bash
pm2 startup
```

Follow the instructions output by the command to enable PM2 to run on system startup.

#### **4. Save the PM2 Process List**

```bash
pm2 save
```

---

## **Automated Deployment**

The project includes a GitHub Actions workflow (`deploy.yaml`) for automated deployment to your server when changes are pushed to the `main` branch.

### **Setup**

1. **Configure SSH Access**

   - Ensure your server accepts SSH connections using a private key.
   - Add your SSH private key to GitHub Secrets as `SSH_PRIVATE_KEY`.
   - Add your server's IP address and SSH username to GitHub Secrets as `SSH_IP` and `SSH_USER`, respectively.

2. **GitHub Actions Workflow**

   The `deploy.yaml` workflow performs the following steps:

   - Checks out the repository.
   - Connects to your server via SSH.
   - Navigates to the bot directory.
   - Pulls the latest changes from the `main` branch.
   - Installs dependencies.
   - Restarts the bot using PM2.

### **Usage**

- **Trigger Deployment**

  - Simply push changes to the `main` branch:

    ```bash
    git add .
    git commit -m "Your commit message"
    git push origin main
    ```

- **Deployment Process**

  - The GitHub Actions workflow will automatically run and deploy the latest code to your server.

---

## **Updating the Script in Production**

If you prefer to update the script manually, follow these steps:

### **1. SSH into Your Server**

```bash
ssh your_username@your_server_ip
```

### **2. Navigate to Your Project Directory**

```bash
cd /path/to/bluesky-scn-bot
```

### **3. Stop the Running Script**

```bash
pm2 stop bluesky-scn-bot
```

### **4. Pull the Latest Changes from GitHub**

```bash
git pull origin main
```

### **5. Install Updated Dependencies**

If any dependencies have changed, install them:

```bash
npm install
```

### **6. Restart the Script with PM2**

```bash
pm2 start index.js --name bluesky-scn-bot
```

### **7. Save the PM2 Process List**

```bash
pm2 save
```

---

## **Logging and Monitoring**

- **View Logs**

  ```bash
  pm2 logs bluesky-scn-bot
  ```

- **Stream Logs**

  ```bash
  pm2 logs
  ```

- **Log Rotation**

  Install the PM2 log rotate module:

  ```bash
  pm2 install pm2-logrotate
  ```

  Configure log rotation settings:

  ```bash
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 7
  ```

---

## **License**

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## **Additional Information**

- **Data Persistence**

  - The script uses `posted_ids.json` to keep track of posted blog entries.
  - Ensure this file is backed up if necessary.
  - The file stores a mapping of RSS item IDs to their corresponding Bluesky post IDs.

- **Security Considerations**

  - Keep your `.env` file secure and never commit it to version control.
  - Regularly update dependencies to patch security vulnerabilities.
  - Use SSH keys instead of passwords for server access.

- **Error Handling**

  - The script includes basic error handling and will log errors without crashing.
  - Consider enhancing error handling as needed for your production environment.

- **Contributions**

  - Contributions are welcome! Please open issues or submit pull requests for improvements.

---

## **Contact**

- **Author**: marianfoo
- **Email**: [marian@marianzeis.de](mailto:marian@marianzeis.de)

---

## **Summary**

The **Bluesky SCN Bot** script automates the process of fetching new blog posts from the SAP Community Network and posting them to your Bluesky account. It handles multiple RSS feeds, includes metadata like the blog source and author, and ensures posts comply with Bluesky's character limit. The script supports automated deployment using GitHub Actions, making it easy to keep your production environment up-to-date.

By following the steps outlined above, you can set up, run, and maintain the bot in both development and production environments.

---

**If you have any questions or need further assistance, feel free to contact the repository maintainer.**
