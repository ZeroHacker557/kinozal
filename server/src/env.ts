/** Loyiha ildizidagi .env faylini yuklash (boshqa modullardan oldin import qilinadi). */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(file)) process.loadEnvFile(file);
