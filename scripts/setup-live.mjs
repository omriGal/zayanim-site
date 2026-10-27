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
  if (code.length < 15) throw new Error('בלוח ההעתקה אין קוד באורך 15 תווים לפחות');
  console.log(`התקבל קוד באורך ${code.length} תווים`);
  process.env.ZAYANIM_CODE = code;
}

console.log('— תמונות');
await import('./upload-photos.mjs');
console.log('— משפחות');
await import('./add-people.mjs');
