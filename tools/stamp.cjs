// 给 8 个科目页里引用共用文件的地址盖上版本号（?v=xxxx）。
//   node tools/stamp.cjs          改了 assets/quiz.css 或 assets/quiz.js 之后跑一次
//   node tools/stamp.cjs --check  只检查，不改文件（tests/run.cjs 会调它；对不上就是忘了盖）
// 版本号 = 两个共用文件内容算出来的指纹：内容没变它就不变，内容一变它就变，不用人记着去改 16 处。
// 为什么需要：GitHub Pages 让浏览器把 css/js 缓存 10 分钟，地址不变的话手机上可能还在用旧文件。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const eol = s => s.replace(/\r\n/g, '\n');   // 指纹按统一换行算，免得同一份内容在不同电脑上算出两个值
const stamp = crypto.createHash('sha1').update(eol(fs.readFileSync(path.join(ROOT, 'assets/quiz.css'), 'utf8'))).update(eol(fs.readFileSync(path.join(ROOT, 'assets/quiz.js'), 'utf8'))).digest('hex').slice(0, 10);
const check = process.argv.includes('--check');
const RE = /(assets\/quiz\.(?:css|js)\?v=)([0-9A-Za-z]+)/g;
let stale = 0, pages = 0;
for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const f = path.join(ROOT, dir.name, 'index.html');
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const found = [...t.matchAll(RE)];
  if (!found.length) continue;
  pages++;
  if (found.every(m => m[2] === stamp)) continue;
  stale++;
  if (check) console.log('版本号过期：' + dir.name + '/index.html（现在是 ' + found[0][2] + '，应为 ' + stamp + '）');
  else { fs.writeFileSync(f, t.replace(RE, (_, a) => a + stamp)); console.log('已更新 ' + dir.name + '/index.html'); }
}
console.log((check ? '检查' : '完成') + '：' + pages + ' 个科目页，' + (check ? '过期 ' : '改了 ') + stale + ' 个；版本号 ' + stamp);
process.exit(check && stale ? 1 : 0);
