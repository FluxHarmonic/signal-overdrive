// logo-glitch.js - the Signal Overdrive wordmark's glitch, for the web.
// Written by scripts/art/gen-logo.mjs --export.
//
//   <img src="logo.png" alt="Signal Overdrive" data-glitch="logo-glitch-{n}.png">
//   <script src="logo-glitch.js" defer></script>
//
// logo.png is the still wordmark, and it is what shows with JS off and
// under prefers-reduced-motion (checked live, so turning it on stops the
// glitch at once). Otherwise, once every frame has loaded, the img's src
// steps through logo-glitch-1.png to -8.png on a fixed timeline: the
// logo holds for a couple of seconds, then glitches for a tenth of one.
// Every frame is the same size as logo.png, so the page's CSS for the img
// applies unchanged; give it image-rendering: pixelated. It stops while
// the tab is hidden.
(() => {
  const T = [[0,2200],[1,60],[2,70],[0,1900],[3,50],[4,60],[0,2700],[5,70],[6,40],[0,1500],[7,60],[8,80]];
  const rm = matchMedia("(prefers-reduced-motion: reduce)");
  for (const img of document.querySelectorAll("img[data-glitch]")) {
    const urls = [img.getAttribute("src")];
    for (let i = 1; i <= 8; i++) urls.push(img.dataset.glitch.replace("{n}", i));
    let step = 0, timer = 0;
    const stop = () => { clearTimeout(timer); timer = 0; img.src = urls[0]; };
    const run = () => {
      if (rm.matches || document.hidden) return stop();
      const [i, ms] = T[step];
      img.src = urls[i];
      step = (step + 1) % T.length;
      timer = setTimeout(run, ms);
    };
    const wake = () => { if (rm.matches || document.hidden) stop(); else if (!timer) run(); };
    Promise.all(urls.slice(1).map((u) => { const p = new Image(); p.src = u; return p.decode(); }))
      .then(() => {
        wake();
        rm.addEventListener("change", wake);
        document.addEventListener("visibilitychange", wake);
      })
      .catch(() => {});   // a frame did not load: the still stays
  }
})();
