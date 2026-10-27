// One-time setup of the live site: asks for the group code (not echoed), then uploads
// the friends' photos and adds the families from people.local.json.
// Usage: node scripts/setup-live.mjs https://zayanim.xyz
import { createInterface } from 'node:readline';

if (!process.argv[2]) throw new Error('Usage: node scripts/setup-live.mjs <site url>');

if (!process.env.ZAYANIM_CODE) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (s.includes('קוד הקבוצה')) process.stdout.write(s); };
  process.env.ZAYANIM_CODE = (await new Promise(done => rl.question('קוד הקבוצה: ', done))).trim();
  rl.close();
  process.stdout.write('\n');
}

console.log('— תמונות');
await import('./upload-photos.mjs');
console.log('— משפחות');
await import('./add-people.mjs');
