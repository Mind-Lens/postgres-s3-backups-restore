import { envsafe, str, bool, makeValidator } from "envsafe";

const mode = makeValidator<string>((input) => {
  const validModes = ['backup', 'restore'];
  const lowerInput = input.toLowerCase();
  if (!validModes.includes(lowerInput)) {
    throw new Error(`MODE must be one of: ${validModes.join(', ')}`);
  }
  return lowerInput;
});

export const env = envsafe({
  AWS_ACCESS_KEY_ID: str(),
  AWS_SECRET_ACCESS_KEY: str(),
  AWS_S3_BUCKET: str(),
  AWS_S3_REGION: str(),
  BACKUP_DATABASE_URL: str({
    desc: 'The connection string of the database to backup.',
    default: '',
    allowEmpty: true,
  }),
  BACKUP_CRON_SCHEDULE: str({
    desc: 'The cron schedule to run the backup on.',
    default: '0 5 * * *',
    allowEmpty: true
  }),
  AWS_S3_ENDPOINT: str({
    desc: 'The S3 custom endpoint you want to use.',
    default: '',
    allowEmpty: true,
  }),
  AWS_S3_FORCE_PATH_STYLE: bool({
    desc: 'Use path style for the endpoint instead of the default subdomain style, useful for MinIO',
    default: false,
    allowEmpty: true
  }),
  RUN_ON_STARTUP: bool({
    desc: 'Run a backup on startup of this application',
    default: false,
    allowEmpty: true,
  }),
  BACKUP_FILE_PREFIX: str({
    desc: 'Prefix to the file name',
    default: 'backup',
  }),
  BUCKET_SUBFOLDER: str({
    desc: 'A subfolder to place the backup files in',
    default: '',
    allowEmpty: true
  }),
  SINGLE_SHOT_MODE: bool({
    desc: 'Run a single backup on start and exit when completed',
    default: false,
    allowEmpty: true,
  }),
  // This is both time consuming and resource intensive so we leave it disabled by default
  SUPPORT_OBJECT_LOCK: bool({
    desc: 'Enables support for buckets with object lock by providing an MD5 hash with the backup file',
    default: false
  }),
  BACKUP_OPTIONS: str({
    desc: 'Any valid pg_dump option.',
    default: '',
    allowEmpty: true,
  }),
  MODE: mode({
    desc: 'Operation mode: backup or restore',
    default: 'backup',
  }),
  RESTORE_DATABASE_URL: str({
    desc: 'The connection string of the database to restore to.',
    default: '',
    allowEmpty: true,
  }),
  RESTORE_FILE_KEY: str({
    desc: 'Specific S3 key to restore from. If empty, uses latest.',
    default: '',
    allowEmpty: true,
  }),
  RESTORE_CRON_SCHEDULE: str({
    desc: 'The cron schedule to run the restore on.',
    default: '',
    allowEmpty: true
  }),
  RESTORE_RUN_ON_STARTUP: bool({
    desc: 'Run a restore on startup of this application',
    default: false,
    allowEmpty: true,
  }),
  RESTORE_SINGLE_SHOT_MODE: bool({
    desc: 'Run a single restore on start and exit when completed',
    default: false,
    allowEmpty: true,
  }),
  RESTORE_OPTIONS: str({
    desc: 'Any valid pg_restore option.',
    default: '',
    allowEmpty: true,
  }),
})
