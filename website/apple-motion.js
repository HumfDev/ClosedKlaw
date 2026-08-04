/**
 * Apple-style fluid interface helpers (WWDC Designing Fluid Interfaces).
 * Springs via CSS custom properties + rAF; interruptible scroll reveals;
 * instant press feedback; respects reduced-motion / reduced-transparency.
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const reduceTransparency = window.matchMedia("(prefers-reduced-transparency: reduce)");

function syncA11yFlags() {
  document.documentElement.classList.toggle("reduce-motion", reduceMotion.matches);
  document.documentElement.classList.toggle("reduce-transparency", reduceTransparency.matches);
}

reduceMotion.addEventListener("change", syncA11yFlags);
reduceTransparency.addEventListener("change", syncA11yFlags);
syncA11yFlags();

/** Instant press feedback on pointer-down (not click). */
function bindPressFeedback() {
  const selector = ".btn-join, .btn-submit, .btn-google, .btn-email, .lp-feat-card";
  document.querySelectorAll(selector).forEach((el) => {
    if (el.dataset.pressBound) return;
    el.dataset.pressBound = "1";

    const down = () => {
      el.classList.add("is-pressed");
    };
    const up = () => {
      el.classList.remove("is-pressed");
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("lostpointercapture", up);
  });
}

/**
 * Critically damped reveal: animate from presentation value via CSS,
 * stagger children, never lock input. Reduced motion → opacity only.
 */
function initScrollReveals() {
  const nodes = document.querySelectorAll("[data-reveal]");
  if (!nodes.length) return;

  document.documentElement.classList.add("motion-ready");

  if (reduceMotion.matches) {
    nodes.forEach((el) => el.classList.add("is-revealed"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        el.classList.add("is-revealed");
        io.unobserve(el);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
  );

  nodes.forEach((el) => {
    const delay = Number(el.dataset.revealDelay || 0);
    el.style.setProperty("--reveal-delay", `${delay}s`);
    io.observe(el);
  });
}

/** Soft header material weight shift as content scrolls underneath. */
function initHeaderMaterial() {
  const header = document.querySelector("body.landing-page .header, body.waitlist-page .header");
  if (!header) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const scrolled = window.scrollY > 8;
    header.classList.toggle("header--scrolled", scrolled);
  };

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  update();
}

bindPressFeedback();
initScrollReveals();
initHeaderMaterial();
