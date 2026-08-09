const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync('content.js', 'utf8');
const dom = new JSDOM(`<!doctype html>
  <main>
    <div class="appointments-container" id="choices">
      <article class="card">NO 120</article>
      <article class="card">NO 30</article>
      <article class="card">NO 480</article>
      <article class="card">NO 60</article>
      <article class="card">NO 240</article>
    </div>
    <div role="grid" id="calendar-grid">
      <div role="gridcell"><article class="card">NO 480</article></div>
      <div role="gridcell"><article class="card">NO 30</article></div>
    </div>
    <div id="aria-choices">
      <button class="booking-slot" aria-label="NO 120, 120 minutes">Book</button>
      <button class="booking-slot" aria-label="NO 30, 30 minutes">Book</button>
      <button class="booking-slot" aria-label="NO 60, 60 min">Book</button>
    </div>
  </main>`, {
  runScripts: 'dangerously',
  url: 'https://calendar.google.com/calendar/selfsched'
});

const { window } = dom;
Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
window.eval(script);

const wait = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));
const order = (selector) => [...window.document.querySelectorAll(selector)]
  .map((element) => element.textContent.trim());

(async () => {
  await wait();
  assert.deepEqual(order('#choices > .card'), ['NO 30', 'NO 60', 'NO 120', 'NO 240', 'NO 480']);
  assert.deepEqual(order('#calendar-grid .card'), ['NO 480', 'NO 30']);
  assert.deepEqual(order('#aria-choices > .booking-slot'), ['Book', 'Book', 'Book']);
  assert.deepEqual([...window.document.querySelectorAll('#aria-choices > .booking-slot')]
    .map((element) => element.getAttribute('aria-label')), [
      'NO 30, 30 minutes',
      'NO 60, 60 min',
      'NO 120, 120 minutes'
    ]);

  const added = window.document.createElement('article');
  added.className = 'card';
  added.textContent = '45 minutes';
  window.document.querySelector('#choices').append(added);
  const combined = window.document.createElement('article');
  combined.className = 'card';
  combined.textContent = '1 hour 30 minutes';
  window.document.querySelector('#choices').append(combined);
  await wait();

  assert.deepEqual(order('#choices > .card'), ['NO 30', '45 minutes', 'NO 60', '1 hour 30 minutes', 'NO 120', 'NO 240', 'NO 480']);

  combined.firstChild.data = '15 minutes';
  await wait();
  assert.deepEqual(order('#choices > .card'), ['15 minutes', 'NO 30', '45 minutes', 'NO 60', 'NO 120', 'NO 240', 'NO 480']);

  added.setAttribute('data-duration', '10');
  await wait();
  assert.deepEqual(order('#choices > .card'), ['45 minutes', '15 minutes', 'NO 30', 'NO 60', 'NO 120', 'NO 240', 'NO 480']);
  assert.equal(window.document.querySelectorAll('#choices > .card').length, 7);
  console.log('content.js tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
