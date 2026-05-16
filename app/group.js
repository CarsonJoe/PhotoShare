(function () {
  function getParam(name) {
    const params = new URLSearchParams(location.search);
    return params.get(name);
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const { PhotoShare } = window;
    const photosEl = document.getElementById('photos');
    const emptyEl = document.getElementById('emptyState');
    const titleEl = document.getElementById('groupTitle');
    const headerTitleEl = document.getElementById('groupHeaderTitle');
    const genEl = document.getElementById('generatedAt');
    const galleryMetaEl = document.getElementById('galleryMeta');
    const selectionStatusEl = document.getElementById('selectionStatus');

    const btnSelectHeader = document.getElementById('btnSelectHeader');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const btnShare = document.getElementById('btnShare');
    const btnDownload = document.getElementById('btnDownload');
    const toastEl = document.getElementById('toast');

    const shareModal = document.getElementById('shareModal');
    const shareForm = document.getElementById('shareForm');
    const shareSubtitle = document.getElementById('shareSubtitle');
    const shareNote = document.getElementById('shareNote');
    const shareCancel = document.getElementById('shareCancel');
    const shareConfirm = document.getElementById('shareConfirm');

    const lb = document.getElementById('lightbox');
    const lbStage = document.getElementById('lbStage');
    const lbTrack = document.getElementById('lbTrack');
    const lbPrevImg = document.getElementById('lbPrevImage');
    const lbImg = document.getElementById('lightboxImage');
    const lbNextImg = document.getElementById('lbNextImage');
    const lbProgress = document.getElementById('lbProgress');
    const lbCounter = document.getElementById('lbCounter');
    const lbAlbumName = document.getElementById('lbAlbumName');
    const lbFilmstrip = document.getElementById('lbFilmstrip');
    const lbSelectBtn = document.getElementById('lbSelectBtn');
    const lbShareBtn = document.getElementById('lbShareBtn');
    const lbDownloadBtn = document.getElementById('lbDownloadBtn');
    const btnPrev = document.querySelector('.lb-prev');
    const btnNext = document.querySelector('.lb-next');
    const btnClose = document.querySelector('.lb-close');
    const btnZonePrev = document.querySelector('.lb-zone-prev');
    const btnZoneNext = document.querySelector('.lb-zone-next');

    PhotoShare.setBusyState(true, 'Loading album...');
    PhotoShare.renderSkeletons(photosEl, { count: 8, kind: 'photo' });
    PhotoShare.revealElements(document);

    try {
      const data = await PhotoShare.loadManifest();
      const id = (getParam('g') || '').trim();
      const isFavoritesGroup = id === 'favorites';
      let group = null;
      if (isFavoritesGroup) {
        group = {
          id: 'favorites',
          name: 'Favorites',
          items: PhotoShare.getFavoriteItems(data.groups),
        };
      } else if (Array.isArray(data.groups)) {
        group = data.groups.find((entry) => entry.id === id);
      }
      if (!group && Array.isArray(data.groups)) {
        group = data.groups.find((entry) => entry.name === id);
      }

      if (!group || !group.items.length) {
        photosEl.innerHTML = '';
        emptyEl.hidden = false;
        if (titleEl) titleEl.textContent = isFavoritesGroup ? 'Favorites' : 'Album unavailable';
        headerTitleEl.textContent = isFavoritesGroup ? 'No favorites yet' : 'Album unavailable';
        btnSelectHeader.hidden = true;
        genEl.textContent = '';
        if (galleryMetaEl) galleryMetaEl.textContent = isFavoritesGroup ? 'Manage favorites in tools/manager.html.' : '';
        PhotoShare.setBusyState(false, 'Album ready');
        return;
      }

      const items = group.items;
      const fullCache = new Map();
      const thumbButtons = [];
      const selected = new Set();
      const lightboxDrag = {
        pointerId: null,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        moved: false,
        axis: '',
      };

      // Pinch-zoom state
      const pinchPointers = new Map(); // pointerId → {x, y}
      let pinchState = null;           // set while two fingers are active
      let lbZoom = 1;
      let lbPanX = 0;
      let lbPanY = 0;
      let lastTapTime = 0;
      let lastTapX = 0;
      let lastTapY = 0;
      let zoomInteractionTimer = null;
      let gestureStartZoom = 1;
      let chromeHiddenByZoom = false;

      let selectionMode = false;
      let lastSelectedIndex = null;
      let shareSupported = false;
      let toastTimer = null;
      let lightboxIndex = 0;
      let loadToken = 0;
      let lightboxAnimating = false;
      let lightboxChromeVisible = true;
      let trackAnimationTimer = null;
      const slideSlots = [
        { slide: lbPrevImg.closest('.lb-slide'), img: lbPrevImg },
        { slide: lbImg.closest('.lb-slide'), img: lbImg },
        { slide: lbNextImg.closest('.lb-slide'), img: lbNextImg },
      ];

      document.title = `${group.name} | Carson's Photos`;
      if (titleEl) titleEl.textContent = group.name;
      headerTitleEl.textContent = `${group.name} / ${items.length} frames`;
      if (lbAlbumName) lbAlbumName.textContent = group.name;

      const formattedDateWithTime = data.generatedAt
        ? PhotoShare.formatTimestamp(data.generatedAt, { includeTime: true })
        : '';

      if (galleryMetaEl) galleryMetaEl.textContent = group.collectionDate || '';
      genEl.textContent = formattedDateWithTime ? `Updated ${formattedDateWithTime}` : '';

      const SharePresets = {
        original: { label: 'Original', maxWidth: null, quality: 0.92, maxCount: 3 },
        large: { label: 'Large (~2048px)', maxWidth: 2048, quality: 0.9, maxCount: 10 },
        medium: { label: 'Medium (~1280px)', maxWidth: 1280, quality: 0.85, maxCount: 20 },
        small: { label: 'Small (~800px)', maxWidth: 800, quality: 0.8, maxCount: 40 },
      };

      function showToast(message) {
        if (!toastEl) return;
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
        toastEl.textContent = message;
        toastEl.hidden = false;
        toastTimer = setTimeout(() => {
          toastEl.hidden = true;
        }, 2200);
      }

      function getSelectedPreset() {
        const formData = new FormData(shareForm);
        const value = (formData.get('preset') || 'large').toString();
        return SharePresets[value] || SharePresets.large;
      }

      function updateShareNote() {
        const preset = getSelectedPreset();
        shareNote.textContent = `On iOS, sharing large files can fail. You can share up to ${preset.maxCount} at this setting.`;
      }

      function openShareModal() {
        const count = selected.size;
        shareSubtitle.textContent = `${count} photo${count === 1 ? '' : 's'} selected`;
        updateShareNote();
        shareModal.hidden = false;
      }

      function closeShareModal() {
        shareModal.hidden = true;
      }

      function updateLightboxSelectionState() {
        if (!lbCounter) return;
        lbCounter.textContent = `${lightboxIndex + 1} / ${items.length}`;

        if (lbSelectBtn) {
          const isSelected = selected.has(lightboxIndex);
          lbSelectBtn.textContent = isSelected ? 'Selected' : 'Select';
          lbSelectBtn.classList.toggle('is-active', isSelected);
        }
      }

      function updateToolbar() {
        const count = selected.size;
        const total = items.length;

        btnDownload.textContent = `Download Selected (${count})`;
        btnDownload.disabled = count === 0;

        if (btnShare) {
          btnShare.textContent = `Share Selected (${count})`;
          btnShare.disabled = count === 0;
        }

        btnSelectAll.textContent = count === total && total ? 'Clear' : 'Select All';
        btnSelectAll.classList.toggle('is-clear', count === total && total > 0);

        if (count === 0) {
          selectionStatusEl.textContent = 'Choose frames to download or share.';
        } else if (count === total) {
          selectionStatusEl.textContent = 'All frames selected.';
        } else {
          selectionStatusEl.textContent = `${count} frame${count === 1 ? '' : 's'} selected.`;
        }

        updateLightboxSelectionState();
      }

      function enterSelect() {
        if (selectionMode) return;
        selectionMode = true;
        document.body.classList.add('select-mode');
        btnSelectHeader.textContent = 'Done';
        updateToolbar();
      }

      function clearSelection() {
        selected.clear();
        lastSelectedIndex = null;
        document.querySelectorAll('.photo-card.selected').forEach((card) => {
          card.classList.remove('selected');
        });
      }

      function exitSelect() {
        selectionMode = false;
        document.body.classList.remove('select-mode');
        btnSelectHeader.textContent = 'Select';
        clearSelection();
        updateToolbar();
      }

      function setSelected(index, value) {
        if (value) selected.add(index);
        else selected.delete(index);

        const card = document.querySelector(`.photo-card[data-index="${index}"]`);
        if (card) card.classList.toggle('selected', value);

        updateToolbar();
      }

      function toggleSelected(index) {
        setSelected(index, !selected.has(index));
      }

      function handleSelectClick(index, event) {
        if (event.shiftKey && lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, index);
          const end = Math.max(lastSelectedIndex, index);
          for (let cursor = start; cursor <= end; cursor += 1) {
            setSelected(cursor, true);
          }
        } else {
          toggleSelected(index);
        }
        lastSelectedIndex = index;
      }

      btnSelectHeader.addEventListener('click', () => {
        if (selectionMode) exitSelect();
        else enterSelect();
      });

      btnSelectAll.addEventListener('click', () => {
        if (!selectionMode) enterSelect();
        if (selected.size === items.length) {
          clearSelection();
        } else {
          for (let index = 0; index < items.length; index += 1) {
            selected.add(index);
          }
          document.querySelectorAll('.photo-card').forEach((card) => card.classList.add('selected'));
        }
        updateToolbar();
      });

      btnDownload.addEventListener('click', () => {
        if (!selected.size) return;
        const indices = Array.from(selected.values()).sort((a, b) => a - b);
        let delay = 0;
        for (const index of indices) {
          const full = items[index].src;
          const url = PhotoShare.relativeAsset(full);
          const name = PhotoShare.basename(full);
          setTimeout(() => {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = name;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          }, delay);
          delay += 150;
        }
      });

      shareCancel.addEventListener('click', (event) => {
        event.preventDefault();
        closeShareModal();
      });

      shareForm.addEventListener('change', updateShareNote);

      (function detectShareSupport() {
        try {
          if (navigator && 'share' in navigator && 'canShare' in navigator && window.File && window.Blob) {
            const file = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', {
              type: 'image/jpeg',
            });
            shareSupported = !!navigator.canShare({ files: [file] });
          } else {
            shareSupported = false;
          }
        } catch {
          shareSupported = false;
        }

        if (btnShare) btnShare.hidden = !shareSupported;
        if (lbShareBtn) lbShareBtn.hidden = !shareSupported;
      })();

      btnShare.addEventListener('click', () => {
        if (!selected.size) return;
        if (!shareSupported) {
          showToast('Sharing is not supported on this device.');
          return;
        }
        openShareModal();
      });

      async function downscaleToFile(url, name, maxWidth, quality) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Image load failed'));
        });

        const inputWidth = img.naturalWidth || img.width;
        const inputHeight = img.naturalHeight || img.height;
        let targetWidth = inputWidth;
        let targetHeight = inputHeight;

        if (maxWidth && inputWidth > maxWidth) {
          const scale = maxWidth / inputWidth;
          targetWidth = Math.round(inputWidth * scale);
          targetHeight = Math.round(inputHeight * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, targetWidth, targetHeight);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        const finalBlob = blob || new Blob();
        const finalName = name.replace(/\.[^.]+$/, '') + (maxWidth ? `_${maxWidth}.jpg` : '');
        return new File([finalBlob], finalName, { type: 'image/jpeg' });
      }

      async function prepareFilesForShare(indices, preset) {
        const files = [];
        for (const index of indices) {
          const full = items[index].src;
          const url = PhotoShare.relativeAsset(full);
          const name = PhotoShare.basename(full);
          if (preset.maxWidth) {
            files.push(await downscaleToFile(url, name, preset.maxWidth, preset.quality));
          } else {
            const res = await fetch(url, { cache: 'no-store' });
            const blob = await res.blob();
            const type = blob.type || 'image/jpeg';
            files.push(new File([blob], name, { type }));
          }
          await new Promise((resolve) => setTimeout(resolve));
        }
        return files;
      }

      async function prepareCurrentFileForShare(index) {
        const full = items[index].src;
        const url = PhotoShare.relativeAsset(full);
        const name = PhotoShare.basename(full);
        const response = await fetch(url, { cache: 'no-store' });
        const blob = await response.blob();
        const type = blob.type || 'image/jpeg';
        const originalFile = new File([blob], name, { type });

        if (navigator.canShare && navigator.canShare({ files: [originalFile] })) {
          return originalFile;
        }

        return downscaleToFile(url, name, 2048, 0.9);
      }

      shareConfirm.addEventListener('click', async (event) => {
        event.preventDefault();
        const preset = getSelectedPreset();
        const indices = Array.from(selected.values())
          .sort((a, b) => a - b)
          .slice(0, preset.maxCount);
        if (!indices.length) {
          closeShareModal();
          return;
        }

        shareConfirm.disabled = true;
        shareConfirm.textContent = 'Preparing...';

        try {
          const files = await prepareFilesForShare(indices, preset);
          if (navigator.canShare && navigator.canShare({ files })) {
            await navigator.share({ files, title: group.name || 'Photos' });
          } else {
            showToast('Sharing is not supported on this device.');
          }
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            console.error('Share failed:', err);
            showToast('Share failed.');
          }
        } finally {
          shareConfirm.disabled = false;
          shareConfirm.textContent = 'Share';
          closeShareModal();
        }
      });

      function getPhotoColumnCount() {
        const width = photosEl.clientWidth || window.innerWidth || 1200;
        if (width < 560) return 2;
        if (width < 920) return 3;
        return 4;
      }

      function getPhotoAspect(item) {
        const width = Number(item.width) || 3;
        const height = Number(item.height) || 2;
        return Math.max(0.45, Math.min(2.8, width / height));
      }

      function estimatePhotoHeight(item, columnWidth) {
        return columnWidth / getPhotoAspect(item);
      }

      function createPhotoCard(item, index) {
        const card = document.createElement('article');
        card.className = 'photo-card';
        card.dataset.index = String(index);
        card.classList.toggle('selected', selected.has(index));

        const indicator = document.createElement('div');
        indicator.className = 'select-indicator';
        indicator.textContent = 'Selected';

        const link = document.createElement('a');
        link.className = 'photo-link';
        link.href = PhotoShare.relativeAsset(item.src);
        link.rel = 'noopener';
        link.addEventListener('click', (event) => {
          if (selectionMode) {
            event.preventDefault();
            handleSelectClick(index, event);
          } else {
            event.preventDefault();
            openLightbox(index);
          }
        });

        const media = document.createElement('div');
        media.className = 'photo-media';
        if (item.width && item.height) {
          media.classList.add('has-ratio');
          media.style.setProperty('--aspect', `${item.width} / ${item.height}`);
        }

        const img = document.createElement('img');
        img.loading = index < 4 ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.fetchPriority = index < 3 ? 'high' : 'auto';
        img.alt = `${item.sourceGroupName || group.name} photo ${index + 1}`;
        img.src = PhotoShare.relativeAsset(item.thumb || item.src);
        PhotoShare.attachImageLoadState(card, img);

        media.append(img);
        link.append(media);
        card.append(indicator, link);
        return card;
      }

      function renderPhotoGrid() {
        const columnCount = Math.min(items.length || 1, getPhotoColumnCount());
        const gap = 8;
        const gridWidth = photosEl.clientWidth || window.innerWidth || 1200;
        const columnWidth = (gridWidth - gap * Math.max(columnCount - 1, 0)) / columnCount;
        const columns = Array.from({ length: columnCount }, (_, index) => ({
          left: index * (columnWidth + gap),
          height: 0,
        }));

        photosEl.innerHTML = '';
        photosEl.style.setProperty('--photo-columns', String(columnCount));
        photosEl.style.setProperty('--photo-column-width', `${columnWidth}px`);

        items.forEach((item, index) => {
          const target = columns.reduce((shortest, column) =>
            column.height < shortest.height ? column : shortest
          );
          const card = createPhotoCard(item, index);
          const height = estimatePhotoHeight(item, columnWidth);
          card.style.left = `${target.left}px`;
          card.style.top = `${target.height}px`;
          card.style.width = `${columnWidth}px`;
          photosEl.appendChild(card);
          target.height += height + gap;
        });

        const tallest = columns.reduce((max, column) => Math.max(max, column.height), 0);
        photosEl.style.height = `${Math.max(0, tallest - gap)}px`;
      }

      renderPhotoGrid();

      let photoGridResizeTimer = null;
      window.addEventListener('resize', () => {
        if (photoGridResizeTimer) window.clearTimeout(photoGridResizeTimer);
        photoGridResizeTimer = window.setTimeout(renderPhotoGrid, 180);
      });

      function normalizeIndex(index) {
        return (index + items.length) % items.length;
      }

      function setProgress(visible) {
        if (lbProgress) lbProgress.hidden = !visible;
      }

      function clearTrackAnimationTimer() {
        if (!trackAnimationTimer) return;
        window.clearTimeout(trackAnimationTimer);
        trackAnimationTimer = null;
      }

      function setTrackAnimated(animated) {
        lightboxAnimating = animated;
        lb.classList.toggle('is-track-animating', animated);
        if (!animated) clearTrackAnimationTimer();
      }

      function setTrackPosition(base = '-100%', offset = 0) {
        lb.style.setProperty('--lb-track-base', base);
        lb.style.setProperty('--lb-track-offset', `${offset}px`);
      }

      function resetTrackPosition() {
        setTrackAnimated(false);
        setTrackPosition('-100%', 0);
      }

      function orderedSlots() {
        const slides = Array.from(lbTrack.children);
        return slides
          .map((slide) => slideSlots.find((slot) => slot.slide === slide))
          .filter(Boolean);
      }

      function updateActiveSlide() {
        const centerSlot = orderedSlots()[1];
        slideSlots.forEach((slot) => {
          slot.img.classList.toggle('is-active', slot === centerSlot);
        });
      }

      function resetLightboxTransform() {
        lb.style.setProperty('--lb-offset-x', '0px');
        lb.style.setProperty('--lb-offset-y', '0px');
        lb.style.setProperty('--lb-scale', '1');
        lb.style.setProperty('--lb-backdrop-opacity', '0.96');
        resetTrackPosition();
      }

      function applyLightboxTransform(dx, dy, scale, backdropOpacity) {
        lb.style.setProperty('--lb-offset-x', `${dx}px`);
        lb.style.setProperty('--lb-offset-y', `${dy}px`);
        lb.style.setProperty('--lb-scale', String(scale));
        lb.style.setProperty('--lb-backdrop-opacity', String(backdropOpacity));
      }

      function clampPan(panX, panY, zoom) {
        const maxX = Math.max(0, (zoom - 1) * window.innerWidth * 0.5);
        const maxY = Math.max(0, (zoom - 1) * window.innerHeight * 0.5);
        return {
          x: Math.max(-maxX, Math.min(maxX, panX)),
          y: Math.max(-maxY, Math.min(maxY, panY)),
        };
      }

      function applyZoom(zoom, panX, panY) {
        const wasZoomed = lbZoom > 1;
        lbZoom = zoom;
        lbPanX = panX;
        lbPanY = panY;
        lb.style.setProperty('--lb-zoom', String(zoom));
        lb.style.setProperty('--lb-pan-x', `${panX}px`);
        lb.style.setProperty('--lb-pan-y', `${panY}px`);

        if (zoom > 1 && lightboxChromeVisible) {
          chromeHiddenByZoom = true;
          setChromeVisible(false);
        } else if (zoom <= 1 && wasZoomed && chromeHiddenByZoom) {
          setChromeVisible(true);
        }
      }

      function setZoomInteractionActive() {
        lb.classList.add('is-pinching');
        if (zoomInteractionTimer) window.clearTimeout(zoomInteractionTimer);
        zoomInteractionTimer = window.setTimeout(() => {
          lb.classList.remove('is-pinching');
          zoomInteractionTimer = null;
        }, 140);
      }

      function zoomAroundPoint(nextZoom, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
        const clampedZoom = Math.max(1, Math.min(5, nextZoom));
        const previousZoom = lbZoom || 1;
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const anchorX = (clientX - cx - lbPanX) / previousZoom;
        const anchorY = (clientY - cy - lbPanY) / previousZoom;
        const rawPanX = clientX - cx - anchorX * clampedZoom;
        const rawPanY = clientY - cy - anchorY * clampedZoom;
        const clamped = clampPan(rawPanX, rawPanY, clampedZoom);
        applyZoom(clampedZoom, clamped.x, clamped.y);
      }

      function resetZoom() {
        if (zoomInteractionTimer) {
          window.clearTimeout(zoomInteractionTimer);
          zoomInteractionTimer = null;
        }
        lbZoom = 1;
        lbPanX = 0;
        lbPanY = 0;
        lb.style.removeProperty('--lb-zoom');
        lb.style.removeProperty('--lb-pan-x');
        lb.style.removeProperty('--lb-pan-y');
        lb.classList.remove('is-pinching');
        pinchPointers.clear();
        pinchState = null;
        if (chromeHiddenByZoom) setChromeVisible(true);
      }

      function ensureFullImage(index) {
        const normalized = normalizeIndex(index);
        let img = fullCache.get(normalized);
        if (!img) {
          img = new Image();
          img.decoding = 'async';
          img.src = PhotoShare.relativeAsset(items[normalized].src);
          fullCache.set(normalized, img);
        }
        return img;
      }

      function preloadNeighbor(index) {
        ensureFullImage(index);
      }

      function syncSlideImage(imgEl, index, options = {}) {
        if (!imgEl) return;

        const normalized = normalizeIndex(index);
        const item = items[normalized];
        const fullUrl = PhotoShare.relativeAsset(item.src);
        const thumbUrl = PhotoShare.relativeAsset(item.thumb || item.src);
        const token = String(++loadToken);

        imgEl.dataset.loadToken = token;
        imgEl.alt = options.alt || '';

        if (thumbUrl && thumbUrl !== fullUrl) {
          imgEl.classList.add('is-thumb');
          imgEl.src = thumbUrl;
        } else {
          imgEl.classList.remove('is-thumb');
          imgEl.src = fullUrl;
        }

        if (options.showProgress) setProgress(true);

        const loader = ensureFullImage(normalized);
        const commit = () => {
          if (imgEl.dataset.loadToken !== token) return;
          imgEl.classList.remove('is-thumb');
          imgEl.src = loader.src;
          if (options.showProgress) setProgress(false);
        };

        if (loader.complete && loader.naturalWidth > 0) {
          commit();
          return;
        }

        loader.addEventListener('load', commit, { once: true });
        loader.addEventListener(
          'error',
          () => {
            if (imgEl.dataset.loadToken === token && options.showProgress) {
              setProgress(false);
            }
          },
          { once: true }
        );
      }

      function updateFilmstripActive() {
        thumbButtons.forEach((button, index) => {
          const active = index === lightboxIndex;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
          if (active) {
            button.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          }
        });
      }

      function updateLightboxChrome() {
        updateLightboxSelectionState();
        updateFilmstripActive();
        lb.classList.toggle('is-single', items.length < 2);
      }

      function renderFilmstrip() {
        if (!lbFilmstrip) return;
        lbFilmstrip.innerHTML = '';
        thumbButtons.length = 0;

        items.forEach((item, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'lb-thumb';
          button.setAttribute('aria-label', `Open photo ${index + 1}`);

          const thumbImg = document.createElement('img');
          thumbImg.loading = 'lazy';
          thumbImg.decoding = 'async';
          thumbImg.alt = '';
          thumbImg.src = PhotoShare.relativeAsset(item.thumb || item.src);

          button.appendChild(thumbImg);
          button.addEventListener('click', () => {
            show(index);
            setChromeVisible(true);
          });

          thumbButtons.push(button);
          lbFilmstrip.appendChild(button);
        });
      }

      function setChromeVisible(visible) {
        lightboxChromeVisible = visible;
        lb.classList.toggle('is-chrome-hidden', !visible);
        if (visible) chromeHiddenByZoom = false;
      }

      function finishGestureState() {
        lightboxDrag.pointerId = null;
        lightboxDrag.axis = '';
        lightboxDrag.moved = false;
      }

      function clearGesture() {
        finishGestureState();
        lb.classList.remove('is-dragging');
        resetLightboxTransform();
      }

      function renderTrack(index) {
        lightboxIndex = normalizeIndex(index);
        updateLightboxChrome();
        resetZoom();

        slideSlots.forEach((slot) => lbTrack.appendChild(slot.slide));
        updateActiveSlide();
        resetTrackPosition();

        syncSlideImage(slideSlots[1].img, lightboxIndex, {
          alt: `${group.name} photo ${lightboxIndex + 1}`,
          showProgress: true,
        });

        syncSlideImage(slideSlots[0].img, lightboxIndex - 1, { alt: '' });
        syncSlideImage(slideSlots[2].img, lightboxIndex + 1, { alt: '' });

        preloadNeighbor(lightboxIndex - 2);
        preloadNeighbor(lightboxIndex + 2);
      }

      function animateTrackTo(targetBase, nextIndex = null) {
        finishGestureState();
        lb.classList.remove('is-dragging');
        applyLightboxTransform(0, 0, 1, 0.96);
        setTrackAnimated(true);
        setTrackPosition(targetBase, 0);

        let finished = false;
        const finalize = (e) => {
          if (e && (e.target !== lbTrack || e.propertyName !== 'transform')) return;
          if (finished) return;
          finished = true;
          lbTrack.removeEventListener('transitionend', finalize);
          clearTrackAnimationTimer();

          if (nextIndex !== null) {
            commitTrackLanding(targetBase, nextIndex);
          } else {
            setTrackAnimated(false);
            resetTrackPosition();
          }
        };

        lbTrack.addEventListener('transitionend', finalize, { once: true });
        trackAnimationTimer = window.setTimeout(finalize, 360);
      }

      function stepLightbox(direction) {
        if (lightboxAnimating || items.length < 2) return;
        animateTrackTo(direction > 0 ? '-200%' : '0%', lightboxIndex + direction);
      }

      function show(index) {
        renderTrack(index);
        applyLightboxTransform(0, 0, 1, 0.96);
      }

      function commitTrackLanding(targetBase, nextIndex) {
        const direction = targetBase === '-200%' ? 1 : -1;
        const slots = orderedSlots();
        const oldCenterSlot = slots[1];
        const landedSlot = direction > 0 ? slots[2] : slots[0];
        const recycledSlot = direction > 0 ? slots[0] : slots[2];

        if (!landedSlot || !oldCenterSlot || !recycledSlot) {
          renderTrack(nextIndex);
          return;
        }

        lightboxIndex = normalizeIndex(nextIndex);
        resetZoom();
        setTrackAnimated(false);
        if (direction > 0) {
          lbTrack.appendChild(recycledSlot.slide);
        } else {
          lbTrack.prepend(recycledSlot.slide);
        }
        setTrackPosition('-100%', 0);
        updateActiveSlide();

        landedSlot.img.alt = `${group.name} photo ${lightboxIndex + 1}`;
        oldCenterSlot.img.alt = '';
        syncSlideImage(recycledSlot.img, lightboxIndex + direction, { alt: '' });
        updateLightboxChrome();
        preloadNeighbor(lightboxIndex - 2);
        preloadNeighbor(lightboxIndex + 2);
      }

      function openLightbox(index) {
        lb.hidden = false;
        lb.setAttribute('aria-hidden', 'false');
        document.body.classList.add('lightbox-open');
        setChromeVisible(true);
        clearGesture();
        show(index);
      }

      function closeLightbox() {
        clearTrackAnimationTimer();
        resetZoom();
        [lbPrevImg, lbImg, lbNextImg].forEach((imgEl) => {
          if (!imgEl) return;
          imgEl.dataset.loadToken = String(++loadToken);
          imgEl.removeAttribute('src');
          imgEl.classList.remove('is-thumb');
        });

        lb.hidden = true;
        lb.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('lightbox-open');
        setProgress(false);
        setChromeVisible(true);
        clearGesture();
      }

      function handleStagePointerDown(event) {
        if (lb.hidden || lightboxAnimating) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target.closest('.lb-btn, .lb-action-btn, .lb-thumb, .lb-zone')) return;

        pinchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        lbStage.setPointerCapture(event.pointerId);

        if (pinchPointers.size >= 2) {
          // Second finger — cancel any active single-finger drag and start pinch.
          if (lightboxDrag.axis) {
            lb.classList.remove('is-dragging');
            resetLightboxTransform();
          }
          lightboxDrag.pointerId = null;
          lightboxDrag.moved = false;
          lb.classList.add('is-pinching');

          const pts = Array.from(pinchPointers.values());
          pinchState = {
            startDist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
            startZoom: lbZoom,
            startPanX: lbPanX,
            startPanY: lbPanY,
            startMidX: (pts[0].x + pts[1].x) / 2,
            startMidY: (pts[0].y + pts[1].y) / 2,
          };
          return;
        }

        lightboxDrag.pointerId = event.pointerId;
        lightboxDrag.startX = event.clientX;
        lightboxDrag.startY = event.clientY;
        lightboxDrag.lastX = event.clientX;
        lightboxDrag.lastY = event.clientY;
        lightboxDrag.axis = '';
        lightboxDrag.moved = false;
      }

      function handleStagePointerMove(event) {
        if (pinchPointers.has(event.pointerId)) {
          pinchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        // Two-finger pinch
        if (pinchState && pinchPointers.size >= 2) {
          event.preventDefault();
          const pts = Array.from(pinchPointers.values());
          const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          const curMidX = (pts[0].x + pts[1].x) / 2;
          const curMidY = (pts[0].y + pts[1].y) / 2;

          const rawZoom = pinchState.startZoom * (curDist / pinchState.startDist);
          const previousZoom = lbZoom;
          lbZoom = pinchState.startZoom;
          lbPanX = pinchState.startPanX;
          lbPanY = pinchState.startPanY;
          zoomAroundPoint(rawZoom, pinchState.startMidX, pinchState.startMidY);
          const movedPan = clampPan(
            lbPanX + curMidX - pinchState.startMidX,
            lbPanY + curMidY - pinchState.startMidY,
            lbZoom
          );
          applyZoom(lbZoom, movedPan.x, movedPan.y);
          if (previousZoom !== lbZoom) setZoomInteractionActive();
          return;
        }

        if (event.pointerId !== lightboxDrag.pointerId) return;

        const prevX = lightboxDrag.lastX;
        const prevY = lightboxDrag.lastY;
        lightboxDrag.lastX = event.clientX;
        lightboxDrag.lastY = event.clientY;

        // While zoomed in: single-finger pans the image
        if (lbZoom > 1) {
          lightboxDrag.moved = true;
          event.preventDefault();
          const clamped = clampPan(
            lbPanX + (event.clientX - prevX),
            lbPanY + (event.clientY - prevY),
            lbZoom
          );
          applyZoom(lbZoom, clamped.x, clamped.y);
          return;
        }

        const dx = event.clientX - lightboxDrag.startX;
        const dy = event.clientY - lightboxDrag.startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (!lightboxDrag.axis) {
          if (absX < 10 && absY < 10) return;
          if (absX > absY * 1.15) {
            lightboxDrag.axis = 'x';
          } else if (absY > absX * 1.15) {
            lightboxDrag.axis = 'y';
          } else {
            return;
          }
        }

        lightboxDrag.moved = true;
        lb.classList.add('is-dragging');
        event.preventDefault();

        if (lightboxDrag.axis === 'x') {
          const scale = 1 - Math.min(absX / 2200, 0.04);
          const backdropOpacity = Math.max(0.7, 0.96 - absX / 1400);
          setTrackPosition('-100%', dx);
          applyLightboxTransform(0, 0, scale, backdropOpacity);
          return;
        }

        const scale = 1 - Math.min(absY / 900, 0.08);
        const backdropOpacity = Math.max(0.4, 0.96 - absY / 480);
        applyLightboxTransform(dx * 0.12, dy, scale, backdropOpacity);
      }

      function handleStagePointerEnd(event) {
        pinchPointers.delete(event.pointerId);

        try {
          lbStage.releasePointerCapture(event.pointerId);
        } catch {
          // Some browsers release capture automatically.
        }

        // End of pinch (one or both fingers lifted)
        if (pinchState) {
          if (pinchPointers.size < 2) {
            pinchState = null;
            lb.classList.remove('is-pinching');

            if (lbZoom <= 1) {
              resetZoom();
            } else if (pinchPointers.size === 1) {
              // One finger remains — set it up for panning
              const [remId, remPos] = Array.from(pinchPointers.entries())[0];
              lightboxDrag.pointerId = remId;
              lightboxDrag.startX = remPos.x;
              lightboxDrag.startY = remPos.y;
              lightboxDrag.lastX = remPos.x;
              lightboxDrag.lastY = remPos.y;
              lightboxDrag.moved = false;
              lightboxDrag.axis = '';
            }
          }
          return;
        }

        if (event.pointerId !== lightboxDrag.pointerId) return;
        lightboxDrag.pointerId = null;

        const dx = event.clientX - lightboxDrag.startX;
        const dy = event.clientY - lightboxDrag.startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const thresholdX = Math.min(window.innerWidth * 0.18, 120);
        const thresholdY = Math.min(window.innerHeight * 0.14, 160);

        // While zoomed: single-finger ends pan (no navigation/dismiss)
        if (lbZoom > 1) {
          if (!lightboxDrag.moved) {
            // Tap while zoomed — check for double-tap to reset
            const now = Date.now();
            if (now - lastTapTime < 300 && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) < 50) {
              resetZoom();
              lastTapTime = 0;
              return;
            }
            lastTapTime = now;
            lastTapX = event.clientX;
            lastTapY = event.clientY;
          }
          lb.classList.remove('is-dragging');
          finishGestureState();
          return;
        }

        if (!lightboxDrag.moved) {
          // Tap — check for double-tap to zoom in
          const now = Date.now();
          if (now - lastTapTime < 300 && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) < 50) {
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const newZoom = 2.5;
            const rawPanX = (event.clientX - cx) * (1 - newZoom);
            const rawPanY = (event.clientY - cy) * (1 - newZoom);
            const clamped = clampPan(rawPanX, rawPanY, newZoom);
            applyZoom(newZoom, clamped.x, clamped.y);
            setZoomInteractionActive();
            lastTapTime = 0;
            clearGesture();
            return;
          }
          lastTapTime = now;
          lastTapX = event.clientX;
          lastTapY = event.clientY;
          setChromeVisible(!lightboxChromeVisible);
          clearGesture();
          return;
        }

        if (lightboxDrag.axis === 'x') {
          if (absX > thresholdX && items.length > 1) {
            animateTrackTo(dx < 0 ? '-200%' : '0%', lightboxIndex + (dx < 0 ? 1 : -1));
          } else {
            animateTrackTo('-100%');
          }
          return;
        }

        if (lightboxDrag.axis === 'y' && absY > thresholdY) {
          closeLightbox();
          return;
        }

        clearGesture();
      }

      function handleLightboxWheel(event) {
        if (lb.hidden) return;
        if (event.target.closest('.lb-btn, .lb-action-btn, .lb-thumb, .lb-filmstrip')) return;

        event.preventDefault();
        event.stopPropagation();
        if (lightboxAnimating) return;

        const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        const deltaX = event.deltaX * deltaScale;
        const deltaY = event.deltaY * deltaScale;

        if (event.ctrlKey || event.metaKey) {
          const delta = deltaY || deltaX;
          if (!delta) return;
          const nextZoom = lbZoom * Math.exp(-delta * 0.012);
          zoomAroundPoint(nextZoom, event.clientX, event.clientY);
          setZoomInteractionActive();
          return;
        }

        if (lbZoom <= 1) return;

        const panX = event.shiftKey && !deltaX ? deltaY : deltaX;
        const panY = event.shiftKey && !deltaX ? 0 : deltaY;
        const clamped = clampPan(lbPanX - panX, lbPanY - panY, lbZoom);
        applyZoom(lbZoom, clamped.x, clamped.y);
        setZoomInteractionActive();
      }

      function handleGestureStart(event) {
        if (lb.hidden) return;
        event.preventDefault();
        gestureStartZoom = lbZoom;
        lb.classList.add('is-pinching');
      }

      function handleGestureChange(event) {
        if (lb.hidden) return;
        event.preventDefault();
        const clientX = Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2;
        const clientY = Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2;
        zoomAroundPoint(gestureStartZoom * event.scale, clientX, clientY);
      }

      function handleGestureEnd(event) {
        if (lb.hidden) return;
        event.preventDefault();
        if (lbZoom <= 1) resetZoom();
        else setZoomInteractionActive();
      }

      async function shareCurrentPhoto() {
        if (!shareSupported) {
          showToast('Sharing is not supported on this device.');
          return;
        }

        const originalText = lbShareBtn.textContent;
        lbShareBtn.disabled = true;
        lbShareBtn.textContent = 'Sharing';

        try {
          const file = await prepareCurrentFileForShare(lightboxIndex);
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: group.name || 'Photo' });
          } else {
            showToast('Sharing is not supported on this device.');
          }
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            console.error('Share failed:', err);
            showToast('Share failed.');
          }
        } finally {
          lbShareBtn.disabled = false;
          lbShareBtn.textContent = originalText;
        }
      }

      renderFilmstrip();
      updateToolbar();

      const initialPhotoParam = Number.parseInt((getParam('p') || '').trim(), 10);
      const initialPresenterParam = ['1', 'true', 'yes'].includes(
        (getParam('present') || '').trim().toLowerCase()
      );
      if (Number.isFinite(initialPhotoParam) && initialPhotoParam >= 1 && initialPhotoParam <= items.length) {
        openLightbox(initialPhotoParam - 1);
        if (initialPresenterParam) setChromeVisible(false);
      }

      btnPrev.addEventListener('click', () => stepLightbox(-1));
      btnNext.addEventListener('click', () => stepLightbox(1));
      btnClose.addEventListener('click', closeLightbox);
      if (btnZonePrev) btnZonePrev.addEventListener('click', () => stepLightbox(-1));
      if (btnZoneNext) btnZoneNext.addEventListener('click', () => stepLightbox(1));
      lbStage.addEventListener('pointerdown', handleStagePointerDown);
      lbStage.addEventListener('pointermove', handleStagePointerMove, { passive: false });
      lbStage.addEventListener('pointerup', handleStagePointerEnd);
      lbStage.addEventListener('pointercancel', handleStagePointerEnd);
      lbStage.addEventListener('wheel', handleLightboxWheel, { passive: false });
      lbStage.addEventListener('gesturestart', handleGestureStart, { passive: false });
      lbStage.addEventListener('gesturechange', handleGestureChange, { passive: false });
      lbStage.addEventListener('gestureend', handleGestureEnd, { passive: false });

      lbSelectBtn.addEventListener('click', () => {
        if (!selectionMode) enterSelect();
        toggleSelected(lightboxIndex);
      });

      lbShareBtn.addEventListener('click', shareCurrentPhoto);

      if (lbDownloadBtn) {
        lbDownloadBtn.addEventListener('click', () => {
          const item = items[lightboxIndex];
          const url = PhotoShare.relativeAsset(item.src);
          const name = PhotoShare.basename(item.src);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        });
      }

      window.addEventListener('keydown', (event) => {
        if (!lb.hidden) {
          if (event.key === 'Escape') closeLightbox();
          if (event.key === 'ArrowLeft') stepLightbox(-1);
          if (event.key === 'ArrowRight') stepLightbox(1);
          if (event.key === ' ') {
            event.preventDefault();
            setChromeVisible(!lightboxChromeVisible);
          }
          return;
        }

        if (selectionMode && event.key === 'Escape') {
          exitSelect();
        }
      });

      PhotoShare.setBusyState(false, 'Album ready');
    } catch (err) {
      console.error('Error rendering group page:', err);
      photosEl.innerHTML = '';
      emptyEl.hidden = false;
      if (titleEl) titleEl.textContent = 'Album unavailable';
      headerTitleEl.textContent = 'Album unavailable';
      btnSelectHeader.hidden = true;
      if (galleryMetaEl) galleryMetaEl.textContent = '';
      PhotoShare.setBusyState(false, 'Album ready');
    }
  });
})();
