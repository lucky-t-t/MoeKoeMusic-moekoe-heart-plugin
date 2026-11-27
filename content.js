(() => {
  'use strict';

  const SCRIPT_ID = 'moekoe-playerbar-heart-injected';

  function injectMainWorldScript() {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('injected.js');
    script.async = false;
    script.onload = () => {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  if (document.documentElement) {
    injectMainWorldScript();
  } else {
    document.addEventListener('DOMContentLoaded', injectMainWorldScript, { once: true });
  }
})();
