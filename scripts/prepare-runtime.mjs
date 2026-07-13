import fs from 'node:fs/promises';
import path from 'node:path';

const runtimeDir = path.join(process.cwd(), 'build', 'runtime');
const target = path.join(runtimeDir, 'node.exe');

await fs.mkdir(runtimeDir, { recursive: true });
await fs.copyFile(process.execPath, target);
console.log(`Node-runtime gekopieerd naar ${target}`);
