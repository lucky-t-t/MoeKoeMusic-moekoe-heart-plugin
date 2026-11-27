(() => {
  'use strict';

  const STORAGE_KEY = 'moekoeHeartSettings';

  const PRESETS = [
    { id: 'classic-red', name: '经典红', color: '#ec4141' },
    { id: 'sakura-pink', name: '樱花粉', color: '#ff4d6a' },
    { id: 'macaron-peach', name: '蜜桃粉', color: '#ff8fab' },
    { id: 'macaron-mint', name: '薄荷绿', color: '#4ecdc4' },
    { id: 'macaron-taro', name: '香芋紫', color: '#a78bfa' },
    { id: 'macaron-butter', name: '奶油黄', color: '#f59e0b' },
    { id: 'macaron-sky', name: '晴空蓝', color: '#38bdf8' },
    { id: 'macaron-coral', name: '珊瑚橘', color: '#fb7185' },
    { id: 'theme', name: '跟随主题', color: 'theme' },
  ];

  const DEFAULT_SETTINGS = {
    colorPreset: 'sakura-pink',
    customColor: '#ff4d6a',
    showPlayNextBtn: true,
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let statusTimer = null;

  const colorGrid = document.getElementById('colorGrid');
  const heartPreview = document.getElementById('heartPreview');
  const customColorInput = document.getElementById('customColorInput');
  const customColorHex = document.getElementById('customColorHex');
  const togglePlayNext = document.getElementById('togglePlayNext');
  const statusText = document.getElementById('statusText');

  function showSavedStatus(msg = '已保存并同步') {
    statusText.textContent = msg;
    statusText.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusText.classList.remove('show');
    }, 1400);
  }

  function getActiveColorHex() {
    if (currentSettings.colorPreset === 'custom') {
      return currentSettings.customColor || '#ff4d6a';
    }
    const found = PRESETS.find((p) => p.id === currentSettings.colorPreset);
    if (!found || found.color === 'theme') {
      return '#ff4d6a';
    }
    return found.color;
  }

  function renderUI() {
    colorGrid.innerHTML = '';
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-option' + (currentSettings.colorPreset === preset.id ? ' active' : '');

      const swatch = document.createElement('span');
      if (preset.color === 'theme') {
        swatch.className = 'swatch theme-swatch';
      } else {
        swatch.className = 'swatch';
        swatch.style.backgroundColor = preset.color;
      }

      const label = document.createElement('span');
      label.textContent = preset.name;

      btn.appendChild(swatch);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        currentSettings.colorPreset = preset.id;
        if (preset.color !== 'theme') {
          currentSettings.customColor = preset.color;
        }
        saveSettings();
      });
      colorGrid.appendChild(btn);
    }

    const previewColor = getActiveColorHex();
    heartPreview.style.color = previewColor;
    customColorInput.value = currentSettings.customColor || '#ff4d6a';
    customColorHex.textContent = (currentSettings.customColor || '#ff4d6a').toLowerCase();
    togglePlayNext.checked = currentSettings.showPlayNextBtn !== false;
  }

  function saveSettings() {
    renderUI();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: currentSettings }, () => {
        showSavedStatus();
      });
    } else {
      showSavedStatus();
    }
  }

  customColorInput.addEventListener('input', (e) => {
    currentSettings.colorPreset = 'custom';
    currentSettings.customColor = e.target.value;
    saveSettings();
  });

  togglePlayNext.addEventListener('change', (e) => {
    currentSettings.showPlayNextBtn = e.target.checked;
    saveSettings();
  });

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (result && result[STORAGE_KEY]) {
        currentSettings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
      }
      renderUI();
    });
  } else {
    renderUI();
  }
})();
