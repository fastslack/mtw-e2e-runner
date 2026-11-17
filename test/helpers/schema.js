import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const cache = new Map();
function validator(file) {
  if (!cache.has(file)) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', file), 'utf-8'));
    cache.set(file, ajv.compile(schema));
  }
  return cache.get(file);
}

/** Throws with readable errors when data does not match schemas/<file>. */
export function assertMatchesSchema(file, data) {
  const validate = validator(file);
  if (!validate(data)) {
    throw new Error(`${file} validation failed:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
  }
}

export const repoRoot = root;
