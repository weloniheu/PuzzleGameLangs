// ---------------------------------------------------------------------------
// Scroll-edge fade — the "there is more below/above" tell for any list that can
// outgrow its container (the destination chooser's row list, the settings card's
// body). A max-height + overflow alone lets a cut-off list look like it simply
// ENDS; this says so. PURE edge detection + a thin DOM attach, same split as
// everything else here.
// ---------------------------------------------------------------------------

export interface ScrollEdges {
  top: boolean;    // content is scrolled DOWN — there is more ABOVE
  bottom: boolean;  // there is more BELOW the visible area
}

/** Which edges are currently cut off. A small slop absorbs sub-pixel rounding so a
 *  fully-scrolled edge doesn't flicker the fade on and off. */
export function scrollEdges(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): ScrollEdges {
  return {
    top: el.scrollTop > 1,
    bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
  };
}

/** Wire a scrollable element to two fade indicators (siblings, CSS-positioned over its
 *  top/bottom edge — see `.room-scroll-fade` in style.css). Paints once immediately AND
 *  returns that paint function so the caller can invoke it again once the scroller has
 *  its real content and is attached to the document — geometry read at CALL time (here)
 *  is whatever `scroller` has right now, which is typically empty/detached the moment a
 *  builder creates it, before content is appended and the panel is shown. */
export function attachScrollFade(scroller: HTMLElement, topEl: HTMLElement, bottomEl: HTMLElement): () => void {
  const paint = () => {
    const edges = scrollEdges(scroller);
    topEl.classList.toggle("visible", edges.top);
    bottomEl.classList.toggle("visible", edges.bottom);
  };
  scroller.addEventListener("scroll", paint);
  paint();
  return paint;
}
