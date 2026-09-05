/*
 * Deterministic application-control-flow regression checks.
 * Executes the actual complete script.js with media/EventTarget fixtures.
 * These checks supplement, and do not replace, real-browser fault recovery.
 * Run: node scripts/media-recovery-tests.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, once: Boolean(options?.once) });
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.fn !== fn));
  }
  emit(type, extra = {}) {
    const event = { type, target: this, preventDefault() {}, ...extra };
    for (const item of [...(this.listeners.get(type) || [])]) {
      if (item.once) this.removeEventListener(type, item.fn);
      item.fn.call(this, event);
    }
  }
}

class Clock {
  constructor() { this.now = 0; this.nextId = 1; this.jobs = new Map(); }
  setTimeout(fn, delay = 0) {
    const id = this.nextId++;
    this.jobs.set(id, { due: this.now + Math.max(0, delay), fn });
    return id;
  }
  clearTimeout(id) { this.jobs.delete(id); }
  async advance(ms) {
    const end = this.now + ms;
    for (let guard = 0; guard < 10000; guard += 1) {
      const next = [...this.jobs].filter(([, job]) => job.due <= end)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) { this.now = end; await flush(); return; }
      this.now = next[1].due;
      this.jobs.delete(next[0]);
      next[1].fn();
      await flush();
    }
    throw Error('Runaway deterministic timer loop');
  }
}

class Element extends Events {
  constructor() {
    super();
    this.attributes = new Map();
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  querySelectorAll() { return []; }
  querySelector() { return new Element(); }
  closest() { return null; }
  contains(element) { return element === this; }
  focus() {}
  scrollIntoView() {}
}

class Video extends Element {
  constructor(markup, clock) {
    super();
    this.clock = clock;
    this.sources = [...markup.matchAll(/<source\b([^>]+)>/g)].map(([, attrs]) => {
      const source = new Element();
      source.media = attrs.match(/\bmedia="([^"]+)"/)?.[1] || '';
      source.dataset.src = attrs.match(/\bdata-src="([^"]+)"/)?.[1];
      return source;
    });
    this.dataset.posterWide = markup.match(/\bdata-poster-wide="([^"]+)"/)?.[1];
    this.dataset.posterTall = markup.match(/\bdata-poster-tall="([^"]+)"/)?.[1];
    this.paused = true;
    this.currentTime = 0;
    this.duration = NaN;
    this.readyState = 0;
    this.networkState = 0;
    this.error = null;
    this.ended = false;
    this.generation = 0;
    this.pendingPlay = [];
    this.requests = [];
    this.loadFailure = 0;
    this.metadataDuration = 30;
    this.buffered = { length: 1, start: () => 0, end: () => 30 };
  }
  get src() { return this.getAttribute('src') || ''; }
  set src(value) { this.setAttribute('src', value); }
  get poster() { return this.getAttribute('poster'); }
  set poster(value) { this.setAttribute('poster', value); }
  get currentSrc() { return this.src; }
  querySelectorAll(selector) {
    return selector === 'source[src]' ? this.sources.filter(source => source.hasAttribute('src')) : this.sources;
  }
  rejectPlay(name) {
    const error = Object.assign(new Error(name), { name });
    this.pendingPlay.splice(0).forEach(pending => pending.reject(error));
  }
  pause() { this.paused = true; this.rejectPlay('AbortError'); this.emit('pause'); }
  load() {
    const generation = ++this.generation;
    this.rejectPlay('AbortError');
    this.paused = true;
    this.currentTime = 0;
    this.duration = NaN;
    this.readyState = 0;
    this.networkState = this.src ? 2 : 0;
    this.error = null;
    if (!this.src) return;
    this.requests.push({ at: this.clock.now, src: this.src });
    queueMicrotask(() => {
      if (generation !== this.generation || !this.src) return;
      if (this.loadFailure) { this.fail(this.loadFailure); return; }
      this.duration = this.metadataDuration;
      this.readyState = 4;
      this.networkState = 1;
      this.emit('loadedmetadata');
      this.emit('loadeddata');
      this.emit('canplay');
      if (!this.paused) {
        this.emit('playing');
        this.pendingPlay.splice(0).forEach(pending => pending.resolve());
      }
    });
  }
  play() {
    if (this.error) return Promise.reject(Object.assign(new Error('Media source failed'), { name: 'NotSupportedError' }));
    this.paused = false;
    if (this.readyState >= 3) { this.emit('playing'); return Promise.resolve(); }
    return new Promise((resolve, reject) => this.pendingPlay.push({ resolve, reject }));
  }
  fail(code = 4) {
    this.error = { code, message: 'Injected deterministic media failure' };
    this.paused = true;
    this.networkState = code === 4 ? 3 : 1;
    if (code === 4) this.readyState = 0;
    this.rejectPlay('NotSupportedError');
    this.emit('error');
  }
}

async function createHarness(options = {}) {
  const clock = new Clock();
  const window = new Events();
  Object.assign(window, {
    innerHeight: 900, scrollX: 0, scrollY: 0,
    setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock),
    requestAnimationFrame: fn => clock.setTimeout(() => fn(clock.now), 16),
    scrollTo({ top = 0, left = 0 }) { this.scrollY = top; this.scrollX = left; },
  });
  const narrow = Object.assign(new Events(), { matches: false });
  window.matchMedia = query => query.includes('max-width: 700px') ? narrow : { matches: true };
  const document = Object.assign(new Events(), {
    hidden: false, documentElement: new Element(), body: new Element(), activeElement: new Element(),
  });
  document.documentElement.dataset.motion = options.reduced ? 'reduced' : 'full';
  const connection = Object.assign(new Events(), { saveData: Boolean(options.saveData) });
  const navigator = { connection, onLine: options.offline ? false : true };
  const videos = [...html.matchAll(/<video\b[\s\S]*?<\/video>/g)].map(([markup]) => new Video(markup, clock));
  assert.equal(videos.length, 5, 'Fixture must use all five actual film elements');
  videos[0].loadFailure = options.failure || 0;
  const films = videos.map(video => Object.assign(new Element(), { querySelector: () => video }));
  const beats = videos.map((_, index) => Object.assign(new Element(), {
    getBoundingClientRect: () => ({ top: index * 1200 - window.scrollY, bottom: (index + 1) * 1200 - window.scrollY }),
  }));
  const passage = Object.assign(new Element(), {
    getBoundingClientRect: () => options.offscreen ? { top: -7000, bottom: -100 } : { top: -window.scrollY, bottom: 7000 - window.scrollY },
  });
  const header = Object.assign(new Element(), { getBoundingClientRect: () => ({ top: 0, bottom: 100 }) });
  const motionOptions = ['full', 'reduced'].map(value => Object.assign(new Element(), { value }));
  const quote = Object.assign(new Element(), { reportValidity: () => true });
  const elements = new Map([
    ['.passage', passage], ['.site-header', header], ['#quote-form', quote],
    ['#quote', beats[4]], ['#top', passage], ['#portfolio', new Element()],
  ]);
  document.querySelectorAll = selector => selector === '.film' ? films : selector === '.beat' ? beats : selector.includes('input[name=') ? motionOptions : [];
  document.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const context = vm.createContext({
    document, window, navigator, performance: { now: () => clock.now },
    history: { pushState() {} }, localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(script, context, { filename: path.join(root, 'script.js') });
  await flush();
  return {
    clock, window, document, navigator, connection, videos, narrow,
    run: expression => vm.runInContext(expression, context),
    state: index => vm.runInContext(`mediaStates[${index}]`, context),
    async signal(target, type, extra) { target.emit(type, extra); await flush(); },
    async hidden(value) { document.hidden = value; document.emit('visibilitychange'); await flush(); },
  };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const count = harness => harness.videos[0].requests.length;

test('initial fatal failure retries exactly at 1s/4s/12s and exhausts', async () => {
  const h = await createHarness({ failure: 4 });
  await h.clock.advance(999); assert.equal(count(h), 1);
  await h.clock.advance(1); assert.equal(count(h), 2);
  await h.clock.advance(2999); assert.equal(count(h), 2);
  await h.clock.advance(1); assert.equal(count(h), 3);
  await h.clock.advance(7999); assert.equal(count(h), 3);
  await h.clock.advance(1); assert.equal(count(h), 4);
  await h.clock.advance(60000); assert.equal(count(h), 4);
  assert.deepEqual(h.videos[0].requests.map(item => item.at), [0, 1000, 4000, 12000]);
});

test('healthy films, normal scroll and repeated interaction do not reload', async () => {
  const h = await createHarness();
  for (let i = 0; i < 20; i += 1) {
    await h.signal(h.window, 'scroll');
    await h.signal(h.window, 'pointerdown');
    await h.signal(h.window, 'online');
    await h.clock.advance(1000);
  }
  assert.equal(count(h), 1);
});

test('scroll never renews an exhausted retry budget', async () => {
  const h = await createHarness({ failure: 4 });
  await h.clock.advance(12000);
  for (let i = 0; i < 30; i += 1) {
    await h.signal(h.window, 'scroll');
    await h.clock.advance(1000);
  }
  assert.equal(count(h), 4);
  assert.equal(h.state(0).retries, 3);
});

test('online renewal is retained and waits ten seconds since last actual retry', async () => {
  const h = await createHarness({ failure: 4 });
  await h.clock.advance(12000);
  h.videos[0].loadFailure = 0;
  await h.signal(h.window, 'online');
  await h.clock.advance(9999); assert.equal(count(h), 4);
  await h.clock.advance(1); assert.equal(count(h), 5);
  assert.equal(h.videos[0].error, null);
  assert.equal(h.videos[0].paused, false);
});

test('repeated explicit renewal signals cannot shorten an already queued cooldown', async () => {
  const h = await createHarness({ failure: 4 });
  await h.clock.advance(12000);
  await h.signal(h.window, 'pointerdown');
  for (let i = 0; i < 9; i += 1) {
    await h.clock.advance(1000);
    await h.signal(h.window, 'keydown');
    await h.signal(h.window, 'online');
    assert.equal(count(h), 4);
  }
  await h.clock.advance(1000); assert.equal(count(h), 5);
});

test('cancelled renewal and visibility wake cannot bypass the ten-second cooldown', async () => {
  const h = await createHarness({ failure: 4 });
  await h.clock.advance(12000);
  await h.signal(h.window, 'online');
  await h.clock.advance(1000); await h.hidden(true);
  assert.equal(h.state(0).retryTimer, null);
  await h.clock.advance(1000); await h.hidden(false);
  await h.clock.advance(7999); assert.equal(count(h), 4);
  await h.clock.advance(1); assert.equal(count(h), 5);
});

test('revisiting a retained errored scene renews only after the cooldown', async () => {
  const h = await createHarness({ failure: 4 });
  await h.clock.advance(12000);
  h.run('setScene(1)'); await flush();
  await h.clock.advance(200);
  assert.equal(h.videos[0].hasAttribute('src'), true, 'Outgoing film is still retained');
  h.run('setScene(0)'); await flush();
  h.videos[0].loadFailure = 0;
  await h.clock.advance(9799); assert.equal(count(h), 4);
  await h.clock.advance(1); assert.equal(count(h), 5);
  assert.equal(h.videos[0].error, null);
});

test('scroll cannot accelerate or duplicate a pending automatic retry', async () => {
  const h = await createHarness({ failure: 4 });
  for (let i = 0; i < 240; i += 1) {
    await h.signal(h.window, 'scroll');
    await h.clock.advance(50);
  }
  assert.deepEqual(h.videos[0].requests.map(item => item.at), [0, 1000, 4000, 12000]);
});

test('initial offline failures do not retry until connectivity returns', async () => {
  const h = await createHarness({ failure: 4, offline: true });
  await h.clock.advance(30000); assert.equal(count(h), 1);
  assert.equal(h.state(0).retryTimer, null);
  h.navigator.onLine = true;
  h.videos[0].loadFailure = 0;
  await h.signal(h.window, 'online');
  await h.clock.advance(1000); assert.equal(count(h), 2);
});

test('going offline before timer fires prevents retry and online can resume it', async () => {
  const h = await createHarness({ failure: 4 });
  h.navigator.onLine = false;
  await h.clock.advance(12000); assert.equal(count(h), 1);
  h.navigator.onLine = true;
  h.videos[0].loadFailure = 0;
  await h.signal(h.window, 'online');
  await h.clock.advance(1000); assert.equal(count(h), 2);
});

test('hidden-tab pause cancels automatic retry; visibility wake resumes', async () => {
  const h = await createHarness({ failure: 4 });
  await h.hidden(true);
  assert.equal(h.state(0).retryTimer, null);
  await h.clock.advance(20000); assert.equal(count(h), 1);
  h.videos[0].loadFailure = 0;
  await h.hidden(false);
  await h.clock.advance(1000); assert.equal(count(h), 2);
});

test('reduced motion cancels retries, releases media and stays poster-only', async () => {
  const h = await createHarness({ failure: 4 });
  h.run('applyMotionChoice("reduced")'); await flush();
  await h.clock.advance(30000);
  await h.signal(h.window, 'online');
  await h.signal(h.window, 'pointerdown');
  assert.equal(count(h), 1);
  assert.equal(h.videos[0].hasAttribute('src'), false);
  assert.equal(h.state(0).retryTimer, null);
  assert.equal(h.state(0).resumeTime, null);
});

test('save-data preference cancels retries and releases media', async () => {
  const h = await createHarness({ failure: 4 });
  h.connection.saveData = true;
  await h.signal(h.connection, 'change');
  await h.clock.advance(30000);
  assert.equal(count(h), 1);
  assert.equal(h.videos[0].hasAttribute('src'), false);
  assert.equal(h.state(0).retryTimer, null);
});

test('leaving the film passage cancels retries without reloading', async () => {
  const h = await createHarness({ failure: 4 });
  h.window.scrollY = 7001;
  await h.signal(h.window, 'scroll');
  await h.clock.advance(30000);
  assert.equal(count(h), 1);
  assert.equal(h.state(0).retryTimer, null);
});

test('noncurrent errored films and films with no src never schedule recovery', async () => {
  const h = await createHarness();
  h.videos[1].fail(); h.videos[3].fail(); await flush();
  h.run('retryFailedVideo(videos[1], true); retryFailedVideo(videos[3], true)');
  assert.equal(h.state(1).retryTimer, null);
  assert.equal(h.state(3).retryTimer, null);
  const before = h.videos[1].requests.length;
  await h.clock.advance(30000);
  assert.equal(h.videos[1].requests.length, before);
  assert.equal(h.videos[3].requests.length, 0);
});

test('a stale error on a released current element cannot restart its source', async () => {
  const h = await createHarness();
  h.run('releaseVideo(videos[0])');
  h.videos[0].fail(); await flush();
  h.run('retryFailedVideo(videos[0], true)');
  assert.equal(h.state(0).retryTimer, null);
  await h.clock.advance(30000);
  assert.equal(count(h), 1);
  assert.equal(h.videos[0].hasAttribute('src'), false);
});

test('initial low-motion, data-saving and offscreen visits make no video requests', async () => {
  for (const options of [{ reduced: true }, { saveData: true }, { offscreen: true }]) {
    const h = await createHarness(options);
    await h.signal(h.window, 'online');
    await h.signal(h.window, 'pointerdown');
    await h.clock.advance(30000);
    assert.equal(h.videos.reduce((total, video) => total + video.requests.length, 0), 0);
  }
});

test('scene change cancels an outgoing film retry before curtain release', async () => {
  const h = await createHarness({ failure: 4 });
  h.run('setScene(1)'); await flush();
  assert.equal(h.state(0).retryTimer, null);
  await h.clock.advance(30000);
  assert.equal(count(h), 1);
  assert.equal(h.videos[0].hasAttribute('src'), false);
});

test('responsive source switch cancels the old retry and resets source-specific state', async () => {
  const h = await createHarness({ failure: 4 });
  h.videos[0].loadFailure = 0;
  h.narrow.matches = true;
  await h.signal(h.narrow, 'change');
  assert.match(h.videos[0].src, /-tall\.mp4$/);
  assert.equal(count(h), 2);
  assert.equal(h.state(0).retryTimer, null);
  assert.equal(h.state(0).retries, 0);
  assert.equal(h.state(0).resumeTime, null);
  await h.clock.advance(30000); assert.equal(count(h), 2);
});

test('recovery restores the original playback position through multiple failed attempts', async () => {
  const h = await createHarness();
  h.videos[0].currentTime = 17.25;
  h.videos[0].loadFailure = 4;
  h.videos[0].fail(2); await flush();
  await h.clock.advance(1000);
  assert.equal(h.state(0).resumeTime, 17.25);
  h.videos[0].loadFailure = 0;
  await h.clock.advance(3000);
  assert.equal(h.videos[0].currentTime, 17.25);
  assert.equal(h.state(0).resumeTime, null);
  assert.equal(h.videos[0].paused, false);
});

test('restored playback position is clamped inside the newly loaded duration', async () => {
  const h = await createHarness();
  h.videos[0].currentTime = 29.99;
  h.videos[0].metadataDuration = 20;
  h.videos[0].fail(2); await flush();
  await h.clock.advance(1000);
  assert.equal(h.videos[0].currentTime, 19.95);
});

test('five seconds of healthy playing resets the automatic budget, not sooner', async () => {
  const h = await createHarness({ failure: 4 });
  h.videos[0].loadFailure = 0;
  await h.clock.advance(1000);
  assert.equal(h.state(0).retries, 1);
  await h.clock.advance(4999); h.videos[0].emit('timeupdate');
  assert.equal(h.state(0).retries, 1);
  await h.clock.advance(1); h.videos[0].emit('timeupdate');
  assert.equal(h.state(0).retries, 0);
});

test('waiting and pause invalidate the continuous healthy-playing clock', async () => {
  const h = await createHarness({ failure: 4 });
  h.videos[0].loadFailure = 0;
  await h.clock.advance(1000);
  await h.clock.advance(4000); h.videos[0].emit('waiting');
  await h.clock.advance(3000); h.videos[0].emit('timeupdate');
  assert.equal(h.state(0).retries, 1);
  h.videos[0].emit('playing');
  await h.clock.advance(4000); await h.hidden(true);
  await h.clock.advance(10000); await h.hidden(false);
  h.videos[0].emit('timeupdate'); assert.equal(h.state(0).retries, 1);
  await h.clock.advance(5000); h.videos[0].emit('timeupdate');
  assert.equal(h.state(0).retries, 0);
});

(async () => {
  const results = [];
  for (const item of tests) {
    try { await item.run(); results.push({ name: item.name, status: 'PASS' }); }
    catch (error) { results.push({ name: item.name, status: 'FAIL', error: error.stack }); }
  }
  const failures = results.filter(item => item.status === 'FAIL');
  console.log(JSON.stringify({
    status: failures.length ? 'FAIL' : 'PASS', passed: results.length - failures.length,
    failed: failures.length, scriptSha256: crypto.createHash('sha256').update(script).digest('hex'),
    evidenceBoundary: 'Actual application script in a deterministic VM with media fixtures; not a browser or Android pass.',
    results,
  }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
