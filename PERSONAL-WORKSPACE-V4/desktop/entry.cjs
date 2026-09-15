// Rendering runs in its own Electron process, without opening the workspace or its database.
const path = require('node:path');
if (process.argv[1] === '--sct-studio-render') {
  require(path.join(process.resourcesPath, 'studio', 'render-luminaire-studio.cjs'));
} else {
  require('./main.cjs');
}
