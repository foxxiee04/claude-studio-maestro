(() => {
  "use strict";

  const stage = document.querySelector(".stage");
  const fox = document.querySelector(".fox");
  const wordmark = document.querySelector(".wordmark");
  const skipButton = document.querySelector(".skip");
  const next = (document.body && document.body.dataset && document.body.dataset.next) || "/app";

  let finished = false;
  let exitTimer = null;
  let navTimer = null;

  const text = (wordmark.textContent || "").trim();
  wordmark.textContent = "";
  const line = document.createElement("span");
  line.className = "line";
  Array.from(text).forEach((character, index) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = character === " " ? "\u00A0" : character;
    span.style.animationDelay = (1.2 + index * 0.055) + "s";
    span.setAttribute("aria-hidden", "true");
    line.appendChild(span);
  });
  wordmark.appendChild(line);
  wordmark.setAttribute("aria-label", text);

  function withTimeout(promise, milliseconds) {
    return Promise.race([
      Promise.resolve(promise).then(() => undefined).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, milliseconds))
    ]);
  }

  function navigate() {
    location.replace(next);
  }

  function skip() {
    if (finished) return;
    finished = true;
    if (exitTimer) clearTimeout(exitTimer);
    if (navTimer) clearTimeout(navTimer);
    stage.classList.remove("is-running");
    stage.classList.add("is-exiting", "is-exiting-fast");
    setTimeout(navigate, 350);
  }

  function startNormal() {
    if (finished) return;
    stage.classList.add("is-running");
    exitTimer = setTimeout(() => {
      if (!finished) stage.classList.add("is-exiting");
    }, 3400);
    navTimer = setTimeout(() => {
      if (!finished) navigate();
    }, 4200);
  }

  function startReduced() {
    if (finished) return;
    stage.classList.add("is-reduced");
    stage.style.opacity = "0";
    stage.style.transition = "opacity 400ms ease";
    requestAnimationFrame(() => {
      stage.style.opacity = "1";
    });
    setTimeout(() => {
      if (!finished) navigate();
    }, 1300);
  }

  async function prepare() {
    const imagePromise = typeof fox.decode === "function" ? fox.decode() : Promise.resolve();
    const fontsPromise = document.fonts && typeof document.fonts.ready !== "undefined"
      ? document.fonts.ready
      : Promise.resolve();
    await Promise.all([
      withTimeout(imagePromise, 1500),
      withTimeout(fontsPromise, 1200)
    ]);
  }

  let shouldSkipImmediately = false;
  try {
    if (sessionStorage.getItem("maestro-intro") === "1") shouldSkipImmediately = true;
  } catch (error) {
    // Ignore storage access failures.
  }

  if (shouldSkipImmediately) {
    navigate();
    return;
  }

  try {
    sessionStorage.setItem("maestro-intro", "1");
  } catch (error) {
    // Ignore storage access failures.
  }

  window.addEventListener("keydown", skip);
  document.addEventListener("click", skip, true);
  if (skipButton) {
    skipButton.addEventListener("click", (event) => {
      event.stopPropagation();
      skip();
    });
  }

  const reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  prepare().then(() => {
    if (finished) return;
    if (reducedMotion) startReduced();
    else startNormal();
  });
})();
