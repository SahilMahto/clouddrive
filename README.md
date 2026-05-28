# CloudDrive - Mini Azure Cloud File Drive Web App

CloudDrive is a lightweight, responsive, and modern file management portal built using **Python Flask** and **Azure Blob Storage**. It mimics core elements of Google Drive by allowing users to upload files (PDFs, images, documents, and archives), view them in an interactive grid, download them, copy their cloud URL, and delete them.

---

## Technical Stack & Features

- **Backend**: Python 3 with Flask, `azure-storage-blob` SDK for Azure communications, and `python-dotenv` for configuration management.
- **Frontend**: Plain HTML5, CSS3, and modern JavaScript (no heavy node frameworks or frontend compilation). It uses standard CSS Custom Variables for Dark/Light theme shifts, CSS Grid/Flexbox layouts, and custom glassmorphism panels.
- **Progress Tracking**: Tracks upload progress in real-time using standard browser XMLHttpRequest (XHR) event listeners (featuring custom progress percentages and animated loading bars).
- **Graceful Local Fallback**: If Azure credentials are not specified, the app automatically runs in **Demo Mode**, saving uploaded files to a local folder (`local_storage/`).

---

## Project Structure

```
├── app.py                      # Flask Server & Core API Routes
├── requirements.txt            # Python Dependencies
├── .env.template               # Template for Environment Configuration
├── .env                        # Local Environment Config (Git Ignored)
├── README.md                   # Setup and Deployment Instructions
├── local_storage/              # Created automatically in local mode
├── templates/
│   └── index.html              # Main User Interface Structure
└── static/
    ├── style.css               # Styling System (Aesthetics, Responsive layout)
    └── main.js                 # Client Event Handlers & API Operations
```

---

## Local Setup & Quick Start

### 1. Prerequisites
Ensure you have **Python 3.8+** installed on your system.

### 2. Clone/Copy Project & Install Dependencies
Open a terminal in the project directory and run:

```bash
# 1. Create a Python virtual environment
python -m venv venv

# 2. Activate the virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# 3. Install required packages
pip install -r requirements.txt
```

### 3. Run the Application (Demo Mode)
You can instantly run and test the portal locally without setting up Azure first:

```bash
python app.py
```
Open your browser and navigate to `http://localhost:8080` (or the port specified in the console). You can drag and drop files and delete them instantly. They will be saved to the newly created `local_storage/` folder.

---

## Azure Storage Integration Setup

To connect the application to your actual Azure cloud storage:

### 1. Create an Azure Storage Account
1. Open the [Azure Portal](https://portal.azure.com/) and sign in.
2. Search for **Storage accounts** in the top search bar and click **Create**.
3. Fill in the required details:
   - **Subscription**: Select your active Azure subscription.
   - **Resource Group**: Create a new group (e.g., `clouddrive-rg`).
   - **Storage account name**: Provide a globally unique name (lower-case letters and numbers only, e.g., `mystorageaccount123`).
   - **Region**: Choose a region close to you.
   - **Performance**: Select **Standard** and **LRS** (Locally Redundant Storage) for cost-efficiency.
4. Click **Review + Create**, then click **Create**. Wait for deployment to complete.

### 2. Retrieve the Connection String
1. Go to your new Storage Account in the Azure Portal.
2. In the left navigation menu, scroll down to **Security + networking** and click **Access keys**.
3. Click **Show** next to **Connection string** under **key1**.
4. Copy the entire connection string. It will start with `DefaultEndpointsProtocol=https;AccountName=...`

### 3. Configure local `.env` File
Open the `.env` file in your project directory and set the copied connection string:

```env
AZURE_STORAGE_CONNECTION_STRING="PASTE_YOUR_COPIED_CONNECTION_STRING_HERE"
AZURE_CONTAINER_NAME="uploads"
PORT=8080
```

### 4. Enable Public Read Access (Important for Direct Downloads)
By default, Azure Storage Account blocks public anonymous read access. To let users download blobs directly via their Azure URLs:
1. In your Storage Account page on the portal, scroll down to **Settings** and click **Configuration**.
2. Locate **Allow Blob anonymous access** and set it to **Enabled**.
3. Click **Save** at the top.
4. Now, go to the **Data storage** -> **Containers** menu, click the `...` next to your `uploads` container (the app creates it on startup if not present), select **Change access level**, and select **Blob (anonymous read access for blobs only)**.

*Note: If your subscription policies strictly prevent enabling public blob access, don't worry. The app contains a built-in proxy download API route (`/api/download/<filename>`) that downloads files server-side, which bypasses public container restrictions.*

---

## How to Verify Uploads in Azure Portal Real-Time

To watch files appear in the cloud as you upload them:
1. In the Azure Portal, navigate to your **Storage Account**.
2. In the left-side navigation panel under **Data storage**, click on **Containers**.
3. Click on the container named `uploads` (or the custom name you configured).
4. Leave this tab open. Go to your local application tab (`http://localhost:8080`) and upload a file.
5. In the Azure Portal Container tab, click **Refresh** at the top. You will see your uploaded file immediately appear in the list with its name, file size, and upload time matching exactly.

---

## Deploying to Azure App Service

You can deploy this Flask app to Azure App Service easily using the Azure CLI or Visual Studio Code.

### Method: Azure CLI Deployment
Run the following commands in your local shell (with Azure CLI installed):

```bash
# 1. Log in to your Azure Account
az login

# 2. Deploy your app code directly.
# Replace <my-unique-app-name> with a unique name, e.g. "clouddrive-portal".
# Replace <resource-group-name> with your resource group.
az webapp up --runtime "PYTHON:3.10" --name <my-unique-app-name> --resource-group <resource-group-name> --sku B1
```

### Configure App Service Environment Variables
For your deployed app to access Azure Storage:
1. In the Azure Portal, go to your **App Service**.
2. On the left menu, select **Settings** -> **Environment variables** (or **Configuration** depending on your portal layout).
3. Click **+ Add** (or **+ New application setting**).
4. Add the setting:
   - **Name**: `AZURE_STORAGE_CONNECTION_STRING`
   - **Value**: Your actual Azure Storage Connection String.
5. Click **Apply** or **Save** at the bottom.
6. The app service will automatically restart and run fully synchronized with Azure Blob Storage!
