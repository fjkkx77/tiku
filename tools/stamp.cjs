// 给页面里引用共用文件的地址盖上版本号（?v=xxxx）。
//   node tools/stamp.cjs          改了 assets/ 里任何一个共用文件之后跑一次
//   node tools/stamp.cjs --check  只检查，不改文件（tests/run.cjs 会调它；对不上就是忘了盖）
// 版本号 = 全部共用文件内容算出来的指纹：内容没变它就不变，内容一变它就变，不用人记着去改几十处。
// 为什么需要：GitHub Pages 让浏览器把 css/js 缓存 10 分钟，地址不变的话手机上可能还在用旧文件。
// 2026-10-19 起多了多设备同步的几个文件，首页（根目录 index.html）也引用了它们，一起盖。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const SHARED = ['quiz.css', 'quiz.js', 'sync-core.js', 'sync-client.js', 'sync-panel.js', 'sync-panel.css', 'tiku-sync.js'];
const eol = s => s.replace(/\r\n/g, '\n');   // 指纹按统一换行算，免得同一份内容在不同电脑上算出两个值
const h = crypto.createHash('sha1');
SHARED.forEach(f => h.update(eol(fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'))));
const stamp = h.digest('hex').slice(0, 10);
const check = process.argv.includes('--check');
const RE = /(assets\/(?:quiz|sync-core|sync-client|sync-panel|tiku-sync)\.(?:css|js)\?v=)([0-9A-Za-z]+)/g;
const files = [path.join(ROOT, 'index.html')];
for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (dir.isDirectory() && fs.existsSync(path.join(ROOT, dir.name, 'index.html'))) files.push(path.join(ROOT, dir.name, 'index.html'));
}
let stale = 0, pages = 0;
for (const f of files) {
  const name = path.relative(ROOT, f).replace(/\\/g, '/');
  const t = fs.readFileSync(f, 'utf8');
  const found = [...t.matchAll(RE)];
  if (!found.length) continue;
  pages++;
  if (found.every(m => m[2] === stamp)) continue;
  stale++;
  if (check) console.log('版本号过期：' + name + '（应为 ' + stamp + '）');
  else { fs.writeFileSync(f, t.replace(RE, (_, a) => a + stamp)); console.log('已更新 ' + name); }
}
console.log((check ? '检查' : '完成') + '：' + pages + ' 个页面，' + (check ? '过期 ' : '改了 ') + stale + ' 个；版本号 ' + stamp);
process.exit(check && stale ? 1 : 0);
