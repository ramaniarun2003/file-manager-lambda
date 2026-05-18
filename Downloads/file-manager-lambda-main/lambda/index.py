import boto3
import json
import uuid
from datetime import datetime

s3_client = boto3.client('s3')
BUCKET_NAME = 'arun-file-uploads-2026'
CHUNK_SIZE = 10 * 1024 * 1024

def lambda_handler(event, context):
    path = event.get('rawPath', '')
    method = event.get('requestContext', {}).get('http', {}).get('method', '')

    if path == '/prod/get-upload-url' and method == 'POST':
        return get_upload_url(event)
    elif path == '/prod/create-multipart' and method == 'POST':
        return create_multipart(event)
    elif path == '/prod/get-part-urls' and method == 'POST':
        return get_part_urls(event)
    elif path == '/prod/complete-multipart' and method == 'POST':
        return complete_multipart(event)
    elif path == '/prod/list-files' and method == 'GET':
        return list_files(event)
    elif path == '/prod/get-download-url' and method == 'GET':
        return get_download_url(event)
    elif path == '/prod/create-folder' and method == 'POST':
        return create_folder(event)
    else:
        return response(404, {'error': f'Not found: {path}'})

def get_upload_url(event):
    body = json.loads(event.get('body', '{}'))
    filename = body.get('filename', 'upload')
    content_type = body.get('contentType', 'application/octet-stream')
    folder = body.get('folder', '')
    if folder:
        unique_key = f"uploads/{folder}/{filename}"
    else:
        unique_key = f"uploads/{datetime.now().strftime('%Y/%m/%d')}/{uuid.uuid4()}/{filename}"
    presigned_url = s3_client.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': BUCKET_NAME,
            'Key': unique_key,
            'ContentType': content_type,
        },
        ExpiresIn=604800
    )
    return response(200, {'uploadUrl': presigned_url, 'key': unique_key})

def create_multipart(event):
    body = json.loads(event.get('body', '{}'))
    filename = body.get('filename', 'upload')
    content_type = body.get('contentType', 'application/octet-stream')
    folder = body.get('folder', '')
    if folder:
        unique_key = f"uploads/{folder}/{filename}"
    else:
        unique_key = f"uploads/{datetime.now().strftime('%Y/%m/%d')}/{uuid.uuid4()}/{filename}"
    result = s3_client.create_multipart_upload(
        Bucket=BUCKET_NAME,
        Key=unique_key,
        ContentType=content_type
    )
    return response(200, {'uploadId': result['UploadId'], 'key': unique_key})

def get_part_urls(event):
    body = json.loads(event.get('body', '{}'))
    key = body.get('key')
    upload_id = body.get('uploadId')
    part_count = body.get('partCount')
    urls = []
    for part_number in range(1, part_count + 1):
        url = s3_client.generate_presigned_url(
            'upload_part',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': key,
                'UploadId': upload_id,
                'PartNumber': part_number
            },
            ExpiresIn=3600
        )
        urls.append(url)
    return response(200, {'urls': urls})

def complete_multipart(event):
    body = json.loads(event.get('body', '{}'))
    key = body.get('key')
    upload_id = body.get('uploadId')
    parts = body.get('parts')
    s3_client.complete_multipart_upload(
        Bucket=BUCKET_NAME,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={'Parts': parts}
    )
    return response(200, {'key': key, 'status': 'complete'})

def list_files(event):
    folder = (event.get('queryStringParameters') or {}).get('folder', '')
    if folder:
        prefix = f"uploads/{folder}/"
        result = s3_client.list_objects_v2(
            Bucket=BUCKET_NAME,
            Prefix=prefix,
            Delimiter='/'
        )
        folders = []
        for cp in result.get('CommonPrefixes') or []:
            folder_key = cp['Prefix']
            folder_name = folder_key.rstrip('/').split('/')[-1]
            folders.append({'key': folder_key, 'name': folder_name})
        files = []
        for obj in result.get('Contents') or []:
            key = obj['Key']
            if key.endswith('/'):
                continue
            filename = key.split('/')[-1]
            files.append({
                'key': key,
                'filename': filename,
                'size': obj['Size'],
                'lastModified': obj['LastModified'].isoformat()
            })
    else:
        result_with_delimiter = s3_client.list_objects_v2(
            Bucket=BUCKET_NAME,
            Prefix='uploads/',
            Delimiter='/'
        )
        folders = []
        for cp in result_with_delimiter.get('CommonPrefixes') or []:
            folder_key = cp['Prefix']
            folder_name = folder_key.rstrip('/').split('/')[-1]
            if folder_name.isdigit():
                continue
            folders.append({'key': folder_key, 'name': folder_name})

        result_all = s3_client.list_objects_v2(
            Bucket=BUCKET_NAME,
            Prefix='uploads/'
        )
        files = []
        seen_folders = {f['name'] for f in folders}
        for obj in result_all.get('Contents') or []:
            key = obj['Key']
            if key.endswith('/'):
                continue
            parts = key.split('/')
            if len(parts) > 2 and parts[1] in seen_folders:
                continue
            filename = parts[-1]
            files.append({
                'key': key,
                'filename': filename,
                'size': obj['Size'],
                'lastModified': obj['LastModified'].isoformat()
            })

    files.sort(key=lambda x: x['lastModified'], reverse=True)
    return response(200, {'folders': folders, 'files': files})

def get_download_url(event):
    key = (event.get('queryStringParameters') or {}).get('key', '')
    if not key:
        return response(400, {'error': 'Missing key parameter'})
    presigned_url = s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': BUCKET_NAME, 'Key': key},
        ExpiresIn=86400
    )
    return response(200, {'downloadUrl': presigned_url})

def create_folder(event):
    body = json.loads(event.get('body', '{}'))
    folder_name = body.get('folderName', '').strip()
    if not folder_name:
        return response(400, {'error': 'Missing folderName'})
    key = f"uploads/{folder_name}/"
    s3_client.put_object(Bucket=BUCKET_NAME, Key=key, Body=b'')
    return response(200, {'key': key, 'folderName': folder_name})

def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        },
        'body': json.dumps(body)
    }