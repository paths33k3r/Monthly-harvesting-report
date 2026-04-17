// scripts/cloudBackup.js
// Runs in GitHub Actions daily — no browser or PC needed.
// Reads all Firebase Realtime Database data and uploads a JSON backup to Google Drive.

import admin from 'firebase-admin';
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
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://ffb-harvesting-report-default-rtdb.asia-southeast1.firebasedatabase.app"
        });
    }

    const db = admin.database();

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
    if (!clientId || !clientSecret || !refreshToken || !driveFolderId) {
        console.log("Google Drive secrets not configured — skipping Drive upload.");
        console.log("Backup is saved as a GitHub Actions artifact.");
        return;
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
        console.error("Google Drive upload failed:", driveErr.message);
        console.log("Backup is still saved as a GitHub Actions artifact.");
    }

    console.log("Backup process complete.");
}

runBackup().catch(err => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
