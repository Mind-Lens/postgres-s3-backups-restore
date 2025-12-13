import { CronJob } from "cron";
import { backup } from "./backup.js";
import { restore } from "./restore.js";
import { env } from "./env.js";

console.log("NodeJS Version: " + process.version);

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
    console.error("Error while running backup: ", error);
    process.exit(1);
  }
};

const tryRestore = async () => {
  try {
    await restore();
  } catch (error) {
    console.error("Error while running restore: ", error);
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
    console.log("Running on start backup...");
    
    await tryBackup();
    
    if (env.SINGLE_SHOT_MODE) {
      console.log("Database backup complete, exiting...");
      process.exit(0);
    }
  }
  
  const backupJob = new CronJob(env.BACKUP_CRON_SCHEDULE, async () => {
    await tryBackup();
  });
  
  backupJob.start();
  console.log("Backup cron scheduled...");
} else if (env.MODE === 'restore') {
  if (env.RESTORE_RUN_ON_STARTUP || env.RESTORE_SINGLE_SHOT_MODE) {
    console.log("Running on start restore...");
    
    await tryRestore();
    
    if (env.RESTORE_SINGLE_SHOT_MODE) {
      console.log("Database restore complete, exiting...");
      process.exit(0);
    }
  }
  
  if (env.RESTORE_CRON_SCHEDULE) {
    const restoreJob = new CronJob(env.RESTORE_CRON_SCHEDULE, async () => {
      await tryRestore();
    });
    
    restoreJob.start();
    console.log("Restore cron scheduled...");
  }
}