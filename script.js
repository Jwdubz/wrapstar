const films = [...document.querySelectorAll(".film")];
const beats = [...document.querySelectorAll(".beat")];
const videos = films.map((film) => film.querySelector("video"));
const passage = document.querySelector(".passage");
const siteHeader = document.querySelector(".site-header");
const quoteForm = document.querySelector("#quote-form");
const formStatus = document.querySelector("#form-status");

const motionStorageKey = "wrapstar-motion-v1";
const accessibilitySettings = document.querySelector("#accessibility-settings");
const motionOptions = [...document.querySelectorAll('input[name="motion"]')];
const motionStatus = document.querySelector("#motion-status");
const motionStorageStatus = document.querySelector("#motion-storage-status");
let reducedMotion = document.documentElement.dataset.motion === "reduced";
const narrowQuery = window.matchMedia("(max-width: 700px)");
let currentScene = -1;
let ticking = false;
let sceneNavigationLock = null;
let sceneNavigationTimer = null;
const outgoingScenes = new Map();
const mediaRetryDelays = [1000, 3000, 8000];
const mediaStates = videos.map(() => ({
  playRequest: null, autoplayDenied: false, retryTimer: null, retries: 0,
  lastRetryAt: -Infinity, resumeTime: null, healthySince: null,
}));

function isPassageVisible() {
  const bounds = passage.getBoundingClientRect();
  return bounds.bottom > siteHeader.getBoundingClientRect().bottom && bounds.top < window.innerHeight;
}

function shouldPlayFilm() {
  const saveData = Boolean(navigator.connection?.saveData);
  return !document.hidden && !reducedMotion && !saveData && isPassageVisible();
}

function applyResponsivePoster(video) {
  const poster = narrowQuery.matches ? video.dataset.posterTall : video.dataset.posterWide;
  if (video.getAttribute("poster") !== poster) video.poster = poster;
}

function selectedVideoSource(video) {
  const source = [...video.querySelectorAll("source")].find((candidate) => {
    return !candidate.media || window.matchMedia(candidate.media).matches;
  });
  return source?.dataset.src || source?.getAttribute("src");
}

function pauseVideo(video) {
  const state = mediaStates[videos.indexOf(video)];
  window.clearTimeout(state.retryTimer);
  state.retryTimer = null;
  state.healthySince = null;
  if (!video.paused || state.playRequest) video.pause();
  state.playRequest = null;
}

function releaseVideo(video) {
  pauseVideo(video);
  const state = mediaStates[videos.indexOf(video)];
  state.retries = 0;
  state.resumeTime = null;
  if (!video.hasAttribute("src")) return;
  video.removeAttribute("src");
  video.preload = "none";
  video.load();
}

function prepareVideo(video) {
  applyResponsivePoster(video);
  const source = selectedVideoSource(video);
  if (!source || video.getAttribute("src") === source) return;
  pauseVideo(video);
  const state = mediaStates[videos.indexOf(video)];
  state.autoplayDenied = false;
  state.retries = 0;
  state.resumeTime = null;
  video.preload = "auto";
  video.src = source;
  video.load();
}

function retryFailedVideo(video, renewedSignal = false) {
  if (!video || video !== videos[currentScene] || !video.error ||
      !video.hasAttribute("src") || !shouldPlayFilm() || navigator.onLine === false) return;
  const state = mediaStates[videos.indexOf(video)];
  if (state.retryTimer !== null) return;
  const renewedBudget = state.retries >= mediaRetryDelays.length;
  let cooldown = 0;
  if (renewedBudget) {
    if (!renewedSignal) return;
    // A new visit/interaction/online signal may renew the budget, not a scroll.
    cooldown = Math.max(0, 10000 - (performance.now() - state.lastRetryAt));
  }
  const source = video.getAttribute("src");
  state.retryTimer = window.setTimeout(() => {
    state.retryTimer = null;
    if (video !== videos[currentScene] || !video.error || !shouldPlayFilm() ||
        navigator.onLine === false || video.getAttribute("src") !== source) return;
    if (renewedBudget) state.retries = 0;
    if (state.resumeTime === null) state.resumeTime = video.currentTime;
    state.retries += 1;
    state.lastRetryAt = performance.now();
    pauseVideo(video);
    // play() cannot clear a latched MediaError; restart this same resource.
    video.load();
    requestVideoPlay(video);
  }, Math.max(cooldown, mediaRetryDelays[renewedBudget ? 0 : state.retries]));
}

function releaseDistantVideos() {
  videos.forEach((video, index) => {
    if (index !== currentScene && index !== currentScene + 1 && !outgoingScenes.has(index)) {
      releaseVideo(video);
    }
  });
}

function prepareUpcomingVideo() {
  const active = videos[currentScene];
  const upcoming = videos[currentScene + 1];
  if (!active || !upcoming || !shouldPlayFilm() || active.readyState < 3) return;
  if (!Number.isFinite(active.duration) || active.duration <= 0) return;

  // Give the visible film a head start before another download can compete.
  const requiredAhead = Math.min(6, active.duration - active.currentTime);
  for (let index = 0; index < active.buffered.length; index += 1) {
    if (active.buffered.start(index) <= active.currentTime &&
        active.buffered.end(index) - active.currentTime >= requiredAhead - 0.1) {
      prepareVideo(upcoming);
      return;
    }
  }
}

function requestVideoPlay(video) {
  if (!video || video.error || video !== videos[currentScene] || !shouldPlayFilm() || !video.hasAttribute("src")) {
    return;
  }

  const state = mediaStates[videos.indexOf(video)];
  if (!video.paused || state.playRequest || state.autoplayDenied) return;
  if (video.ended) video.currentTime = 0;
  const attempt = {};
  state.playRequest = attempt;
  const promise = video.play();

  if (promise) {
    promise
      .then(() => {
        // A preference or scene may change while play() is pending.
        if (!shouldPlayFilm() || video !== videos[currentScene]) {
          video.pause();
        }
        if (state.playRequest !== attempt) return;
        state.playRequest = null;
        state.autoplayDenied = false;
        if (video !== videos[currentScene]) return;
        document.body.classList.remove("autoplay-blocked");
      })
      .catch((error) => {
        if (state.playRequest !== attempt) return;
        state.playRequest = null;
        // pause()/load() legitimately abort pending play; that is not a denial.
        if (error.name === "NotAllowedError" && video === videos[currentScene] && shouldPlayFilm()) {
          state.autoplayDenied = true;
          document.body.classList.add("autoplay-blocked");
        }
      });
  } else {
    state.playRequest = null;
  }
}

function setScene(nextScene) {
  if (nextScene === currentScene && beats[nextScene]?.classList.contains("is-current")) {
    syncPlaybackPreference();
    return;
  }

  const previousScene = currentScene;
  currentScene = nextScene;
  document.body.classList.toggle("is-final", currentScene === films.length - 1);

  films.forEach((film, index) => {
    film.classList.toggle("is-revealed", index <= currentScene);
  });

  beats.forEach((beat, index) => {
    const isCurrent = index === currentScene;
    beat.classList.toggle("is-current", isCurrent);

    if (index === beats.length - 1) {
      beat.inert = !isCurrent;
      if (isCurrent) beat.removeAttribute("aria-hidden");
      else beat.setAttribute("aria-hidden", "true");
    }
  });

  // Retain the outgoing frame until the authored 950 ms curtain has closed.
  if (previousScene >= 0) {
    window.clearTimeout(outgoingScenes.get(previousScene));
    const releaseTimer = window.setTimeout(() => {
      if (outgoingScenes.get(previousScene) !== releaseTimer) return;
      outgoingScenes.delete(previousScene);
      releaseDistantVideos();
    }, reducedMotion ? 0 : 1000);
    outgoingScenes.set(previousScene, releaseTimer);
  }
  releaseDistantVideos();
  if (currentScene === videos.length - 1 && videos[currentScene].hasAttribute("src")) {
    mediaStates[currentScene].resumeTime = null;
    videos[currentScene].currentTime = 0;
  }
  retryFailedVideo(videos[currentScene], true);
  syncPlaybackPreference();
}

function readSceneFromViewport() {
  if (sceneNavigationLock !== null) {
    setScene(sceneNavigationLock);
    ticking = false;
    return;
  }

  let bestScene = 0;

  beats.forEach((beat, index) => {
    const bounds = beat.getBoundingClientRect();
    // Focusing a form field may scroll the quote below the fixed header.
    // Keep that visible form active instead of making its focused field inert.
    const activationTop = index === beats.length - 1
      ? siteHeader.getBoundingClientRect().bottom
      : 0;
    if (bounds.top <= activationTop + 1) bestScene = index;
  });

  setScene(bestScene);
  ticking = false;
}

function requestSceneRead() {
  if (!ticking) {
    ticking = true;
    window.requestAnimationFrame(readSceneFromViewport);
  }
}

function syncPlaybackPreference() {
  const active = videos[currentScene];
  if (!active) return;
  applyResponsivePoster(active);
  const canPlay = shouldPlayFilm();
  videos.forEach((video) => {
    if (!canPlay || video !== active) pauseVideo(video);
    // Explicit low-motion/data-saving visits use posters, without video fetches.
    if (reducedMotion || navigator.connection?.saveData) releaseVideo(video);
  });
  document.body.classList.toggle("autoplay-blocked", canPlay && mediaStates[currentScene].autoplayDenied);
  if (!canPlay) return;
  prepareVideo(active);
  requestVideoPlay(active);
  retryFailedVideo(active);
  prepareUpcomingVideo();
}

window.addEventListener("scroll", requestSceneRead, { passive: true });
window.addEventListener("resize", () => {
  const focusedBeat = document.activeElement?.closest?.(".beat");
  const focusedScene = beats.indexOf(focusedBeat);

  if (focusedScene >= 0) setScene(focusedScene);
  else requestSceneRead();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) retryFailedVideo(videos[currentScene], true);
  syncPlaybackPreference();
});
window.addEventListener("online", () => {
  retryFailedVideo(videos[currentScene], true);
  syncPlaybackPreference();
});
navigator.connection?.addEventListener?.("change", syncPlaybackPreference);
narrowQuery.addEventListener?.("change", () => {
  videos.forEach((video) => {
    if (video.hasAttribute("poster")) applyResponsivePoster(video);
    // Reselect only films already hydrated; unseen scenes stay dormant.
    if (video.hasAttribute("src")) releaseVideo(video);
  });
  syncPlaybackPreference();
});

function navigateToScene(event, targetSelector, nextScene, hash) {
  event.preventDefault();
  const target = document.querySelector(targetSelector);
  if (!target) return;

  window.clearTimeout(sceneNavigationTimer);
  sceneNavigationLock = nextScene;
  setScene(nextScene);
  history.pushState(null, "", hash);
  target.scrollIntoView({
    behavior: reducedMotion || navigator.connection?.saveData ? "instant" : "smooth",
    block: "start",
  });

  sceneNavigationTimer = window.setTimeout(() => {
    sceneNavigationLock = null;
    requestSceneRead();
    if (!target.contains(document.activeElement)) {
      target.focus({ preventScroll: true });
    }
  }, reducedMotion || navigator.connection?.saveData ? 0 : 1350);
}

document.querySelector("a.quote-link")?.addEventListener("click", (event) => {
  navigateToScene(event, "#quote", films.length - 1, "#quote");
});

document.querySelector("a.brand")?.addEventListener("click", (event) => {
  navigateToScene(event, "#top", 0, "#top");
});

document.querySelector("a.portfolio-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  const target = document.querySelector("#portfolio");
  if (!target) return;

  window.clearTimeout(sceneNavigationTimer);
  sceneNavigationLock = null;
  history.pushState(null, "", "#portfolio");
  target.scrollIntoView({
    behavior: reducedMotion || navigator.connection?.saveData ? "instant" : "smooth",
    block: "start",
  });

  sceneNavigationTimer = window.setTimeout(() => {
    if (!target.contains(document.activeElement)) target.focus({ preventScroll: true });
  }, reducedMotion || navigator.connection?.saveData ? 0 : 1350);
});

quoteForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!quoteForm.reportValidity()) {
    return;
  }

  formStatus.textContent = "Concept preview — no message was sent.";
  quoteForm.querySelector("button").textContent = "Preview complete";
});

videos.forEach((video) => {
  video.muted = true;
  video.setAttribute("aria-hidden", "true");
  video.preload = "none";
  // Retain compatibility with the previous source markup during the cutover.
  let hadEagerSource = false;
  video.querySelectorAll("source[src]").forEach((source) => {
    if (!source.dataset.src) source.dataset.src = source.getAttribute("src");
    source.removeAttribute("src");
    hadEagerSource = true;
  });
  if (hadEagerSource) video.load();
  const state = mediaStates[videos.indexOf(video)];
  video.addEventListener("error", () => {
    state.healthySince = null;
    retryFailedVideo(video);
  });
  video.addEventListener("loadedmetadata", () => {
    if (state.resumeTime === null) return;
    const resumeTime = state.resumeTime;
    state.resumeTime = null;
    if (Number.isFinite(video.duration) && resumeTime > 0) {
      video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.05));
    }
  });
  video.addEventListener("playing", () => { state.healthySince = performance.now(); });
  video.addEventListener("waiting", () => { state.healthySince = null; });
  ["progress", "timeupdate", "canplay"].forEach((event) => {
    video.addEventListener(event, () => {
      if (state.healthySince !== null && !video.paused && !video.error &&
          video.readyState >= 3 && performance.now() - state.healthySince >= 5000) {
        state.retries = 0;
        state.healthySince = null;
      }
      if (video === videos[currentScene]) prepareUpcomingVideo();
    });
  });
});

const retryAutoplay = () => {
  if (currentScene < 0) return;
  mediaStates[currentScene].autoplayDenied = false;
  retryFailedVideo(videos[currentScene], true);
  syncPlaybackPreference();
};
window.addEventListener("pointerdown", retryAutoplay, { passive: true });
window.addEventListener("keydown", retryAutoplay);

function renderMotionChoice() {
  document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  motionOptions.forEach((option) => {
    option.checked = option.value === document.documentElement.dataset.motion;
  });
  motionStatus.textContent = reducedMotion ? "· Motion reduced" : "· Motion on";
}

function applyMotionChoice(value) {
  reducedMotion = value === "reduced";
  renderMotionChoice();
  // Do not leave an earlier smooth navigation or delayed focus transfer running.
  window.clearTimeout(sceneNavigationTimer);
  sceneNavigationLock = null;
  if (reducedMotion) {
    window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" });
  }
  readSceneFromViewport();
  syncPlaybackPreference();
}

motionOptions.forEach((option) => {
  option.addEventListener("change", () => {
    if (!option.checked) return;
    applyMotionChoice(option.value);
    try {
      localStorage.setItem(motionStorageKey, option.value);
      motionStorageStatus.textContent = "Your choice is saved for this site in this browser.";
    } catch {
      motionStorageStatus.textContent = "Your choice applies to this visit. This browser is not allowing it to be saved.";
    }
  });
});

window.addEventListener("storage", (event) => {
  if (event.key !== motionStorageKey && event.key !== null) return;
  applyMotionChoice(event.key === motionStorageKey ? event.newValue : "full");
});

function closeAccessibilitySettings() {
  accessibilitySettings.open = false;
  accessibilitySettings.querySelector("summary").focus({ preventScroll: true });
}

document.querySelector("#close-accessibility").addEventListener("click", closeAccessibilitySettings);
accessibilitySettings.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && accessibilitySettings.open) {
    event.preventDefault();
    closeAccessibilitySettings();
  }
});

renderMotionChoice();
try {
  localStorage.getItem(motionStorageKey);
} catch {
  motionStorageStatus.textContent = "Your choice applies to this visit. This browser is not allowing it to be saved.";
}
accessibilitySettings.hidden = false;
// Honor restored scroll/hash position without starting an invisible first film.
readSceneFromViewport();
