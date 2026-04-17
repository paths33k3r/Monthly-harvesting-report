// scripts/getGoogleToken.js
// Run this ONCE locally to get your Google Drive refresh token.
// Usage: node scripts/getGoogleToken.js
//
// Before running:
//   1. Go to Google Cloud Console → APIs & Services → Credentials
//      (use the ffb-harvesting-report project)
//   2. Click "Create Credentials" → "OAuth 2.0 Client ID"
//   3. Application type: "Desktop app" → name it "Harvesting Backup Script" → Create
//   4. Copy the Client ID and Client Secret shown
//   5. Run one of the commands below:
//
//   Windows CMD:
//   set GDRIVE_CLIENT_ID=your_client_id && set GDRIVE_CLIENT_SECRET=your_client_secret && node scripts/getGoogleToken.js
//
//   Windows PowerShell:
//   $env:GDRIVE_CLIENT_ID="your_client_id"; $env:GDRIVE_CLIENT_SECRET="your_client_secret"; node scripts/getGoogleToken.js

import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';

const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('\nMissing credentials. Run like this:\n');
    console.error('  Windows CMD:');
    console.error('  set GDRIVE_CLIENT_ID=your_client_id && set GDRIVE_CLIENT_SECRET=your_client_secret && node scripts/getGoogleToken.js\n');
    console.error('  Windows PowerShell:');
    console.error('  $env:GDRIVE_CLIENT_ID="your_client_id"; $env:GDRIVE_CLIENT_SECRET="your_client_secret"; node scripts/getGoogleToken.js\n');
    process.exit(1);
}

const REDIRECT_URI = 'http://localhost:9876';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent',
});

console.log('\n========================================');
console.log(' Google Drive Token Generator');
console.log(' Harvesting Report Backup');
console.log('========================================\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Log in with your Google account and click Allow.');
console.log('3. This script will capture the token automatically.\n');
console.log('Waiting for login...\n');

const server = createServer(async (req, res) => {
    try {
        const url   = new URL(req.url, REDIRECT_URI);
        const code  = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h2>Access denied. You can close this tab.</h2>');
            server.close();
            console.error('Access was denied:', error);
            process.exit(1);
        }

        if (!code) return;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2 style="font-family:sans-serif;color:green">✅ Success! You can close this tab and check the terminal.</h2>');
        server.close();

        const { tokens } = await oauth2Client.getToken(code);

        console.log('========================================');
        console.log(' ✅ SUCCESS! Add these as GitHub Secrets');
        console.log(' in the Monthly Harvesting Report repo:');
        console.log('========================================\n');
        console.log('Secret name: GDRIVE_CLIENT_ID');
        console.log('Value:', CLIENT_ID);
        console.log('');
        console.log('Secret name: GDRIVE_CLIENT_SECRET');
        console.log('Value:', CLIENT_SECRET);
        console.log('');
        console.log('Secret name: GDRIVE_REFRESH_TOKEN');
        console.log('Value:', tokens.refresh_token);
        console.log('\n----------------------------------------');
        console.log('Also add:');
        console.log('  FIREBASE_SERVICE_ACCOUNT — from Firebase Console →');
        console.log('  Project Settings → Service Accounts → Generate new private key');
        console.log('');
        console.log('  GDRIVE_FOLDER_ID — the ID of the "Harvesting Report Backups"');
        console.log('  folder in Google Drive (from the folder URL)');
        console.log('----------------------------------------\n');
        console.log('Keep these values private and secure.');

    } catch (e) {
        console.error('Failed to get token:', e.message);
        server.close();
        process.exit(1);
    }
});

server.listen(9876, () => {
    console.log('(Listening on http://localhost:9876 for Google redirect...)\n');
});
