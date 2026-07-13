import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(root,'server','dist');
if(path.dirname(target)!==path.join(root,'server')||path.basename(target)!=='dist')throw new Error('Onveilige server/dist-locatie; opschonen afgebroken.');
fs.rmSync(target,{recursive:true,force:true});
fs.mkdirSync(target,{recursive:true});
console.log('Oude server/dist-uitvoer veilig opgeschoond.');
