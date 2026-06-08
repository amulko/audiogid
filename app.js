// app.js — ВелоГид: Зеленоградск → Светлогорск

let map, userMarker, accuracyCircle;
let watchId = null;
let markers = {};
let currentWpId = 1;
let visitedWaypoints = new Set();
let isSpeaking = false;
let isPaused = false;
let lastTriggeredId = null;
let lastTriggerTime = 0;
const COOLDOWN_MS = 90000;
let audioEnabled = false;
let audioQueue = [];
let currentAudio = null;
let wakeLock = null;
let audioCtx = null;

function initAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playBeep() {
  try {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
  } catch(_) {}
}

// ── MAP ──────────────────────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', {
    center: [54.946, 20.315],
    zoom: 12,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Линия маршрута
  L.polyline(ROUTE_LINE, {
    color: '#1565c0',
    weight: 5,
    opacity: 0.65,
    dashArray: '10, 7'
  }).addTo(map);

  // Маркеры точек
  WAYPOINTS.forEach(wp => {
    const m = L.marker([wp.lat, wp.lng], { icon: buildIcon(wp, 'normal') })
      .addTo(map)
      .bindPopup(
        `<strong>${wp.icon} ${wp.name}</strong><br><small>${wp.shortDesc}</small>`,
        { closeButton: false, maxWidth: 220 }
      );

    m.on('click', () => {
      setCurrentWp(wp.id);
      if (audioEnabled) playAudio(wp);
      else showToast('Нажмите «Слушать» для озвучки');
    });

    markers[wp.id] = m;
  });

  // Подогнать под маршрут
  map.fitBounds([[54.935, 20.145], [54.965, 20.490]], { padding: [16, 16] });
}

function buildIcon(wp, state) {
  const colors = {
    normal:  { border: '#1565c0', bg: '#fff' },
    active:  { border: '#e65100', bg: '#fff8e1' },
    visited: { border: '#2e7d32', bg: '#e8f5e9' }
  };
  const c = colors[state] || colors.normal;
  return L.divIcon({
    html: `<div style="width:38px;height:38px;background:${c.bg};border:3px solid ${c.border};
           border-radius:50%;display:flex;align-items:center;justify-content:center;
           font-size:17px;box-shadow:0 2px 8px rgba(0,0,0,.25)">${wp.icon}</div>`,
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

function setMarkerState(id, state) {
  const wp = WAYPOINTS.find(w => w.id === id);
  if (wp && markers[id]) markers[id].setIcon(buildIcon(wp, state));
}

// ── GEOLOCATION ──────────────────────────────────────────────────────────────

function startGPS() {
  if (!navigator.geolocation) { showToast('GPS недоступен'); return; }
  setGPSStatus('searching');

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    onPositionError,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  setGPSStatus('active');

  // Маркер пользователя
  if (!userMarker) {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#1565c0',
      fillOpacity: 1
    }).addTo(map);
    accuracyCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#1565c0',
      fillColor: '#1565c0',
      fillOpacity: 0.06,
      weight: 1
    }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lng]);
    accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
  }

  // Ближайшая точка
  let nearest = null, nearestDist = Infinity;
  WAYPOINTS.forEach(wp => {
    const d = haversine(lat, lng, wp.lat, wp.lng);
    if (d < nearestDist) { nearestDist = d; nearest = wp; }
  });

  if (nearest) {
    setCurrentWp(nearest.id);
    document.getElementById('currentDistance').textContent =
      nearestDist < nearest.radius
        ? '📍 Вы здесь!'
        : `До точки: ${nearestDist < 1000 ? Math.round(nearestDist) + ' м' : (nearestDist / 1000).toFixed(1) + ' км'}`;
  }

  // Авто-запуск аудио при входе в зону
  const now = Date.now();
  WAYPOINTS.forEach(wp => {
    const d = haversine(lat, lng, wp.lat, wp.lng);
    if (d <= wp.radius && audioEnabled) {
      const alreadyQueued = audioQueue.some(q => q.id === wp.id);
      const cooldownOk = lastTriggeredId !== wp.id || (now - lastTriggerTime) > COOLDOWN_MS;
      if (cooldownOk && !alreadyQueued) {
        if (!isSpeaking) {
          // Играем сразу
          lastTriggeredId = wp.id;
          lastTriggerTime = now;
          visitedWaypoints.add(wp.id);
          updateProgress();
          setMarkerState(wp.id, 'active');
          showToast(`📍 ${wp.name}`);
          playAudio(wp);
          setTimeout(() => setMarkerState(wp.id, 'visited'), 3000);
        } else {
          // Ставим в очередь — доиграет текущий, потом этот
          audioQueue.push(wp);
          showToast(`⏳ ${wp.name} — после текущего рассказа`);
        }
      }
    }
  });
}

function onPositionError(err) {
  setGPSStatus('error');
  const msg = { 1: 'Разрешите доступ к GPS', 2: 'GPS сигнал недоступен', 3: 'GPS не отвечает' };
  showToast(msg[err.code] || 'Ошибка GPS');
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── AUDIO ────────────────────────────────────────────────────────────────────

function playAudio(wp) {
  stopAudio();
  setCurrentWp(wp.id);

  currentAudio = new Audio(wp.audioFile);
  currentAudio.preload = 'auto';

  currentAudio.addEventListener('play', () => {
    isSpeaking = true; isPaused = false;
    updatePlayBtn();
  });
  currentAudio.addEventListener('pause', () => {
    isPaused = true; updatePlayBtn();
  });
  currentAudio.addEventListener('ended', onAudioFinished);
  currentAudio.addEventListener('error', onAudioFinished);

  currentAudio.play().catch(() => showPlayBanner(wp));
  visitedWaypoints.add(wp.id);
  updateProgress();
}

let _pendingWp = null;
function showPlayBanner(wp) {
  _pendingWp = wp;
  const b = document.getElementById('playBanner');
  if (b) { b.style.display = 'flex'; b.querySelector('span').textContent = wp.name; }
  playBeep();
}
function hideBanner() {
  _pendingWp = null;
  const b = document.getElementById('playBanner');
  if (b) b.style.display = 'none';
}
function resumeFromBanner() {
  hideBanner();
  if (_pendingWp) playAudio(_pendingWp);
}

function onAudioFinished() {
  isSpeaking = false; isPaused = false;
  updatePlayBtn();
  if (audioQueue.length > 0) {
    const next = audioQueue.shift();
    setTimeout(() => {
      lastTriggeredId = next.id;
      lastTriggerTime = Date.now();
      visitedWaypoints.add(next.id);
      updateProgress();
      setMarkerState(next.id, 'active');
      showToast(`📍 ${next.name}`);
      playAudio(next);
      setTimeout(() => setMarkerState(next.id, 'visited'), 3000);
    }, 1000);
  }
}

function toggleAudio() {
  if (!audioEnabled) audioEnabled = true;

  if (!currentAudio || (!isSpeaking && !isPaused)) {
    const wp = WAYPOINTS.find(w => w.id === currentWpId);
    if (wp) playAudio(wp);
    return;
  }

  if (isPaused) {
    currentAudio.play();
  } else {
    currentAudio.pause();
  }
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  isSpeaking = false; isPaused = false;
  updatePlayBtn();
}

function updatePlayBtn() {
  const icon = document.getElementById('playIcon');
  const text = document.getElementById('playText');
  if (isSpeaking && !isPaused) {
    icon.innerHTML = `<span style="display:inline-flex;gap:2px;align-items:center">
      <span style="width:3px;height:12px;background:#fff;border-radius:2px;animation:sb .7s ease infinite"></span>
      <span style="width:3px;height:16px;background:#fff;border-radius:2px;animation:sb .7s .15s ease infinite"></span>
      <span style="width:3px;height:12px;background:#fff;border-radius:2px;animation:sb .7s .3s ease infinite"></span>
    </span>`;
    text.textContent = 'Озвучивается…';
  } else if (isPaused) {
    icon.textContent = '▶';
    text.textContent = 'Продолжить';
  } else {
    icon.textContent = '▶';
    text.textContent = 'Слушать';
  }
}

// ── UI ───────────────────────────────────────────────────────────────────────

function setCurrentWp(id) {
  currentWpId = id;
  const wp = WAYPOINTS.find(w => w.id === id);
  if (!wp) return;
  document.getElementById('currentIcon').textContent = wp.icon;
  document.getElementById('currentName').textContent = wp.name;
  document.getElementById('currentDesc').textContent = wp.shortDesc;
}

function updateProgress() {
  const done = visitedWaypoints.size;
  const total = WAYPOINTS.length;
  document.getElementById('progressText').textContent = `${done} из ${total} точек`;
  document.getElementById('progressFill').style.width = `${(done / total) * 100}%`;
}

function setGPSStatus(state) {
  const dot = document.getElementById('gpsDot');
  const txt = document.getElementById('gpsText');
  dot.className = 'gps-dot';
  if (state === 'active')    { dot.classList.add('active');    txt.textContent = 'GPS'; }
  else if (state === 'searching') { dot.classList.add('searching'); txt.textContent = '…'; }
  else { txt.textContent = 'GPS'; }
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function toggleList() {
  const modal = document.getElementById('listModal');
  if (!modal.classList.contains('open')) renderList();
  modal.classList.toggle('open');
}

function renderList() {
  document.getElementById('modalList').innerHTML = WAYPOINTS.map(wp => `
    <div class="modal-item ${visitedWaypoints.has(wp.id) ? 'visited' : ''}"
         onclick="onListClick(${wp.id})">
      <div class="item-icon">${wp.icon}</div>
      <div class="item-info">
        <div class="item-name">${wp.name}</div>
        <div class="item-desc">${wp.shortDesc}</div>
      </div>
    </div>`).join('');
}

function onListClick(id) {
  const wp = WAYPOINTS.find(w => w.id === id);
  if (!wp) return;
  toggleList();
  map.flyTo([wp.lat, wp.lng], 15, { duration: 1.2 });
  setCurrentWp(id);
  if (audioEnabled) playAudio(wp);
}

// ── START ────────────────────────────────────────────────────────────────────

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        if (audioEnabled) requestWakeLock();
      });
    }
  } catch (_) {}
}

// Перезапрашиваем wake lock когда вкладка снова становится видимой
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && audioEnabled) requestWakeLock();
});

function startTour() {
  document.getElementById('startOverlay').classList.add('hidden');
  audioEnabled = true;
  requestWakeLock();
  initAudioCtx();
  startGPS();

  setCurrentWp(1);
  map.fitBounds([[54.920, 20.140], [54.970, 20.490]], { padding: [20, 20] });

  // Сразу играем первую точку
  const wp1 = WAYPOINTS.find(w => w.id === 1);
  if (wp1) {
    lastTriggeredId = wp1.id;
    lastTriggerTime = Date.now();
    visitedWaypoints.add(wp1.id);
    updateProgress();
    setMarkerState(wp1.id, 'active');
    playAudio(wp1);
    setTimeout(() => setMarkerState(wp1.id, 'visited'), 3000);
  }
}

// ── OFFLINE DOWNLOAD ─────────────────────────────────────────────────────────

// Перевод координат в номер тайла OSM
function latLngToTile(lat, lng, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const rad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
}

// Собираем все URL тайлов для маршрута
function buildTileList() {
  // Bounding box маршрута Зеленоградск → Светлогорск
  const BOUNDS = { minLat: 54.910, maxLat: 54.975, minLng: 20.130, maxLng: 20.510 };
  const ZOOMS  = [10, 11, 12, 13, 14, 15]; // ~600 тайлов, ~12 МБ
  const SUBDOMAINS = ['a', 'b', 'c'];
  const urls = [];

  ZOOMS.forEach(z => {
    const tl = latLngToTile(BOUNDS.maxLat, BOUNDS.minLng, z);
    const br = latLngToTile(BOUNDS.minLat, BOUNDS.maxLng, z);
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        const sub = SUBDOMAINS[(x + y) % 3];
        urls.push(`https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`);
      }
    }
  });

  return urls;
}

async function downloadOffline() {
  if (!('serviceWorker' in navigator)) {
    alert('Офлайн-режим не поддерживается этим браузером');
    return;
  }

  const btn = document.getElementById('btnOffline');
  const progress = document.getElementById('offlineProgress');
  const bar = document.getElementById('offlineBar');
  const status = document.getElementById('offlineStatus');

  btn.disabled = true;
  btn.textContent = '⏳ Загружаем…';
  progress.style.display = 'block';

  const tiles = buildTileList();
  status.textContent = `Загружаем ${tiles.length} тайлов карты…`;

  try {
    // Слушаем прогресс от Service Worker
    navigator.serviceWorker.addEventListener('message', function handler(e) {
      if (e.data.type === 'TILE_PROGRESS') {
        const pct = Math.round(e.data.done / e.data.total * 100);
        bar.style.width = pct + '%';
        status.textContent = `${pct}% — ${e.data.done} из ${e.data.total} тайлов`;
      }
      if (e.data.type === 'TILE_DONE') {
        navigator.serviceWorker.removeEventListener('message', handler);
        bar.style.width = '100%';
        status.textContent = '✅ Карта готова для офлайн!';
        btn.textContent = '✅ Карта скачана';
        btn.style.background = 'rgba(165,214,167,.2)';
      }
    });

    // Ждём SW с таймаутом 8 сек
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Service Worker не отвечает — обновите страницу')), 8000))
    ]);

    const target = reg.active || navigator.serviceWorker.controller;
    if (!target) throw new Error('Service Worker не активен — обновите страницу');

    target.postMessage({ type: 'CACHE_TILES', tiles });

  } catch (err) {
    status.textContent = '❌ ' + err.message;
    btn.disabled = false;
    btn.textContent = '📥 Скачать карту для офлайн';
    progress.style.display = 'none';
  }
}

// ── INIT ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  initMap();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }
});
