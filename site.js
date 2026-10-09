/* Wrapstar - own motion. Ignore prefers-reduced-motion. One Pause/Play. */
(() => {
  document.documentElement.classList.add('js-motion');

  const films = () => [...document.querySelectorAll('video.film')];
  const loader = document.querySelector('.loader');
  const motionBtn = document.querySelector('.motion');
  const menuBtn = document.querySelector('.hdr__menu');
  const nav = document.querySelector('.hdr__nav');
  const hdr = document.querySelector('.hdr');
  let paused = false;
  let lenis;

  // ----- Lenis -----
  if (window.Lenis) {
    // Single RAF driver via GSAP ticker (no dual lenis.raf) - avoids mast jitter/gap under pin.
    lenis = new Lenis({
      // smoothWheel false: headed Chrome was painting fixed mast ~8–32px low mid-wheel
      // while rect.top stayed 0 (compositor desync). Native wheel keeps mast paint flush;
      // Lenis still drives scrollTo + ScrollTrigger sync.
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: false,
      touchMultiplier: 1.4,
      autoRaf: false
    });
    window.__wrapstarLenis = lenis;
    if (window.gsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger, SplitText);
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      function raf(t){ lenis.raf(t); requestAnimationFrame(raf); }
      requestAnimationFrame(raf);
    }
  } else if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger, SplitText);
  }

  // ----- Loader -----
  window.addEventListener('load', () => {
    setTimeout(() => loader && loader.classList.add('is-done'), 700);
  });
  setTimeout(() => loader && loader.classList.add('is-done'), 1800);

  // ----- Films always try play -----
  const kickFilms = () => films().forEach(v => {
    v.muted = true; v.playsInline = true;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  });
  kickFilms();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) kickFilms(); });

  // ----- Pause / Play -----
  const setPaused = (on) => {
    paused = on;
    if (!motionBtn) return;
    motionBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    motionBtn.setAttribute('aria-label', on ? 'Play Motion' : 'Pause Motion');
    const txt = motionBtn.querySelector('.motion__txt');
    if (txt) txt.textContent = on ? 'Play' : 'Pause';
    films().forEach(v => { try { on ? v.pause() : v.play(); } catch(e){} });
    document.documentElement.classList.toggle('is-paused', on);
        if (window.ScrollTrigger) {
      ScrollTrigger.getAll().forEach(st => {
        if (st.animation) on ? st.animation.pause() : st.animation.resume();
      });
    }
    /* Pause freezes all motion: GSAP + smooth scroll */ if(window.gsap){gsap.globalTimeline[on?'pause':'resume']();}if(typeof lenis!=='undefined'&&lenis){lenis.options.smoothWheel=!on;}
  };
  motionBtn && motionBtn.addEventListener('click', () => setPaused(!paused));

  // ----- Menu -----
  menuBtn && menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    hdr && hdr.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav && nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('is-open');
    hdr && hdr.classList.remove('is-open');
    menuBtn && menuBtn.setAttribute('aria-expanded', 'false');
  }));

  // ----- Header solid after hero (home only) -----
  // Do NOT set transform on .hdr - translate3d/will-change creates a compositor layer
  // that visually dips under Lenis wheel + GSAP pin in headed Chrome while layout top stays 0.
  const onScroll = () => {
    if (!hdr || hdr.classList.contains('hdr--inner')) return;
    const y = lenis ? lenis.scroll : window.scrollY;
    hdr.classList.toggle('is-solid', y > window.innerHeight * 0.72);
  };
  onScroll();
  if (lenis) lenis.on('scroll', onScroll); else window.addEventListener('scroll', onScroll, {passive:true});

  // ----- Force-show helper (anti-flake) -----
  const forceShow = (el) => {
    if (!el) return;
    el.classList.remove('is-pending');
    el.classList.add('is-shown');
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.style.filter = 'none';
    el.querySelectorAll('.line > span, .word, [style*="translate"]').forEach(n => {
      n.style.transform = 'none';
      n.style.filter = 'none';
      n.style.opacity = '1';
    });
    if (window.gsap) {
      try { gsap.set(el, { clearProps: 'opacity,transform,filter,y,yPercent' }); } catch(e){}
      el.querySelectorAll('.line > span, .word').forEach(n => {
        try { gsap.set(n, { clearProps: 'opacity,transform,filter,y,yPercent' }); } catch(e){}
      });
    }
  };

  const ease = 'power3.out';
  const expo = 'expo.out';

  // ----- Hero lines: wipe up one-by-one, 1s apart (Protect → Enhance → Redefine) -----
  (function heroWipe(){
    const lines = Array.from(document.querySelectorAll('[data-hero-wipe]'));
    if (!lines.length) return;

    const inners = lines.map(el => {
      el.classList.add('is-pending');
      el.style.overflow = 'hidden';
      el.style.display = 'block';
      let inner = el.querySelector('.hero__wipe');
      if (!inner) {
        inner = document.createElement('span');
        inner.className = 'hero__wipe';
        while (el.firstChild) inner.appendChild(el.firstChild);
        el.appendChild(inner);
      }
      inner.style.display = 'block';
      inner.style.willChange = 'transform';
      return inner;
    });

    let played = false;
    const play = () => {
      if (played) return;
      played = true;
      if (!(window.gsap)) {
        inners.forEach((inner, i) => {
          inner.style.transform = 'translate3d(0,110%,0)';
          inner.style.animation = 'wrapstarHeroWipe .9s cubic-bezier(.19,1,.22,1) forwards';
          inner.style.animationDelay = (i * 1.0) + 's';
        });
        setTimeout(() => {
          lines.forEach((el, i) => {
            const inner = inners[i];
            inner.style.animation = 'none';
            inner.style.transform = 'none';
            el.classList.remove('is-pending');
            el.classList.add('is-shown');
          });
        }, 1000 * (inners.length - 1) + 1000);
        return;
      }

      // Park with GSAP only (no CSS transform left on the element)
      gsap.set(inners, { yPercent: 110, force3D: true });

      const tl = gsap.timeline({
        onComplete: () => {
          inners.forEach(inner => {
            gsap.set(inner, { yPercent: 0, clearProps: 'transform' });
            inner.style.transform = 'none';
          });
          lines.forEach(el => {
            el.classList.remove('is-pending');
            el.classList.add('is-shown');
          });
        }
      });
      inners.forEach((inner, i) => {
        tl.fromTo(
          inner,
          { yPercent: 110 },
          {
            yPercent: 0,
            duration: 0.9,
            ease: 'power3.out',
            immediateRender: false,
            onComplete: () => {
              // lock this line at rest so nothing re-applies the park offset
              gsap.set(inner, { yPercent: 0, clearProps: 'transform' });
              inner.style.transform = 'none';
              lines[i].classList.add('is-shown');
              lines[i].classList.remove('is-pending');
            }
          },
          i * 1.0
        );
      });
    };

    const arm = () => setTimeout(play, 80);

    if (loader) {
      if (loader.classList.contains('is-done')) arm();
      else {
        const obs = new MutationObserver(() => {
          if (loader.classList.contains('is-done')) {
            obs.disconnect();
            arm();
          }
        });
        obs.observe(loader, { attributes: true, attributeFilter: ['class'] });
        setTimeout(() => { try { obs.disconnect(); } catch(e){} arm(); }, 2800);
      }
    } else {
      arm();
    }
  })();

  // ----- Split + reveal (progressive: mark pending only while animating) -----
  document.querySelectorAll('[data-split]').forEach(el => {
    if (!(window.SplitText && window.gsap && window.ScrollTrigger)) {
      forceShow(el);
      return;
    }
    el.classList.add('is-pending');
    const split = new SplitText(el, { type: 'lines,words', linesClass: 'line', wordsClass: 'word' });
    split.lines.forEach(line => {
      const wrap = document.createElement('span');
      wrap.style.display = 'block';
      wrap.style.overflow = 'hidden';
      line.parentNode.insertBefore(wrap, line);
      wrap.appendChild(line);
    });
    gsap.set(split.words, { yPercent: 110, filter: 'blur(5px)' });
    const play = () => {
      gsap.to(split.words, {
        yPercent: 0, filter: 'blur(0px)', duration: 1.05, ease: expo, stagger: 0.028,
        onComplete: () => forceShow(el)
      });
    };
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: play,
      // If already in view at creation time
      onRefresh: (self) => { if (self.isActive || self.progress > 0) play(); }
    });
    // Immediate kick for hero / above-fold
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.95 && r.bottom > 0) play();
    });
  });

  document.querySelectorAll('[data-reveal]').forEach(el => {
    if (!window.gsap || !window.ScrollTrigger) {
      forceShow(el);
      return;
    }
    el.classList.add('is-pending');
    gsap.set(el, { opacity: 0, y: 28 });
    const play = () => {
      gsap.to(el, {
        opacity: 1, y: 0, duration: 0.85, ease,
        onComplete: () => forceShow(el)
      });
    };
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: play
    });
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.95 && r.bottom > 0) play();
    });
  });

  // Hard fallback: never leave blank Vision / Services / Contact blocks
  const revealAllPending = () => {
    document.querySelectorAll('[data-reveal].is-pending, [data-split].is-pending').forEach(forceShow);
  };
  setTimeout(revealAllPending, 2200);
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (window.ScrollTrigger) ScrollTrigger.refresh();
      revealAllPending();
    }, 400);
  });

  // ----- Horizontal rail: plain CSS overflow-x:auto ONLY -----
  // Pass 11 CRITICAL: remove ALL wheel→horizontal hijack / preventDefault /
  // data-lenis-prevent. Vertical mouse wheel must always scroll the page through
  // Work → rail → Services. Horizontal = scrollbar / trackpad deltaX only.
  // No scroll-snap. No GSAP pin. Mast stays transform:none.
  const rail = document.querySelector('.rail');
  if (rail) {
    rail.removeAttribute('data-lenis-prevent-wheel');
    rail.removeAttribute('data-lenis-prevent');
    rail.style.scrollSnapType = 'none';
    const track = document.querySelector('#rail-track');
    if (track) {
      track.style.transform = 'none';
      track.style.willChange = 'auto';
    }
    // Explicitly do NOT add any wheel listener on .rail.
  }

  // ----- Soft parallax on ask film (copy sits on solid band; film only in open side) -----
  const askFilm = document.querySelector('.ask__media .film');
  if (askFilm && window.gsap && window.ScrollTrigger) {
    gsap.to(askFilm, {
      yPercent: 8, ease: 'none',
      scrollTrigger: { trigger: '.ask', start: 'top bottom', end: 'bottom top', scrub: true }
    });
  }

  // ----- Contact mailto builder (local demo - no external post) -----
  const form = document.getElementById('quote-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (document.getElementById('qf-name') || {}).value || '';
      const email = (document.getElementById('qf-email') || {}).value || '';
      const phone = (document.getElementById('qf-phone') || {}).value || '';
      const vehicle = (document.getElementById('qf-vehicle') || {}).value || '';
      const service = (document.getElementById('qf-service') || {}).value || '';
      const notes = (document.getElementById('qf-notes') || {}).value || '';
      const body = [
        'Wrapstar quote request (local concept demo)',
        '',
        'Name: ' + name,
        'Email: ' + email,
        'Phone: ' + phone,
        'Vehicle: ' + vehicle,
        'Service interest: ' + service,
        '',
        'Notes:',
        notes
      ].join('\n');
      const href = 'mailto:info@wrapstarnv.com'
        + '?subject=' + encodeURIComponent('Quote request - ' + (vehicle || name || 'Wrapstar'))
        + '&body=' + encodeURIComponent(body);
      window.location.href = href;
    });
  }

  // Resize refresh
  let rAf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rAf);
    rAf = requestAnimationFrame(() => { if (window.ScrollTrigger) ScrollTrigger.refresh(); });
  });
})();

/* REDEFINE. reveal synced to the hero film: hidden on the work shots of the FIRST play only; once revealed it stays. Paused => shown. */
(function(){
  var v=document.getElementById('film-hero'); var line=document.querySelector('.hero__h .hero__line--teal');
  if(!v||!line) return;
  var revealed=false; /* once the first plaza cut lands, REDEFINE. stays */
  var REVEAL=5.77; /* 1s after the plaza Bugatti cut (4.767s in hero.mp4 and hero-sm.mp4) */
  function sync(){
    if(!revealed && !v.paused && v.currentTime>=REVEAL) revealed=true;
    var show = revealed || v.paused || document.documentElement.classList.contains('is-paused') || v.currentTime>=REVEAL;
    line.classList.toggle('is-held', !show);
  }
  function loop(){ sync(); if(v.requestVideoFrameCallback){ v.requestVideoFrameCallback(loop); } else { requestAnimationFrame(loop); } }
  ['timeupdate','seeked','play','pause','playing'].forEach(function(e){ v.addEventListener(e,sync); });
  sync(); loop();
  setInterval(sync,250);
})();
