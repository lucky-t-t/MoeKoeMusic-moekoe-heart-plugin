(() => {
  'use strict';

  if (window.__MOEKOE_PLAYERBAR_HEART_LOADED__) return;
  window.__MOEKOE_PLAYERBAR_HEART_LOADED__ = true;

  const LOG_PREFIX = '[MoeKoe-Heart]';
  const PENDING_FILEID = '__PENDING__';
  const SYNC_COOLDOWN_MS = 15000;
  const CACHE_KEY = 'moekoe_heart_cache_v1';
  const LOCAL_SETTINGS_KEY = 'moekoe_heart_settings_v1';

  const PLAY_NEXT_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 6h11"/><path d="M4 12h8"/><path d="M4 18h8"/>' +
    '<path d="M16 12l5 3.5-5 3.5V12z" fill="currentColor" stroke="none"/>' +
    '</svg>';

  const DEFAULT_SETTINGS = {
    colorPreset: 'sakura-pink',
    customColor: '#ff4d6a',
    showPlayNextBtn: true,
  };

  const state = {
    userid: null,
    likeListId: null,
    likeGlobalCollectionId: null,
    hashToFileId: new Map(),
    fileIdToHashes: new Map(),
    nameAuthorToFileId: new Map(),
    fileIdToNameAuthor: new Map(),
    synced: false,
    syncingPromise: null,
    lastSyncAt: 0,
    toggling: false,
    lastSongKey: '',
    upNextQueue: [],
    settings: { ...DEFAULT_SETTINGS },
  };

  function safeJsonParse(raw, fallback = null) {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function loadSettingsFromLocalStorage() {
    const saved = safeJsonParse(localStorage.getItem(LOCAL_SETTINGS_KEY), null);
    if (saved && typeof saved === 'object') {
      state.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  function getMoeData() {
    return safeJsonParse(localStorage.getItem('MoeData'), {});
  }

  function getCurrentSong() {
    return safeJsonParse(localStorage.getItem('current_song'), null);
  }

  function getApiBaseUrl() {
    const settings = safeJsonParse(localStorage.getItem('settings'), {});
    const custom = typeof settings?.apiBaseUrl === 'string' ? settings.apiBaseUrl.trim().replace(/\/+$/, '') : '';
    return custom || 'http://127.0.0.1:6521';
  }

  function buildAuthHeader() {
    const moeData = getMoeData();
    const userInfo = moeData?.UserInfo || {};
    const device = moeData?.Device || {};

    const parts = [];
    if (userInfo.token) parts.push(`token=${userInfo.token}`);
    if (userInfo.userid) parts.push(`userid=${userInfo.userid}`);
    if (device.dfid) parts.push(`dfid=${device.dfid}`);
    if (userInfo.t1) parts.push(`t1=${userInfo.t1}`);
    if (device.mid) parts.push(`KUGOU_API_MID=${device.mid}`);
    if (device.guid) parts.push(`KUGOU_API_GUID=${device.guid}`);
    if (device.serverDev) parts.push(`KUGOU_API_DEV=${device.serverDev}`);
    if (device.mac) parts.push(`KUGOU_API_MAC=${device.mac}`);
    return parts.join(';');
  }

  function notify(type, text) {
    try {
      if (window.$message && typeof window.$message[type] === 'function') {
        window.$message[type](text);
        return;
      }
      if (type === 'warning' && window.$modal && typeof window.$modal.alert === 'function') {
        window.$modal.alert(text);
        return;
      }
    } catch (err) {
      console.warn(LOG_PREFIX, 'notify failed:', err);
    }
    console.log(LOG_PREFIX, `[${type}]`, text);
  }

  async function apiGet(path, params = {}) {
    const authHeader = buildAuthHeader();
    const headers = {};
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    if ('kugouapi' in window && window.kugouapi && typeof window.kugouapi.request === 'function') {
      const res = await window.kugouapi.request(path, { params, headers });
      return res?.body ?? { status: 0, error_msg: 'empty response body' };
    }

    const baseUrl = getApiBaseUrl();
    const hasQuery = path.includes('?');
    const searchParams = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        searchParams.append(k, String(v));
      }
    });
    const qs = searchParams.toString();
    const fullUrl = `${baseUrl}${path}${qs ? (hasQuery ? '&' : '?') + qs : ''}`;

    const resp = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      credentials: 'include',
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json();
  }

  function normalizeHash(hash) {
    return typeof hash === 'string' ? hash.trim().toUpperCase() : '';
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[()（）【】[\]'"`.,，。!?！？\-—_]/g, '');
  }

  function buildNameAuthorKey(name, author) {
    const n = normalizeText(name);
    const a = normalizeText(author);
    if (!n) return '';
    return `${n}||${a}`;
  }

  function clearFavoritesCache() {
    state.hashToFileId.clear();
    state.fileIdToHashes.clear();
    state.nameAuthorToFileId.clear();
    state.fileIdToNameAuthor.clear();
    state.synced = false;
  }

  function hydrateCacheFromStorage() {
    const moeData = getMoeData();
    const userid = moeData?.UserInfo?.userid;
    if (!userid) return false;

    const cached = safeJsonParse(localStorage.getItem(CACHE_KEY), null);
    if (!cached || String(cached.userid) !== String(userid)) return false;

    state.userid = userid;
    state.likeListId = cached.likeListId || null;
    state.likeGlobalCollectionId = cached.likeGlobalCollectionId || null;

    clearFavoritesCache();
    if (Array.isArray(cached.entries)) {
      for (const item of cached.entries) {
        if (!Array.isArray(item) || !item[0]) continue;
        const [fileid, hashes, naKey] = item;
        const set = new Set();
        if (Array.isArray(hashes)) {
          for (const h of hashes) {
            if (h) {
              state.hashToFileId.set(h, fileid);
              set.add(h);
            }
          }
        }
        if (set.size > 0) {
          state.fileIdToHashes.set(fileid, set);
        }
        if (naKey) {
          state.nameAuthorToFileId.set(naKey, fileid);
          state.fileIdToNameAuthor.set(fileid, naKey);
        }
      }
      state.synced = true;
      return true;
    }
    return false;
  }

  function persistCacheToStorage() {
    if (!state.userid || !state.likeListId) return;
    try {
      const entries = [];
      const seenFileIds = new Set();
      for (const [fileid, hashSet] of state.fileIdToHashes.entries()) {
        if (!fileid || fileid === PENDING_FILEID) continue;
        seenFileIds.add(fileid);
        entries.push([fileid, Array.from(hashSet), state.fileIdToNameAuthor.get(fileid) || '']);
      }
      for (const [fileid, naKey] of state.fileIdToNameAuthor.entries()) {
        if (!fileid || fileid === PENDING_FILEID || seenFileIds.has(fileid)) continue;
        entries.push([fileid, [], naKey]);
      }

      const payload = {
        userid: state.userid,
        likeListId: state.likeListId,
        likeGlobalCollectionId: state.likeGlobalCollectionId,
        updatedAt: Date.now(),
        entries,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to persist cache:', err);
    }
  }

  function indexTrack(track) {
    if (!track) return;
    const fileid = track.fileid != null ? String(track.fileid) : '';
    if (!fileid) return;

    const hashes = new Set();
    const addHash = (h) => {
      const norm = normalizeHash(h);
      if (norm) hashes.add(norm);
    };

    addHash(track.hash);
    addHash(track.hash_128);
    addHash(track.hash_320);
    addHash(track.hash_flac);
    addHash(track.hash_high);

    if (Array.isArray(track.relate_goods)) {
      for (const item of track.relate_goods) {
        if (item && item.hash) addHash(item.hash);
      }
    }

    if (hashes.size > 0) {
      let existingSet = state.fileIdToHashes.get(fileid);
      if (!existingSet) {
        existingSet = new Set();
        state.fileIdToHashes.set(fileid, existingSet);
      }
      for (const h of hashes) {
        state.hashToFileId.set(h, fileid);
        existingSet.add(h);
      }
    }

    if (typeof track.name === 'string' && track.name.trim()) {
      const parts = track.name.split(' - ');
      const songName = parts.length > 1 ? parts.slice(1).join(' - ') : track.name;
      const author = parts.length > 1 ? parts[0] : (track.author || '');
      const key = buildNameAuthorKey(songName, author);
      if (key) {
        state.nameAuthorToFileId.set(key, fileid);
        state.fileIdToNameAuthor.set(fileid, key);
      }
    }
  }

  function removeTrackFromCache(fileid, song) {
    if (fileid && fileid !== PENDING_FILEID) {
      const hashes = state.fileIdToHashes.get(fileid);
      if (hashes) {
        for (const h of hashes) {
          if (state.hashToFileId.get(h) === fileid) {
            state.hashToFileId.delete(h);
          }
        }
        state.fileIdToHashes.delete(fileid);
      }
      const naKey = state.fileIdToNameAuthor.get(fileid);
      if (naKey) {
        if (state.nameAuthorToFileId.get(naKey) === fileid) {
          state.nameAuthorToFileId.delete(naKey);
        }
        state.fileIdToNameAuthor.delete(fileid);
      }
    }

    if (song) {
      for (const h of getSongCandidateHashes(song)) {
        state.hashToFileId.delete(h);
      }
      const key = buildNameAuthorKey(song.name, song.author);
      if (key) {
        state.nameAuthorToFileId.delete(key);
      }
    }
  }

  function addOptimisticTrackToCache(song, fileid) {
    const fid = fileid ? String(fileid) : PENDING_FILEID;
    const hashes = getSongCandidateHashes(song);
    if (hashes.length > 0) {
      let existingSet = state.fileIdToHashes.get(fid);
      if (!existingSet) {
        existingSet = new Set();
        state.fileIdToHashes.set(fid, existingSet);
      }
      for (const h of hashes) {
        state.hashToFileId.set(h, fid);
        existingSet.add(h);
      }
    }
    const key = buildNameAuthorKey(song.name, song.author);
    if (key) {
      state.nameAuthorToFileId.set(key, fid);
      state.fileIdToNameAuthor.set(fid, key);
    }
  }

  function getSongCandidateHashes(song) {
    if (!song) return [];
    const set = new Set();
    const add = (h) => {
      const norm = normalizeHash(h);
      if (norm) set.add(norm);
    };
    add(song.hash);
    add(song.playHash);
    if (Array.isArray(song.qualityOptions)) {
      for (const opt of song.qualityOptions) {
        if (opt && opt.hash) add(opt.hash);
      }
    }
    return Array.from(set);
  }

  function findSongFavorite(song) {
    if (!song || song.isLocal || song.isCloud) {
      return { liked: false, fileid: null };
    }

    const hashes = getSongCandidateHashes(song);
    for (const h of hashes) {
      if (state.hashToFileId.has(h)) {
        return { liked: true, fileid: state.hashToFileId.get(h) };
      }
    }

    const naKey = buildNameAuthorKey(song.name, song.author);
    if (naKey && state.nameAuthorToFileId.has(naKey)) {
      return { liked: true, fileid: state.nameAuthorToFileId.get(naKey) };
    }

    return { liked: false, fileid: null };
  }

  async function ensureLikePlaylistInfo(force = false) {
    const moeData = getMoeData();
    const userid = moeData?.UserInfo?.userid;
    const token = moeData?.UserInfo?.token;

    if (!userid || !token) {
      state.userid = null;
      state.likeListId = null;
      state.likeGlobalCollectionId = null;
      clearFavoritesCache();
      return false;
    }

    if (String(state.userid) !== String(userid)) {
      state.userid = userid;
      state.likeListId = null;
      state.likeGlobalCollectionId = null;
      clearFavoritesCache();
    }

    if (!force && state.likeListId && state.likeGlobalCollectionId) {
      return true;
    }

    const res = await apiGet('/user/playlist', {
      pagesize: 500,
      t: Date.now(),
    });

    if (!res || res.status !== 1 || !Array.isArray(res?.data?.info)) {
      return false;
    }

    const savedLikeId = localStorage.getItem('like');
    const playlists = res.data.info;

    let likePlaylist = playlists.find((p) => p.name === '我喜欢' && String(p.list_create_userid) === String(userid));
    if (!likePlaylist) {
      likePlaylist = playlists.find((p) => p.name === '我喜欢');
    }
    if (!likePlaylist && savedLikeId) {
      likePlaylist = playlists.find((p) => String(p.listid) === String(savedLikeId));
    }

    if (!likePlaylist) {
      return false;
    }

    state.likeListId = String(likePlaylist.listid);
    state.likeGlobalCollectionId = likePlaylist.list_create_gid || likePlaylist.global_collection_id || '';
    if (state.likeListId) {
      localStorage.setItem('like', state.likeListId);
    }

    return Boolean(state.likeListId && state.likeGlobalCollectionId);
  }

  async function syncFavorites(force = false) {
    if (state.syncingPromise) {
      return state.syncingPromise;
    }

    const now = Date.now();
    if (!force && state.synced && now - state.lastSyncAt < SYNC_COOLDOWN_MS) {
      return true;
    }

    state.syncingPromise = (async () => {
      try {
        const hasInfo = await ensureLikePlaylistInfo(force);
        if (!hasInfo) {
          updateHeartButtonsUI();
          return false;
        }

        const pageSize = 300;
        const maxPages = 50;
        const collected = [];
        let page = 1;
        let total = Infinity;

        while (page <= maxPages && collected.length < total) {
          const res = await apiGet('/playlist/track/all', {
            id: state.likeGlobalCollectionId,
            page,
            pagesize: pageSize,
            t: Date.now(),
          });

          if (!res || res.status !== 1) {
            break;
          }

          const songs = Array.isArray(res?.data?.songs) ? res.data.songs : [];
          if (typeof res?.data?.list_info?.count === 'number') {
            total = res.data.list_info.count;
          }

          collected.push(...songs);
          if (songs.length < pageSize) {
            break;
          }
          page += 1;
        }

        clearFavoritesCache();
        for (const track of collected) {
          indexTrack(track);
        }

        state.synced = true;
        state.lastSyncAt = Date.now();
        persistCacheToStorage();
        updateHeartButtonsUI();
        return true;
      } catch (err) {
        console.warn(LOG_PREFIX, 'Failed to sync favorites:', err);
        return false;
      } finally {
        state.syncingPromise = null;
      }
    })();

    return state.syncingPromise;
  }

  function extractFileIdFromAddResponse(res) {
    const candidates = [
      res?.data?.[0]?.fileid,
      res?.data?.info?.[0]?.fileid,
      res?.data?.fileid,
      res?.fileid,
    ];
    for (const c of candidates) {
      if (c !== undefined && c !== null && String(c).trim() !== '') {
        return String(c);
      }
    }
    return null;
  }

  function getHeartButtons() {
    const buttons = [];
    const barButtons = document.querySelectorAll('.player-bar .extra-controls button');
    for (const btn of barButtons) {
      if (btn.querySelector('i.fa-heart')) {
        buttons.push(btn);
      }
    }
    const lyricsButtons = document.querySelectorAll('.lyrics-screen .player-controls button.like-btn');
    for (const btn of lyricsButtons) {
      if (btn.querySelector('i.fa-heart')) {
        buttons.push(btn);
      }
    }
    return buttons;
  }

  function isHeartButton(el) {
    if (!el || !(el instanceof Element)) return null;
    const btn = el.closest('button');
    if (!btn) return null;
    if (!btn.querySelector('i.fa-heart')) return null;
    if (btn.closest('.player-bar .extra-controls') || btn.closest('.lyrics-screen .player-controls')) {
      return btn;
    }
    return null;
  }

  function triggerPopAnimation(buttons) {
    for (const btn of buttons) {
      btn.classList.remove('moekoe-heart-pop');
      void btn.offsetWidth;
      btn.classList.add('moekoe-heart-pop');
    }
  }

  function updateHeartButtonsUI(withPop = false) {
    const buttons = getHeartButtons();
    if (buttons.length === 0) return;

    const song = getCurrentSong();
    const { liked } = findSongFavorite(song);

    for (const btn of buttons) {
      btn.classList.add('moekoe-heart-btn');
      btn.classList.toggle('moekoe-heart-liked', liked);
      btn.classList.toggle('moekoe-heart-loading', state.toggling);
      btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      btn.setAttribute('title', liked ? '取消喜欢' : '我喜欢');
    }

    if (withPop) {
      triggerPopAnimation(buttons);
    }
  }

  async function toggleFavorite() {
    if (state.toggling) return;

    const moeData = getMoeData();
    if (!moeData?.UserInfo?.token || !moeData?.UserInfo?.userid) {
      notify('warning', '请先登录账号');
      return;
    }

    const song = getCurrentSong();
    if (!song || !song.hash) {
      notify('warning', '没有正在播放的歌曲');
      return;
    }
    if (song.isLocal) {
      notify('warning', '本地音乐不支持收藏到歌单');
      return;
    }
    if (song.isCloud) {
      notify('warning', '云盘音乐不支持收藏到歌单');
      return;
    }

    state.toggling = true;
    updateHeartButtonsUI();

    try {
      if (!state.synced || !state.likeListId) {
        await syncFavorites(true);
      }

      if (!state.likeListId) {
        notify('error', '未找到“我喜欢”歌单，请稍后重试');
        return;
      }

      let fav = findSongFavorite(song);

      if (fav.liked) {
        let fileid = fav.fileid;
        if (!fileid || fileid === PENDING_FILEID) {
          await syncFavorites(true);
          fav = findSongFavorite(song);
          fileid = fav.fileid;
        }

        if (!fileid || fileid === PENDING_FILEID) {
          notify('error', '未获取到歌曲记录 ID，请稍后重试');
          return;
        }

        const delRes = await apiGet('/playlist/tracks/del', {
          listid: state.likeListId,
          fileids: fileid,
        });

        if (delRes && delRes.status === 0 && delRes.error_code) {
          throw new Error(delRes.error_msg || `error_code=${delRes.error_code}`);
        }

        removeTrackFromCache(fileid, song);
        persistCacheToStorage();
        localStorage.setItem('t', String(Date.now()));
        updateHeartButtonsUI(true);
        notify('success', '已取消收藏');
      } else {
        const cleanName = String(song.name || '').replace(/,/g, '');
        const songData = `${encodeURIComponent(cleanName)}|${song.hash}`;
        const addRes = await apiGet(
          `/playlist/tracks/add?listid=${encodeURIComponent(state.likeListId)}&data=${songData}`
        );

        if (addRes && addRes.status === 0 && addRes.error_code) {
          throw new Error(addRes.error_msg || `error_code=${addRes.error_code}`);
        }

        const newFileId = extractFileIdFromAddResponse(addRes);
        addOptimisticTrackToCache(song, newFileId);
        persistCacheToStorage();
        localStorage.setItem('t', String(Date.now()));
        updateHeartButtonsUI(true);
        notify('success', '已添加到我喜欢');

        if (!newFileId) {
          setTimeout(() => {
            syncFavorites(true);
          }, 800);
        }
      }
    } catch (err) {
      console.error(LOG_PREFIX, 'Toggle favorite failed:', err);
      notify('error', '操作失败，请稍后重试');
    } finally {
      state.toggling = false;
      updateHeartButtonsUI();
    }
  }

  function createPlayNextButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'moekoe-play-next-btn';
    btn.title = '下一首播放';
    btn.setAttribute('aria-label', '下一首播放');
    btn.innerHTML = PLAY_NEXT_ICON_SVG;
    return btn;
  }

  function getPlaybackModeOptions() {
    return Array.from(document.querySelectorAll('.player-bar .playback-mode-menu .playback-mode-option'));
  }

  function isShuffleModeActive() {
    const options = getPlaybackModeOptions();
    if (options.length >= 2) {
      return options[0].classList.contains('active');
    }
    return Boolean(document.querySelector('.player-bar .playback-mode .fa-random, .player-bar .playback-mode .fa-shuffle'));
  }

  function switchToLoopForNextTick() {
    const options = getPlaybackModeOptions();
    if (options.length < 2) return;
    const shuffleBtn = options[0];
    const loopBtn = options[1];
    if (!shuffleBtn.classList.contains('active')) return;

    // 临时切到列表循环，让客户端原生下一首逻辑严格按队列下一位播放，随后恢复随机播放
    loopBtn.click();
    setTimeout(() => {
      const latestOptions = getPlaybackModeOptions();
      if (latestOptions[0] && !latestOptions[0].classList.contains('active')) {
        latestOptions[0].click();
      }
    }, 120);
  }

  function getUpNextPosition(hash) {
    const norm = normalizeHash(hash);
    if (!norm) return -1;
    return state.upNextQueue.findIndex((s) => normalizeHash(s.hash) === norm);
  }

  function syncUpNextOrderInStore(store) {
    if (!store || !Array.isArray(store.queue) || state.upNextQueue.length === 0) return;

    const currentSong = getCurrentSong();
    const currentHash = normalizeHash(currentSong?.hash);

    // Build ordered list of upNext hashes (excluding currently playing song)
    state.upNextQueue = state.upNextQueue.filter((s) => normalizeHash(s.hash) !== currentHash);
    if (state.upNextQueue.length === 0) return;

    const upNextHashSet = new Set(state.upNextQueue.map((s) => normalizeHash(s.hash)));
    const remaining = [];
    const byHash = new Map();

    for (const s of store.queue) {
      const h = normalizeHash(s.hash);
      if (upNextHashSet.has(h)) {
        if (!byHash.has(h)) byHash.set(h, s);
      } else {
        remaining.push(s);
      }
    }

    const orderedUpNext = [];
    for (const queued of state.upNextQueue) {
      const h = normalizeHash(queued.hash);
      orderedUpNext.push(byHash.get(h) || queued);
    }

    const currentIdxInRemaining = currentHash
      ? remaining.findIndex((s) => normalizeHash(s.hash) === currentHash)
      : -1;
    const insertAt = currentIdxInRemaining !== -1 ? currentIdxInRemaining + 1 : 0;

    remaining.splice(insertAt, 0, ...orderedUpNext);
    remaining.forEach((song, i) => {
      song.id = i + 1;
    });

    if (typeof store.setQueue === 'function') {
      store.setQueue(remaining);
    } else {
      store.queue = remaining;
    }
  }

  function enqueueUpNextSong(song, store) {
    if (!song || !song.hash) return;
    const normHash = normalizeHash(song.hash);
    const currentHash = normalizeHash(getCurrentSong()?.hash);

    if (normHash === currentHash) {
      notify('warning', '当前正在播放这首歌曲');
      return;
    }

    const existingPos = getUpNextPosition(normHash);
    if (existingPos !== -1) {
      notify('warning', `已在下一首排队第 ${existingPos + 1} 位：${song.name}`);
      return;
    }

    state.upNextQueue.push({ ...song });
    if (store) {
      syncUpNextOrderInStore(store);
    }
    const pos = state.upNextQueue.length;
    notify('success', `已加入下一首排队（第 ${pos} 位）：${song.name}`);
    setTimeout(injectPlayNextButtons, 40);
  }

  function resolveQueueItemSong(queueItemEl, store) {
    if (!store || !Array.isArray(store.queue)) return null;
    const titleText = (queueItemEl.querySelector('.queue-song-title')?.textContent || '').trim();
    const durationText = (queueItemEl.querySelector('.queue-artist')?.textContent || '').trim();
    const vnodeKey = queueItemEl.__vnode?.key;

    if (vnodeKey !== undefined && vnodeKey !== null) {
      const byId = store.queue.find((s) => String(s.id) === String(vnodeKey));
      if (byId) return byId;
    }
    if (titleText) {
      const exact = store.queue.find(
        (s) => String(s.name || '').trim() === titleText && (!durationText || formatDurationText(s.timeLength) === durationText)
      );
      if (exact) return exact;
      const byName = store.queue.find((s) => String(s.name || '').trim() === titleText);
      if (byName) return byName;
    }
    return null;
  }

  function injectPlayNextButtons() {
    if (state.settings.showPlayNextBtn === false) {
      document.querySelectorAll('.moekoe-play-next-btn, .moekoe-queue-badge').forEach((el) => el.remove());
      return;
    }

    const store = getMusicQueueStore();

    // 1. 播放列表弹窗 (.queue-popup .queue-item)
    const queueItems = document.querySelectorAll('.queue-popup .queue-item');
    for (const item of queueItems) {
      const actions = item.querySelector('.queue-actions');
      if (!actions) continue;

      const isPlaying = item.classList.contains('playing');
      let existingBtn = actions.querySelector('.moekoe-play-next-btn');
      let existingBadge = actions.querySelector('.moekoe-queue-badge');

      if (isPlaying) {
        if (existingBtn) existingBtn.remove();
        if (existingBadge) existingBadge.remove();
        continue;
      }

      if (!existingBtn) {
        existingBtn = createPlayNextButton();
        actions.prepend(existingBtn);
      }

      const song = resolveQueueItemSong(item, store);
      const pos = song ? getUpNextPosition(song.hash) : -1;
      existingBtn.classList.toggle('moekoe-queued', pos !== -1);
      existingBtn.title = pos !== -1 ? `已在下一首排队第 ${pos + 1} 位` : '下一首播放（支持多首排队）';

      if (pos !== -1) {
        if (!existingBadge) {
          existingBadge = document.createElement('span');
          existingBadge.className = 'moekoe-queue-badge';
          actions.prepend(existingBadge);
        }
        const badgeText = pos === 0 ? '下一首' : `排#${pos + 1}`;
        if (existingBadge.textContent !== badgeText) {
          existingBadge.textContent = badgeText;
        }
      } else if (existingBadge) {
        existingBadge.remove();
      }
    }

    // 2. 歌单 / 专辑 / 歌手 / 排行榜虚拟列表行 (.track-list .li)
    const trackRows = document.querySelectorAll('.track-list .li');
    for (const row of trackRows) {
      const timelen = row.querySelector('.track-timelen');
      if (timelen && !timelen.querySelector('.moekoe-play-next-btn')) {
        timelen.prepend(createPlayNextButton());
      }
    }

    // 3. 首页每日推荐歌曲卡片 (.song-list .song-item)
    const homeSongItems = document.querySelectorAll('.song-list .song-item');
    for (const item of homeSongItems) {
      if (!item.querySelector('.moekoe-play-next-btn')) {
        item.appendChild(createPlayNextButton());
      }
    }
  }

  function getMusicQueueStore() {
    const appEl = document.querySelector('#app');
    const pinia = appEl?.__vue_app__?.config?.globalProperties?.$pinia;
    if (pinia && pinia._s && typeof pinia._s.get === 'function') {
      return pinia._s.get('MusicQueue') || null;
    }
    return null;
  }

  function formatDurationText(ms) {
    const num = Number(ms);
    if (!Number.isFinite(num) || num <= 0) return '';
    const totalSeconds = Math.floor(num > 10000 ? num / 1000 : num);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}分${secs}秒`;
  }

  function moveQueueItemToNext(queueItemEl) {
    const store = getMusicQueueStore();
    if (!store || !Array.isArray(store.queue) || store.queue.length === 0) {
      notify('warning', '播放队列暂不可用');
      return;
    }

    const targetSong = resolveQueueItemSong(queueItemEl, store);
    if (!targetSong) {
      notify('warning', '未在播放队列中找到该歌曲');
      return;
    }

    enqueueUpNextSong(targetSong, store);
  }

  function triggerPlayNextForRow(row) {
    if (!row) return;

    if (row.classList.contains('queue-item')) {
      moveQueueItemToNext(row);
      return;
    }

    const moeData = getMoeData();
    if (!moeData?.UserInfo?.token || !moeData?.UserInfo?.userid) {
      notify('warning', '请先登录账号');
      return;
    }

    const store = getMusicQueueStore();
    const beforeHashes = new Set((store?.queue || []).map((s) => normalizeHash(s.hash)));
    const currentHash = normalizeHash(getCurrentSong()?.hash);

    document.body.classList.add('moekoe-silent-contextmenu');

    const cleanup = () => {
      document.body.classList.remove('moekoe-silent-contextmenu');
    };

    try {
      const rect = row.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: Math.max(10, Math.round(rect.left + rect.width / 2)),
        clientY: Math.max(10, Math.round(rect.top + rect.height / 2)),
      });
      row.dispatchEvent(ev);

      requestAnimationFrame(() => {
        try {
          const menuItems = document.querySelectorAll('.context-menu li');
          let nextItem = null;
          for (const li of menuItems) {
            if (li.querySelector('.fa-arrow-right') || /下一首/.test(li.textContent || '')) {
              nextItem = li;
              break;
            }
          }
          if (nextItem) {
            nextItem.click();
            // After native addToNext inserts at currentIndex + 1, append it to FIFO upNextQueue
            setTimeout(() => {
              const updatedStore = getMusicQueueStore();
              if (!updatedStore || !Array.isArray(updatedStore.queue)) return;
              const curIdx = currentHash
                ? updatedStore.queue.findIndex((s) => normalizeHash(s.hash) === currentHash)
                : -1;
              let addedSong = updatedStore.queue.find((s) => !beforeHashes.has(normalizeHash(s.hash)));
              if (!addedSong && curIdx !== -1 && updatedStore.queue[curIdx + 1]) {
                addedSong = updatedStore.queue[curIdx + 1];
              }
              if (addedSong) {
                const norm = normalizeHash(addedSong.hash);
                if (norm && norm !== currentHash && getUpNextPosition(norm) === -1) {
                  state.upNextQueue.push({ ...addedSong });
                  syncUpNextOrderInStore(updatedStore);
                }
              }
              injectPlayNextButtons();
            }, 120);
          } else {
            document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            notify('warning', '当前列表暂不支持添加到下一首');
          }
        } finally {
          setTimeout(cleanup, 30);
        }
      });
    } catch (err) {
      cleanup();
      console.warn(LOG_PREFIX, 'triggerPlayNextForRow failed:', err);
    }
  }

  function isNextTrackButton(el) {
    if (!el || !(el instanceof Element)) return null;
    const btn = el.closest('button');
    if (!btn) return null;
    if (!btn.querySelector('i.fa-step-forward')) return null;
    if (btn.closest('.player-bar .controls') || btn.closest('.lyrics-screen .player-controls')) {
      return btn;
    }
    return null;
  }

  function handleDocumentClick(event) {
    const targetEl = event.target instanceof Element ? event.target : null;

    // 1. 列表“下一首播放”按钮（支持播放列表、歌单、每日推荐）
    const playNextBtn = targetEl ? targetEl.closest('.moekoe-play-next-btn') : null;
    if (playNextBtn) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const row = playNextBtn.closest('.queue-item, .li, .song-item');
      triggerPlayNextForRow(row);
      return;
    }

    // 2. 切下一首按钮：不拦截原生点击！若存在排队且处于随机模式，先确保队列顺序并临时切列表循环让原生切歌播排队第 1 首
    if (state.upNextQueue.length > 0 && isNextTrackButton(event.target)) {
      const store = getMusicQueueStore();
      if (store) {
        syncUpNextOrderInStore(store);
      }
      if (isShuffleModeActive()) {
        switchToLoopForNextTick();
      }
      return;
    }

    // 3. 播放栏与全屏歌词页红心按钮
    const heartBtn = isHeartButton(event.target);
    if (!heartBtn) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    toggleFavorite();
  }

  function handleSongOrAuthMaybeChanged() {
    const song = getCurrentSong();
    const songKey = song ? `${song.hash || ''}|${song.playHash || ''}|${song.name || ''}` : '';
    const moeData = getMoeData();
    const userid = moeData?.UserInfo?.userid || null;

    if (String(userid || '') !== String(state.userid || '')) {
      syncFavorites(true);
      return;
    }

    if (songKey !== state.lastSongKey) {
      state.lastSongKey = songKey;

      // 当排队中的歌曲真正开始播放时，再将其移出待播排队列表
      const newHash = normalizeHash(song?.hash);
      if (newHash && state.upNextQueue.length > 0) {
        const idx = getUpNextPosition(newHash);
        if (idx !== -1) {
          state.upNextQueue.splice(idx, 1);
        }
      }

      updateHeartButtonsUI();
      setTimeout(injectPlayNextButtons, 80);
    }
  }

  function hookLocalStorage() {
    try {
      const origSetItem = Storage.prototype.setItem;
      if (origSetItem.__moekoeHeartHooked) return;

      const wrapped = function (key, value) {
        const result = origSetItem.apply(this, arguments);
        if (this === window.localStorage) {
          if (key === 'current_song' || key === 'MoeData' || key === 'like') {
            queueMicrotask(handleSongOrAuthMaybeChanged);
          }
        }
        return result;
      };
      wrapped.__moekoeHeartHooked = true;
      Storage.prototype.setItem = wrapped;
    } catch (err) {
      console.warn(LOG_PREFIX, 'hookLocalStorage skipped:', err);
    }
  }

  function startDomObserver() {
    let debounceTimer = null;
    const scheduleUpdate = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        updateHeartButtonsUI();
        injectPlayNextButtons();
      }, 90);
    };

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    document.addEventListener(
      'scroll',
      (e) => {
        const target = e.target;
        if (target instanceof Element && (target.classList.contains('queue-list') || target.closest('.queue-popup'))) {
          scheduleUpdate();
        }
      },
      true
    );
  }

  function listenSettingsMessages() {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.source === 'moekoe-heart-content' && event.data.type === 'SETTINGS_UPDATE') {
        state.settings = { ...DEFAULT_SETTINGS, ...(event.data.settings || {}) };
        injectPlayNextButtons();
        updateHeartButtonsUI();
      }
    });
  }

  function init() {
    loadSettingsFromLocalStorage();
    hydrateCacheFromStorage();
    hookLocalStorage();
    listenSettingsMessages();

    document.addEventListener('click', handleDocumentClick, true);
    startDomObserver();

    window.addEventListener('focus', () => {
      syncFavorites(false);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncFavorites(false);
      }
    });

    handleSongOrAuthMaybeChanged();
    updateHeartButtonsUI();
    injectPlayNextButtons();

    setTimeout(() => {
      syncFavorites(true);
    }, 600);

    console.log(LOG_PREFIX, 'Plugin v1.4.2 initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
