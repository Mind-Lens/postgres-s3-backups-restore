import { exec, execSync } from "child_process";
import { S3Client, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, unlink, statSync } from "fs";
import { filesize } from "filesize";
import path from "path";

import { env } from "./env.js";
import { createMD5, createS3Client, getS3Key, escapeShellArg, createSecureTempPath } from "./util.js";

const uploadToS3 = async ({ name, path }: { name: string, path: string }) => {
  console.log("Uploading backup to S3...");

  const bucket = env.AWS_S3_BUCKET;
  const client = createS3Client();
  
  const s3Key = getS3Key(name);

  let params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: s3Key,
    Body: createReadStream(path),
  }

  if (env.SUPPORT_OBJECT_LOCK) {
    console.log("MD5 hashing file...");

    const md5Hash = await createMD5(path);

    console.log("Done hashing file");

    params.ContentMD5 = Buffer.from(md5Hash, 'hex').toString('base64');
  }

  await new Upload({
    client,
    params: params
  }).done();

  console.log("Backup uploaded to S3...");
}

const dumpToFile = async (filePath: string) => {
  console.log("Dumping DB to file...");

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
        console.log({ stderr: stderr.trimEnd() });
      }

      console.log("Backup archive file is valid");
      console.log("Backup filesize:", filesize(statSync(filePath).size));

      // if stderr contains text, let the user know that it was potently just a warning message
      if (stderr != "") {
        console.log(`Potential warnings detected; Please ensure the backup file "${path.basename(filePath)}" contains all needed data`);
      }

      resolve(undefined);
    });
  });

  console.log("DB dumped to file...");
}

const deleteFile = async (path: string) => {
  console.log("Deleting file...");
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
  console.log("Initiating DB backup...");

  const date = new Date().toISOString();
  const timestamp = date.replace(/[:.]+/g, '-');
  const filename = `${env.BACKUP_FILE_PREFIX}-${timestamp}.tar.gz`;

  // Create secure temp file with restricted permissions (0600)
  const filepath = await createSecureTempPath(filename);

  await dumpToFile(filepath);
  await uploadToS3({ name: filename, path: filepath });
  await deleteFile(filepath);

  console.log("DB backup complete...");
}
