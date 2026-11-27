const assert = require('node:assert/strict');

async function checkPracticeScope(browser, base, pressStart) {
  const url = new URL('linux-network/', base).href;
  await browser.goto(url);
  const key = '"linuxnetworkquiz_progs"';
  const legacy = await browser.ev(`(()=>{
    localStorage.clear();
    const Q=__quiz, old=QUESTIONS.filter(q=>q.cat!=="期末复习汇编");
    Q.startQuiz(old,"全部作业",false);
    Q.session.idx=41;
    Q.renderQuestion();
    const q=Q.session.queue[41];
    Q.pickOption(Object.keys(q.options).find(k=>k!==q.correct));
    if(!Q.session.answers[41]) Q.submitAnswer();
    Q.showScreen("home"); Q.renderCatList();
    return JSON.parse(localStorage.getItem(${key}))["全部作业"];
  })()`);
  assert.equal(legacy.ids.length, 65);
  assert.equal(legacy.idx, 41);
  assert.equal(legacy.answers.filter(Boolean).length, 1);
  await browser.goto(url);

  const start = pressStart || (()=>browser.ev('document.getElementById("startBtn").click()'));
  const slots = () => browser.ev(`JSON.parse(localStorage.getItem(${key}))`);
  const state = () => browser.ev(`(()=>{
    const s=__quiz.session;
    return {size:s.queue.length, idx:s.idx, slot:s.slot, answers:s.answers.filter(Boolean).length,
      categories:[...new Set(s.queue.map(q=>q.cat))], bar:document.getElementById("quizProgressText").textContent};
  })()`);
  const home = () => browser.ev('__quiz.showScreen("home");__quiz.renderCatList()');
  const answerWrong = () => browser.ev(`(()=>{
    const Q=__quiz, i=Q.session.idx, q=Q.session.queue[i];
    Q.pickOption(Object.keys(q.options).find(k=>k!==q.correct));
    if(!Q.session.answers[i]) Q.submitAnswer();
  })()`);
  const clickProgress = (slot, action) => browser.ev(`document.querySelector('.resume-row[data-slot="'+CSS.escape(${JSON.stringify(slot)})+'"] .resume-${action}').click()`);

  await start();
  const fresh = await state();
  assert.equal(fresh.size, 119, '旧「全部作业」存档存在时，全选并开始应进入 119 题');
  assert.equal(fresh.bar, '1/119');
  assert.deepEqual(fresh.categories, ['作业一','作业二','作业三','期末复习汇编']);
  assert.notEqual(fresh.slot, '全部作业');
  assert.deepEqual((await slots())['全部作业'], legacy);

  await home();
  await clickProgress(fresh.slot, 'restart');
  assert.equal((await state()).slot, fresh.slot);
  assert.deepEqual((await slots())['全部作业'], legacy);

  await browser.ev('__quiz.session.idx=4;__quiz.renderQuestion()');
  await answerWrong();
  await home();
  await start();
  const resumed = await state();
  assert.equal(resumed.slot, fresh.slot);
  assert.equal(resumed.idx, 4);
  assert.equal(resumed.answers, 1);
  await browser.ev('__quiz.finishQuiz();document.getElementById("retryAllBtn").click()');
  assert.equal((await state()).slot, fresh.slot);
  assert.deepEqual((await slots())['全部作业'], legacy);

  await home();
  await clickProgress('全部作业', 'continue');
  const old = await state();
  assert.equal(old.size, 65);
  assert.equal(old.idx, 41);
  assert.equal(old.answers, 1);
  assert.equal(old.bar, '42/65');

  // 同名且同题数的题单也要检查具体成员，随机顺序可以正常续练。
  await browser.ev(`(()=>{
    __quiz.startQuiz(QUESTIONS.filter(q=>q.cat==="作业三"),"作业二",false);
  })()`);
  await answerWrong();
  await home();
  await browser.ev(`(()=>{
    for(const el of document.querySelectorAll(".catChk")) el.checked = el.value==="作业二";
    document.querySelector('input[name="order"][value="random"]').click();
  })()`);
  await start();
  const selected = await state();
  assert.equal(selected.size, 20);
  assert.deepEqual(selected.categories, ['作业二']);
  assert.notEqual(selected.slot, '作业二');
  await answerWrong();
  await home();
  await start();
  assert.equal((await state()).slot, selected.slot);
  assert.equal((await state()).answers, 1);
}

module.exports = { checkPracticeScope };
