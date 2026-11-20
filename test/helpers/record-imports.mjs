// Loader hook: records every module resolved while importing the target, then
// prints them as JSON. Usage: node --import ./record-imports.mjs -e "..."
import { register } from 'node:module';
register(new URL('./record-imports-hooks.mjs', import.meta.url));
