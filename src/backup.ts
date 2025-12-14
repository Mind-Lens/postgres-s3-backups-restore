import { exec, execSync } from "child_process";
import { S3Client, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, unlink, statSync } from "fs";
import { filesize } from "filesize";
import path from "path";

import { env } from "./env.js";
import { createMD5, createS3Client, getS3Key, escapeShellArg, createSecureTempPath, extractDatabaseHost } from "./util.js";
import { log, logStderr } from "./logger.js";

const uploadToS3 = async ({ name, path }: { name: string, path: string }) => {
  const s3Key = getS3Key(name);
  log(`Uploading backup to S3...`);
  log(`  - Bucket: ${env.AWS_S3_BUCKET}`);
  log(`  - Key: ${s3Key}`);
  log(`  - Size: ${filesize(statSync(path).size)}`);

  const bucket = env.AWS_S3_BUCKET;
  const client = createS3Client();

  let params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: s3Key,
    Body: createReadStream(path),
  }

  if (env.SUPPORT_OBJECT_LOCK) {
    log("  - Calculating MD5 hash (object lock enabled)...");

    const md5Hash = await createMD5(path);

    log("  - MD5 hash calculated");

    params.ContentMD5 = Buffer.from(md5Hash, 'hex').toString('base64');
  }

  await new Upload({
    client,
    params: params
  }).done();

  log("Backup uploaded to S3 successfully");
}

const dumpToFile = async (filePath: string) => {
  const dbHost = extractDatabaseHost(env.BACKUP_DATABASE_URL);
  log(`Dumping database to file...`);
  log(`  - Connecting to: ${dbHost}`);
  log(`  - Format: tar + gzip`);
  if (env.BACKUP_OPTIONS) {
    log(`  - Options: ${env.BACKUP_OPTIONS}`);
  }

  await new Promise((resolve, reject) => {
    // Escape shell arguments to prevent command injection
    const escapedDbUrl = escapeShellArg(env.BACKUP_DATABASE_URL);
    const escapedFilePath = escapeShellArg(filePath);
    const escapedOptions = env.BACKUP_OPTIONS; // Already validated by user, treated as trusted

    exec(`pg_dump --dbname=${escapedDbUrl} --format=tar ${escapedOptions} | gzip > ${escapedFilePath}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error, stderr: stderr.trimEnd() });
        return;
      }

      // check if archive is valid and contains data
      const escapedFilePathForValidation = escapeShellArg(filePath);
      const isValidArchive = (execSync(`gzip -cd ${escapedFilePathForValidation} | head -c1`).length == 1) ? true : false;
      if (isValidArchive == false) {
        reject({ error: "Backup archive file is invalid or empty; check for errors above" });
        return;
      }

      // not all text in stderr will be a critical error, print the error / warning
      if (stderr != "") {
        logStderr(stderr.trimEnd(), "pg_dump");
      }

      log(`  - Archive validated successfully`);
      log(`  - File size: ${filesize(statSync(filePath).size)}`);

      // if stderr contains text, let the user know that it was potently just a warning message
      if (stderr != "") {
        log(`  - Note: stderr output detected (may be warnings). Verify backup if needed.`);
      }

      resolve(undefined);
    });
  });

  log("Database dump completed");
}

const deleteFile = async (path: string) => {
  log(`Cleaning up temporary file...`);
  await new Promise((resolve, reject) => {
    unlink(path, (err) => {
      if (err) {
        reject({ error: err });
        return;
      }
      resolve(undefined);
    });
  });
}

export const backup = async () => {
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]+/g, '-');
  const filename = `${env.BACKUP_FILE_PREFIX}-${timestamp}.tar.gz`;

  log("=".repeat(50));
  log("BACKUP STARTED");
  log(`  - Timestamp: ${startTime.toISOString()}`);
  log(`  - Filename: ${filename}`);
  log("=".repeat(50));

  // Create secure temp file with restricted permissions (0600)
  const filepath = await createSecureTempPath(filename);

  await dumpToFile(filepath);
  await uploadToS3({ name: filename, path: filepath });
  await deleteFile(filepath);

  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationSec = (durationMs / 1000).toFixed(2);

  log("=".repeat(50));
  log("BACKUP COMPLETED");
  log(`  - Duration: ${durationSec}s`);
  log(`  - End time: ${endTime.toISOString()}`);
  log("=".repeat(50));
}
