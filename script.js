(() => {
  'use strict';

  const OCR_ENDPOINT = '/api/ocr';

  let cameraStream = null;
  let isScanning = false;
  let lastSpeechText = '';
  let activeAnchor = null;
  let trackTimer = null;
  let lastTrackImage = null;

  const $ = (id) => document.getElementById(id);

  const screenStart = $('screen-start');
  const screenCamera = $('screen-camera');
  const video = $('camera-video');
  const capCanvas = $('capture-canvas');
  const capCtx = capCanvas.getContext('2d', { willReadFrequently: true });
  const motionCanvas = $('motion-canvas');
  const motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });

  const btnStart = $('btn-start');
  const btnBack = $('btn-back');
  const btnSpeak = $('btn-speak');
  const btnAgain = $('btn-again');

  const statusBadge = $('status-badge');
  const scanFrame = $('scan-frame');
  const scanFrameWrap = $('scan-frame-wrap');
  const scanHint = $('scan-hint');

  const arTextWrap = $('ar-text-wrap');
  const arLabel = $('ar-label');
  const arLine1 = $('ar-line-1');
  const arLine2 = $('ar-line-2');

  const progressWrap = $('progress-wrap');
  const progressBar = $('progress-bar');
  const panelLabel = $('panel-label');
  const panelCaption = $('panel-caption');

  if (!btnStart || !video || !scanFrame || !arTextWrap) {
    alert('HTML is not loaded correctly. Please replace index.html with the full file.');
    return;
  }

  btnStart.addEventListener('click', startCamera);
  btnBack.addEventListener('click', exitCamera);
  btnSpeak.addEventListener('click', speakResult);
  btnAgain.addEventListener('click', scanAgainOnce);

  async function startCamera() {
    btnStart.disabled = true;
    btnStart.textContent = '⏳ Starting…';

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera is not supported on this browser.');
      }

      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
      } catch {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
      }

      video.srcObject = cameraStream;

      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      await video.play();

      screenStart.classList.add('hidden');
      screenCamera.classList.remove('hidden');

      setStatus('searching', 'SEARCHING');
      panelCaption.textContent = 'Hold the label steady. Reading will start once.';

      startTrackingLoop();

      setTimeout(() => {
        runOcrOnce({ speak: true });
      }, 900);
    } catch (err) {
      console.error('[Camera]', err);

      let message = err.message || 'Could not access camera.';
      if (err.name === 'NotAllowedError') message = 'Camera permission denied. Please allow access.';
      if (err.name === 'NotFoundError') message = 'No camera found on this device.';
      if (err.name === 'NotReadableError') message = 'Camera is in use by another app.';

      alert(message);

      btnStart.disabled = false;
      btnStart.textContent = '📷 Start Camera';
    }
  }

  function exitCamera() {
    stopTrackingLoop();
    stopCamera();
    stopSpeech();
    clearResult();

    screenCamera.classList.add('hidden');
    screenStart.classList.remove('hidden');

    btnStart.disabled = false;
    btnStart.textContent = '📷 Start Camera';
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }

    video.pause();
    video.srcObject = null;
  }

  function scanAgainOnce() {
    stopSpeech();
    activeAnchor = null;
    lastTrackImage = null;
    arTextWrap.classList.add('hidden');
    scanFrameWrap.classList.remove('dim');
    panelLabel.textContent = 'READING';
    panelCaption.textContent = 'Hold the label steady.';
    setStatus('reading', 'READING');

    runOcrOnce({ speak: true });
  }

  async function runOcrOnce({ speak = true } = {}) {
    if (isScanning || !cameraStream) return;

    isScanning = true;
    setStatus('reading', 'READING');
    progressWrap.classList.remove('hidden');
    progressBar.style.width = '18%';

    try {
      const capture = captureScanFrame();
      if (!capture.imageBase64) throw new Error('Camera is not ready. Try again.');

      progressBar.style.width = '45%';

      const res = await fetch(OCR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: capture.imageBase64 })
      });

      const json = await res.json().catch(() => ({}));
      progressBar.style.width = '82%';

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `OCR request failed (${res.status})`);
      }

      const lines = filterOcrLines(json.lines || [], json.text || '');
      const cleaned = lines.map((line) => line.text).join('\n').trim();

      progressBar.style.width = '100%';

      if (!cleaned) {
        showNoText();
        return;
      }

      lastSpeechText = buildSpeechText(cleaned);

      const bestLine = lines[0];
      const anchor = makeAnchorFromBox(bestLine?.box, capture.cropScreenRect);

      activeAnchor = {
        x: anchor.x,
        y: anchor.y,
        text: cleaned
      };

      showArResult(cleaned, activeAnchor.x, activeAnchor.y);
      lastTrackImage = captureSmallFrame(86, 64);

      panelLabel.textContent = 'LOCKED';
      panelCaption.textContent = cleaned;
      scanFrameWrap.classList.add('dim');
      setStatus('locked', 'LOCKED');

      if (speak) speakResult();
    } catch (err) {
      console.error('[OCR]', err);
      showError(err.message || 'Scan failed. Please try again.');
    } finally {
      isScanning = false;

      setTimeout(() => {
        progressWrap.classList.add('hidden');
        progressBar.style.width = '0%';
      }, 450);
    }
  }

  function captureScanFrame() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return { imageBase64: '', cropScreenRect: null };

    const videoRect = video.getBoundingClientRect();
    const frameRect = scanFrame.getBoundingClientRect();

    const videoAspect = vw / vh;
    const elementAspect = videoRect.width / videoRect.height;

    let displayedW;
    let displayedH;
    let offsetX;
    let offsetY;

    if (videoAspect > elementAspect) {
      displayedH = videoRect.height;
      displayedW = displayedH * videoAspect;
      offsetX = (displayedW - videoRect.width) / 2;
      offsetY = 0;
    } else {
      displayedW = videoRect.width;
      displayedH = displayedW / videoAspect;
      offsetX = 0;
      offsetY = (displayedH - videoRect.height) / 2;
    }

    const left = frameRect.left - videoRect.left + offsetX;
    const top = frameRect.top - videoRect.top + offsetY;

    let cropX = (left / displayedW) * vw;
    let cropY = (top / displayedH) * vh;
    let cropW = (frameRect.width / displayedW) * vw;
    let cropH = (frameRect.height / displayedH) * vh;

    const padX = cropW * 0.08;
    const padY = cropH * 0.12;

    cropX = clamp(cropX - padX, 0, vw - 1);
    cropY = clamp(cropY - padY, 0, vh - 1);
    cropW = clamp(cropW + padX * 2, 1, vw - cropX);
    cropH = clamp(cropH + padY * 2, 1, vh - cropY);

    const targetW = Math.min(1200, Math.max(860, cropW));
    const scale = targetW / cropW;
    const outW = Math.round(cropW * scale);
    const outH = Math.round(cropH * scale);

    capCanvas.width = outW;
    capCanvas.height = outH;
    capCtx.imageSmoothingEnabled = true;
    capCtx.imageSmoothingQuality = 'high';
    capCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

    const cropScreenRect = {
      left: frameRect.left - frameRect.width * 0.08,
      top: frameRect.top - frameRect.height * 0.12,
      width: frameRect.width * 1.16,
      height: frameRect.height * 1.24
    };

    return {
      imageBase64: capCanvas.toDataURL('image/jpeg', 0.82).split(',')[1],
      cropScreenRect
    };
  }

  function startTrackingLoop() {
    stopTrackingLoop();
    trackTimer = setInterval(trackTick, 360);
  }

  function stopTrackingLoop() {
    if (trackTimer) clearInterval(trackTimer);
    trackTimer = null;
  }

  function trackTick() {
    if (!cameraStream || isScanning || !activeAnchor) return;

    const shift = estimateTrackShift();
    if (!shift) return;

    if (shift.score < 38) {
      activeAnchor.x = clamp(activeAnchor.x + shift.dx, 20, window.innerWidth - 20);
      activeAnchor.y = clamp(activeAnchor.y + shift.dy, 80, window.innerHeight - 130);
      placeArText(activeAnchor.x, activeAnchor.y);
    }
  }

  function captureSmallFrame(w, h) {
    if (!video.videoWidth || !video.videoHeight) return null;

    motionCanvas.width = w;
    motionCanvas.height = h;
    motionCtx.drawImage(video, 0, 0, w, h);

    const data = motionCtx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    return { w, h, gray };
  }

  function estimateTrackShift() {
    const current = captureSmallFrame(86, 64);
    if (!current || !lastTrackImage) {
      lastTrackImage = current;
      return null;
    }

    const prev = lastTrackImage;
    let best = { score: Infinity, dx: 0, dy: 0 };

    for (let dy = -4; dy <= 4; dy += 2) {
      for (let dx = -4; dx <= 4; dx += 2) {
        const score = shiftedDiff(prev, current, dx, dy);
        if (score < best.score) best = { score, dx, dy };
      }
    }

    lastTrackImage = current;

    const scaleX = window.innerWidth / current.w;
    const scaleY = window.innerHeight / current.h;

    return {
      score: best.score,
      dx: best.dx * scaleX * 0.62,
      dy: best.dy * scaleY * 0.62
    };
  }

  function shiftedDiff(a, b, dx, dy) {
    let sum = 0;
    let count = 0;
    const margin = 8;

    for (let y = margin; y < a.h - margin; y += 3) {
      const yy = y + dy;
      if (yy < 0 || yy >= b.h) continue;

      for (let x = margin; x < a.w - margin; x += 3) {
        const xx = x + dx;
        if (xx < 0 || xx >= b.w) continue;

        sum += Math.abs(a.gray[y * a.w + x] - b.gray[yy * b.w + xx]);
        count++;
      }
    }

    return count ? sum / count : Infinity;
  }

  function filterOcrLines(lines, fallback = '') {
    const input = Array.isArray(lines) && lines.length
      ? lines.map((x) => ({
          text: typeof x === 'string' ? x : x.text || '',
          confidence: typeof x === 'string' ? 50 : x.confidence || 50,
          box: typeof x === 'string' ? null : x.box || null
        }))
      : String(fallback || '').split(/\n+/).map((text) => ({ text, confidence: 50, box: null }));

    const output = [];
    const seen = new Set();

    for (const item of input) {
      const line = cleanLine(item.text);
      if (!isGoodLine(line, item.confidence)) continue;

      const key = textKey(line);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      output.push({ text: line, confidence: item.confidence, box: item.box });

      if (output.length >= 5) break;
    }

    return output;
  }

  function cleanLine(text) {
    return String(text || '')
      .replace(/[|_[\]{}<>~^`•·]/g, ' ')
      .replace(/[^A-Za-z0-9 .,%+\-&/():]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function isGoodLine(line, confidence = 50) {
    if (!line || line.length < 3 || line.length > 85) return false;

    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const digits = (line.match(/[0-9]/g) || []).length;
    const chars = line.replace(/\s/g, '').length;

    if (letters < 2 || !chars) return false;

    const ratio = letters / chars;
    if (ratio < 0.35) return false;
    if (digits >= 6 && ratio < 0.55) return false;
    if (/^[0-9\s.,:/+\-%]+$/.test(line)) return false;
    if (/^(www|http|https)\b/i.test(line)) return false;
    if (/^[A-Za-z]{1,2}$/.test(line)) return false;
    if (confidence < 40 && line.length < 8) return false;

    return true;
  }

  function showArResult(text, x, y) {
    const display = makeDisplayLines(text);

    arLabel.textContent = 'LOCKED';
    arLine1.textContent = display.line1;
    arLine2.textContent = display.line2;

    placeArText(x, y);
    arTextWrap.classList.remove('hidden');
  }

  function showNoText() {
    activeAnchor = null;
    arTextWrap.classList.add('hidden');
    scanFrameWrap.classList.remove('dim');
    setStatus('ready', 'READY');
    panelLabel.textContent = 'NO TEXT';
    panelCaption.textContent = 'No readable English text found. Tap Scan Again to try again.';
  }

  function showError(message) {
    activeAnchor = null;
    arTextWrap.classList.add('hidden');
    scanFrameWrap.classList.remove('dim');
    setStatus('error', 'NOT FOUND');
    panelLabel.textContent = 'RESULT';
    panelCaption.textContent = message || 'No readable English text found. Try again.';
  }

  function placeArText(x, y) {
    arTextWrap.style.setProperty('--ar-x', `${x}px`);
    arTextWrap.style.setProperty('--ar-y', `${y}px`);
  }

  function makeAnchorFromBox(box, cropRect) {
    if (!box || !cropRect) {
      const frameRect = scanFrame.getBoundingClientRect();
      return {
        x: frameRect.left + frameRect.width / 2,
        y: frameRect.top + frameRect.height * 0.35
      };
    }

    const centerX = box.left + box.width / 2;
    const topY = Math.max(0.02, box.top - 0.18);

    return {
      x: cropRect.left + centerX * cropRect.width,
      y: cropRect.top + topY * cropRect.height
    };
  }

  function clearResult() {
    activeAnchor = null;
    lastSpeechText = '';
    arTextWrap.classList.add('hidden');
    panelLabel.textContent = 'AUTO READER';
    panelCaption.textContent = 'Hold the label steady. Reading will start once.';
    scanFrameWrap.classList.remove('dim');
  }

  function makeDisplayLines(text) {
    const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);

    if (lines.length >= 2) {
      return {
        line1: limitLine(lines[0], 22),
        line2: limitLine(lines[1], 24)
      };
    }

    const first = lines[0] || '';
    if (first.length <= 21) return { line1: first, line2: '' };

    const words = first.split(/\s+/);
    let line1 = '';
    let line2 = '';

    for (const word of words) {
      if ((line1 + ' ' + word).trim().length <= 20) line1 = (line1 + ' ' + word).trim();
      else line2 = (line2 + ' ' + word).trim();
    }

    return {
      line1: limitLine(line1 || first, 22),
      line2: limitLine(line2, 24)
    };
  }

  function limitLine(text, max) {
    const t = String(text || '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1).trim()}…`;
  }

  function speakResult() {
    if (!lastSpeechText || !('speechSynthesis' in window)) return;

    stopSpeech();

    const utterance = new SpeechSynthesisUtterance(lastSpeechText);
    utterance.lang = 'en-US';
    utterance.rate = 0.86;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const voice =
      voices.find((v) => v.lang === 'en-US' && v.localService) ||
      voices.find((v) => v.lang && v.lang.startsWith('en'));

    if (voice) utterance.voice = voice;

    btnSpeak.classList.add('speaking');
    utterance.onend = utterance.onerror = () => btnSpeak.classList.remove('speaking');

    window.speechSynthesis.speak(utterance);
  }

  function buildSpeechText(text) {
    return String(text || '')
      .replace(/[^\w\s.,%+\-&/():]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 360);
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    btnSpeak.classList.remove('speaking');
  }

  function setStatus(type, text) {
    statusBadge.className = `status ${type}`;
    statusBadge.textContent = text;
  }

  function textKey(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  window.addEventListener('pagehide', stopCamera);
  window.addEventListener('beforeunload', stopCamera);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSpeech();
  });
})();
