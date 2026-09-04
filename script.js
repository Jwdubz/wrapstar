const films = [...document.querySelectorAll(".film")];
const beats = [...document.querySelectorAll(".beat")];
const videos = films.map((film) => film.querySelector("video"));
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

function shouldPlayFilm() {
  const saveData = Boolean(navigator.connection?.saveData);
  return !document.hidden && !reducedMotion && !saveData;
}

function applyResponsivePosters() {
  videos.forEach((video) => {
    video.poster = narrowQuery.matches ? video.dataset.posterTall : video.dataset.posterWide;
  });
}

function requestVideoPlay(video) {
  if (!video || !shouldPlayFilm()) {
    return;
  }

  if (video.ended) video.currentTime = 0;

  const promise = video.play();

  if (promise) {
    promise
      .then(() => {
        // A preference or scene may change while play() is pending.
        if (!shouldPlayFilm() || video !== videos[currentScene]) {
          video.pause();
          return;
        }
        document.body.classList.remove("autoplay-blocked");
      })
      .catch(() => {
        document.body.classList.add("autoplay-blocked");
      });
  }
}

function setScene(nextScene) {
  if (nextScene === currentScene && beats[nextScene]?.classList.contains("is-current")) {
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

  videos.forEach((video, index) => {
    if (index === currentScene && shouldPlayFilm()) {
      if (index === videos.length - 1 && previousScene !== currentScene) video.currentTime = 0;
      requestVideoPlay(video);
    } else {
      video.pause();
    }
  });
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
      ? document.querySelector(".site-header").getBoundingClientRect().bottom
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
  setScene(currentScene);
  if (shouldPlayFilm()) {
    requestVideoPlay(videos[currentScene]);
  } else {
    videos.forEach((video) => video.pause());
  }
}

window.addEventListener("scroll", requestSceneRead, { passive: true });
window.addEventListener("resize", () => {
  const focusedBeat = document.activeElement?.closest?.(".beat");
  const focusedScene = beats.indexOf(focusedBeat);

  if (focusedScene >= 0) setScene(focusedScene);
  else requestSceneRead();
});
document.addEventListener("visibilitychange", syncPlaybackPreference);
navigator.connection?.addEventListener?.("change", syncPlaybackPreference);
narrowQuery.addEventListener?.("change", () => {
  applyResponsivePosters();
  videos.forEach((video) => video.load());
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
});

const retryAutoplay = () => requestVideoPlay(videos[currentScene]);
window.addEventListener("pointerdown", retryAutoplay, { once: true, passive: true });
window.addEventListener("keydown", retryAutoplay, { once: true });

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
applyResponsivePosters();
setScene(0);
requestSceneRead();
