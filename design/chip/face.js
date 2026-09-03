/**
 * Read the one thing a face varies by, off its own URL.
 *
 *   side-1.html?mm=43
 *
 * `mm` is the diameter of the circle the art fills. On a chip printed edge to
 * edge that is the whole chip; on one with a border it is the art window inside
 * it, which is what Custom Made Casino's 47mm ceramic has: 43mm of art inside a
 * 2mm ring. The math does not care which it is.
 *
 * The artwork is drawn once, at 39mm, and every other size is the same drawing
 * scaled. The only thing that genuinely changes is how much of the artboard the
 * art occupies, because the 3mm of bleed is absolute and does not grow: it is
 * 1/15th of a 39mm circle and 1/16th of a 43mm one. So the scale is the ratio
 * of those two fractions, and it is small, about 1.02 from 39mm to 47mm.
 */
(function () {
  const BASE_MM = 39;
  const BLEED_MM = 6; // 3mm on each side

  function trimFraction(mm) {
    return mm / (mm + BLEED_MM);
  }

  const params = new URLSearchParams(location.search);
  const mm = Number(params.get("mm")) || BASE_MM; // the art circle, not the chip
  const root = document.documentElement;

  root.style.setProperty("--scale", String(trimFraction(mm) / trimFraction(BASE_MM)));
  root.dataset.mm = String(mm);
})();
