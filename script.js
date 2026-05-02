(() => {
  'use strict';

  const OCR_ENDPOINT = '/api/ocr';
  let cameraStream = null;
  let isScanning = false;
  let lastSpeechText = '';

  const $ = (id) => document.getElementById(id);
  const screenStart = $('screen-start');
  const screenCamera = $('screen-camera');
  const video = $('camera-video');
  const capCanvas = $('capture-canvas');
  const capCtx = capCanvas.getContext('2d', { willReadFrequently: true });
  const freezeCanvas = $('freeze-canvas');
  const freezeCtx = freezeCanvas.getContext('2d');
  const btnStart = $('btn-start');
  const btnBack = $('btn-back');
  const btnScan = $('btn-scan');
  const btnSpeak = $('btn-speak');
  const btnAgain = $('btn-again');
  const statusBadge = $('status-badge');
  const scanFrameWrap = $('scan-frame-wrap');
  const scanFrame = $('scan-frame');
  const scanLine = $('scan-line');
  const progressWrap = $('progress-wrap');
  const progressBar = $('progress-bar');
  const resultPanel = $('result-panel');
  const resultLabel = $('result-label');
  const resultText = $('result-text');
  const loadingOverlay = $('loading-overlay');
  const loadingText = $('loading-text');

  if (!btnStart || !video || !resultPanel) {
    alert('HTML is not loaded correctly. Please replace index.html with the full HTML file.');
    return;
  }

  btnStart.addEventListener('click', startCamera);
  btnBack.addEventListener('click', exitCamera);
  btnScan.addEventListener('click', scanText);
  btnSpeak.addEventListener('click', speakResult);
  btnAgain.addEventListener('click', scanAgain);

  async function startCamera() {
    btnStart.disabled = true;
    btnStart.textContent = '⏳ Starting…';
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera is not supported on this browser.');
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      } catch (_) {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      }
      video.srcObject = cameraStream;
      await new Promise((resolve) => { video.onloadedmetadata = resolve; });
      await video.play();
      screenStart.classList.add('hidden');
      screenCamera.classList.remove('hidden');
      setStatus('ready', 'READY');
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
    stopCamera();
    stopSpeech();
    resetResult();
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
    hideFreeze();
  }

  async function scanText() {
    if (isScanning) return;
    isScanning = true;
    resetResult();
    btnScan.disabled = true;
    scanLine.classList.add('active');
    progressWrap.classList.remove('hidden');
    progressBar.style.width = '8%';
    setStatus('reading', 'CAPTURING');
    showLoading('Capturing image…');
    try {
      const imageBase64 = captureScanFrame();
      if (!imageBase64) throw new Error('Camera is not ready. Try again.');
      showFreeze();
      setStatus('reading', 'READING');
      showLoading('Reading text with AWS Rekognition…');
      progressBar.style.width = '35%';
      const res = await fetch(OCR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64 }) });
      progressBar.style.width = '75%';
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `OCR request failed (${res.status})`);
      const cleaned = filterOcrLines(json.lines || [], json.text || '');
      progressBar.style.width = '100%';
      if (!cleaned) showError('No readable English text found. Try again.');
      else showResult(cleaned);
    } catch (err) {
      console.error('[OCR]', err);
      showError(err.message || 'Scan failed. Please try again.');
    } finally {
      isScanning = false;
      btnScan.disabled = false;
      scanLine.classList.remove('active');
      hideLoading();
      setTimeout(() => { progressWrap.classList.add('hidden'); progressBar.style.width = '0%'; }, 550);
    }
  }

  function captureScanFrame() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return '';
    const videoRect = video.getBoundingClientRect();
    const frameRect = scanFrame.getBoundingClientRect();
    const videoAspect = vw / vh;
    const elementAspect = videoRect.width / videoRect.height;
    let displayedW, displayedH, offsetX, offsetY;
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
    const targetW = Math.min(1280, Math.max(900, cropW));
    const scale = targetW / cropW;
    const outW = Math.round(cropW * scale);
    const outH = Math.round(cropH * scale);
    capCanvas.width = outW;
    capCanvas.height = outH;
    capCtx.imageSmoothingEnabled = true;
    capCtx.imageSmoothingQuality = 'high';
    capCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
    return capCanvas.toDataURL('image/jpeg', 0.82).split(',')[1];
  }

  function showFreeze() {
    const rect = video.getBoundingClientRect();
    freezeCanvas.width = rect.width * window.devicePixelRatio;
    freezeCanvas.height = rect.height * window.devicePixelRatio;
    freezeCanvas.style.width = `${rect.width}px`;
    freezeCanvas.style.height = `${rect.height}px`;
    freezeCtx.save();
    freezeCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    freezeCtx.drawImage(video, 0, 0, rect.width, rect.height);
    freezeCtx.restore();
    freezeCanvas.classList.add('show');
  }

  function hideFreeze() { freezeCanvas.classList.remove('show'); }

  function filterOcrLines(lines, fallback = '') {
    const input = Array.isArray(lines) && lines.length ? lines.map((x) => (typeof x === 'string' ? x : x.text || '')) : String(fallback || '').split(/\n+/);
    const output = [];
    const seen = new Set();
    for (const raw of input) {
      const line = cleanLine(raw);
      if (!isGoodLine(line)) continue;
      const key = line.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(line);
      if (output.length >= 8) break;
    }
    return output.join('\n').trim();
  }

  function cleanLine(text) {
    return String(text || '').replace(/[|_[\]{}<>~^`•·]/g, ' ').replace(/[^A-Za-z0-9 .,%+\-&/():]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function isGoodLine(line) {
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
    return true;
  }

  function showResult(text) {
    lastSpeechText = buildSpeechText(text);
    resultLabel.textContent = 'TEXT FOUND';
    resultLabel.style.color = 'var(--violet)';
    resultText.textContent = text;
    resultText.classList.remove('error');
    resultPanel.classList.add('show');
    btnScan.classList.add('hidden');
    scanFrameWrap.classList.add('hidden');
    setStatus('done', 'DONE');
    if ('vibrate' in navigator) navigator.vibrate([40, 30, 80]);
    speakResult();
  }

  function showError(message) {
    lastSpeechText = '';
    resultLabel.textContent = 'RESULT';
    resultLabel.style.color = 'var(--pink)';
    resultText.textContent = message || 'No readable English text found. Try again.';
    resultText.classList.add('error');
    resultPanel.classList.add('show');
    btnScan.classList.add('hidden');
    setStatus('error', 'NOT FOUND');
    btnSpeak.disabled = true;
    if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
  }

  async function scanAgain() {
    stopSpeech();
    hideFreeze();
    resetResult();
    if (video.paused && cameraStream) {
      try { await video.play(); } catch (err) { console.warn('[video.play]', err); }
    }
  }

  function resetResult() {
    resultPanel.classList.remove('show');
    resultText.classList.remove('error');
    resultText.textContent = '';
    btnScan.classList.remove('hidden');
    btnSpeak.disabled = false;
    btnSpeak.classList.remove('speaking');
    scanFrameWrap.classList.remove('hidden');
    setStatus('ready', 'READY');
  }

  function speakResult() {
    if (!lastSpeechText || !('speechSynthesis' in window)) return;
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(lastSpeechText);
    utterance.lang = 'en-US';
    utterance.rate = 0.86;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === 'en-US' && v.localService) || voices.find((v) => v.lang && v.lang.startsWith('en'));
    if (voice) utterance.voice = voice;
    btnSpeak.classList.add('speaking');
    utterance.onend = utterance.onerror = () => btnSpeak.classList.remove('speaking');
    window.speechSynthesis.speak(utterance);
  }

  function buildSpeechText(text) { return String(text || '').replace(/[^\w\s.,%+\-&/():]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 360); }
  function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); btnSpeak.classList.remove('speaking'); }
  function setStatus(type, text) { statusBadge.className = `status ${type}`; statusBadge.textContent = text; }
  function showLoading(text) { loadingText.textContent = text; loadingOverlay.classList.remove('hidden'); }
  function hideLoading() { loadingOverlay.classList.add('hidden'); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  window.addEventListener('pagehide', stopCamera);
  window.addEventListener('beforeunload', stopCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopSpeech(); });
})();
