(() => {
  'use strict';

  const SCRIPT_ID = 'moekoe-playerbar-heart-injected';
  const STORAGE_KEY = 'moekoeHeartSettings';
  const LOCAL_SETTINGS_KEY = 'moekoe_heart_settings_v1';

  const PRESET_COLORS = {
    'classic-red': '#ec4141',
    'sakura-pink': '#ff4d6a',
    'macaron-peach': '#ff8fab',
    'macaron-mint': '#4ecdc4',
    'macaron-taro': '#a78bfa',
    'macaron-butter': '#f59e0b',
    'macaron-sky': '#38bdf8',
    'macaron-coral': '#fb7185',
    theme: 'theme',
  };

  const DEFAULT_SETTINGS = {
    colorPreset: 'sakura-pink',
    customColor: '#ff4d6a',
    showPlayNextBtn: true,
  };

  function resolveColorValue(settings) {
    if (settings.colorPreset === 'theme') {
      return 'var(--primary-color, #ff4d6a)';
    }
    if (settings.colorPreset === 'custom' && settings.customColor) {
      return settings.customColor;
    }
    return PRESET_COLORS[settings.colorPreset] || settings.customColor || '#ff4d6a';
  }

  function applySettingsToPage(rawSettings) {
    const settings = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
    const colorValue = resolveColorValue(settings);

    const root = document.documentElement;
    if (root) {
      root.style.setProperty('--moekoe-heart-color', colorValue);
    }

    try {
      localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage quota errors
    }

    window.postMessage(
      {
        source: 'moekoe-heart-content',
        type: 'SETTINGS_UPDATE',
        settings,
      },
      '*'
    );
  }

  function loadAndSyncSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        applySettingsToPage(result ? result[STORAGE_KEY] : null);
      });

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE_KEY]) {
          applySettingsToPage(changes[STORAGE_KEY].newValue);
        }
      });
    } else {
      applySettingsToPage(DEFAULT_SETTINGS);
    }
  }

  function injectMainWorldScript() {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('injected.js');
    script.async = false;
    script.onload = () => {
      script.remove();
      loadAndSyncSettings();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  if (document.documentElement) {
    loadAndSyncSettings();
    injectMainWorldScript();
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        loadAndSyncSettings();
        injectMainWorldScript();
      },
      { once: true }
    );
  }
})();
