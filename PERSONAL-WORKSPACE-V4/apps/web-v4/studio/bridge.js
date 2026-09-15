let studioTemplateVersion = 0;
let studioVersion = 0,
  studioFingerprint = '',
  studioKnown = [],
  studioSaving = null,
  studioReady = false;
const studioParameters = new URLSearchParams(location.search),
  studioProjectId = studioParameters.get('projectId');
const studioAllowed = ['luminaires', 'systems', 'accessories', 'output', 'datasheets'];
view = studioAllowed.includes(studioParameters.get('view'))
  ? studioParameters.get('view')
  : 'luminaires';
const studioApi = async (method, url, body) => {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error?.message || 'Studio request failed.');
  return result.data;
};
async function studioLoad() {
  $('#app').textContent = 'Loading Luminaire Studio…';
  try {
    const result = await studioApi('GET', `/api/projects/${studioProjectId}/luminaire-studio`);
    p = result.document;
    for (const key of ['columns', 'boqColumns', 'accessoryColumns'])
      p.output[key] = p.output[key].filter((column) => !['rate', 'amount'].includes(column.key));
    studioVersion = result.version;
    studioFingerprint = result.fingerprint;
    studioKnown = p.luminaires.map((r) => r.id);
    const sharedTemplates = await studioApi('GET', '/api/luminaire-studio/templates');
    studioTemplateVersion = sharedTemplates.version;
    templates = sharedTemplates.templates;
    studioReady = true;
    dirty = false;
    savedAt = 'Saved to project · Studio 1.4.1';
    render();
    parent.postMessage({ type: 'studio:ready' }, location.origin);
  } catch (error) {
    $('#app').textContent = error.message;
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = studioLoad;
    $('#app').append(retry);
  }
}
async function studioSave() {
  if (!studioReady) return;
  if (studioSaving) {
    await studioSaving;
    if (dirty) return studioSave();
    return;
  }
  if (!dirty) return;
  clearTimeout(saveTimer);
  const snapshot = C.clone(p),
    serial = JSON.stringify(p);
  savedAt = 'Saving to project…';
  updateStatus();
  studioSaving = (async () => {
    const result = await studioApi('PUT', `/api/projects/${studioProjectId}/luminaire-studio`, {
      expectedVersion: studioVersion,
      baseFingerprint: studioFingerprint,
      operationId: C.uid(),
      deletedLuminaireIds: studioKnown.filter(
        (id) => !snapshot.luminaires.some((r) => r.id === id),
      ),
      document: snapshot,
    });
    studioVersion = result.version;
    studioFingerprint = result.fingerprint;
    studioKnown = result.document.luminaires.map((r) => r.id);
    if (JSON.stringify(p) === serial) {
      p = result.document;
      dirty = false;
    } else {
      for (const before of snapshot.luminaires) {
        const after = result.document.luminaires.find(
          (r) => r.tag.trim().toUpperCase() === before.tag.trim().toUpperCase(),
        );
        const current = p.luminaires.find((r) => r.id === before.id);
        if (current && after) current.id = after.id;
      }
    }
    savedAt = 'Saved to project';
    updateStatus();
  })();
  try {
    await studioSaving;
  } catch (error) {
    savedAt = 'Not saved · ' + error.message;
    updateStatus();
    toast(savedAt);
    throw error;
  } finally {
    studioSaving = null;
  }
}
let studioExporting = false;
async function studioExport(format, selection, separate = false, composition) {
  if (studioExporting) {
    if (composition) throw Error('An export is already running. Wait for it to finish.');
    return;
  }
  studioExporting = true;
  try {
    await studioSave();
    if (dirty) throw Error('Finish saving your edits before generating outputs.');
    savedAt = 'Generating registered outputs…';
    updateStatus();
    const result = await studioApi(
      'POST',
      `/api/projects/${studioProjectId}/luminaire-studio/outputs`,
      {
        version: studioVersion,
        baseFingerprint: studioFingerprint,
        operationId: C.uid(),
        format,
        kind: composition?.kind || (selection ? 'datasheets' : p.output.kind),
        selection: selection || [],
        separate,
        ...(composition
          ? { targetRevisionId: composition.targetRevisionId }
          : new URLSearchParams(location.search).has('targetRevisionId')
            ? { targetRevisionId: new URLSearchParams(location.search).get('targetRevisionId') }
            : {}),
      },
    );
    savedAt = 'Saved in Revision ' + result.revisionSequence;
    updateStatus();
    if (separate) {
      const archive = new JSZip();
      for (const artifact of result.artifacts) {
        const response = await fetch(artifact.url);
        if (!response.ok) throw Error('A registered file could not be downloaded.');
        archive.file(artifact.name, await response.arrayBuffer());
      }
      download(
        await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
        'Datasheets_' + result.revisionSequence + '.zip',
        'application/zip',
      );
    } else if (!composition)
      for (const artifact of result.artifacts) {
        const link = document.createElement('a');
        link.href = artifact.url;
        link.download = artifact.name;
        document.body.append(link);
        link.click();
        link.remove();
      }
    toast('Outputs registered in Revision ' + result.revisionSequence + '.');
    return result;
  } catch (error) {
    toast(error.message);
    savedAt = 'Output not completed';
    updateStatus();
    if (composition) throw error;
  } finally {
    studioExporting = false;
  }
}
window.studioExport = studioExport;
window.studioGenerateRevision = (input) =>
  studioExport(
    input.format,
    input.kind === 'datasheets' ? input.selection : undefined,
    false,
    input,
  );
window.addEventListener('message', (event) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.type === 'studio:theme') {
    for (const [key, value] of Object.entries(message.tokens || {}))
      if (key.startsWith('--v4-') && typeof value === 'string')
        document.documentElement.style.setProperty(key, value);
    document.documentElement.dataset.theme = message.theme;
  }
});
// Keep the integrated project boundary explicit: no separate projects or local drafts.
document.addEventListener(
  'click',
  (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (['new', 'open', 'recent', 'demo', 'checks'].includes(action)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

window.studioFlush = studioSave;
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="save-library"]');
  if (!button) return;
  try {
    button.disabled = true;
    await studioSave();
    if (dirty) throw new Error('Save the luminaire before adding it to the Library.');
    parent.postMessage(
      { type: 'studio:save-library', luminaireId: button.dataset.id },
      location.origin,
    );
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
window.studioIsDirty = () => dirty;
window.addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.type !== 'studio:view'
  )
    return;
  if (studioAllowed.includes(event.data.view)) {
    view = event.data.view;
    if (event.data.kind && studioReady) p.output.kind = event.data.kind;
    if (studioReady) render();
  }
});

const studioPages = {};
let studioRequestedAnchor = null;
document.addEventListener(
  'click',
  (event) => {
    const summary = event.target.closest('summary');
    if (summary) studioRequestedAnchor = summary.parentElement;
  },
  true,
);
function studioPageItems(container, items, key, available) {
  container.querySelector(':scope > .studio-pagination')?.remove();
  if (!items.length) return;
  items.forEach((item) => (item.hidden = false));
  const pages = [[]];
  let height = 0;
  for (const item of items) {
    const style = getComputedStyle(item);
    const size =
      item.getBoundingClientRect().height +
      (parseFloat(style.marginTop) || 0) +
      (parseFloat(style.marginBottom) || 0);
    if (height + size > available && pages.at(-1).length) {
      pages.push([]);
      height = 0;
    }
    pages.at(-1).push(item);
    height += size;
  }
  const anchorPage = items.includes(studioRequestedAnchor)
    ? pages.findIndex((items) => items.includes(studioRequestedAnchor))
    : -1;
  const page = anchorPage >= 0 ? anchorPage : Math.min(studioPages[key] || 0, pages.length - 1);
  studioPages[key] = page;
  items.forEach((item) => (item.hidden = !pages[page].includes(item)));
  if (pages.length < 2) return;
  const nav = document.createElement('nav');
  nav.className = 'studio-pagination';
  const section = container.closest('details')?.querySelector('summary')?.textContent?.trim();
  const label = key.startsWith('datasheet-fields-')
    ? container.matches('.ds-ref-editor')
      ? 'Reference image fields'
      : 'Technical fields'
    : key.startsWith('datasheet-section-')
      ? section || 'Section items'
      : key === '.ds-tools'
        ? 'Datasheet sections'
        : key;
  nav.setAttribute('aria-label', label + ' pages');
  const caption = document.createElement('span');
  caption.className = 'studio-pagination__label';
  caption.textContent = label + ' · Page ' + (page + 1) + ' of ' + pages.length;
  nav.append(caption);
  pages.forEach((_, index) => {
    const button = document.createElement('button');
    button.textContent = String(index + 1);
    button.setAttribute('aria-label', label + ' page ' + (index + 1));
    if (index === page) button.setAttribute('aria-current', 'page');
    button.onclick = () => {
      studioPages[key] = index;
      studioPaginate();
    };
    nav.append(button);
  });
  container.append(nav);
}
function studioPaginate() {
  document.body.classList.toggle('datasheet-mode', view === 'datasheets');
  const frame = document.querySelector('#dsPreview');
  if (frame && !frame.dataset.fitted) {
    frame.dataset.fitted = 'true';
    frame.addEventListener('load', () => studioFitDatasheet(frame));
  }
  if (frame?.contentDocument?.querySelector('.ds-page')) studioFitDatasheet(frame);

  const table = document.querySelector('.tablewrap');
  if (table)
    studioPageItems(
      table,
      [...table.querySelectorAll('tbody > tr')],
      view,
      Math.max(85, innerHeight - table.getBoundingClientRect().top - 112),
    );
  // Specification controls use their existing collapsible sections in one scroll area.
  // Document-page navigation remains separate from the editing controls.
  studioRequestedAnchor = null;
}
let studioResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(studioResizeTimer);
  studioResizeTimer = setTimeout(studioPaginate, 100);
});
document.addEventListener('toggle', () => requestAnimationFrame(studioPaginate), true);

window.studioReload = studioLoad;

let studioLinkedId;
window.addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.type !== 'studio:view' ||
    !event.data.luminaireId ||
    !studioReady ||
    studioLinkedId === event.data.luminaireId
  )
    return;
  studioLinkedId = event.data.luminaireId;
  const linked = p.luminaires.find((row) => row.id === studioLinkedId);
  if (!linked) {
    toast('The linked luminaire is not available in this project.');
    return;
  }
  view = 'luminaires';
  search = linked.tag;
  render();
  openEditor('luminaires', linked.id);
});

let studioOrigin;
document.addEventListener(
  'click',
  (event) => {
    const target = event.target.closest('button');
    if (target) studioOrigin = target.getBoundingClientRect();
  },
  true,
);
const studioShowDialog = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  studioShowDialog.call(this);
  const rect = this.getBoundingClientRect();
  if (studioOrigin)
    this.style.transformOrigin = `${studioOrigin.x + studioOrigin.width / 2 - rect.x}px ${studioOrigin.y + studioOrigin.height / 2 - rect.y}px`;
};
const studioCloseDialog = HTMLDialogElement.prototype.close;
HTMLDialogElement.prototype.close = function (value) {
  if (!this.open || matchMedia('(prefers-reduced-motion: reduce)').matches)
    return studioCloseDialog.call(this, value);
  this.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'perspective(1200px) rotateX(-8deg) translateY(12px)' },
    ],
    { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' },
  ).finished.then(() => {
    studioCloseDialog.call(this, value);
    this.getAnimations().forEach((animation) => animation.cancel());
  });
};

window.studioStoreTemplates = async (next) => {
  const result = await studioApi('PUT', '/api/luminaire-studio/templates', {
    version: studioTemplateVersion,
    templates: next,
  });
  studioTemplateVersion = result.version;
  templates = result.templates;
};
window.studioChooseReferenceImage = async (luminaireId) => {
  const dialog = document.createElement('dialog');
  dialog.className = 'studio-reference-picker';
  dialog.setAttribute('aria-label', 'Reference image from Datasheet');
  dialog.innerHTML = `<form method="dialog"><header><h2>Reference image from Datasheet</h2><button value="cancel" aria-label="Close image picker">×</button></header></form><p>Select an embedded image, or crop the PDF page to capture a beam diagram or polar graph.</p><div class="actions"><label>PDF page <input name="page" type="number" min="1" max="200" value="1"></label><button type="button" data-read>Read page</button></div><p role="status"></p><div class="studio-reference-picker__images"></div><div class="studio-reference-picker__crop"><label>Left %<input name="left" type="number" min="0" max="99" value="0"></label><label>Top %<input name="top" type="number" min="0" max="99" value="0"></label><label>Width %<input name="width" type="number" min="1" max="100" value="100"></label><label>Height %<input name="height" type="number" min="1" max="100" value="100"></label></div><canvas aria-label="Selected reference image preview"></canvas><footer><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-use disabled>Use reference image</button></footer>`;
  document.body.append(dialog);
  const status = dialog.querySelector('[role="status"]');
  const canvas = dialog.querySelector('canvas');
  const use = dialog.querySelector('[data-use]');
  let source = null;
  let loading = false;
  const crop = () => {
    if (!source) return;
    const number = (name) => Number(dialog.querySelector(`[name="${name}"]`).value);
    const x = Math.max(0, Math.min(99, number('left'))) / 100;
    const y = Math.max(0, Math.min(99, number('top'))) / 100;
    const w = Math.max(0.01, Math.min(1 - x, number('width') / 100));
    const h = Math.max(0.01, Math.min(1 - y, number('height') / 100));
    canvas.width = Math.max(1, Math.round(source.naturalWidth * w));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * h));
    canvas
      .getContext('2d')
      .drawImage(
        source,
        source.naturalWidth * x,
        source.naturalHeight * y,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    use.disabled = loading;
  };
  const read = async () => {
    if (loading) return;
    loading = true;
    use.disabled = true;
    source = null;
    const list = dialog.querySelector('.studio-reference-picker__images');
    list.replaceChildren();
    status.textContent = 'Reading the attached Datasheet…';
    try {
      const page = Number(dialog.querySelector('[name="page"]').value);
      if (!Number.isInteger(page) || page < 1 || page > 200)
        throw Error('Choose a PDF page from 1 to 200.');
      const base = `/api/projects/${studioProjectId}/luminaires/${encodeURIComponent(luminaireId)}`;
      const [images, full] = await Promise.all([
        studioApi('GET', `${base}/datasheet-images?pageNumber=${page}`),
        studioApi('GET', `${base}/datasheet-page?pageNumber=${page}`),
      ]);
      if (images.sourceAssetVersionId !== full.sourceAssetVersionId)
        throw Error('The Datasheet changed. Read the page again.');
      for (const [index, item] of [...images.images, full].entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(
          'aria-label',
          index === images.images.length ? 'Crop PDF page' : `Choose image ${index + 1}`,
        );
        const img = new Image();
        img.src = `data:image/png;base64,${item.pngBase64}`;
        img.alt = button.getAttribute('aria-label');
        button.append(img);
        list.append(button);
        button.onclick = async () => {
          await img.decode();
          source = img;
          for (const [name, value] of Object.entries({ left: 0, top: 0, width: 100, height: 100 }))
            dialog.querySelector(`[name="${name}"]`).value = String(value);
          for (const other of list.children)
            other.setAttribute('aria-pressed', String(other === button));
          crop();
        };
      }
      status.textContent =
        'Choose an image or the PDF page. Adjust the crop percentages if needed.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      loading = false;
    }
  };
  dialog.querySelector('[data-read]').onclick = read;
  dialog.querySelector('[name="page"]').oninput = () => {
    dialog.querySelector('.studio-reference-picker__images').replaceChildren();
    source = null;
    use.disabled = true;
  };
  for (const input of dialog.querySelectorAll('.studio-reference-picker__crop input'))
    input.oninput = crop;
  dialog.showModal();
  void read();
  return new Promise((resolve) => {
    let result = null;
    use.onclick = () => {
      if (!source || loading) return;
      result = canvas.toDataURL('image/png');
      dialog.close();
    };
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        resolve(result);
      },
      { once: true },
    );
  });
};

function studioFitDatasheet(frame) {
  const doc = frame.contentDocument;
  const pages = [...(doc?.querySelectorAll('.ds-page') || [])];
  if (!pages.length) return;
  const index = Math.min(Number(frame.dataset.page || 0), pages.length - 1);
  pages.forEach((page, i) => (page.style.display = i === index ? '' : 'none'));
  const page = pages[index];
  let nav = frame.parentElement.querySelector('.studio-preview-pages');
  if (!nav) {
    nav = document.createElement('div');
    nav.className = 'studio-preview-pages actions';
    frame.before(nav);
  }
  nav.replaceChildren();
  for (const [label, next] of [
    ['Previous page', index - 1],
    ['Next page', index + 1],
  ]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.type = 'button';
    button.disabled = next < 0 || next >= pages.length;
    button.onclick = () => {
      frame.dataset.page = String(next);
      studioFitDatasheet(frame);
    };
    nav.append(button);
  }
  const count = document.createElement('span');
  count.textContent = `${index + 1} / ${pages.length}`;
  nav.append(count);
  doc.documentElement.style.overflow = 'hidden';
  doc.body.style.minHeight = '0';
  doc.body.style.height = 'auto';
  doc.body.style.zoom = '1';
  doc.body.style.zoom = String(
    Math.min(
      (frame.clientWidth - 32) / (page.offsetWidth + 24),
      (frame.clientHeight - 32) / (page.offsetHeight + 24),
    ),
  );
}
