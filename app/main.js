(function () {
  const ManifestPath = './photos.json';
  const SkeletonHeights = [260, 340, 300, 380, 280, 360, 320, 410];

  function basename(path) {
    return String(path || '').split('/').filter(Boolean).pop() || '';
  }

  function prettifyLabel(pathOrName) {
    return basename(pathOrName)
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim();
  }

  function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function normalizeItem(item, fallbackSrc, fallbackThumb) {
    const src = (item && typeof item === 'object' ? item.src : fallbackSrc) || fallbackSrc || '';
    const thumb =
      (item && typeof item === 'object' ? item.thumb : fallbackThumb) || fallbackThumb || src;
    const width = toNumber(item && typeof item === 'object' ? item.width : null);
    const height = toNumber(item && typeof item === 'object' ? item.height : null);
    const name =
      (item && typeof item === 'object' && item.name ? String(item.name) : '') ||
      prettifyLabel(src);

    return { src, thumb, width, height, name };
  }

  function normalizeGroup(group) {
    const normalized = { ...(group || {}) };
    const rawPhotos = Array.isArray(normalized.photos) ? normalized.photos : [];
    const rawThumbs = Array.isArray(normalized.thumbs) ? normalized.thumbs : [];
    const rawItems =
      Array.isArray(normalized.items) && normalized.items.length
        ? normalized.items
        : rawPhotos.map((src, index) => ({
            src,
            thumb: rawThumbs[index] || src,
          }));

    const items = rawItems.map((item, index) =>
      normalizeItem(item, rawPhotos[index], rawThumbs[index])
    );

    normalized.id = normalized.id || (normalized.name || '').toLowerCase().replace(/\s+/g, '_');
    normalized.name = normalized.name || normalized.id.replace(/_/g, ' ');
    normalized.items = items;
    normalized.photos = items.map((item) => item.src);
    normalized.thumbs = items.map((item) => item.thumb);
    normalized.cover = normalized.cover || (items[0] ? items[0].src : '');
    normalized.coverThumb = normalized.coverThumb || (items[0] ? items[0].thumb : normalized.cover);

    return normalized;
  }

  async function loadManifest() {
    const url = `${ManifestPath}?v=${Date.now()}`;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
      const data = await res.json();
      data.groups = Array.isArray(data.groups) ? data.groups.map(normalizeGroup) : [];
      data.groups.sort((a, b) => a.name.localeCompare(b.name));
      return data;
    } catch (err) {
      console.error(err);
      return { groups: [] };
    }
  }

  function setBusyState(isLoading, label) {
    if (!document.body) return;

    document.body.classList.toggle('is-loading', !!isLoading);

    if (isLoading) {
      document.body.classList.remove('is-ready');
    } else {
      requestAnimationFrame(() => document.body.classList.add('is-ready'));
    }

    document.body.setAttribute('aria-busy', isLoading ? 'true' : 'false');

    const status = document.getElementById('pageStatus');
    if (status && typeof label === 'string' && label.trim()) {
      status.textContent = label;
    }
  }

  function formatTimestamp(value, options = {}) {
    if (!value) return '';
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return String(value);

    const includeTime = !!options.includeTime;
    return new Intl.DateTimeFormat('en-US', {
      month: includeTime ? 'short' : 'long',
      day: 'numeric',
      year: 'numeric',
      ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    }).format(parsed);
  }

  function relativeAsset(path) {
    if (!path) return 'placeholder.svg';
    return `../${String(path).replace(/^\.?\//, '')}`;
  }

  function revealElements(root = document) {
    const elements = Array.from(root.querySelectorAll('[data-reveal]'));
    if (!elements.length) return;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    elements.forEach((element, index) => {
      element.style.setProperty('--stagger-index', String(index));
    });

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    elements.forEach((element) => {
      if (!element.classList.contains('is-visible')) observer.observe(element);
    });
  }

  function attachImageLoadState(card, img) {
    if (!card || !img) return;
    let settled = false;
    let pollId = 0;
    const clearPoll = () => {
      if (pollId) {
        window.clearInterval(pollId);
        pollId = 0;
      }
    };
    const markReady = () => {
      if (settled) return;
      settled = true;
      clearPoll();
      requestAnimationFrame(() => card.classList.add('is-loaded'));
    };
    const markError = () => {
      if (settled) return;
      settled = true;
      clearPoll();
      requestAnimationFrame(() => card.classList.add('is-loaded', 'is-error'));
    };

    if (img.complete && img.naturalWidth > 0) {
      markReady();
      return;
    }

    img.addEventListener('load', markReady, { once: true });
    img.addEventListener('error', markError, { once: true });

    pollId = window.setInterval(() => {
      if (img.complete && img.naturalWidth > 0) {
        markReady();
      }
    }, 120);
    window.setTimeout(clearPoll, 4000);
  }

  function renderSkeletons(target, options = {}) {
    if (!target) return;

    const kind = options.kind || 'group';
    const count = Number(options.count) || 6;
    target.innerHTML = '';

    for (let index = 0; index < count; index += 1) {
      const card = document.createElement('article');
      card.className = `skeleton-card skeleton-${kind}`;

      const media = document.createElement('div');
      media.className = 'skeleton-media';
      if (kind === 'photo') {
        media.style.height = `${SkeletonHeights[index % SkeletonHeights.length]}px`;
      }

      const body = document.createElement('div');
      body.className = 'skeleton-body';

      const lineShort = document.createElement('span');
      lineShort.className = 'skeleton-line skeleton-line-short';
      const lineLong = document.createElement('span');
      lineLong.className = 'skeleton-line skeleton-line-long';

      body.append(lineShort, lineLong);
      card.append(media, body);
      target.appendChild(card);
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!(location.protocol === 'http:' || location.protocol === 'https:')) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error) => {
        console.warn('Service worker registration failed:', error);
      });
    });
  }

  registerServiceWorker();

  window.PhotoShare = {
    attachImageLoadState,
    basename,
    formatTimestamp,
    loadManifest,
    prettifyLabel,
    relativeAsset,
    renderSkeletons,
    revealElements,
    setBusyState,
  };
})();
