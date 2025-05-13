import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME;
const UPLOAD_EXPIRES_IN = 300; // 5 minutes for upload URL
const DOWNLOAD_EXPIRES_IN = 300; // 5 minutes for download URL

export const handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    const httpMethod = event.requestContext?.http?.method || event.httpMethod;
    const path = event.requestContext?.http?.path || event.path;

    try {
        if (httpMethod === "GET" && path === "/") {
            return await listFilesAndServeHtml();
        } else if (httpMethod === "POST" && path === "/get-upload-url") {
            const body = JSON.parse(event.body || "{}");
            const { fileName, contentType } = body;
            if (!fileName || !contentType) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "fileName and contentType are required" }),
                    headers: { "Content-Type": "application/json" },
                };
            }
            return await getUploadUrl(fileName, contentType);
        } else if (httpMethod === "POST" && path === "/get-download-url") {
            const body = JSON.parse(event.body || "{}");
            const { fileKey } = body;
            if (!fileKey) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "fileKey is required" }),
                    headers: { "Content-Type": "application/json" },
                };
            }
            return await getDownloadUrl(fileKey);
        }

        return {
            statusCode: 404,
            body: JSON.stringify({ message: "Not Found" }),
            headers: { "Content-Type": "application/json" },
        };
    } catch (error) {
        console.error("Error processing request:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal Server Error", message: error.message }),
            headers: { "Content-Type": "application/json" },
        };
    }
};

async function listFilesAndServeHtml() {
    const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME });
    const { Contents = [] } = await s3Client.send(command);

    const fileListItems = Contents.map(
        (item) => `
        <li>
            ${item.Key} (${(item.Size / 1024).toFixed(2)} KB)
            <button onclick="downloadFile('${item.Key}')">Download</button>
        </li>`
    ).join("");

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>S3 File Manager</title>
            <style>
                body { font-family: sans-serif; margin: 20px; }
                .upload-section { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; }
                ul { list-style-type: none; padding: 0; }
                li { margin-bottom: 10px; padding: 5px; border: 1px solid #eee; }
                button { margin-left: 10px; }
            </style>
        </head>
        <body>
            <h1>S3 File Manager</h1>
            <div class="upload-section">
                <h2>Upload File</h2>
                <input type="file" id="fileInput" />
                <button onclick="uploadFile()">Upload</button>
                <p id="uploadStatus"></p>
            </div>
            <h2>Uploaded Files</h2>
            <ul id="fileList">${fileListItems}</ul>

            <script>
                async function uploadFile() {
                    const fileInput = document.getElementById('fileInput');
                    const file = fileInput.files[0];
                    const statusElement = document.getElementById('uploadStatus');
                    if (!file) {
                        statusElement.textContent = 'Please select a file first.';
                        return;
                    }
                    statusElement.textContent = 'Getting upload URL...';
                    try {
                        const response = await fetch('get-upload-url', { // Removed leading slash
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fileName: file.name, contentType: file.type })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Failed to get upload URL');
                        
                        statusElement.textContent = 'Uploading...';
                        await fetch(data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
                        statusElement.textContent = 'Upload successful! Refreshing list...';
                        location.reload(); // Simple refresh
                    } catch (err) {
                        console.error('Upload error:', err);
                        statusElement.textContent = 'Upload failed: ' + err.message;
                    }
                }

                async function downloadFile(fileKey) {
                    try {
                        const response = await fetch('get-download-url', { // Removed leading slash
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fileKey })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Failed to get download URL');
                        window.open(data.downloadUrl, '_blank'); // Open download link in new tab
                    } catch (err) {
                        console.error('Download error:', err);
                        alert('Failed to get download link: ' + err.message);
                    }
                }
            </script>
        </body>
        </html>
    `;
    return { statusCode: 200, body: html, headers: { "Content-Type": "text/html" } };
}

async function getUploadUrl(fileName, contentType) {
    const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: fileName, ContentType: contentType });
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: UPLOAD_EXPIRES_IN });
    return { statusCode: 200, body: JSON.stringify({ uploadUrl }), headers: { "Content-Type": "application/json" } };
}

async function getDownloadUrl(fileKey) {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileKey });
    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: DOWNLOAD_EXPIRES_IN });
    return { statusCode: 200, body: JSON.stringify({ downloadUrl }), headers: { "Content-Type": "application/json" } };
}