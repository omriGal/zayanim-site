// One-time setup of the live site: takes the group code from the clipboard (copy it, then
// press Enter) so it never shows on screen, then uploads the friends' photos and adds the
// families from people.local.json.
// Usage: node scripts/setup-live.mjs https://zayanim.xyz
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';

if (!process.argv[2]) throw new Error('Usage: node scripts/setup-live.mjs <site url>');

const clipboard = () => process.platform === 'win32'
  ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' }).trim()
  : execFileSync('pbpaste', { encoding: 'utf8' }).trim();

if (!process.env.ZAYANIM_CODE) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('העתיקו את קוד הקבוצה ולחצו Enter… ');
  rl.close();
  const code = clipboard();
  // Don't echo whatever else is on the clipboard; just say it isn't a code.
  if (code.length < 15 || code.length > 200 || /\s/.test(code)) {
    console.error('מה שבלוח ההעתקה לא נראה כמו קוד הקבוצה (15-200 תווים, בלי רווחים). העתיקו רק את הקוד ונסו שוב.');
    process.exit(1);
  }
  console.log(`התקבל קוד באורך ${code.length} תווים`);
  process.env.ZAYANIM_CODE = code;
}

console.log('— תמונות');
await import('./upload-photos.mjs');
console.log('— משפחות');
await import('./add-people.mjs');
