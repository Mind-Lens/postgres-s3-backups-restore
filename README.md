# Postgres S3 backups and restore

A simple NodeJS application to backup your PostgreSQL database to S3 via a cron and restore from S3 backups.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/I4zGrH)

## Modes

This application supports two modes of operation:
- **backup** (default): Backup PostgreSQL database to S3
- **restore**: Restore PostgreSQL database from S3

Set the `MODE` environment variable to switch between modes.

## Configuration

### Global Configuration

- `MODE` - Operation mode: `backup` (default) or `restore`
- `AWS_ACCESS_KEY_ID` - AWS access key ID`
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key, sometimes also called an application key
- `AWS_S3_BUCKET` - The name of the bucket that the access key ID and secret access key are authorized to access
- `AWS_S3_REGION` - The name of the region your bucket is located in, set to `auto` if unknown
- `AWS_S3_ENDPOINT` - The S3 custom endpoint you want to use. Applicable for 3-rd party S3 services such as Cloudflare R2 or Backblaze R2
- `AWS_S3_FORCE_PATH_STYLE` - Use path style for the endpoint instead of the default subdomain style, useful for MinIO. Default `false`
- `BUCKET_SUBFOLDER` - Define a subfolder to place the backup files in
- `NODE_VERSION` - Specify a custom Node.js version to override the default version set in the Dockerfile
- `PG_VERSION` - Specify a custom PostgreSQL version to override the default version set in the Dockerfile

### Backup Mode Configuration

- `BACKUP_DATABASE_URL` - The connection string of the database to backup
- `BACKUP_CRON_SCHEDULE` - The cron schedule to run the backup on. Example: `0 5 * * *`
- `RUN_ON_STARTUP` - Run a backup on startup of this application then proceed with making backups on the set schedule
- `BACKUP_FILE_PREFIX` - Add a prefix to the file name
- `SINGLE_SHOT_MODE` - Run a single backup on start and exit when completed. Useful with the platform's native CRON scheduler
- `SUPPORT_OBJECT_LOCK` - Enables support for buckets with object lock by providing an MD5 hash with the backup file
- `BACKUP_OPTIONS` - Add any valid pg_dump option, supported pg_dump options can be found [here](https://www.postgresql.org/docs/current/app-pgdump.html). Example: `--exclude-table=pattern`

### Restore Mode Configuration

- `RESTORE_DATABASE_URL` - **Required** when MODE=restore. The connection string of the database to restore to
- `RESTORE_FILE_KEY` - Optional S3 key (filename) of the specific backup to restore. If not provided, the system will restore the latest backup
- `RESTORE_CRON_SCHEDULE` - The cron schedule to run the restore on (optional)
- `RESTORE_RUN_ON_STARTUP` - Run a restore on startup of this application
- `RESTORE_SINGLE_SHOT_MODE` - Run a single restore on start and exit when completed. Useful with the platform's native CRON scheduler
- `RESTORE_OPTIONS` - Add any valid pg_restore option, supported pg_restore options can be found [here](https://www.postgresql.org/docs/current/app-pgrestore.html). Example: `--clean --if-exists`

## Usage Examples

### Backup Mode

```bash
# Set environment variables
export MODE=backup
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_S3_BUCKET=your_bucket
export AWS_S3_REGION=us-east-1
export BACKUP_DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
export BACKUP_CRON_SCHEDULE="0 2 * * *"  # Daily at 2 AM

# Run the application
npm start
```

### Restore Mode

```bash
# Set environment variables
export MODE=restore
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_S3_BUCKET=your_bucket
export AWS_S3_REGION=us-east-1
export RESTORE_DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
export RESTORE_SINGLE_SHOT_MODE=true

# Run the application
npm start
```

### Restore Latest Backup

```bash
# Restore the latest backup and exit
export MODE=restore
export RESTORE_DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
export RESTORE_SINGLE_SHOT_MODE=true

npm start
```

### Restore Specific Backup

```bash
# Restore a specific backup file
export MODE=restore
export RESTORE_DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
export RESTORE_FILE_KEY=backup-2024-01-15T02-00-00.tar.gz
export RESTORE_SINGLE_SHOT_MODE=true

npm start
```

## How It Works

### Backup Process
1. Dumps the PostgreSQL database to a tar.gz file using `pg_dump`
2. Uploads the backup file to S3
3. Cleans up temporary files
4. Supports optional MD5 hashing for object lock support

### Restore Process
1. Downloads the specified backup file from S3 (or latest if not specified)
2. Decompresses the tar.gz file using `gunzip`
3. Restores the database using `pg_restore`
4. Cleans up temporary files

## Notes for Postgres 17

If backing up a Postgres 17 database imported from Postgres 16, set `PG_VERSION=17` and `NODE_VERSION=22`.

## Security Best Practices

### Production Deployments
- **Use IAM Roles**: Instead of hardcoding AWS credentials in environment variables, use IAM roles for EC2/ECS/EKS or Railway's secrets management
- **Restrict Database Access**: Use dedicated database users with minimal required permissions
- **Enable SSL/TLS**: Always use SSL-enabled database connection strings in production
- **Rotate Credentials**: Regularly rotate AWS keys and database passwords
- **Monitor Access**: Enable CloudTrail for S3 and database audit logs

### Temporary File Security
Backup and restore operations create temporary files with restricted permissions (0600) to prevent unauthorized access on shared systems. Ensure your deployment environment has adequate disk space in `/tmp`.

### Network Security
- Ensure S3 endpoints are accessed over HTTPS
- Use VPC endpoints for AWS S3 in production environments
- Restrict database access to trusted networks

## Important Limitations

### Restore Mode Considerations

**Handling Existing Databases:**
The restore process does NOT automatically drop or clean existing database objects. If you attempt to restore to a database that already contains data, `pg_restore` will fail when encountering conflicting objects.

**Solutions:**
1. **For fresh restores**: Create an empty database before running restore
2. **For overwriting existing data**: Use the `RESTORE_OPTIONS` environment variable:
   ```bash
   export RESTORE_OPTIONS="--clean --if-exists"
   ```
   This will drop existing database objects before restoring.

3. **For scheduled restores**: Only use cron-based restore mode for disaster recovery scenarios, not regular overwrites

**Example: Idempotent Restore**
```bash
export MODE=restore
export RESTORE_DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
export RESTORE_OPTIONS="--clean --if-exists"
export RESTORE_SINGLE_SHOT_MODE=true
npm start
```

### Known Limitations
- No built-in retry logic for transient S3 or database errors
- Scheduled restores require manual database cleanup or `--clean --if-exists` option
- Large backups may require significant `/tmp` disk space (backup size × 2 for compressed + decompressed)
- No automatic backup rotation or retention policies
