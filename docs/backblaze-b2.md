# Connect Backblaze B2

BlazeSync is compatible with **Backblaze B2 Cloud Storage** through its S3-compatible API. It is an independent client, not an official Backblaze product. A Backblaze Personal Backup subscription is a different service; this app needs a B2 bucket and B2 Application Key.

1. Sign in to [Backblaze B2](https://secure.backblaze.com/b2_buckets.htm).
2. Create a bucket or use an existing one.
3. Open [Application Keys](https://secure.backblaze.com/app_keys.htm) and create a dedicated key for the buckets and operations you need.
4. Open BlazeSync from its macOS menu-bar icon, then select **Connection settings**.
5. Enter **Application Key ID** and **Application Key**. BlazeSync discovers the endpoint, region and permitted bucket names.

Once connected, fields stay masked and locked. **Change connection** requires confirmation. Temporary network failures do not remove the saved key. Credentials are encrypted locally using macOS protected storage and kept outside the application bundle and repository.

## Key permissions

| Action | Relevant B2 capabilities |
| --- | --- |
| Browse folders and list current files | `listFiles` plus access to the selected bucket |
| Download / preview | `readFiles` |
| Upload / create folders / backups | `writeFiles` |
| Delete current objects or stored versions | `deleteFiles` |
| Discover bucket names | Appropriate bucket-list/name access, such as `listBuckets` / `listAllBucketNames` |

B2 permission enforcement is authoritative. A key can be limited to selected buckets. Some keys hide a bucket name, so BlazeSync asks for that name once. Multi-bucket keys hiding names need name-listing access. Filename-prefix-restricted keys are not supported in this build.

Never paste your Application Key into a GitHub issue, screenshot, chat, commit or public log. Do not use your account password in the app.

## Current files, history and deletion

**Current files** shows live objects. **Versions & deleted** shows retained versions and delete markers. A file hidden by a delete marker may disappear from Current files while remaining in the Backblaze web console's history.

- **Hide current file:** removes it from the live list; stored historical versions may remain.
- **Delete all versions:** separately confirmed, permanent deletion of the exact file's stored versions and markers. BlazeSync checks history afterward before reporting completion.
- **Delete folder:** deletes current objects under that exact folder prefix; retained historical versions are not purged by this action.

Object Lock, retention rules, legal holds and key permissions can prevent deletion. BlazeSync cannot bypass these controls. Recovery is not guaranteed.

## Storage and charges

Backblaze bills your account directly. BlazeSync is not a hosting service and does not include cloud storage. Review [Backblaze's current pricing](https://www.backblaze.com/cloud-storage/pricing) before large transfers. Original-image previews and downloads use bandwidth. Folder sizes count current files recursively, including nested subfolders; they do not include historical-version storage or represent your bill.

Official references: [B2 S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api), [v4 authorization](https://www.backblaze.com/apidocs/b2-authorize-account), [lifecycle rules](https://www.backblaze.com/docs/cloud-storage-lifecycle-rules).
