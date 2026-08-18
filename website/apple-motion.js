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
  const selector =
    ".btn-join, .btn-submit, .btn-google, .btn-email, .lp-feat-card, .lp-faq-item summary, .plan, .download-btn, .btn-text, .chip, .start-choice, .start-back, .start-arrow, .start-promo-apply";
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
  const header = document.querySelector(
    "body.landing-page .header, body.waitlist-page .header, body.onboarding-page .header",
  );
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

/** Symmetric ease with no overshoot — gentle departure and settle. */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* Constant pace: one viewport of travel takes SECTION_NAV_PACE_MS, so speed
   stays the same and duration scales with distance. */
const SECTION_NAV_PACE_MS = 1500;
const SECTION_NAV_MIN_MS = 450;
const SECTION_NAV_MAX_MS = 2600;

function sectionNavDuration(distance) {
  const viewport = window.innerHeight || 800;
  const scaled = (Math.abs(distance) / viewport) * SECTION_NAV_PACE_MS;
  return Math.min(SECTION_NAV_MAX_MS, Math.max(SECTION_NAV_MIN_MS, scaled));
}

let sectionNavRaf = 0;
let sectionNavToken = 0;

function getHeaderOffset() {
  const header = document.querySelector("body.landing-page .header");
  if (!header) return 0;
  return header.getBoundingClientRect().height + 8;
}

function cancelSectionNav() {
  sectionNavToken += 1;
  if (sectionNavRaf) {
    cancelAnimationFrame(sectionNavRaf);
    sectionNavRaf = 0;
  }
}

/**
 * Slow scroll between sections. Interruptible: any user
 * scroll/wheel/touch cancels and leaves the page at the live position.
 */
function animateToSection(target) {
  const startY = window.scrollY || window.pageYOffset;
  const endY = Math.max(
    0,
    target.getBoundingClientRect().top + startY - getHeaderOffset(),
  );
  const distance = endY - startY;

  if (Math.abs(distance) < 2) {
    history.replaceState(null, "", `#${target.id}`);
    return;
  }

  if (reduceMotion.matches) {
    window.scrollTo(0, endY);
    history.replaceState(null, "", `#${target.id}`);
    return;
  }

  cancelSectionNav();
  const token = sectionNavToken;
  const duration = sectionNavDuration(distance);
  const t0 = performance.now();

  const interrupt = () => {
    if (token !== sectionNavToken) return;
    cancelSectionNav();
    teardown();
  };

  const teardown = () => {
    window.removeEventListener("wheel", interrupt);
    window.removeEventListener("touchstart", interrupt);
    window.removeEventListener("keydown", interrupt);
  };

  window.addEventListener("wheel", interrupt, { passive: true });
  window.addEventListener("touchstart", interrupt, { passive: true });
  window.addEventListener("keydown", interrupt);

  const tick = (now) => {
    if (token !== sectionNavToken) {
      teardown();
      return;
    }

    const t = Math.min(1, (now - t0) / duration);
    const eased = easeInOutCubic(t);
    window.scrollTo(0, startY + distance * eased);

    if (t < 1) {
      sectionNavRaf = requestAnimationFrame(tick);
      return;
    }

    sectionNavRaf = 0;
    history.replaceState(null, "", `#${target.id}`);
    teardown();
  };

  sectionNavRaf = requestAnimationFrame(tick);
}

/**
 * Animate the FAQ rows open and shut.
 *
 * A <details> cannot do this in CSS alone: transitioning to `height: auto`
 * needs `interpolate-size`, which only Chrome supports, so Safari and Firefox
 * snap open instantly. Driving the height here gives every browser the same
 * slow reveal. Timing is read from the stylesheet so it stays tunable there.
 */
function initFaqAccordion() {
  const items = document.querySelectorAll(".lp-faq-item");
  if (!items.length) return;

  const section = document.querySelector(".lp-faq");
  const styles = getComputedStyle(section);
  const rawDuration = styles.getPropertyValue("--faq-box-duration").trim();
  const duration = rawDuration.endsWith("ms")
    ? parseFloat(rawDuration)
    : (parseFloat(rawDuration) || 1.15) * 1000;
  const easing =
    styles.getPropertyValue("--faq-ease").trim() || "cubic-bezier(0.4, 0, 0.2, 1)";

  const closers = [];

  items.forEach((item) => {
    const summary = item.querySelector("summary");
    const content = item.querySelector(".lp-faq-answer");
    if (!summary || !content) return;

    let animation = null;

    const animate = (from, to, onFinish) => {
      animation?.cancel();
      animation = content.animate(
        [{ height: `${from}px` }, { height: `${to}px` }],
        { duration, easing, fill: "forwards" },
      );
      animation.onfinish = () => {
        onFinish?.();
        animation?.cancel();
        animation = null;
      };
    };

    const settleClosed = () => {
      animation?.cancel();
      animation = null;
      item.classList.remove("is-closing");
      item.open = false;
    };

    const close = (instant) => {
      if (!item.open || item.classList.contains("is-closing")) return;
      if (instant || reduceMotion.matches) {
        settleClosed();
        return;
      }
      item.classList.add("is-closing");
      animate(content.getBoundingClientRect().height, 0, () => {
        item.open = false;
        item.classList.remove("is-closing");
      });
    };

    closers.push(close);

    summary.addEventListener("click", (event) => {
      event.preventDefault();

      if (reduceMotion.matches) {
        const wasOpen = item.open;
        settleClosed();
        item.open = !wasOpen;
        return;
      }

      const isClosing = item.classList.contains("is-closing");
      // Only trustworthy while the row is open or mid-animation: a collapsed
      // row still reports the answer's full natural height here.
      const live = content.getBoundingClientRect().height;

      if (item.open && !isClosing) {
        close(false);
        return;
      }

      // Reversing mid-close resumes from the live height; otherwise start flat.
      const from = isClosing ? live : 0;
      item.classList.remove("is-closing");
      animation?.cancel();
      animation = null;
      item.open = true;
      animate(from, content.getBoundingClientRect().height);
    });
  });

  const closeAll = (instant) => closers.forEach((close) => close(instant));

  // Leaving the section — scrolling away, or jumping to another section from
  // the header — resets the rows so the FAQ is collapsed next time it's seen.
  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) closeAll(false);
      }
    },
    { threshold: 0 },
  ).observe(section);

  // Navigating away: collapse instantly so a back/forward restore from the
  // bfcache doesn't come back with rows still open.
  window.addEventListener("pagehide", () => closeAll(true));
}

/**
 * A native hash jump happens before late layout (images, fonts) settles, which
 * can leave a deep link parked mid-section. Re-align once things stop moving,
 * unless the visitor has already taken over the scroll.
 */
function correctInitialHashScroll() {
  const id = location.hash.slice(1);
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;

  let userMoved = false;
  const release = () => {
    userMoved = true;
  };
  window.addEventListener("wheel", release, { passive: true, once: true });
  window.addEventListener("touchstart", release, { passive: true, once: true });
  window.addEventListener("keydown", release, { once: true });

  const settle = () => {
    if (userMoved) return;
    const y = Math.max(
      0,
      target.getBoundingClientRect().top + window.scrollY - getHeaderOffset(),
    );
    if (Math.abs(y - window.scrollY) < 2) return;
    window.scrollTo(0, y);
  };

  requestAnimationFrame(settle);
  window.addEventListener(
    "load",
    () => {
      settle();
      setTimeout(settle, 150);
    },
    { once: true },
  );
}

/** Header section links: slow eased scroll instead of a hard jump. */
function initSectionNav() {
  if (!document.body.classList.contains("landing-page")) return;

  correctInitialHashScroll();

  document.querySelectorAll('.header-nav a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href")?.slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      animateToSection(target);
    });
  });
}

bindPressFeedback();
initScrollReveals();
initHeaderMaterial();
initSectionNav();
initFaqAccordion();
