import { CronJob } from "cron";
import { backup } from "./backup.js";
import { restore } from "./restore.js";
import { env } from "./env.js";
import { logBanner, logError, log } from "./logger.js";
import { extractDatabaseHost } from "./util.js";

// Display startup banner with configuration
const executionMode =
  env.MODE === 'backup'
    ? (env.SINGLE_SHOT_MODE ? 'SINGLE-SHOT' : env.RUN_ON_STARTUP ? 'STARTUP+CRON' : 'CRON')
    : (env.RESTORE_SINGLE_SHOT_MODE ? 'SINGLE-SHOT' : env.RESTORE_RUN_ON_STARTUP ? 'STARTUP+CRON' : 'CRON');

const cronSchedule = env.MODE === 'backup' ? env.BACKUP_CRON_SCHEDULE : env.RESTORE_CRON_SCHEDULE;

const bannerDetails: Record<string, string> = {
  "Mode": env.MODE.toUpperCase(),
  "Node Version": process.version,
  "Execution": executionMode,
  "S3 Bucket": env.AWS_S3_BUCKET,
};

// Add cron schedule if in cron mode
if (!env.SINGLE_SHOT_MODE && !env.RESTORE_SINGLE_SHOT_MODE) {
  bannerDetails["Cron Schedule"] = cronSchedule || 'none';
}

// Add S3 subfolder if configured
if (env.BUCKET_SUBFOLDER) {
  bannerDetails["S3 Subfolder"] = env.BUCKET_SUBFOLDER;
}

// Add database connection info (host only, no credentials)
if (env.MODE === 'backup') {
  bannerDetails["Database"] = extractDatabaseHost(env.BACKUP_DATABASE_URL);
} else if (env.RESTORE_DATABASE_URL) {
  bannerDetails["Database"] = extractDatabaseHost(env.RESTORE_DATABASE_URL);
}

logBanner("PostgreSQL Backup/Restore Service", bannerDetails);

// Validate restore-specific requirements when in restore mode
if (env.MODE === 'restore') {
  if (!env.RESTORE_DATABASE_URL) {
    console.error("RESTORE_DATABASE_URL is required when MODE=restore");
    process.exit(1);
  }
}

const tryBackup = async () => {
  try {
    await backup();
  } catch (error) {
    logError("Backup failed", error);
    process.exit(1);
  }
};

const tryRestore = async () => {
  try {
    await restore();
  } catch (error) {
    logError("Restore failed", error);
    process.exit(1);
  }
};

// Function to execute the appropriate operation based on mode
const executeOperation = async () => {
  if (env.MODE === 'backup') {
    await tryBackup();
  } else if (env.MODE === 'restore') {
    await tryRestore();
  }
};

// Handle startup execution modes
if (env.MODE === 'backup') {
  if (env.RUN_ON_STARTUP || env.SINGLE_SHOT_MODE) {
    log("[BACKUP MODE] Running backup on startup...");

    await tryBackup();

    if (env.SINGLE_SHOT_MODE) {
      log("[BACKUP MODE] Backup complete, exiting...");
      process.exit(0);
    }
  }

  if (!env.SINGLE_SHOT_MODE) {
    const backupJob = new CronJob(env.BACKUP_CRON_SCHEDULE, async () => {
      await tryBackup();
    });

    backupJob.start();
    const nextRun = backupJob.nextDate();
    log(`[BACKUP MODE] Cron scheduled: ${env.BACKUP_CRON_SCHEDULE} (next run: ${nextRun.toISO()})`);
  }
} else if (env.MODE === 'restore') {
  if (env.RESTORE_RUN_ON_STARTUP || env.RESTORE_SINGLE_SHOT_MODE) {
    log("[RESTORE MODE] Running restore on startup...");

    await tryRestore();

    if (env.RESTORE_SINGLE_SHOT_MODE) {
      log("[RESTORE MODE] Restore complete, exiting...");
      process.exit(0);
    }
  }

  if (env.RESTORE_CRON_SCHEDULE && !env.RESTORE_SINGLE_SHOT_MODE) {
    const restoreJob = new CronJob(env.RESTORE_CRON_SCHEDULE, async () => {
      await tryRestore();
    });

    restoreJob.start();
    const nextRun = restoreJob.nextDate();
    log(`[RESTORE MODE] Cron scheduled: ${env.RESTORE_CRON_SCHEDULE} (next run: ${nextRun.toISO()})`);
  }
}