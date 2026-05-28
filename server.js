/**
 * CLOUDDRIVE EXPRESS SERVER
 * Backend controller for handling file operations, storage synchronization,
 * and routing, integrating Azure Blob Storage with Local Storage fallback.
 */

const express = require('express');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'uploads';
const AZURE_CONN_STR = process.env.AZURE_STORAGE_CONNECTION_STRING;
const LOCAL_STORAGE_DIR = path.join(__dirname, 'local_storage');

// Maximum File Size (10 MB)
const MAX_FILE_SIZE_MB = 10;

// Setup Multer memory storage (buffers are sent directly to Azure without intermediate disk writes)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } // 10MB
});

let useAzure = false;
let containerClient = null;

// Initialize Azure Storage if credentials are provided
if (AZURE_CONN_STR && AZURE_CONN_STR.trim()) {
    try {
        const { BlobServiceClient } = require('@azure/storage-blob');
        const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONN_STR);
        containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
        
        // Asynchronous initialization checks
        (async () => {
            try {
                // Attempt to create container with public blob read access
                await containerClient.createIfNotExists({ accessPolicy: 'blob' });
                console.log(`Azure Blob container "${CONTAINER_NAME}" created/verified with public blob access.`);
            } catch (err) {
                // Fallback to private container if policy restricts public anonymous access
                console.log(`Failed to configure public container due to policy: ${err.message}. Creating private container...`);
                try {
                    await containerClient.createIfNotExists();
                    console.log(`Azure Blob container "${CONTAINER_NAME}" verified as PRIVATE.`);
                } catch (innerErr) {
                    console.error(`Failed to instantiate private container: ${innerErr.message}`);
                }
            }
        })();
        
        useAzure = true;
        console.log("Successfully connected and initialized Azure Blob Storage integration.");
    } catch (err) {
        console.error("Failed to connect to Azure Blob Storage SDK:", err);
        console.log("Falling back to local disk storage for demo mode...");
    }
} else {
    console.log("No AZURE_STORAGE_CONNECTION_STRING found in environmental config.");
    console.log("Running in DEMO MODE with Local Storage fallback.");
}

// Guarantee local storage folder existence if Azure is inactive
if (!useAzure) {
    if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
        fs.mkdirSync(LOCAL_STORAGE_DIR);
        console.log(`Created local storage directory at: ${LOCAL_STORAGE_DIR}`);
    }
}

// Serve Static files (style.css, main.js) from the static folder
app.use('/static', express.static(path.join(__dirname, 'static')));

// Serve uploads folder locally when running in local storage fallback
if (!useAzure) {
    app.use('/local_storage', express.static(LOCAL_STORAGE_DIR));
}

// --- ENDPOINTS ---

// 1. Root route - Serve Web Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// 2. Status check endpoint (tells JS if Azure or Local is active)
app.get('/api/status', (req, res) => {
    res.json({
        status: 'success',
        storage_mode: useAzure ? 'Azure' : 'Local',
        container_name: useAzure ? CONTAINER_NAME : 'local_storage',
        is_azure_configured: useAzure
    });
});

// 3. File Listing Endpoint
app.get('/api/files', async (req, res) => {
    const files = [];
    
    if (useAzure) {
        try {
            // Iterate flat list of blobs
            for await (const blob of containerClient.listBlobsFlat()) {
                const blobClient = containerClient.getBlobClient(blob.name);
                files.push({
                    name: blob.name,
                    size: blob.properties.contentLength,
                    last_modified: blob.properties.lastModified.toISOString(),
                    url: blobClient.url, // Direct Azure storage url
                    download_url: `/api/download/${encodeURIComponent(blob.name)}`, // Proxy download route
                    storage: 'Azure'
                });
            }
        } catch (err) {
            return res.status(500).json({
                status: 'error',
                message: `Azure list retrieval failure: ${err.message}`
            });
        }
    } else {
        // Read local files
        try {
            const filenames = fs.readdirSync(LOCAL_STORAGE_DIR);
            for (const filename of filenames) {
                const filePath = path.join(LOCAL_STORAGE_DIR, filename);
                const stat = fs.statSync(filePath);
                
                if (stat.isFile()) {
                    const localUrl = `${req.protocol}://${req.get('host')}/local_storage/${encodeURIComponent(filename)}`;
                    files.push({
                        name: filename,
                        size: stat.size,
                        last_modified: stat.mtime.toISOString(),
                        url: localUrl,
                        download_url: localUrl,
                        storage: 'Local'
                    });
                }
            }
        } catch (err) {
            return res.status(500).json({
                status: 'error',
                message: `Local directory read failure: ${err.message}`
            });
        }
    }
    
    // Sort by last modified descending (newest first)
    files.sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified));
    
    res.json({
        status: 'success',
        files: files
    });
});

// 4. File Upload Endpoint (Uses custom Multer handler for size limit checks)
app.post('/api/upload', (req, res, next) => {
    upload.single('file')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    status: 'error',
                    message: `File exceeds the maximum limit of ${MAX_FILE_SIZE_MB}MB.`
                });
            }
            return res.status(400).json({ status: 'error', message: err.message });
        } else if (err) {
            return res.status(500).json({ status: 'error', message: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'No file part in the request' });
    }
    
    const file = req.file;
    // Replace non-alphanumeric and dot characters with underscores to sanitize filenames
    let filename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    if (!filename) {
        filename = `upload_${Date.now()}`;
    }
    
    if (useAzure) {
        try {
            const blockBlobClient = containerClient.getBlockBlobClient(filename);
            
            // Upload memory buffer directly, mapping proper content type headers
            await blockBlobClient.uploadData(file.buffer, {
                blobHTTPHeaders: {
                    blobContentType: file.mimetype
                }
            });
            
            res.json({
                status: 'success',
                message: 'File uploaded successfully to Azure Blob Storage!',
                file: {
                    name: filename,
                    size: file.size,
                    url: blockBlobClient.url,
                    download_url: `/api/download/${encodeURIComponent(filename)}`,
                    storage: 'Azure'
                }
            });
        } catch (err) {
            res.status(500).json({
                status: 'error',
                message: `Failed uploading to Azure container: ${err.message}`
            });
        }
    } else {
        // Local upload saving
        try {
            const filePath = path.join(LOCAL_STORAGE_DIR, filename);
            fs.writeFileSync(filePath, file.buffer);
            
            const localUrl = `${req.protocol}://${req.get('host')}/local_storage/${encodeURIComponent(filename)}`;
            
            res.json({
                status: 'success',
                message: 'File uploaded successfully to local storage (Demo Mode)!',
                file: {
                    name: filename,
                    size: file.size,
                    url: localUrl,
                    download_url: localUrl,
                    storage: 'Local'
                }
            });
        } catch (err) {
            res.status(500).json({
                status: 'error',
                message: `Failed writing local file: ${err.message}`
            });
        }
    }
});

// 5. Delete File Endpoint
app.delete('/api/files/:filename', async (req, res) => {
    const filename = req.params.filename;
    
    if (useAzure) {
        try {
            const blockBlobClient = containerClient.getBlockBlobClient(filename);
            const exists = await blockBlobClient.exists();
            
            if (exists) {
                await blockBlobClient.delete();
                res.json({
                    status: 'success',
                    message: `File '${filename}' successfully deleted from Azure Blob Storage.`
                });
            } else {
                res.status(404).json({ status: 'error', message: 'File not found in storage container.' });
            }
        } catch (err) {
            res.status(500).json({
                status: 'error',
                message: `Failed deleting from Azure container: ${err.message}`
            });
        }
    } else {
        // Local Disk delete
        try {
            const filePath = path.join(LOCAL_STORAGE_DIR, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                res.json({
                    status: 'success',
                    message: `File '${filename}' successfully deleted from local storage.`
                });
            } else {
                res.status(404).json({ status: 'error', message: 'File not found in local storage.' });
            }
        } catch (err) {
            res.status(500).json({
                status: 'error',
                message: `Failed deleting local file: ${err.message}`
            });
        }
    }
});

// 6. Download / Proxy Endpoint
// Retrieves blob stream from Azure, allowing downloads even if the Azure container is private.
app.get('/api/download/:filename', async (req, res) => {
    const filename = req.params.filename;
    
    if (useAzure) {
        try {
            const blobClient = containerClient.getBlobClient(filename);
            const exists = await blobClient.exists();
            
            if (!exists) {
                return res.status(404).send('File not found in storage container.');
            }
            
            const properties = await blobClient.getProperties();
            const downloadResponse = await blobClient.download(0);
            
            // Set download headers
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', properties.contentType || 'application/octet-stream');
            
            // Stream the download response directly to client res
            downloadResponse.readableStreamBody.pipe(res);
        } catch (err) {
            res.status(500).send(`Error downloading blob from Azure: ${err.message}`);
        }
    } else {
        // Local download fallback
        const filePath = path.join(LOCAL_STORAGE_DIR, filename);
        if (fs.existsSync(filePath)) {
            res.download(filePath);
        } else {
            res.status(404).send('File not found in local storage.');
        }
    }
});

// Start listening
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`CloudDrive application server successfully started!`);
    console.log(`Local web address: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
