# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Node.js/TypeScript service for backing up PostgreSQL databases to S3 and restoring them. Designed for containerized deployments with Railway and other platforms. Supports scheduled execution via cron or single-shot modes.

**Key Characteristics**: Simple, no-fuss backup/restore service with minimal dependencies and straightforward architecture.

## Common Commands

### Development
```bash
npm install          # Install dependencies
npm run typecheck    # Type check without building
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled application
```

### Docker Build
```bash
# Default build (Node 20.11.1, PostgreSQL 16)
docker build -t postgres-backup .

# Custom versions (Postgres 17 requires Node 22)
docker build --build-arg NODE_VERSION=22 --build-arg PG_VERSION=17 -t postgres-backup .
```

### Testing
**Note**: No formal test suite exists. Manual testing required.

## High-Level Architecture

### Dual-Mode Operation
The application operates in one of two modes controlled by the `MODE` environment variable:
- **backup** (default): Dumps PostgreSQL to S3
- **restore**: Downloads from S3 and restores to PostgreSQL

### Entry Point Flow ([src/index.ts](src/index.ts))
1. Load and validate environment variables via [src/env.ts](src/env.ts)
2. Check `MODE` and validate mode-specific required variables
3. Execute based on mode:
   - **Single-shot mode**: Run once and exit (exit code 0 on success, 1 on error)
   - **Startup mode**: Run immediately, then schedule cron
   - **Cron mode** (default): Schedule recurring execution
4. Error handling: All operations wrapped in try/catch with `process.exit(1)` on failure

### Core Modules

**[src/backup.ts](src/backup.ts)** - Backup pipeline
- `backup()`: Main orchestration (dump → upload → cleanup)
- `dumpToFile()`: Execute pg_dump with tar format + gzip compression
- `uploadToS3()`: Stream upload to S3 with optional MD5 hashing
- `deleteFile()`: Cleanup temporary files

**[src/restore.ts](src/restore.ts)** - Restore pipeline
- `restore()`: Main orchestration (download → decompress → restore → cleanup)
- `getLatestBackupKey()`: List S3 objects and select newest by LastModified
- `downloadFromS3()`: Stream download from S3 to temp file
- `decompressFile()`: Decompress .tar.gz using gunzip
- `restoreFromFile()`: Execute pg_restore to target database
- `deleteFile()`: Cleanup temporary files

**[src/util.ts](src/util.ts)** - Shared utilities
- `createS3Client()`: Factory for configured S3Client (supports custom endpoints)
- `getS3Key()`: Apply BUCKET_SUBFOLDER prefix to S3 keys
- `createMD5()`: Stream-based MD5 hash generation for object lock support

**[src/env.ts](src/env.ts)** - Environment configuration
- Uses `envsafe` library for type-safe environment variable parsing
- Custom MODE validator ensures only "backup" or "restore"
- All environment variables documented in README.md

### Key Architectural Patterns

**Stream-Based I/O**: All file operations use Node.js streams to handle large backups efficiently without loading entire files into memory.

**Promise-Wrapped exec()**: Shell commands wrapped in Promises for async/await flow:
```typescript
await new Promise<void>((resolve, reject) => {
  exec(`command`, (error, stdout, stderr) => {
    if (error) {
      reject({ error, stderr: stderr.trimEnd() });
      return;
    }
    resolve();
  });
});
```

**Error Propagation**: Errors include both error object and stderr for debugging:
```typescript
reject({ error: error, stderr: stderr.trimEnd() });
```

**S3 Client Reuse**: Central factory (`createS3Client()`) applies region, endpoint, and forcePathStyle settings consistently.

**Temporary File Handling**: Uses `os.tmpdir()` for scratch space with timestamp-based naming to avoid collisions.

## Important Implementation Details

### PostgreSQL Commands
- **Backup**: `pg_dump --dbname=<url> --format=tar | gzip > file.tar.gz`
  - TAR format preserves structure and permissions
  - Gzip compression applied via shell pipe
  - Archive validation: `gzip -cd file | head -c1` checks decompressibility

- **Restore**: `pg_restore --dbname=<url> <options> file.tar`
  - Expects decompressed TAR archive
  - Does NOT automatically drop/recreate database
  - Users must use `RESTORE_OPTIONS="--clean --if-exists"` for idempotent restores

### S3 Integration
- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`)
- Supports S3-compatible services: Cloudflare R2, MinIO, Backblaze B2
- Custom endpoints via `AWS_S3_ENDPOINT`
- Path-style addressing via `AWS_S3_FORCE_PATH_STYLE` for MinIO compatibility
- Multipart upload via `Upload` class handles large files automatically

### Execution Modes
Each mode has separate environment flags:
- **Cron**: `BACKUP_CRON_SCHEDULE` / `RESTORE_CRON_SCHEDULE` (default: `0 5 * * *`)
- **Startup**: `RUN_ON_STARTUP` / `RESTORE_RUN_ON_STARTUP`
- **Single-shot**: `SINGLE_SHOT_MODE` / `RESTORE_SINGLE_SHOT_MODE`

Combine modes: e.g., `RUN_ON_STARTUP=true` + cron schedule runs immediately then schedules.

### File Naming Convention
Backups use ISO timestamp format:
```
<BACKUP_FILE_PREFIX>-2025-12-12T08-42-31-456Z.tar.gz
```
Colons and dots replaced with hyphens for filesystem compatibility.

## Known Limitations and Security Considerations

### CRITICAL SECURITY ISSUES

**1. Shell Command Injection Vulnerability**
- **Locations**: [src/backup.ts:48](src/backup.ts#L48), [src/backup.ts:55](src/backup.ts#L55), [src/restore.ts:50](src/restore.ts#L50), [src/restore.ts:76](src/restore.ts#L76)
- **Problem**: File paths and database URLs not quoted in exec() calls
- **Impact**: Malicious environment variables can execute arbitrary commands
- **Example**: `BACKUP_DATABASE_URL="postgres://x; rm -rf /"`
- **Fix Required**: Properly quote all variables in shell commands or use execFile() with argument arrays

**2. Path Traversal Vulnerability**
- **Location**: [src/util.ts:28-32](src/util.ts#L28-L32)
- **Problem**: No validation that S3 keys don't escape bucket subfolder
- **Impact**: `RESTORE_FILE_KEY="../../../etc/passwd"` could access parent directories
- **Fix Required**: Validate S3 keys don't contain `..` or absolute paths

**3. Temporary File Security**
- **Locations**: [src/backup.ts:98](src/backup.ts#L98), [src/restore.ts:17](src/restore.ts#L17)
- **Problem**: Files in `/tmp` may be world-readable with default permissions
- **Impact**: Sensitive database contents exposed to other users
- **Fix Required**: Use secure temp file creation with restricted permissions (0600)

**4. Incomplete Cleanup on Error**
- **Location**: [src/restore.ts:158-160](src/restore.ts#L158-L160)
- **Problem**: Cleanup only happens in success path
- **Impact**: Failed restores leave sensitive files in /tmp
- **Fix Required**: Use try/finally blocks for guaranteed cleanup

### Known Bugs

**deleteFile() in backup.ts ([lines 81-90](src/backup.ts#L81-L90))**
```typescript
// BUGGY CODE - always calls reject even on success
unlink(path, (err) => {
  reject({ error: err });  // Called even if err is undefined!
  return;
});
resolve(undefined);  // Never reached
```
**Impact**: Mitigated by accident - reject only throws if err is truthy
**Fix Required**: Add conditional: `if (err) { reject({ error: err }); return; } resolve();`

### Architectural Limitations

**Restore Mode Doesn't Handle Existing Databases**
- `pg_restore` will fail if database has conflicting objects
- Workaround: Use `RESTORE_OPTIONS="--clean --if-exists"`
- Scheduled restores will fail repeatedly without this flag

**No Retry Logic**
- Transient S3 or database errors cause permanent failure
- Scheduled backups can miss windows due to network blips

**No Archive Validation After Download**
- Corrupted downloads could partially restore and leave database in inconsistent state
- No checksum verification

**Credentials in Environment Variables**
- AWS keys should use IAM roles in production, not hardcoded keys
- Connection strings can appear in error messages and logs

## Development Guidelines

### When Modifying Backup/Restore Logic
1. Maintain stream-based I/O for memory efficiency
2. Preserve error structure: `{ error, stderr }`
3. Ensure cleanup happens even on errors (use try/finally)
4. Log progress at each stage for operational visibility
5. Exit with code 1 on errors for container orchestration

### When Adding Environment Variables
1. Add to [src/env.ts](src/env.ts) with type-safe `envsafe` definition
2. Document in README.md under appropriate mode section
3. Provide sensible defaults where possible
4. Use `allowEmpty: true` for optional strings

### When Working with Shell Commands
1. **ALWAYS** quote variables in exec() calls
2. Consider using `execFile()` instead of `exec()` for better security
3. Log stderr even when not erroring (warnings are common in pg_dump)
4. Validate file paths don't contain shell metacharacters

### When Testing
No automated tests exist. Manual testing checklist:
- Backup mode: Verify file created in S3, check filesize, download and decompress manually
- Restore mode: Verify database restored correctly, check all tables/data
- Error cases: Kill database mid-backup, corrupt S3 file, invalid credentials
- Both modes: Single-shot, startup, and cron execution modes

## PostgreSQL Version Compatibility

**PostgreSQL 16 and earlier**: Default (Node 20.11.1)
**PostgreSQL 17**: Requires Node 22
```bash
docker build --build-arg NODE_VERSION=22 --build-arg PG_VERSION=17
```
Or set environment variables: `NODE_VERSION=22` and `PG_VERSION=17`

## Deployment Notes

### Docker Health Check
Dockerfile includes `pg_isready` health check before starting application.

### Exit Codes
- `0`: Success (single-shot mode completion)
- `1`: Error (backup/restore failed, invalid config)

### Logging
- Uses `console.log()` and `console.error()` (no structured logging)
- Stderr from pg_dump/pg_restore logged but doesn't always indicate failure

### S3 Bucket Configuration
- Supports bucket subfolders via `BUCKET_SUBFOLDER`
- Optional MD5 hashing via `SUPPORT_OBJECT_LOCK` (performance cost)
- Multipart uploads handle files of any size

## Design Documentation

See [design.md](design.md) for the original restore functionality design document, including sequence diagrams and implementation planning.
