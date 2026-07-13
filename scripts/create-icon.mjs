import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = process.cwd();
const source = path.join(root, 'assets', 'thuishub-logo-source.png');
const publicBrand = path.join(root, 'public', 'brand');
const buildDir = path.join(root, 'build');
const sizes = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512];

await fs.mkdir(publicBrand, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });

const metadata = await sharp(source).metadata();
if (metadata.width !== 1536 || metadata.height !== 1024) {
  throw new Error('Het aangeleverde ThuisHub-bronlogo heeft onverwachte afmetingen.');
}

// Bewaar het aangeleverde logo exact; maak daarnaast een compacte merkmarkering
// voor Windows-, PWA- en systeemvakiconen.
await sharp(source)
  .resize({ width: 1536, withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicBrand, 'thuishub-logo.png'));

const iconSource = sharp(source).extract({ left: 280, top: 330, width: 300, height: 300 });
const icoInputs = [];
for (const size of sizes) {
  const output = path.join(publicBrand, `thuishub-icon-${size}.png`);
  await iconSource.clone().resize(size, size, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(output);
  if ([16, 24, 32, 48, 64, 128, 256].includes(size)) icoInputs.push(output);
}

await fs.copyFile(path.join(publicBrand, 'thuishub-icon-512.png'), path.join(buildDir, 'icon.png'));
await fs.writeFile(path.join(buildDir, 'icon.ico'), await pngToIco(icoInputs));

console.log(`ThuisHub-logo en ${sizes.length} pictogramformaten gemaakt.`);
