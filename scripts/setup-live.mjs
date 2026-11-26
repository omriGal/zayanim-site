// One-time setup of the live site: asks for the group code (paste it at the prompt, or copy
// it and just press Enter), then uploads the friends' photos and brings the families in line
// with people.local.json.
// Usage: node scripts/setup-live.mjs https://zayanim.xyz
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';

if (!process.argv[2]) throw new Error('Usage: node scripts/setup-live.mjs <site url>');

const looksLikeCode = s => s.length >= 15 && s.length <= 200 && !/\s/.test(s);
const clipboard = () => process.platform === 'win32'
  ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' }).trim()
  : execFileSync('pbpaste', { encoding: 'utf8' }).trim();

if (!process.env.ZAYANIM_CODE) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question('הדביקו כאן את קוד הקבוצה ולחצו Enter: ')).trim();
  rl.close();
  const code = typed || clipboard();
  // Don't echo what was pasted or copied; just say it isn't a code.
  if (!looksLikeCode(code)) {
    console.error('זה לא נראה כמו קוד הקבוצה (15-200 תווים, בלי רווחים). נסו שוב עם הקוד בלבד.');
    process.exit(1);
  }
  process.env.ZAYANIM_CODE = code;
}

console.log('— תמונות');
await import('./upload-photos.mjs');
console.log('— משפחות');
await import('./add-people.mjs');
