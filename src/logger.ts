/**
 * Simple logging utilities with timestamps and structured output
 */

/**
 * Log a message with ISO timestamp
 */
export const log = (message: string): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

/**
 * Log a stage-prefixed message with timestamp
 */
export const logStage = (stage: string, message: string): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${stage}] ${message}`);
};

/**
 * Log an error with enhanced formatting
 * Extracts stderr from error objects if present
 */
export const logError = (message: string, error: any): void => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);

  if (error && typeof error === 'object') {
    // Check if error has stderr property (from exec callbacks)
    if (error.stderr) {
      console.error(`[${timestamp}] PostgreSQL stderr: ${error.stderr}`);
    }

    // Log the error object itself
    if (error.error) {
      console.error(`[${timestamp}] Error details:`, error.error);
    } else {
      console.error(`[${timestamp}] Error details:`, error);
    }
  } else {
    console.error(`[${timestamp}] Error details:`, error);
  }
};

/**
 * Log stderr output from PostgreSQL commands
 */
export const logStderr = (stderr: string, label: string = "PostgreSQL"): void => {
  const timestamp = new Date().toISOString();
  if (stderr && stderr.trim()) {
    console.log(`[${timestamp}] ${label} stderr: ${stderr}`);
  }
};

/**
 * Display a startup banner with configuration details
 */
export const logBanner = (title: string, details: Record<string, string>): void => {
  console.log("\n" + "=".repeat(50));
  console.log(title);
  console.log("=".repeat(50));

  // Find the longest key for alignment
  const maxKeyLength = Math.max(...Object.keys(details).map(k => k.length));

  for (const [key, value] of Object.entries(details)) {
    const padding = " ".repeat(maxKeyLength - key.length);
    console.log(`${key}:${padding} ${value}`);
  }

  console.log("=".repeat(50) + "\n");
};

/**
 * Calculate and format time duration
 */
export const formatDuration = (startTime: Date, endTime: Date): string => {
  const durationMs = endTime.getTime() - startTime.getTime();
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
};

/**
 * Format file age from timestamp
 */
export const formatAge = (date: Date): string => {
  const ageMs = Date.now() - date.getTime();
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMinutes / 60);
  const ageDays = Math.floor(ageHours / 24);

  if (ageDays > 0) {
    return `${ageDays}d ${ageHours % 24}h`;
  }
  if (ageHours > 0) {
    return `${ageHours}h ${ageMinutes % 60}m`;
  }
  return `${ageMinutes}m`;
};
