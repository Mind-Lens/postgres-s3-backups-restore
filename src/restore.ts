import { exec, execSync } from "child_process";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream, unlink } from "fs";
import path from "path";
import { createS3Client, getS3Key, escapeShellArg, createSecureTempPath, extractDatabaseHost } from "./util.js";
import { env } from "./env.js";
import { log, logStderr, formatAge } from "./logger.js";

const downloadFromS3 = async (key: string): Promise<string> => {
  const s3Key = getS3Key(key);
  log(`Downloading backup from S3...`);
  log(`  - Bucket: ${env.AWS_S3_BUCKET}`);
  log(`  - Key: ${s3Key}`);

  const bucket = env.AWS_S3_BUCKET;
  const client = createS3Client();

  const filename = path.basename(s3Key);

  // Create secure temp file with restricted permissions (0600)
  const filepath = await createSecureTempPath(filename);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  });

  const response = await client.send(command);

  if (!response.Body) {
    throw new Error("No response body from S3");
  }

  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(filepath);
    const body = response.Body as any;

    body.pipe(writeStream);

    writeStream.on('finish', () => resolve());
    writeStream.on('error', (error) => reject(error));
  });

  log(`Downloaded backup to ${filepath}`);
  return filepath;
};

const validateArchive = async (filepath: string): Promise<void> => {
  log("Validating archive integrity...");

  const escapedFilepath = escapeShellArg(filepath);

  try {
    // Test that the gzip file can be decompressed
    execSync(`gunzip -t ${escapedFilepath} 2>&1`);
    log("  - Archive validation successful");
  } catch (error: any) {
    throw new Error(`Archive validation failed: ${error.message}`);
  }
};

const decompressFile = async (filepath: string): Promise<string> => {
  log("Decompressing backup file...");

  const decompressedPath = filepath.replace('.gz', '');

  await new Promise<void>((resolve, reject) => {
    // Escape shell arguments to prevent command injection
    const escapedFilepath = escapeShellArg(filepath);
    const escapedDecompressedPath = escapeShellArg(decompressedPath);

    exec(`gunzip -c ${escapedFilepath} > ${escapedDecompressedPath}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error, stderr: stderr.trimEnd() });
        return;
      }

      if (stderr) {
        logStderr(stderr.trimEnd(), "gunzip");
      }

      resolve();
    });
  });

  log(`  - Decompressed to ${path.basename(decompressedPath)}`);
  return decompressedPath;
};

const restoreFromFile = async (filepath: string) => {
  if (!env.RESTORE_DATABASE_URL) {
    throw new Error("RESTORE_DATABASE_URL is required for restore mode");
  }

  const dbHost = extractDatabaseHost(env.RESTORE_DATABASE_URL);
  log("Restoring database from backup...");
  log(`  - Connecting to: ${dbHost}`);
  if (env.RESTORE_OPTIONS) {
    log(`  - Options: ${env.RESTORE_OPTIONS}`);
  }

  await new Promise<void>((resolve, reject) => {
    // Escape shell arguments to prevent command injection
    const escapedDbUrl = escapeShellArg(env.RESTORE_DATABASE_URL);
    const escapedFilepath = escapeShellArg(filepath);
    const escapedOptions = env.RESTORE_OPTIONS; // Already validated by user, treated as trusted

    exec(`pg_restore --dbname=${escapedDbUrl} ${escapedOptions} ${escapedFilepath}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error, stderr: stderr.trimEnd() });
        return;
      }

      if (stderr) {
        logStderr(stderr.trimEnd(), "pg_restore");
      }

      resolve();
    });
  });

  log("Database restore completed");
};

const deleteFile = async (filepath: string) => {
  log(`Cleaning up temporary file...`);
  await new Promise<void>((resolve, reject) => {
    unlink(filepath, (err) => {
      if (err) {
        reject({ error: err });
        return;
      }
      resolve();
    });
  });
};

const getLatestBackupKey = async (): Promise<string> => {
  log("Getting latest backup from S3...");

  const bucket = env.AWS_S3_BUCKET;
  const client = createS3Client();
  const s3KeyPrefix = env.BUCKET_SUBFOLDER ? env.BUCKET_SUBFOLDER + "/" : "";
  const searchPrefix = s3KeyPrefix + env.BACKUP_FILE_PREFIX + "-";

  log(`  - Searching: ${bucket}/${searchPrefix}*`);

  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: searchPrefix,
  });

  const response = await client.send(command);

  if (!response.Contents || response.Contents.length === 0) {
    throw new Error(`No backup files found with prefix: ${searchPrefix}`);
  }

  log(`  - Found ${response.Contents.length} backup file(s)`);

  // Sort by LastModified and get the latest
  const latest = response.Contents.sort((a, b) => {
    const timeA = a.LastModified ? a.LastModified.getTime() : 0;
    const timeB = b.LastModified ? b.LastModified.getTime() : 0;
    return timeB - timeA;
  })[0];

  if (!latest.Key) {
    throw new Error("Could not determine latest backup key");
  }

  const fileAge = latest.LastModified ? formatAge(latest.LastModified) : 'unknown';
  log(`Latest backup: ${latest.Key}`);
  log(`  - Age: ${fileAge}`);
  log(`  - Last modified: ${latest.LastModified?.toISOString() || 'unknown'}`);

  return latest.Key;
};

export const restore = async () => {
  const startTime = new Date();

  log("=".repeat(50));
  log("RESTORE STARTED");
  log(`  - Timestamp: ${startTime.toISOString()}`);
  if (env.RESTORE_FILE_KEY) {
    log(`  - Source: ${env.RESTORE_FILE_KEY} (specified)`);
  } else {
    log(`  - Source: Latest backup from S3`);
  }
  log("=".repeat(50));

  let downloadedPath: string | null = null;
  let decompressedPath: string | null = null;

  try {
    // Determine which backup file to restore
    const restoreKey = env.RESTORE_FILE_KEY || await getLatestBackupKey();

    // Download from S3
    downloadedPath = await downloadFromS3(restoreKey);

    // Validate archive integrity before decompression
    await validateArchive(downloadedPath);

    // Decompress the file
    decompressedPath = await decompressFile(downloadedPath);

    // Restore to PostgreSQL
    await restoreFromFile(decompressedPath);

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationSec = (durationMs / 1000).toFixed(2);

    log("=".repeat(50));
    log("RESTORE COMPLETED");
    log(`  - Duration: ${durationSec}s`);
    log(`  - End time: ${endTime.toISOString()}`);
    log("=".repeat(50));
  } catch (error) {
    log("RESTORE FAILED - See error details above");
    throw error;
  } finally {
    // Guaranteed cleanup of temporary files, even on error
    if (downloadedPath) {
      try {
        await deleteFile(downloadedPath);
      } catch (error) {
        log("Warning: Failed to delete downloaded file");
      }
    }

    if (decompressedPath) {
      try {
        await deleteFile(decompressedPath);
      } catch (error) {
        log("Warning: Failed to delete decompressed file");
      }
    }
  }
};