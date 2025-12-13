import crypto from 'crypto';
import fs from 'fs';
import { open } from 'fs/promises';
import path from 'path';
import os from 'os';
import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import { env } from "./env.js";

/**
 * Escapes a string for safe use in shell commands by wrapping in single quotes
 * and escaping any existing single quotes
 */
export const escapeShellArg = (arg: string): string => {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
};

export const createMD5 = (path: string) => new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const rs = fs.createReadStream(path)
    rs.on('error', reject)
    rs.on('data', chunk => hash.update(chunk))
    rs.on('end', () => resolve(hash.digest('hex')))
});

export const createS3Client = (): S3Client => {
  const clientOptions: S3ClientConfig = {
    region: env.AWS_S3_REGION,
    forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE
  }

  if (env.AWS_S3_ENDPOINT) {
    console.log(`Using custom endpoint: ${env.AWS_S3_ENDPOINT}`);
    clientOptions.endpoint = env.AWS_S3_ENDPOINT;
  }

  return new S3Client(clientOptions);
};

export const getS3Key = (name: string): string => {
  // Validate against path traversal attacks
  if (name.includes('..') || name.startsWith('/')) {
    throw new Error(`Invalid S3 key: path traversal detected in "${name}"`);
  }

  if (env.BUCKET_SUBFOLDER) {
    return env.BUCKET_SUBFOLDER + "/" + name;
  }
  return name;
};

/**
 * Creates a secure temporary file path with restricted permissions (0600)
 * Returns the file path which will be created with secure permissions
 */
export const createSecureTempPath = async (filename: string): Promise<string> => {
  const filepath = path.join(os.tmpdir(), filename);

  // Create file with restricted permissions (rw-------)
  const fileHandle = await open(filepath, 'w', 0o600);
  await fileHandle.close();

  return filepath;
};