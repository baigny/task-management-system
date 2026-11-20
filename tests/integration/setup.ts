import 'dotenv/config';
import { testDatabaseUrl } from '../../scripts/test-database.js';
process.env.DATABASE_URL = testDatabaseUrl(process.env.TEST_DATABASE_URL);
process.env.UPLOAD_DIR = '.tmp/test-uploads';
process.env.SMTP_HOST = 'localhost';
