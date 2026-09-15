const studioSectionOpen = new Map();
const studioRenderBeforeSections = render;
render = function () {
  studioRenderBeforeSections();
  if (view !== 'output') return;
  const settings = document.querySelector('.settings');
  if (!settings) return;
  let section = null;
  for (const node of [...settings.children]) {
    if (node.tagName === 'H2') {
      section = document.createElement('details');
      section.className = 'studio-output-section';
      const title = node.textContent;
      section.open = studioSectionOpen.get(title) ?? true;
      const summary = document.createElement('summary');
      summary.textContent = title;
      section.append(summary);
      node.before(section);
      node.remove();
      section.addEventListener('toggle', () => studioSectionOpen.set(title, section.open));
    } else if (section) section.append(node);
  }
  const font = settings.querySelector('[data-setting="fontFamily"]');
  if (font) {
    font.setAttribute('aria-label', 'Table font');
    font.setAttribute('list', 'studio-font-choices');
    const list = document.createElement('datalist');
    list.id = 'studio-font-choices';
    const preview = document.createElement('div');
    preview.className = 'studio-font-preview';
    preview.setAttribute('aria-label', 'Font choices with preview');
    for (const name of ['Roboto', 'Montserrat', 'Arial', 'Georgia', 'Times New Roman']) {
      const option = document.createElement('option');
      option.value = name;
      list.append(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.style.fontFamily = name;
      // Keep the input from committing and replacing the clicked button on blur.
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.onclick = () => {
        font.value = name;
        font.dispatchEvent(new Event('input', { bubbles: true }));
        font.dispatchEvent(new Event('change', { bubbles: true }));
      };
      preview.append(button);
    }
    const status = document.createElement('p');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    const update = () => {
      const name = font.value.trim();
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('2d'),
        sample = 'Wide technical text 01357';
      const width = (family) => {
        context.font = `16px ${family}`;
        return context.measureText(sample).width;
      };
      const quoted = JSON.stringify(name);
      const available =
        ['Roboto', 'Montserrat'].includes(name) ||
        ['monospace', 'serif', 'sans-serif'].some(
          (family) => width(`${quoted},${family}`) !== width(family),
        );
      status.textContent = ['Roboto', 'Montserrat'].includes(name)
        ? 'Bundled for offline preview and PDF. Excel uses the installed font.'
        : available
          ? 'System font available for this preview. PDF and Excel use fonts available on the export device.'
          : 'This font is unavailable here; the preview uses a fallback. Install it for matching PDF and Excel output.';
    };
    font.after(list, preview, status);
    font.addEventListener('input', update);
    update();
  }
};
