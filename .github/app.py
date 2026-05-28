import os
import sys
import io
from flask import Flask, request, jsonify, render_template, send_from_directory, send_file, url_for
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables from .env
load_dotenv()

# Initialize Flask App
# By placing index.html in /templates and assets in /static, we maintain Flask standards.
app = Flask(__name__, template_folder='templates', static_folder='static')

# Maximum file size configuration (10 MB)
MAX_FILE_SIZE_MB = 10
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE_MB * 1024 * 1024  # 10 MB in bytes

# Configuration parameters
AZURE_CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
CONTAINER_NAME = os.getenv("AZURE_CONTAINER_NAME", "uploads")
PORT = int(os.getenv("PORT", 8080))

# Local storage fallback directory
LOCAL_STORAGE_DIR = os.path.join(app.root_path, "local_storage")
use_azure = False
container_client = None

# Initialize Azure Storage if connection string is configured
if AZURE_CONN_STR and AZURE_CONN_STR.strip():
    try:
        from azure.storage.blob import BlobServiceClient, ContainerClient, ContentSettings
        
        # Instantiate BlobServiceClient
        blob_service_client = BlobServiceClient.from_connection_string(AZURE_CONN_STR)
        container_client = blob_service_client.get_container_client(CONTAINER_NAME)
        
        # Try to create container. Public access 'blob' allows direct anonymous read access to individual blobs
        try:
            if not container_client.exists():
                container_client.create_container(public_access='blob')
                print(f"Container '{CONTAINER_NAME}' successfully created with public blob access.")
            else:
                print(f"Container '{CONTAINER_NAME}' already exists.")
        except Exception as container_err:
            # If public-container creation fails due to Subscription/Storage Account Policies (public access blocked)
            # fallback to creating a private container and use API proxy for downloads.
            print(f"Could not create public container due to: {container_err}")
            try:
                if not container_client.exists():
                    container_client.create_container()
                    print(f"Container '{CONTAINER_NAME}' created as private.")
            except Exception as private_err:
                print(f"Failed to create private container: {private_err}")
                raise private_err
                
        use_azure = True
        print("Successfully connected and initialized Azure Blob Storage.")
    except Exception as e:
        print(f"Warning: Failed to connect to Azure Blob Storage: {e}")
        print("Falling back to local storage directory for demo mode...")
else:
    print("No AZURE_STORAGE_CONNECTION_STRING found in environmental variable or .env file.")
    print("Running in DEMO MODE with Local Storage fallback.")

# Ensure local storage folder exists if Azure is not active
if not use_azure:
    if not os.path.exists(LOCAL_STORAGE_DIR):
        os.makedirs(LOCAL_STORAGE_DIR)
        print(f"Created local storage directory at: {LOCAL_STORAGE_DIR}")


# Error Handler for files exceeding 10MB limit
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({
        "status": "error",
        "message": f"File exceeds the maximum limit of {MAX_FILE_SIZE_MB}MB."
    }), 413


# --- ENDPOINTS ---

# 1. Main Page Route
@app.route('/')
def index():
    return render_template('index.html')


# 2. Get Status Check (Tells frontend if it is using Azure or Local)
@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        "status": "success",
        "storage_mode": "Azure" if use_azure else "Local",
        "container_name": CONTAINER_NAME if use_azure else "local_storage",
        "is_azure_configured": use_azure
    })


# 3. File List Endpoint
@app.route('/api/files', methods=['GET'])
def list_files():
    files = []
    
    if use_azure:
        try:
            # List all blobs in container
            blobs = container_client.list_blobs()
            for blob in blobs:
                blob_client = container_client.get_blob_client(blob.name)
                
                # Fetch properties to get the actual uploaded time and sizes
                size = blob.size
                last_modified = blob.last_modified.isoformat() if blob.last_modified else datetime.now().isoformat()
                
                files.append({
                    "name": blob.name,
                    "size": size,
                    "last_modified": last_modified,
                    "url": blob_client.url, # Direct blob URL
                    "download_url": url_for('download_file', filename=blob.name, _external=True), # Download proxy endpoint
                    "storage": "Azure"
                })
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Failed to retrieve files from Azure Blob Storage: {str(e)}"
            }), 500
    else:
        # Fetch from local directory for demo
        try:
            for filename in os.listdir(LOCAL_STORAGE_DIR):
                file_path = os.path.join(LOCAL_STORAGE_DIR, filename)
                if os.path.isfile(file_path):
                    file_stat = os.stat(file_path)
                    size = file_stat.st_size
                    # ISO string format for modification time
                    last_modified = datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                    
                    # Direct and download URL map to local endpoint
                    local_url = url_for('serve_local_file', filename=filename, _external=True)
                    
                    files.append({
                        "name": filename,
                        "size": size,
                        "last_modified": last_modified,
                        "url": local_url,
                        "download_url": local_url,
                        "storage": "Local"
                    })
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Failed to retrieve files from local directory: {str(e)}"
            }), 500

    # Sort files by modification date (newest first)
    files.sort(key=lambda x: x["last_modified"], reverse=True)
    
    return jsonify({
        "status": "success",
        "files": files
    })


# 4. Upload File Endpoint
@app.route('/api/upload', methods=['POST'])
def upload_file():
    # Verify file is present in request
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part in the request"}), 400
        
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({"status": "error", "message": "No file selected for uploading"}), 400

    # Sanitize the filename to prevent path injection
    filename = secure_filename(file.filename)
    if not filename:
        # Fallback in case of non-ASCII characters only
        filename = f"upload_{int(datetime.now().timestamp())}"

    # Read binary stream
    file_data = file.read()
    file_size = len(file_data)
    
    # Check size again (redundancy check for safety)
    if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
        return jsonify({"status": "error", "message": f"File size exceeds maximum {MAX_FILE_SIZE_MB}MB limit."}), 413

    if use_azure:
        try:
            blob_client = container_client.get_blob_client(filename)
            
            # Map Content Type (so images render properly in browser instead of downloading)
            content_type = file.content_type or "application/octet-stream"
            content_settings = ContentSettings(content_type=content_type)
            
            # Upload blob data
            blob_client.upload_blob(file_data, overwrite=True, content_settings=content_settings)
            
            return jsonify({
                "status": "success",
                "message": "File uploaded successfully to Azure Blob Storage!",
                "file": {
                    "name": filename,
                    "size": file_size,
                    "url": blob_client.url,
                    "download_url": url_for('download_file', filename=filename, _external=True),
                    "storage": "Azure"
                }
            })
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Failed to upload to Azure Blob Storage: {str(e)}"
            }), 500
    else:
        # Save to local storage for local demo
        try:
            file_path = os.path.join(LOCAL_STORAGE_DIR, filename)
            with open(file_path, "wb") as f:
                f.write(file_data)
                
            local_url = url_for('serve_local_file', filename=filename, _external=True)
            
            return jsonify({
                "status": "success",
                "message": "File uploaded successfully to local storage (Demo Mode)!",
                "file": {
                    "name": filename,
                    "size": file_size,
                    "url": local_url,
                    "download_url": local_url,
                    "storage": "Local"
                }
            })
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Failed to save locally: {str(e)}"
            }), 500


# 5. Delete File Endpoint
@app.route('/api/files/<path:filename>', methods=['DELETE'])
def delete_file(filename):
    if use_azure:
        try:
            blob_client = container_client.get_blob_client(filename)
            if blob_client.exists():
                blob_client.delete_blob()
                return jsonify({
                    "status": "success",
                    "message": f"File '{filename}' successfully deleted from Azure Blob Storage."
                })
            else:
                return jsonify({"status": "error", "message": "File not found in storage container."}), 404
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Failed to delete file from Azure: {str(e)}"
            }), 500
    else:
        # Local Delete
        try:
            file_path = os.path.join(LOCAL_STORAGE_DIR, filename)
            if os.path.exists(file_path):
                os.remove(file_path)
                return jsonify({
                    "status": "success",
                    "message": f"File '{filename}' successfully deleted from local storage."
                })
            else:
                return jsonify({"status": "error", "message": "File not found in local storage."}), 404
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Failed to delete local file: {str(e)}"
            }), 500


# 6. Azure Download/Proxy Endpoint
# This route streams the file directly from Azure.
# It acts as a fallback for downloading files when public-blob access policy is private.
@app.route('/api/download/<path:filename>', methods=['GET'])
def download_file(filename):
    if use_azure:
        try:
            blob_client = container_client.get_blob_client(filename)
            if not blob_client.exists():
                return "File not found in storage container", 404
                
            # Stream blob content
            blob_data = blob_client.download_blob()
            blob_properties = blob_client.get_blob_properties()
            
            # Wrap in BytesIO stream
            file_stream = io.BytesIO(blob_data.readall())
            content_type = blob_properties.content_settings.content_type or 'application/octet-stream'
            
            return send_file(
                file_stream,
                mimetype=content_type,
                as_attachment=True,
                download_name=filename
            )
        except Exception as e:
            return f"Error downloading file from Azure: {str(e)}", 500
    else:
        # If in local mode, call local server
        return serve_local_file(filename)


# 7. Local File Server Route
# Used when in Demo (Local) Mode to fetch or download local files.
@app.route('/local_storage/<path:filename>')
def serve_local_file(filename):
    return send_from_directory(LOCAL_STORAGE_DIR, filename, as_attachment=True)


# --- MAIN TRIGGER ---
if __name__ == '__main__':
    # Bind to host 0.0.0.0 to enable access inside containers or network
    app.run(host='0.0.0.0', port=PORT, debug=True)
