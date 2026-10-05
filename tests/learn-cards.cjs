// Learning cards: the learn tool's arguments are normalised on the server, and the app
// scores quizzes, checks typed answers, flips flashcards and plots functions locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { learnArgs, learnSummary, plainMath, resultCard } = require('../server/agents/cards');
const { TOOLS, pickTools } = require('../server/agents/tools');
const { TOOL_SCHEMAS } = require('../server/agents/vm-harness');

(async () => {
  /* ---------- server: what the agent sends becomes a safe, complete card ---------- */
  // The correct option is given as its text, a letter or a 0-based index; a question whose
  // answer matches no option is dropped instead of being scored wrong.
  const quiz = learnArgs({ kind: 'quiz', title: 'Capitals', questions: [
    { question: 'Capital of France?', options: ['Lyon', 'Paris', 'Nice'], answer: 'paris.', explanation: 'Paris since 987.' },
    { question: 'Capital of Spain?', options: ['Madrid', 'Seville'], answer: 'A' },
    { question: 'Capital of Italy?', options: ['Milan', 'Rome', 'Turin'], answer: '1' },
    { question: 'Broken', options: ['a', 'b'], answer: 'c' },
    { question: 'One option', options: ['a'], answer: 'a' },
  ] });
  assert.equal(quiz.type, 'learn');
  assert.equal(quiz.questions.length, 3, 'unanswerable questions are dropped');
  assert.deepEqual(quiz.questions.map((q) => q.options[q.answer]), ['Paris', 'Madrid', 'Rome']);
  assert.equal(quiz.questions[0].explanation, 'Paris since 987.');
  // The right option does not always sit in the same place, and the same question keeps its order.
  const many = learnArgs({ kind: 'quiz', title: 't', questions: Array.from({ length: 8 }, (_, i) => ({ question: `What is ${i} + ${i}?`, options: ['w', 'RIGHT', 'x', 'y'], answer: 'RIGHT' })) });
  assert.ok(new Set(many.questions.map((q) => q.answer)).size >= 3, 'answers are spread over the options');
  assert.deepEqual(learnArgs({ kind: 'quiz', title: 't', questions: [{ question: 'What is 0 + 0?', options: ['w', 'RIGHT', 'x', 'y'], answer: 'RIGHT' }] }).questions[0], many.questions[0]);
  const above = learnArgs({ kind: 'quiz', title: 't', questions: [{ question: 'Which?', options: ['a', 'b', 'All of the above'], answer: 'All of the above' }] });
  assert.deepEqual(above.questions[0].options, ['a', 'b', 'All of the above'], '"All of the above" keeps the order it refers to');

  const flash = learnArgs({ kind: 'flashcards', title: 'Verbs', cards: [{ front: 'ser', back: 'to be' }, { front: '', back: 'x' }] });
  assert.deepEqual(flash.cards, [{ front: 'ser', back: 'to be' }]);

  const problem = learnArgs({ kind: 'problem', title: 'Equations', problems: [{ question: 'Solve 3x - 5 = 10', steps: ['Add 5', 'Divide by 3'], answer: 'x = 5', accept: ['5'] }, { question: 'No answer' }] });
  assert.equal(problem.problems.length, 1);
  assert.deepEqual(problem.problems[0].steps, ['Add 5', 'Divide by 3']);

  // LaTeX the model writes anyway becomes the plain math the app draws.
  const bs = String.fromCharCode(92);
  assert.equal(plainMath(`$${bs}frac{x+1}{2} = ${bs}sqrt{9}$, ${bs}pi ${bs}cdot r^2 ${bs}le 3`), '(x+1)/2 = sqrt(9), π · r^2 ≤ 3');

  // Graphs accept only arithmetic in x, one slider letter and known functions.
  const plot = learnArgs({ kind: 'plot', title: 'Parabola', plot: { functions: [{ expr: 'y = a*x^2 - 4' }, { expr: 'alert(1)' }, { expr: 'fetch(x)' }, 'sin(x)', { expr: 'x^(2' }],
    slider: { name: 'a', min: -3, max: 3 }, x_min: 5, x_max: -5, points: [{ x: 2, y: 0, label: 'root' }, { x: 'bad', y: 1 }] } });
  assert.deepEqual(plot.functions.map((f) => f.expr), ['a*x^2 - 4', 'sin(x)']);
  assert.deepEqual(plot.x, [-10, 10], 'a reversed range falls back to the default');
  assert.equal(plot.slider.value, 1, 'the slider starts at 1 when that is in range');
  assert.deepEqual(plot.points, [{ x: 2, y: 0, label: 'root' }]);
  assert.equal(learnArgs({ kind: 'plot', title: 'x', plot: { functions: [{ expr: 'b*x' }] } }).functions.length, 0, 'a letter that is not the slider is refused');

  // The tool, the worker's card and the agent's view of it.
  assert.ok(TOOL_SCHEMAS.some((s) => s.name === 'learn'), 'learn has a model schema');
  const ran = await TOOLS.learn.run({ kind: 'quiz', title: 'Q', questions: [{ question: 'a?', options: ['x', 'y'], answer: 'y' }] }, { trace: () => {} });
  assert.equal(ran.shown, true); assert.equal(ran.count, 1);
  const empty = await TOOLS.learn.run({ kind: 'quiz', title: 'Q', questions: [{ question: 'a?', options: ['x', 'y'], answer: 'z' }] }, { trace: () => {} });
  assert.equal(empty.shown, false); assert.match(empty.note, /call learn again/i);
  assert.equal(resultCard('learn', empty, {}), null, 'an empty learning card is not shown');
  assert.equal(resultCard('learn', ran, { kind: 'quiz', title: 'Q', questions: [{ question: 'a?', options: ['x', 'y'], answer: 'y' }] }).type, 'learn');
  assert.deepEqual(learnSummary(quiz), { shown: true, kind: 'quiz', title: 'Capitals', count: 3 });
  // Workers get the tool for study requests, not for everything.
  assert.ok(pickTools('Quiz me on Spanish verbs').some((t) => t.name === 'learn'));
  assert.ok(pickTools('Förhör mig på glosor').some((t) => t.name === 'learn'));
  assert.ok(!pickTools('Plan a trip to Rome').some((t) => t.name === 'learn'));

  /* ---------- app: scoring, checking and drawing ---------- */
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('/* ---------- learning cards');
  const end = source.indexOf("if (typeof window !== 'undefined') window.learnSummaryText", start);
  assert.ok(start >= 0 && end > start);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const painted = [];
  const context = vm.createContext({ esc, icon: (n) => `[${n}]`, cvHead: (t, title, sub) => `<h>${title}|${sub}</h>`, cvTile: (n) => n,
    replaceNode: (c, m) => painted.push(m.id), save: () => {}, document: { querySelector: () => null }, setTimeout, clearTimeout });
  vm.runInContext(`${source.slice(start, end)}\nthis.api = { learnMath, learnAnswerOk, learnCardHTML, learnAct, learnCheck, learnSummaryText, learnCompile, learnPlotSVG };`, context);
  const app = context.api;

  assert.equal(app.learnMath('x^2 + sqrt(x) <= pi'), 'x<sup>2</sup> + √(x) ≤ π');
  assert.equal(app.learnMath('a_1 * b^{n+1}'), 'a<sub>1</sub>·b<sup>n+1</sup>');
  assert.equal(app.learnMath('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', 'card text is escaped');

  // Typed answers: the same value written another way is right; another value is not.
  const p = (answer, accept) => ({ answer, accept });
  for (const [typed, want] of [['5', p('x = 5')], ['x=5', p('x = 5')], ['3/4', p('0.75')], ['0,75', p('3/4')], ['-2, 2', p('x = 2 or x = -2')],
    ['Paris', p('paris')], ['12 cm', p('12')], ['x = ±2', p('x = 2 or x = -2', ['x = ±2'])]]) assert.ok(app.learnAnswerOk(typed, want), `${typed} matches ${want.answer}`);
  for (const [typed, want] of [['6', p('x = 5')], ['', p('5')], ['2', p('x = 2 or x = -2')], ['5 bananas please', p('5')]]) assert.ok(!app.learnAnswerOk(typed, want), `${typed} does not match ${want.answer}`);

  // Functions of x evaluate correctly, with implicit multiplication and precedence.
  const at = (expr, x, a) => app.learnCompile(expr, 'a')({ x, a });
  assert.equal(at('x^2 - 4', 3), 5);
  assert.equal(at('-x^2', 3), -9, 'a power binds before the sign');
  assert.equal(at('2x + 1', 4), 9);
  assert.equal(at('3(x+1)', 1), 6);
  assert.equal(at('a*x^2', 2, 0.5), 2);
  assert.ok(Math.abs(at('sin(pi/2) + ln(e) + log(100)', 0) - 4) < 1e-9);
  assert.equal(app.learnCompile('x +'), null);
  assert.equal(app.learnCompile('constructor'), null, 'unknown names never reach the scope');

  // A quiz: pick, next, score; the agent hears how it went.
  const chat = { id: 'c1' };
  const msg = { id: 'm1', card: quiz };
  assert.match(app.learnCardHTML(chat, msg), /Question 1 of 3/);
  app.learnAct(chat, msg, 'learn-pick', { dataset: { o: String(quiz.questions[0].answer) } });
  assert.match(app.learnCardHTML(chat, msg), /Correct!/);
  app.learnAct(chat, msg, 'learn-next', {});
  const wrong = quiz.questions[1].answer === 0 ? 1 : 0;
  app.learnAct(chat, msg, 'learn-pick', { dataset: { o: String(wrong) } });
  app.learnAct(chat, msg, 'learn-pick', { dataset: { o: String(quiz.questions[1].answer) } });
  assert.equal(quiz.progress.picks[1], wrong, 'the first pick counts');
  assert.match(app.learnCardHTML(chat, msg), /Not quite\. The answer is Madrid/);
  app.learnAct(chat, msg, 'learn-next', {});
  app.learnAct(chat, msg, 'learn-pick', { dataset: { o: String(quiz.questions[2].answer) } });
  app.learnAct(chat, msg, 'learn-next', {});
  assert.match(app.learnCardHTML(chat, msg), /2<small>\/3<\/small>/);
  assert.match(app.learnSummaryText(quiz), /^3\/3 answered, 2 right; missed: Capital of Spain\?/);
  app.learnAct(chat, msg, 'learn-restart', {});
  assert.equal(app.learnSummaryText(quiz), 'not started');

  // Flashcards: every card marked once, then the score and a review of the missed ones.
  const cards = learnArgs({ kind: 'flashcards', title: 'F', cards: [{ front: 'a', back: '1' }, { front: 'b', back: '2' }, { front: 'c', back: '3' }] });
  const fm = { id: 'm2', card: cards };
  for (const act of ['learn-known', 'learn-again', 'learn-known']) { app.learnAct(chat, fm, 'learn-flip', {}); app.learnAct(chat, fm, act, {}); }
  assert.equal(cards.progress.done, true);
  assert.match(app.learnCardHTML(chat, fm), /1 to review again/);
  app.learnAct(chat, fm, 'learn-review', {});
  assert.equal(cards.progress.i, 1, 'review starts at the card still being learnt');

  // A problem: a wrong answer, a hint, then the right one.
  const pm = { id: 'm3', card: problem };
  const form = (value) => ({ elements: { answer: { value, focus() {} } } });
  app.learnCheck(chat, pm, form('4'));
  assert.match(app.learnCardHTML(chat, pm), /Not quite/);
  app.learnAct(chat, pm, 'learn-hint', {});
  assert.match(app.learnCardHTML(chat, pm), /<li>Add 5<\/li>/);
  app.learnCheck(chat, pm, form('x = 5'));
  assert.match(app.learnCardHTML(chat, pm), /Correct! x = 5/);
  assert.equal(app.learnSummaryText(problem), '1/1 solved, 0 solutions shown, 1 hints used');

  // A graph draws its curves, and an asymptote breaks the line instead of joining it.
  const svg = app.learnPlotSVG(learnArgs({ kind: 'plot', title: 't', plot: { functions: [{ expr: '1/x' }], x_min: -5, x_max: 5, y_min: -5, y_max: 5 } }), undefined);
  assert.equal((svg.match(/<path d="M/g) || []).length, 1);
  assert.ok((svg.match(/M[\d.]+ [\d.-]+/g) || []).length >= 2, '1/x is drawn as two pieces');
  console.log('learn-cards: ok');
})().catch((error) => { console.error(error); process.exit(1); });
