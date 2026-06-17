// scripts/cloudBackup.js
// Runs in GitHub Actions daily — no browser or PC needed.
// Reads all Firebase Realtime Database data and uploads a JSON backup to Google Drive.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { google } from 'googleapis';
import { writeFileSync } from 'fs';

async function runBackup() {
    console.log("Starting automated cloud-to-cloud backup...");

    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
    const clientId          = process.env.GDRIVE_CLIENT_ID;
    const clientSecret      = process.env.GDRIVE_CLIENT_SECRET;
    const refreshToken      = process.env.GDRIVE_REFRESH_TOKEN;
    const driveFolderId     = process.env.GDRIVE_FOLDER_ID;

    if (!serviceAccountVar) {
        console.error("Error: FIREBASE_SERVICE_ACCOUNT secret is not set.");
        process.exit(1);
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountVar);
    } catch (e) {
        console.error("Error: FIREBASE_SERVICE_ACCOUNT is not valid JSON.", e.message);
        process.exit(1);
    }

    // --- Step 1: Read from Firebase Realtime Database ---
    // Use the modular firebase-admin API (firebase-admin/app + /database).
    // The legacy default-export namespace (`admin.apps` / `admin.database()`)
    // changed shape in a newer release and broke this script on 2026-06-09
    // ("Cannot read properties of undefined (reading 'length')" at admin.apps).
    // The modular subpath exports are the stable, recommended interface and
    // are pinned via package.json so an upstream release can't silently break us.
    if (!getApps().length) {
        initializeApp({
            credential: cert(serviceAccount),
            databaseURL: "https://ffb-harvesting-report-default-rtdb.asia-southeast1.firebasedatabase.app"
        });
    }

    const db = getDatabase();

    console.log("  Reading database...");
    const snapshot = await db.ref('/').once('value');
    const backupData = snapshot.val() || {};

    const userCount      = Object.keys(backupData.users       || {}).length;
    const userRoleCount  = Object.keys(backupData.user_roles  || {}).length;

    console.log(`  Users:      ${userCount}`);
    console.log(`  User roles: ${userRoleCount}`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename  = `harvesting_backup_${timestamp}.json`;
    const jsonContent = JSON.stringify(backupData, null, 2);

    writeFileSync(filename, jsonContent);
    console.log(`Backup file created: ${filename} (${(jsonContent.length / 1024).toFixed(1)} KB)`);

    // --- Step 2: Upload to Google Drive ---
    // The local file (written above) is always uploaded as a GitHub Actions
    // artifact by the workflow's upload-artifact step, so it survives even if
    // the Drive upload below fails. We still treat a Drive failure as a hard
    // error (exit 1) so the workflow goes red and GitHub emails the owner —
    // a silently-succeeding job that uploads nothing is the worst outcome.
    if (!clientId || !clientSecret || !refreshToken || !driveFolderId) {
        console.error("Error: Google Drive secrets are not fully configured.");
        console.error("Missing one of: GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, GDRIVE_FOLDER_ID.");
        console.error("The backup artifact was still produced, but nothing was uploaded to Drive.");
        process.exit(1);
    }

    try {
        console.log("Uploading to Google Drive folder...");

        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const response = await drive.files.create({
            requestBody: {
                name: filename,
                parents: [driveFolderId],
            },
            media: {
                mimeType: 'application/json',
                body: jsonContent,
            },
            fields: 'id, name, size',
        });

        console.log(`Google Drive upload successful!`);
        console.log(`  File:     ${response.data.name}`);
        console.log(`  Drive ID: ${response.data.id}`);
        console.log(`  Size:     ${(parseInt(response.data.size) / 1024).toFixed(1)} KB`);

    } catch (driveErr) {
        console.error("Google Drive upload FAILED:", driveErr.message);
        if (/invalid_grant|token has been expired|revoked/i.test(driveErr.message || '')) {
            console.error("This usually means GDRIVE_REFRESH_TOKEN has expired or been revoked.");
            console.error("If your Google OAuth consent screen is in 'Testing' mode, refresh tokens");
            console.error("expire after 7 days. Set the consent screen to 'In production' and");
            console.error("regenerate the token with scripts/getGoogleToken.js, then update the secret.");
        }
        console.error("The backup artifact was still produced for this run.");
        process.exit(1); // fail loudly so the workflow turns red and notifies the owner
    }

    console.log("Backup process complete.");
    process.exit(0);
}

runBackup().catch(err => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
