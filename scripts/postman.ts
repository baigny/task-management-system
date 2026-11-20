import { readFile, writeFile } from 'node:fs/promises';
import { postmanCollection } from './postman-collection.js';

const path = 'postman/TaskManagement.postman_collection.json';
const expected = JSON.stringify(postmanCollection(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  // Normalize Windows checkout line endings without hiding meaningful documentation drift.
  const actual = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  if (actual !== expected) throw new Error('Postman collection is out of date. Run npm run docs:postman.');
  console.info('Postman collection matches the API contract');
} else {
  await writeFile(path, expected);
}
