const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
fs.mkdirSync('dist',{recursive:true});
const read=p=>fs.readFileSync(p,'utf8');
const config=JSON.parse(read('app/config.json'));
const core=read('app/js/core.js').replace(/export /g,'');
const erp=read('app/js/erp.js').replace(/^import .*;\n/,'').replace(/export /g,'');
let app=read('app/js/app.js').replace(/^import .*;\n/gm,'').replace(/const config = await fetch[^\n]*;/,`const config = ${JSON.stringify(config)};`);
function makeHtml({preview}) {
  let html=read('app/widget.html').replace('<link rel="stylesheet" href="css/style.css">',`<style>${read('app/css/style.css')}</style>`).replace('<script type="module" src="js/app.js"></script>','');
  if (preview) html=html.replace(/<script src="https:\/\/static\.zohocdn\.com[^>]*><\/script>/,'');
  html=html.replace('src="img/logo.svg"',`src="data:image/svg+xml;base64,${Buffer.from(read('app/img/logo.svg')).toString('base64')}"`);
  return html.replace('</body>',`${preview ? `<script>${read('preview/mock-sdk.js')}</script>` : ''}<script type="module">${core}\n${erp}\n${app}</script></body>`);
}
fs.writeFileSync('dist/InvoicePreview.html',makeHtml({preview:true}));
fs.writeFileSync('dist/index.html',makeHtml({preview:false}));
// ZET packages only app/ + manifest; preview fixtures stay outside the deployable app.
execFileSync(path.resolve('node_modules/.bin/zet'),['validate'],{stdio:'inherit'});
execFileSync(path.resolve('node_modules/.bin/zet'),['pack'],{stdio:'inherit'});
const toolkitZip=fs.readdirSync('dist').find(n=>n.endsWith('.zip')&&n!=='RajadhaniInvoice.zip'&&n!=='RajadhaniInvoiceSource.zip');
if(toolkitZip)fs.renameSync(path.join('dist',toolkitZip),'dist/RajadhaniInvoice.zip');
console.log('Built dist/RajadhaniInvoice.zip, dist/InvoicePreview.html and dist/index.html');
