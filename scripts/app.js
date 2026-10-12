(() => {
  'use strict';

  const STORAGE_KEY = 'happy.orphanages.v1';
  const MAX_PHOTOS = 6;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const MAX_PHOTO_STORAGE = 3 * 1024 * 1024;
  const MERCATOR_LIMIT = 85.05112878;
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const wrapLongitude = longitude => ((longitude + 180) % 360 + 360) % 360 - 180;

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function validCoordinates(latitude, longitude) {
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }

  function phoneNumber(value) {
    let digits = String(value).replace(/\D/g, '');
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      digits = digits.slice(2);
    }
    return /^\d{10,11}$/.test(digits) ? `55${digits}` : null;
  }

  function isRecord(record) {
    return record && typeof record === 'object' && !Array.isArray(record)
      && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 120
      && typeof record.name === 'string' && record.name.trim().length > 0 && record.name.length <= 80
      && typeof record.about === 'string' && record.about.trim().length > 0 && record.about.length <= 300
      && typeof record.whatsapp === 'string' && phoneNumber(record.whatsapp) !== null
      && typeof record.instructions === 'string' && record.instructions.trim().length > 0 && record.instructions.length <= 1000
      && typeof record.openingHours === 'string' && record.openingHours.trim().length > 0 && record.openingHours.length <= 80
      && typeof record.openOnWeekends === 'boolean'
      && validCoordinates(record.latitude, record.longitude)
      && Array.isArray(record.photos) && record.photos.length <= MAX_PHOTOS
      && record.photos.every(photo => typeof photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo))
      && typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt));
  }

  function readRecords() {
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      throw new Error('Não foi possível acessar os cadastros neste navegador. Permita o armazenamento do site e tente novamente.');
    }
    if (raw === null) return [];
    let records;
    try {
      records = JSON.parse(raw);
    } catch {
      throw new Error('Não foi possível ler os cadastros salvos. Nenhum dado foi alterado.');
    }
    if (!Array.isArray(records) || records.some(record => !isRecord(record))
      || new Set(records.map(record => record.id)).size !== records.length) {
      throw new Error('Os cadastros salvos apresentam um problema. Nenhum dado foi alterado.');
    }
    return records;
  }

  function saveRecord(record) {
    const records = readRecords();
    if (!isRecord(record)) throw new Error('Revise os dados do cadastro e tente novamente.');
    if (records.some(existing => existing.id === record.id)) {
      throw new Error('Não foi possível gerar este cadastro. Tente confirmar novamente.');
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...records, record]));
    } catch (error) {
      if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        throw new Error('Não há espaço suficiente para salvar o cadastro. Remova algumas fotos e tente novamente.');
      }
      throw new Error('Não foi possível salvar o cadastro neste navegador. Seus dados continuam no formulário.');
    }
  }

  function projected(latitude, longitude, zoom) {
    const size = 256 * 2 ** zoom;
    const radians = clamp(latitude, -MERCATOR_LIMIT, MERCATOR_LIMIT) * Math.PI / 180;
    return {
      x: (longitude + 180) / 360 * size,
      y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * size
    };
  }

  function geographic(x, y, zoom) {
    const size = 256 * 2 ** zoom;
    return {
      latitude: clamp(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI, -MERCATOR_LIMIT, MERCATOR_LIMIT),
      longitude: wrapLongitude(x / size * 360 - 180)
    };
  }

  class HappyMap {
    constructor(container, onSelect) {
      this.container = container;
      this.mode = container.dataset.mode || 'view';
      const initialLatitude = Number(container.dataset.lat);
      const initialLongitude = Number(container.dataset.lng);
      this.latitude = Number.isFinite(initialLatitude) ? clamp(initialLatitude, -MERCATOR_LIMIT, MERCATOR_LIMIT) : -27.2143;
      this.longitude = Number.isFinite(initialLongitude) ? wrapLongitude(initialLongitude) : -49.643;
      this.zoom = clamp(Number(container.dataset.zoom) || 14, 3, 18);
      this.onSelect = onSelect;
      this.tilesLayer = $('.map-tiles', container) || container.appendChild(element('div', 'map-tiles'));
      this.markersLayer = $('.map-markers', container) || container.appendChild(element('div', 'map-markers'));
      this.unavailable = $('.map-unavailable', container);
      this.tiles = new Map();
      this.markers = [];
      this.frame = null;
      this.drag = null;
      this.allowTiles = window.location.protocol !== 'file:';
      if (!this.allowTiles) {
        this.showUnavailable('Para carregar o mapa, abra pelo servidor local. Você também pode informar as coordenadas.');
      }
      this.bindEvents();
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
        this.resizeObserver.observe(container);
      } else {
        window.addEventListener('resize', () => this.scheduleRender());
      }
      this.render();
    }

    showUnavailable(message) {
      if (this.unavailable) {
        const messageNode = $('[data-map-message]', this.unavailable) || this.unavailable;
        messageNode.textContent = message;
        this.unavailable.hidden = false;
      }
    }

    checkNetwork() {
      if (!this.allowTiles) return;
      const currentTiles = [...this.tiles.values()];
      if (currentTiles.some(tile => tile.dataset.state === 'loaded')) {
        if (this.unavailable) this.unavailable.hidden = true;
      } else if (currentTiles.some(tile => tile.dataset.state === 'error')) {
        this.showUnavailable('Não foi possível carregar o mapa. Verifique sua conexão. As coordenadas continuam disponíveis.');
      }
    }

    bindEvents() {
      const zoomIn = $('.map-zoom-in', this.container);
      const zoomOut = $('.map-zoom-out', this.container);
      if (zoomIn) zoomIn.addEventListener('click', () => this.setZoom(this.zoom + 1));
      if (zoomOut) zoomOut.addEventListener('click', () => this.setZoom(this.zoom - 1));

      this.container.addEventListener('pointerdown', event => {
        if ((event.pointerType === 'mouse' && event.button !== 0)
          || event.target.closest('button, a, input, label, .map-unavailable')) return;
        const center = projected(this.latitude, this.longitude, this.zoom);
        this.drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, center, moved: false };
        this.container.setPointerCapture(event.pointerId);
        this.container.classList.add('is-dragging');
      });
      this.container.addEventListener('pointermove', event => {
        if (!this.drag || this.drag.id !== event.pointerId) return;
        const dx = event.clientX - this.drag.startX;
        const dy = event.clientY - this.drag.startY;
        if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
        if (!this.drag.moved) return;
        event.preventDefault();
        const center = geographic(this.drag.center.x - dx, this.drag.center.y - dy, this.zoom);
        this.latitude = center.latitude;
        this.longitude = center.longitude;
        this.scheduleRender();
      });
      this.container.addEventListener('pointerup', event => {
        if (!this.drag || this.drag.id !== event.pointerId) return;
        const moved = this.drag.moved;
        this.finishDrag(event.pointerId);
        if (!moved && this.mode === 'select') {
          const bounds = this.container.getBoundingClientRect();
          const center = projected(this.latitude, this.longitude, this.zoom);
          this.select(geographic(center.x + event.clientX - bounds.left - bounds.width / 2,
            center.y + event.clientY - bounds.top - bounds.height / 2, this.zoom));
        }
      });
      this.container.addEventListener('pointercancel', event => this.finishDrag(event.pointerId));
      this.container.addEventListener('lostpointercapture', () => {
        this.drag = null;
        this.container.classList.remove('is-dragging');
      });
      this.container.addEventListener('keydown', event => {
        if (event.target !== this.container) return;
        const directions = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
        if (directions[event.key]) {
          event.preventDefault();
          const center = projected(this.latitude, this.longitude, this.zoom);
          const [dx, dy] = directions[event.key];
          const next = geographic(center.x + dx, center.y + dy, this.zoom);
          this.setCenter(next.latitude, next.longitude);
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          this.setZoom(this.zoom + 1);
        } else if (event.key === '-') {
          event.preventDefault();
          this.setZoom(this.zoom - 1);
        } else if (event.key === 'Enter' && this.mode === 'select') {
          event.preventDefault();
          this.select({ latitude: this.latitude, longitude: this.longitude });
        }
      });
    }

    finishDrag(pointerId) {
      if (this.drag && this.drag.id !== pointerId) return;
      this.drag = null;
      this.container.classList.remove('is-dragging');
      if (this.container.hasPointerCapture(pointerId)) this.container.releasePointerCapture(pointerId);
    }

    setZoom(zoom) {
      this.zoom = clamp(zoom, 3, 18);
      this.scheduleRender();
    }

    setCenter(latitude, longitude, zoom = this.zoom) {
      this.latitude = clamp(latitude, -MERCATOR_LIMIT, MERCATOR_LIMIT);
      this.longitude = wrapLongitude(longitude);
      this.zoom = clamp(zoom, 3, 18);
      this.scheduleRender();
    }

    select(coordinates, recenter = false) {
      if (!validCoordinates(coordinates.latitude, coordinates.longitude)) return;
      this.setMarkers([{ ...coordinates, label: 'Localização selecionada' }]);
      if (recenter) this.setCenter(coordinates.latitude, coordinates.longitude);
      if (this.onSelect) this.onSelect(coordinates);
    }

    setMarkers(records) {
      this.markersLayer.replaceChildren();
      this.markers = records.map(record => {
        const marker = element(record.id ? 'button' : 'div', 'map-marker');
        if (record.id) {
          marker.type = 'button';
          marker.setAttribute('aria-label', `Conhecer ${record.name || record.label}`);
          marker.addEventListener('click', () => {
            window.location.href = `orphanage.html?id=${encodeURIComponent(record.id)}`;
          });
        } else {
          marker.setAttribute('role', 'img');
          marker.setAttribute('aria-label', record.label || 'Localização da instituição');
        }
        marker.title = record.name || record.label || 'Localização da instituição';
        const icon = element('img');
        icon.src = 'assets/map-marker.svg';
        icon.alt = '';
        icon.draggable = false;
        marker.appendChild(icon);
        this.markersLayer.appendChild(marker);
        return { ...record, element: marker };
      });
      this.scheduleRender();
    }

    scheduleRender() {
      if (this.frame !== null) return;
      this.frame = window.requestAnimationFrame(() => {
        this.frame = null;
        this.render();
      });
    }

    render() {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (!width || !height) return;
      const center = projected(this.latitude, this.longitude, this.zoom);
      const left = center.x - width / 2;
      const top = center.y - height / 2;
      const tileCount = 2 ** this.zoom;
      const worldSize = 256 * tileCount;

      if (this.allowTiles) {
        const visible = new Set();
        const firstX = Math.floor(left / 256);
        const lastX = Math.floor((left + width - 1) / 256);
        const firstY = Math.max(0, Math.floor(top / 256));
        const lastY = Math.min(tileCount - 1, Math.floor((top + height - 1) / 256));
        for (let x = firstX; x <= lastX; x += 1) {
          for (let y = firstY; y <= lastY; y += 1) {
            const key = `${this.zoom}/${x}/${y}`;
            visible.add(key);
            let tile = this.tiles.get(key);
            if (!tile) {
              tile = element('img', 'map-tile');
              tile.alt = '';
              tile.setAttribute('aria-hidden', 'true');
              tile.draggable = false;
              tile.width = 256;
              tile.height = 256;
              tile.referrerPolicy = 'strict-origin-when-cross-origin';
              tile.dataset.state = 'loading';
              tile.addEventListener('load', () => { tile.dataset.state = 'loaded'; this.checkNetwork(); });
              tile.addEventListener('error', () => { tile.dataset.state = 'error'; this.checkNetwork(); });
              this.tiles.set(key, tile);
              this.tilesLayer.appendChild(tile);
              const wrappedX = ((x % tileCount) + tileCount) % tileCount;
              tile.src = `https://tile.openstreetmap.org/${this.zoom}/${wrappedX}/${y}.png`;
            }
            tile.style.left = `${Math.round(x * 256 - left)}px`;
            tile.style.top = `${Math.round(y * 256 - top)}px`;
          }
        }
        for (const [key, tile] of this.tiles) {
          if (!visible.has(key)) {
            tile.remove();
            this.tiles.delete(key);
          }
        }
        this.checkNetwork();
      }

      for (const marker of this.markers) {
        const point = projected(marker.latitude, marker.longitude, this.zoom);
        let dx = point.x - center.x;
        if (dx > worldSize / 2) dx -= worldSize;
        if (dx < -worldSize / 2) dx += worldSize;
        const markerX = Math.round(width / 2 + dx);
        const markerY = Math.round(height / 2 + point.y - center.y);
        marker.element.style.left = `${markerX}px`;
        marker.element.style.top = `${markerY}px`;
        marker.element.hidden = markerX < -48 || markerX > width + 48 || markerY < 0 || markerY > height + 58;
      }
      const zoomIn = $('.map-zoom-in', this.container);
      const zoomOut = $('.map-zoom-out', this.container);
      if (zoomIn) zoomIn.disabled = this.zoom === 18;
      if (zoomOut) zoomOut.disabled = this.zoom === 3;
    }
  }

  function setFieldError(input, errorNode, message) {
    if (errorNode) errorNode.textContent = message;
    if (input) {
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      input.classList.toggle('is-invalid', Boolean(message));
    }
  }

  function processPhoto(file) {
    return new Promise((resolve, reject) => {
      const sourceUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
          if (!longestSide) throw new Error('Esta imagem não pôde ser aberta.');
          const scale = Math.min(1, 1200 / longestSide);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Não foi possível preparar esta imagem.');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            if (!blob) {
              reject(new Error('Não foi possível preparar esta imagem.'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve({ dataUrl: String(reader.result), blob, name: file.name });
            reader.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
            reader.readAsDataURL(blob);
          }, 'image/jpeg', 0.75);
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(sourceUrl);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error('Esta imagem não pôde ser aberta. Escolha outra foto.'));
      };
      image.src = sourceUrl;
    });
  }

  function initializeForm() {
    const form = $('#orphanage-form');
    if (!form) return;
    const submit = $('#submit-button');
    const feedback = $('#form-feedback');
    const originalButtonNodes = submit ? [...submit.childNodes] : [];
    const photosInput = $('#photos-input');
    const previews = $('#photo-previews');
    const photos = [];
    const touched = new Set();
    let processing = false;
    let saving = false;
    let manualDraftInvalid = false;
    const fields = [
      { id: 'name', label: 'Informe o nome da instituição.', max: 80 },
      { id: 'about', label: 'Conte um pouco sobre a instituição.', max: 300 },
      { id: 'whatsapp', label: 'Informe um número de WhatsApp.' },
      { id: 'instructions', label: 'Informe as orientações para a visita.', max: 1000 },
      { id: 'opening-hours', label: 'Informe o horário de visitas.', max: 80 }
    ];

    function validateField(config) {
      const input = $(`#${config.id}`);
      if (!input) return false;
      const value = input.value.trim();
      let message = value ? '' : config.label;
      if (!message && config.max && value.length > config.max) message = `Use no máximo ${config.max} caracteres.`;
      if (!message && config.id === 'whatsapp' && !phoneNumber(value)) {
        message = 'Informe o DDD e o telefone com 10 ou 11 dígitos. O código 55 é opcional.';
      }
      setFieldError(input, $(`#${config.id}-error`), message);
      return !message;
    }

    function updateButton() {
      if (!submit) return;
      submit.disabled = saving || processing;
      submit.setAttribute('aria-busy', String(saving || processing));
      if (saving || processing) submit.textContent = saving ? 'Salvando…' : 'Preparando fotos…';
      else submit.replaceChildren(...originalButtonNodes);
    }

    for (const config of fields) {
      const input = $(`#${config.id}`);
      if (!input) continue;
      input.addEventListener('blur', () => { touched.add(config.id); validateField(config); });
      input.addEventListener('input', () => {
        if (touched.has(config.id)) validateField(config);
        if (config.id === 'about' && $('#about-count')) $('#about-count').textContent = `${input.value.length}/300`;
      });
    }
    if ($('#about-count') && $('#about')) $('#about-count').textContent = `${$('#about').value.length}/300`;

    function locationError(message) {
      const error = $('#location-error');
      if (error) error.textContent = message;
      const container = $('#location-map');
      if (container) container.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    const mapContainer = $('#location-map');
    const map = mapContainer ? new HappyMap(mapContainer, coordinates => {
      $('#latitude').value = coordinates.latitude.toFixed(6);
      $('#longitude').value = coordinates.longitude.toFixed(6);
      if ($('#manual-latitude')) $('#manual-latitude').value = coordinates.latitude.toFixed(6);
      if ($('#manual-longitude')) $('#manual-longitude').value = coordinates.longitude.toFixed(6);
      const label = $('#location-label');
      if (label) label.textContent = `Localização selecionada: ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
      manualDraftInvalid = false;
      locationError('');
    }) : null;

    const setLocation = $('#set-location');
    for (const id of ['manual-latitude', 'manual-longitude']) {
      const coordinateInput = $(`#${id}`);
      if (coordinateInput) coordinateInput.addEventListener('input', () => {
        manualDraftInvalid = true;
        locationError('Clique em “Usar localização” para confirmar as coordenadas ou selecione um ponto no mapa.');
      });
    }
    if (setLocation) setLocation.addEventListener('click', () => {
      const latInput = $('#manual-latitude');
      const lngInput = $('#manual-longitude');
      const latitude = latInput && latInput.value.trim() ? Number(latInput.value) : NaN;
      const longitude = lngInput && lngInput.value.trim() ? Number(lngInput.value) : NaN;
      if (!validCoordinates(latitude, longitude)) {
        manualDraftInvalid = true;
        locationError('Informe uma latitude entre -90 e 90 e uma longitude entre -180 e 180.');
        if (latInput) latInput.focus();
        return;
      }
      if (map) map.select({ latitude, longitude }, true);
    });

    function validateLocation() {
      const latInput = $('#latitude');
      const lngInput = $('#longitude');
      const latitude = latInput && latInput.value.trim() ? Number(latInput.value) : NaN;
      const longitude = lngInput && lngInput.value.trim() ? Number(lngInput.value) : NaN;
      if (manualDraftInvalid || !validCoordinates(latitude, longitude)) {
        locationError(manualDraftInvalid
          ? 'Clique em “Usar localização” para confirmar as coordenadas ou selecione um ponto no mapa.'
          : 'Selecione a localização no mapa ou informe as coordenadas.');
        return false;
      }
      locationError('');
      return true;
    }

    function photoError(message) {
      setFieldError(photosInput, $('#photos-error'), message);
    }

    const addPhoto = previews ? $('.photos-add', previews) : null;
    if (addPhoto && photosInput) {
      addPhoto.tabIndex = 0;
      addPhoto.setAttribute('role', 'button');
      addPhoto.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!photosInput.disabled && !saving && !processing) photosInput.click();
      });
    }

    function addPreview(photo) {
      const figure = element('figure', 'photo-preview');
      const image = element('img');
      image.src = photo.previewUrl;
      image.alt = `Foto da instituição: ${photo.name}`;
      const remove = element('button', 'photo-remove btn btn-light btn-sm', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remover foto ${photo.name}`);
      remove.addEventListener('click', () => {
        if (saving || processing) return;
        const index = photos.indexOf(photo);
        if (index >= 0) photos.splice(index, 1);
        URL.revokeObjectURL(photo.previewUrl);
        figure.remove();
        photoError('');
        if (feedback) feedback.textContent = 'Foto removida.';
      });
      figure.append(image, remove);
      const addLabel = $('.photos-add', previews);
      previews.insertBefore(figure, addLabel);
      photo.figure = figure;
    }

    if (photosInput) photosInput.addEventListener('change', async () => {
      const files = [...photosInput.files];
      photosInput.value = '';
      if (!files.length || saving || processing) return;
      if (photos.length + files.length > MAX_PHOTOS) {
        photoError(`Adicione no máximo ${MAX_PHOTOS} fotos. Você pode incluir mais ${MAX_PHOTOS - photos.length}.`);
        return;
      }
      processing = true;
      photosInput.disabled = true;
      updateButton();
      photoError('');
      if (feedback) feedback.textContent = 'Preparando as fotos…';
      const errors = [];
      let added = 0;
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          errors.push(`${file.name}: use uma imagem JPG, PNG ou WebP.`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          errors.push(`${file.name}: o limite é de 5 MB por foto.`);
          continue;
        }
        try {
          const prepared = await processPhoto(file);
          const totalSize = photos.reduce((sum, photo) => sum + photo.dataUrl.length, 0) + prepared.dataUrl.length;
          if (totalSize > MAX_PHOTO_STORAGE) {
            errors.push('As fotos ficaram muito grandes. Escolha menos imagens ou fotos menores.');
            continue;
          }
          const photo = { dataUrl: prepared.dataUrl, name: prepared.name, previewUrl: URL.createObjectURL(prepared.blob) };
          photos.push(photo);
          addPreview(photo);
          added += 1;
        } catch (error) {
          errors.push(`${file.name}: ${error.message}`);
        }
      }
      processing = false;
      photosInput.disabled = false;
      updateButton();
      photoError(errors.join(' '));
      if (feedback) feedback.textContent = added ? `${added === 1 ? '1 foto adicionada.' : `${added} fotos adicionadas.`}` : '';
    });

    window.addEventListener('pagehide', event => {
      if (!event.persisted) for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (saving || processing) return;
      if (feedback) feedback.textContent = '';
      let firstInvalid = null;
      const locationValid = validateLocation();
      if (!locationValid) firstInvalid = mapContainer;
      for (const config of fields) {
        touched.add(config.id);
        if (!validateField(config) && !firstInvalid) firstInvalid = $(`#${config.id}`);
      }
      if (firstInvalid) {
        if (feedback) feedback.textContent = 'Revise os campos indicados antes de confirmar.';
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        return;
      }
      saving = true;
      updateButton();
      const id = window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      const record = {
        id,
        name: $('#name').value.trim(),
        about: $('#about').value.trim(),
        whatsapp: phoneNumber($('#whatsapp').value),
        instructions: $('#instructions').value.trim(),
        openingHours: $('#opening-hours').value.trim(),
        openOnWeekends: Boolean($('#open-on-weekends') && $('#open-on-weekends').checked),
        latitude: Number($('#latitude').value),
        longitude: Number($('#longitude').value),
        photos: photos.map(photo => photo.dataUrl),
        createdAt: new Date().toISOString()
      };
      try {
        saveRecord(record);
        const success = $('#success-panel');
        if ($('#success-name')) $('#success-name').textContent = record.name;
        if ($('#success-detail')) $('#success-detail').href = `orphanage.html?id=${encodeURIComponent(id)}`;
        if (success) {
          form.hidden = true;
          success.hidden = false;
          success.tabIndex = -1;
          success.focus();
          window.scrollTo({ top: 0, behavior: 'auto' });
        } else if (feedback) {
          feedback.textContent = 'Cadastro salvo com sucesso.';
        }
      } catch (error) {
        if (feedback) feedback.textContent = error.message;
      } finally {
        saving = false;
        updateButton();
      }
    });
  }

  function searchable(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  }

  function initializeDirectory() {
    const mapContainer = $('#directory-map');
    const map = mapContainer ? new HappyMap(mapContainer) : null;
    const list = $('#orphanage-list');
    const empty = $('#directory-empty');
    const count = $('#directory-count');
    const search = $('#directory-search');
    const feedback = $('#directory-feedback');
    let records = [];
    let storageFailed = false;

    function render() {
      const query = searchable(search ? search.value : '');
      const filtered = records.filter(record => searchable(`${record.name} ${record.about}`).includes(query));
      if (count) count.textContent = `(${filtered.length})`;
      if (empty) empty.hidden = storageFailed || records.length > 0;
      if (list) {
        list.replaceChildren();
        for (const record of filtered) {
          const link = element('a', 'orphanage-list-item list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3');
          link.href = `orphanage.html?id=${encodeURIComponent(record.id)}`;
          const text = element('span', 'orphanage-list-text');
          text.append(element('span', 'orphanage-list-title', record.name), element('span', 'orphanage-list-meta', record.openingHours));
          const arrow = element('span', 'orphanage-list-arrow', '→');
          arrow.setAttribute('aria-hidden', 'true');
          link.append(text, arrow);
          if (list.tagName === 'UL' || list.tagName === 'OL') {
            const item = element('li');
            item.appendChild(link);
            list.appendChild(item);
          } else list.appendChild(link);
        }
        if (!filtered.length && records.length) {
          list.appendChild(element(list.tagName === 'UL' || list.tagName === 'OL' ? 'li' : 'p', 'directory-no-results form-text', 'Nenhuma instituição encontrada para esta busca.'));
        }
      }
      if (map) map.setMarkers(filtered);
    }

    function load() {
      try {
        records = readRecords();
        storageFailed = false;
        if (feedback) feedback.textContent = '';
      } catch (error) {
        records = [];
        storageFailed = true;
        if (feedback) feedback.textContent = error.message;
      }
      render();
    }
    load();
    if (search) search.addEventListener('input', render);
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY || event.key === null) load();
    });

    const locate = $('#locate-button');
    if (locate) locate.addEventListener('click', () => {
      const hostname = window.location.hostname;
      const localhost = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]';
      if (window.location.protocol !== 'https:' && !localhost) {
        if (feedback) feedback.textContent = 'Para usar sua localização, abra o projeto pelo servidor local ou em uma conexão HTTPS.';
        return;
      }
      if (!navigator.geolocation) {
        if (feedback) feedback.textContent = 'Este navegador não oferece localização. Você pode explorar o mapa manualmente.';
        return;
      }
      locate.disabled = true;
      locate.setAttribute('aria-busy', 'true');
      if (feedback) feedback.textContent = 'Encontrando sua localização…';
      navigator.geolocation.getCurrentPosition(position => {
        if (map) map.setCenter(position.coords.latitude, position.coords.longitude, 15);
        if (feedback) feedback.textContent = 'Mapa centralizado na sua localização.';
        locate.disabled = false;
        locate.setAttribute('aria-busy', 'false');
      }, error => {
        if (feedback) feedback.textContent = error.code === 1
          ? 'O acesso à sua localização não foi permitido. Você pode explorar o mapa manualmente.'
          : 'Não foi possível encontrar sua localização. Tente novamente ou explore o mapa manualmente.';
        locate.disabled = false;
        locate.setAttribute('aria-busy', 'false');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
  }

  function initializeDetail() {
    const content = $('#detail-content');
    const missing = $('#detail-missing');
    const id = new URLSearchParams(window.location.search).get('id');
    let record;
    let message = '';
    try {
      record = id ? readRecords().find(item => item.id === id) : undefined;
    } catch (error) {
      message = error.message;
    }
    if (!record) {
      if (content) content.hidden = true;
      if (missing) {
        missing.hidden = false;
        if (message) {
          const text = $('[data-missing-message]', missing) || $('p', missing);
          if (text) text.textContent = message;
        }
      }
      return;
    }
    if (content) content.hidden = false;
    if (missing) missing.hidden = true;
    const values = {
      'detail-name': record.name,
      'detail-about': record.about,
      'detail-instructions': record.instructions,
      'detail-hours': record.openingHours,
      'detail-weekends': record.openOnWeekends ? 'Atendemos fim de semana' : 'Não atendemos fim de semana'
    };
    for (const [field, value] of Object.entries(values)) {
      const node = $(`#${field}`);
      if (node) node.textContent = value;
    }
    document.title = `${record.name} | Happy`;
    const weekend = $('#weekend-card');
    if (weekend) {
      weekend.classList.toggle('is-closed', !record.openOnWeekends);
      weekend.classList.toggle('is-open', record.openOnWeekends);
    }
    const photos = $('#detail-photos');
    if (photos) {
      photos.replaceChildren();
      if (!record.photos.length) {
        photos.appendChild(element('p', 'detail-no-photos', 'Esta instituição ainda não adicionou fotos.'));
      } else {
        const gallery = element('div', 'carousel slide');
        gallery.id = 'orphanage-gallery';
        gallery.setAttribute('role', 'region');
        gallery.setAttribute('aria-roledescription', 'carrossel');
        gallery.setAttribute('aria-label', `Fotos de ${record.name}`);
        gallery.dataset.bsInterval = 'false';
        const slides = element('div', 'carousel-inner');
        record.photos.forEach((source, index) => {
          const slide = element('div', `carousel-item${index === 0 ? ' active' : ''}`);
          slide.setAttribute('role', 'group');
          slide.setAttribute('aria-roledescription', 'slide');
          slide.setAttribute('aria-label', `${index + 1} de ${record.photos.length}`);
          const image = element('img', 'detail-photo-main d-block w-100');
          image.src = source;
          image.alt = `Foto ${index + 1} de ${record.name}`;
          slides.appendChild(slide);
          slide.appendChild(image);
        });
        gallery.appendChild(slides);
        photos.appendChild(gallery);
        if (record.photos.length > 1) {
          const thumbnails = element('div', 'detail-photo-thumbnails');
          thumbnails.setAttribute('aria-label', 'Fotos da instituição');
          let activeIndex = 0;
          let carousel = null;

          function syncThumbnails(index) {
            activeIndex = index;
            for (const [position, button] of [...thumbnails.children].entries()) {
              const active = position === index;
              button.classList.toggle('is-active', active);
              button.setAttribute('aria-pressed', String(active));
            }
          }

          function showFallbackPhoto(index) {
            const nextIndex = (index + record.photos.length) % record.photos.length;
            for (const [position, slide] of [...slides.children].entries()) {
              slide.classList.toggle('active', position === nextIndex);
            }
            syncThumbnails(nextIndex);
          }

          record.photos.forEach((source, index) => {
            const thumbnail = element('button', `detail-photo-thumb${index === 0 ? ' is-active' : ''}`);
            thumbnail.type = 'button';
            thumbnail.dataset.bsTarget = '#orphanage-gallery';
            thumbnail.dataset.bsSlideTo = String(index);
            thumbnail.setAttribute('aria-label', `Ver foto ${index + 1} de ${record.name}`);
            thumbnail.setAttribute('aria-pressed', String(index === 0));
            const image = element('img');
            image.src = source;
            image.alt = '';
            image.loading = 'lazy';
            thumbnail.appendChild(image);
            thumbnail.addEventListener('click', () => {
              if (!carousel) showFallbackPhoto(index);
            });
            thumbnails.appendChild(thumbnail);
          });

          for (const direction of ['prev', 'next']) {
            const control = element('button', `carousel-control-${direction}`);
            control.type = 'button';
            control.dataset.bsTarget = '#orphanage-gallery';
            control.dataset.bsSlide = direction;
            const icon = element('span', `carousel-control-${direction}-icon`);
            icon.setAttribute('aria-hidden', 'true');
            const label = element('span', 'visually-hidden', direction === 'prev' ? 'Foto anterior' : 'Próxima foto');
            control.append(icon, label);
            control.addEventListener('click', () => {
              if (!carousel) showFallbackPhoto(activeIndex + (direction === 'prev' ? -1 : 1));
            });
            gallery.appendChild(control);
          }
          photos.appendChild(thumbnails);

          gallery.addEventListener('slid.bs.carousel', event => syncThumbnails(event.to));
          if (window.bootstrap && window.bootstrap.Carousel) {
            carousel = window.bootstrap.Carousel.getOrCreateInstance(gallery, {
              interval: false,
              keyboard: true,
              touch: true,
              ride: false
            });
          }
          window.addEventListener('pagehide', event => {
            if (!event.persisted && carousel) carousel.dispose();
          });
        }
      }
    }
    const routes = $('#detail-routes');
    if (routes) {
      routes.href = `https://www.google.com/maps/dir/?api=1&destination=${record.latitude},${record.longitude}`;
      routes.target = '_blank';
      routes.rel = 'noopener noreferrer';
    }
    const whatsapp = $('#detail-whatsapp');
    if (whatsapp) {
      whatsapp.href = `https://wa.me/${phoneNumber(record.whatsapp)}?text=${encodeURIComponent(`Olá! Gostaria de saber mais sobre visitas à instituição ${record.name}.`)}`;
      whatsapp.target = '_blank';
      whatsapp.rel = 'noopener noreferrer';
    }
    const mapContainer = $('#detail-map');
    if (mapContainer) {
      const map = new HappyMap(mapContainer);
      map.setCenter(record.latitude, record.longitude, 15);
      map.setMarkers([{ latitude: record.latitude, longitude: record.longitude, label: record.name }]);
    }
  }

  function initialize() {
    const page = document.body.dataset.page;
    if (page === 'directory') initializeDirectory();
    else if (page === 'create') initializeForm();
    else if (page === 'detail') initializeDetail();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
