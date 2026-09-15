import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Adapt the exact owner-supplied UI at build time; keep the reference source immutable. */
export function studioIntegration(root: string): Plugin {
  const files = new Map<string, string | Buffer>();
  const source = path.join(root, 'tools/luminaire-studio-v1.4.1');
  const walk = (directory: string, prefix = '') => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}${item.name}`;
      if (item.isDirectory()) walk(path.join(directory, item.name), `${relative}/`);
      else if (/\.(js|css|woff2?|ttf)$/i.test(item.name))
        files.set(relative, readFileSync(path.join(directory, item.name)));
    }
  };
  walk(source);
  for (const weight of [400, 500, 600])
    files.set(
      `fonts/Inter-${weight}.ttf`,
      readFileSync(
        path.join(root, `apps/web-v4/src/components/final-ui/fonts/Inter-${weight}.ttf`),
      ),
    );
  files.set(
    'core.js',
    files
      .get('core.js')!
      .toString()
      .replaceAll("['rate','Unit rate','number',12],['amount','Amount','number',14]", ''),
  );
  let app = files.get('app.js')!.toString();
  app = app.replace(
    'actions=`<div class="actions">',
    "actions=`<div class=\"actions\">${kind==='luminaires'?btn('save-library','','folder','icon',`title=\"Add to Library\" aria-label=\"Add to Library\" data-id=\"${h(r.id)}\"`):''}",
  );
  const replaceLine = (start: string, replacement: string) => {
    const lines = app.split(/\r?\n/);
    const index = lines.findIndex((line) => line.startsWith(start));
    if (index < 0) throw new Error(`Studio 1.4.1 integration anchor missing: ${start}`);
    lines[index] = replacement;
    app = lines.join('\n');
  };
  replaceLine('async function initDB()', 'async function initDB(){await studioLoad();}');
  replaceLine(
    'async function cache()',
    'async function cache(){return studioSave().catch(()=>undefined);}',
  );
  replaceLine('function saveProject()', 'function saveProject(){void studioSave();}');
  replaceLine('let templates=[];', "let templates=[];let templateId='';");
  replaceLine(
    'function storeTemplates(',
    `async function storeTemplates(next){return window.studioStoreTemplates(next);}`,
  );
  app = app
    .replace(
      /storeTemplates\(\[\.\.\.templates,item\]\)/g,
      'await storeTemplates([...templates,item])',
    )
    .replace(
      'storeTemplates(templates.filter(x=>x.id!==t.id))',
      'await storeTemplates(templates.filter(x=>x.id!==t.id))',
    );
  app = app.replace(
    'LSDatasheetUI.bind({get:()=>p,mark,render,toast,download,filename});render();initDB();',
    readFileSync(path.join(root, 'apps/web-v4/studio/bridge.js'), 'utf8') +
      '\n' +
      readFileSync(path.join(root, 'apps/web-v4/studio/systems.js'), 'utf8') +
      '\n' +
      readFileSync(path.join(root, 'apps/web-v4/studio/output-controls.js'), 'utf8') +
      '\nLSDatasheetUI.bind({get:()=>p,mark,render,toast,download,filename});initDB();',
  );
  app = app.replace('<small>Scheduled power</small>', '<small>Project luminaire power</small>');
  app = app.replaceAll("+input('rate','Unit rate — optional',r.rate,'number',p.meta.currency)", '');
  app = app.replace(
    "combo('mounting','Mounting',['Recessed','Surface','Suspended'],r.mounting)",
    "combo('mounting','Mounting',['Recessed','Surface','Suspended','Track mounted','Wall mounted','In-ground','Pole mounted'],r.mounting)",
  );
  app = app.replace(
    "else if(a==='nav'){view=b.dataset.view;search='';scope='All';render();}",
    "else if(a==='nav'){parent.postMessage({type:'studio:navigate',view:b.dataset.view},location.origin);}",
  );
  app = app.replace(
    "if(a==='preview-prev'",
    "if(['new','open','recent','demo','checks'].includes(a))return; if(a==='xlsx'||a==='print'){await studioExport(a==='xlsx'?'XLSX':'PDF');return;} if(a==='preview-prev'",
  );
  app = app.replace(
    "if(view==='datasheets')LSDatasheetUI.preview();}",
    "if(view==='datasheets')LSDatasheetUI.preview();queueMicrotask(studioPaginate);}",
  );
  app = app.replace(
    '${h(p.meta.name)}<small id="savestatus">',
    'Luminaire Studio - 1.4.1<small id="savestatus">',
  );
  app = app.replace(
    "${btn('recent','Projects','folder')}",
    "${btn('library-tools','Library tools','folder')}",
  );
  app = app.replace(
    "if(a==='preview-prev'",
    "if(a==='library-tools'){parent.postMessage({type:'studio:library-tools'},location.origin);return;}if(a==='preview-prev'",
  );
  app = app.replace(
    'PDF uses your browser’s print dialog — choose “Save as PDF” and enable “Background graphics” to retain grey fills.',
    'PDF and Excel exports are saved in this project’s Revision history.',
  );
  app = app
    .replace(/\bconfirm\(/g, 'await parent.sctDecisions.confirm(')
    .replace(/\bprompt\(/g, 'await parent.sctDecisions.prompt(');
  files.set('app.js', app);
  let datasheets = files.get('datasheet-ui.js')!.toString();
  datasheets = datasheets.replaceAll('<h1>Datasheets</h1>', '<h1>Luminaire Specifications</h1>');
  datasheets = datasheets.replace(
    "if(a==='print'){const win=",
    "if(window.studioExport){await window.studioExport(a==='print'?'PDF':'XLSX',selection,a==='separate');return;}if(a==='print'){const win=",
  );
  datasheets = datasheets.replaceAll(
    "${button('upload','Upload / replace',`data-slot=\"${i}\"`)}",
    "${button('upload','Upload / replace',`data-slot=\"${i}\"`)}${button('from-datasheet','From Datasheet',`data-slot=\"${i}\"`)}",
  );
  datasheets = datasheets.replace(
    "if(a==='upload'){",
    "if(a==='from-datasheet'){const image=await window.studioChooseReferenceImage(r.id);if(!image)return;s.refs[+b.dataset.slot].data=image;}else if(a==='upload'){",
  );
  datasheets = datasheets.replace(/\bconfirm\(/g, 'await parent.sctDecisions.confirm(');
  datasheets = datasheets.replace(
    /<p class="hint" dir="rtl">[^<]*<\/p>/,
    '<p class="hint">These specifications use the same Project luminaire record. Empty values remain blank in exported documents.</p>',
  );
  files.set('datasheet-ui.js', datasheets);
  files.set(
    'interactions.css',
    readFileSync(path.join(root, 'apps/web-v4/src/styles/v4-interactions.css')),
  );
  files.set('workspace.css', readFileSync(path.join(root, 'apps/web-v4/studio/workspace.css')));
  files.set(
    'index.html',
    readFileSync(path.join(source, 'START.html'), 'utf8').replace(
      '</head>',
      '<link rel="stylesheet" href="workspace.css"><link rel="stylesheet" href="interactions.css"></head>',
    ),
  );
  return {
    name: 'scli-luminaire-studio-1.4.1',
    generateBundle() {
      for (const [name, value] of files)
        this.emitFile({ type: 'asset', fileName: `studio/${name}`, source: value });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const marker = '/studio/';
        if (!pathname.includes(marker)) return next();
        const name = pathname.slice(pathname.indexOf(marker) + marker.length);
        const value = files.get(name);
        if (!value) return next();
        response.setHeader(
          'Content-Type',
          name.endsWith('.js')
            ? 'text/javascript'
            : name.endsWith('.css')
              ? 'text/css'
              : name.endsWith('.html')
                ? 'text/html'
                : 'application/octet-stream',
        );
        response.end(value);
      });
    },
  };
}
