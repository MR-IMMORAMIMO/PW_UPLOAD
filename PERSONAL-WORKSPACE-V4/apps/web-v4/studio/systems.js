// Extend the integrated register while preserving the supplied Studio renderer and records.
let studioSelectedSystem = null;
let studioSelectedAccessory = null;
window.addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.type !== 'studio:icons'
  )
    return;
  let changed = false;
  for (const [key, value] of Object.entries(event.data.icons || {}))
    if (typeof value === 'string' && Object.hasOwn(paths, key) && paths[key] !== value) {
      paths[key] = value;
      changed = true;
    }
  if (changed && studioReady) render();
});
const studioOriginalRow = rowHTML;
rowHTML = function (kind, record) {
  let html = studioOriginalRow(kind, record);
  if (!['systems', 'accessories'].includes(kind)) return html;
  const label = kind === 'systems' ? record.code : record.ref;
  html = html.replace(
    '<tr>',
    `<tr data-studio-record="${h(record.id)}" data-studio-kind="${kind}">`,
  );
  html = html.replace(
    `<td class="tag">${h(label)}</td>`,
    `<td class="tag"><button class="studio-record-link" data-action="inspect-record" data-kind="${kind}" data-id="${h(record.id)}">${h(label)}</button></td>`,
  );
  if (kind === 'accessories' && (record.quantity === '' || record.quantity == null))
    html = html.replace(
      `<td>${h(C.formatValue(record, 'quantity', record.quantity))}</td><td>`,
      '<td>Not specified</td><td>',
    );
  return html;
};
const studioOriginalRender = render;
render = function () {
  studioOriginalRender();
  studioRegisterInspector();
};
function studioRegisterInspector() {
  if (!['systems', 'accessories'].includes(view)) return;
  const id = view === 'systems' ? studioSelectedSystem : studioSelectedAccessory;
  const record = p[view].find((item) => item.id === id);
  if (!record) return;
  const content = document.querySelector('.content');
  const panel = content.querySelector(':scope > .panel');
  if (!panel) return;
  const layout = document.createElement('div');
  layout.className = 'studio-register-layout';
  panel.before(layout);
  layout.append(panel);
  const aside = document.createElement('aside');
  aside.className = 'studio-register-inspector panel';
  aside.setAttribute('aria-label', view === 'systems' ? 'System details' : 'Accessory details');
  const system =
    view === 'systems' ? record : p.systems.find((item) => item.id === record.systemId);
  const field = (label, value) =>
    `<div><dt>${h(label)}</dt><dd>${h(value ?? '') || '—'}</dd></div>`;
  const linked =
    view === 'systems'
      ? [
          ...p.luminaires.map((item) => ({ ...item, kind: 'luminaires' })),
          ...p.accessories.map((item) => ({ ...item, kind: 'accessories' })),
        ].filter((item) => item.systemId === id)
      : [];
  aside.innerHTML = `<header><h2>${h(record.code || record.ref)}</h2>${btn('close-inspector', '', 'close', 'icon', 'aria-label="Close details"')}</header><div class="studio-register-inspector__body">
    ${record.image ? `<img class="studio-accessory-image" src="${h(record.image)}" alt="${h(record.ref)} product">` : ''}
    <dl>${field('Type', view === 'systems' ? record.type : record.component)}${field('Manufacturer', record.manufacturer)}${field('Location', [system?.floor, system?.area].filter(Boolean).join(' · '))}${view === 'systems' ? field('Family', record.family) + field('Voltage', record.voltage) + field('Mounting', record.mounting) : field('System', system?.code) + field('Ordering code', record.orderCode) + field('Description', record.description) + field('Quantity', record.quantity === '' || record.quantity == null ? 'Not specified' : C.formatValue(record, 'quantity', record.quantity)) + field('Dimensions', record.size) + field('Supply scope', record.supply)}</dl>
    ${view === 'systems' ? `<section><h3>Linked records (${linked.length})</h3>${linked.map((item) => `<button class="studio-linked-record" data-action="edit" data-kind="${item.kind}" data-id="${h(item.id)}">${h(item.tag || item.ref)} · ${h(item.description || item.component || item.type)}</button>`).join('') || '<p>No linked records.</p>'}${btn('manage-system-links', 'Manage links', 'grid', '', `data-id="${h(id)}"`)}</section>` : ''}
    ${record.attachment ? `<section class="studio-pdf"><h3>Datasheet</h3>${btn('download-pdf', h(record.attachment.name), 'file', '', `data-kind="accessories" data-id="${h(id)}"`)}</section>` : ''}
    ${record.datasheet ? field('Datasheet reference', record.datasheet) : ''}<section><h3>Notes</h3><p>${h(record.notes || 'No notes.')}</p></section></div><footer>${btn('edit', 'Edit', 'edit', '', `data-kind="${view}" data-id="${h(id)}"`)}</footer>`;
  layout.append(aside);
  aside.style.maxHeight =
    Math.max(280, innerHeight - aside.getBoundingClientRect().top - 16) + 'px';
}
function studioManageLinks(systemId) {
  const dialog = document.createElement('dialog');
  dialog.className = 'studio-links-editor';
  dialog.setAttribute('aria-label', 'Manage system links');
  const candidates = [
    ...p.luminaires.map((item) => ({ ...item, kind: 'luminaires' })),
    ...p.accessories.map((item) => ({ ...item, kind: 'accessories' })),
  ];
  dialog.innerHTML = `<form><header><h2>Manage system links</h2></header><div class="body"><p>Select the records assigned to this system. Existing assignments are shown.</p>${candidates.map((item) => `<label class="checklabel"><input type="checkbox" name="${h(item.id)}" data-kind="${item.kind}" ${item.systemId === systemId ? 'checked' : ''}><span>${h(item.tag || item.ref)}${item.systemId && item.systemId !== systemId ? ' · ' + h(p.systems.find((s) => s.id === item.systemId)?.code || 'Other system') : ''}</span></label>`).join('') || '<p>No records available.</p>'}<p role="alert"></p></div><footer class="formfoot"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Save links</button></footer></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const button = dialog.querySelector('[type="submit"]');
    button.disabled = true;
    for (const input of dialog.querySelectorAll('input[type="checkbox"]')) {
      const item = p[input.dataset.kind].find((row) => row.id === input.name);
      if (item && input.checked) item.systemId = systemId;
      else if (item?.systemId === systemId) item.systemId = '';
    }
    mark();
    try {
      await studioSave();
      dialog.close();
      render();
    } catch (error) {
      dialog.querySelector('[role="alert"]').textContent = error.message;
      button.disabled = false;
    }
  };
}
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (action?.dataset.action === 'close-inspector') {
    studioSelectedSystem = null;
    studioSelectedAccessory = null;
    render();
    return;
  }
  if (action?.dataset.action === 'manage-system-links') {
    studioManageLinks(action.dataset.id);
    return;
  }
  const row = event.target.closest('[data-studio-record]');
  if (!row || (action && action.dataset.action !== 'inspect-record')) return;
  if (row.dataset.studioKind === 'systems') studioSelectedSystem = row.dataset.studioRecord;
  else studioSelectedAccessory = row.dataset.studioRecord;
  render();
});
const studioOriginalEdit = openEditor;
openEditor = function (...args) {
  studioOriginalEdit(...args);
  const form = document.querySelector('#recordForm');
  for (const select of form.querySelectorAll('select'))
    select.setAttribute('aria-label', select.closest('label').querySelector('span').textContent);
  for (const input of form.querySelectorAll(
    'input[type="file"][name="photo"],input[type="file"][name="pdf"]',
  )) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Browse';
    button.setAttribute(
      'aria-label',
      input.name === 'pdf' ? 'Browse Datasheet PDF' : 'Browse product image',
    );
    const filename = document.createElement('span');
    filename.className = 'hint';
    filename.textContent = 'No new file selected';
    input.hidden = true;
    input.after(button, filename);
    if (input.name === 'pdf') button.className = 'studio-pdf';
    button.onclick = async () => {
      if (!parent.scliDesktop?.selectStudioAsset) {
        input.click();
        return;
      }
      button.disabled = true;
      try {
        const selected = await parent.scliDesktop.selectStudioAsset(
          input.name === 'pdf' ? 'Datasheet' : 'ProductImage',
        );
        if (!selected) return;
        const bytes = Uint8Array.from(atob(selected.base64), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], selected.fileName, { type: selected.mime }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
    input.onchange = () => {
      filename.textContent = input.files[0]?.name || 'No new file selected';
    };
  }
  const identity = form.elements.code || form.elements.ref || form.elements.tag;
  if (identity) {
    identity.required = true;
    identity.closest('label').querySelector('span').textContent += ' *';
  }
};
