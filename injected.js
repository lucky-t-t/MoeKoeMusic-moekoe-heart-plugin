(() => {
  'use strict';

  if (window.__MOEKOE_PLAYERBAR_HEART_LOADED__) return;
  window.__MOEKOE_PLAYERBAR_HEART_LOADED__ = true;

  const LOG_PREFIX = '[MoeKoe-Heart]';
  const PENDING_FILEID = '__PENDING__';
  const SYNC_COOLDOWN_MS = 15000;

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
    refreshTimer: null,
  };

  function safeJsonParse(raw, fallback = null) {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
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

    if (state.userid !== userid) {
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
    state.likeGlobalCollectionId = likePlaylist.global_collection_id || '';
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
      // Trigger reflow so animation replays cleanly
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
        localStorage.setItem('t', String(Date.now()));
        updateHeartButtonsUI(true);
        notify('success', '已添加到我喜欢');

        // Refresh in background so fileid is ready if user immediately unlikes
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

  function handleDocumentClick(event) {
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

    if (userid !== state.userid) {
      syncFavorites(true);
      return;
    }

    if (songKey !== state.lastSongKey) {
      state.lastSongKey = songKey;
      updateHeartButtonsUI();
    }
  }

  function hookLocalStorage() {
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
  }

  function startDomObserver() {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        updateHeartButtonsUI();
      }, 120);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    hookLocalStorage();
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

    // Initial sync with slight delay to let MoeKoeMusic finish mounting
    setTimeout(() => {
      handleSongOrAuthMaybeChanged();
      syncFavorites(true);
    }, 600);

    console.log(LOG_PREFIX, 'Plugin initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
