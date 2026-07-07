import dotenv from 'dotenv';
import path from 'path';

// Load .env.local for local runs only. Lambda gets env vars from AWS at runtime.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
}
