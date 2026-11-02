// Run: NODE_PATH=/path/to/node_modules node tests/browser.cjs
// Requires Playwright and Chrome. All images are generated; no patient data.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cpf-v041-'));
const url = pathToFileURL(path.resolve(__dirname, '../figure-builder.html')).href;
const checks=[];
function check(name,value){ assert.ok(value,name); checks.push(name); }
async function ready(page){ await page.waitForFunction(()=>typeof initializing!=='undefined'&&!initializing); }
async function saved(page){ await page.waitForFunction(()=>saveRevision===storedRevision&&saveRevision>0); }
async function download(page,selector,filename){
 const [d]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
 await d.saveAs(path.join(output,filename)); return path.join(output,filename);
}
function pngInfo(filename){
 const bytes=fs.readFileSync(filename),phys=[];
 assert.equal(bytes.subarray(1,4).toString(),'PNG');
 for(let at=8;at+12<=bytes.length;){
  const length=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8);
  if(kind==='pHYs') phys.push({x:bytes.readUInt32BE(at+8),y:bytes.readUInt32BE(at+12),unit:bytes[at+16]});
  at+=length+12;
 }
 return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),phys};
}
async function stageSize(page){
 const box=await page.locator('#stage').boundingBox();
 return {width:box.width,height:box.height};
}
(async()=>{
 const browser=await chromium.launch(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
  const page=await context.newPage(), errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(url);await ready(page);await page.locator('#preset').selectOption('g33');
  // Physical width and preview magnification are independent of export resolution.
  check('Preview starts at a fixed 100 percent',await page.locator('#previewZoom').inputValue()==='100');
  await page.locator('[data-mm="174"]').click();const doubleCol=await stageSize(page);
  await page.locator('[data-mm="85"]').click();const singleCol=await stageSize(page);
  check('Width buttons visibly resize the page in both dimensions',
   Math.abs(singleCol.width-doubleCol.width*85/174)<=1&&Math.abs(singleCol.height-doubleCol.height*85/174)<=1);
  check('100 percent preview uses 96 CSS pixels per inch',Math.abs(singleCol.width-85/25.4*96)<=1);
  check('Page size remains visible beside the preview',/85\D.*mm/i.test(await page.locator('#pageSize').textContent()));
  await page.locator('[data-dpi="1200"]').click();
  assert.deepEqual(await stageSize(page),singleCol);
  check('Changing DPI leaves the preview page size unchanged',true);
  await page.locator('#jpreset').selectOption('174,600');
  check('Double-column publisher preset updates width, DPI and preview',
   await page.locator('#wmm').inputValue()==='174'&&await page.locator('#dpi').inputValue()==='600'&&Math.abs((await stageSize(page)).width-doubleCol.width)<=1);
  await page.locator('#jpreset').selectOption('85,300');
  const singleExport=pngInfo(await download(page,'#expFull','width85-300dpi.png'));
  check('Single-column preset exports a 1004-pixel PNG with 300-dpi physical metadata',
   singleExport.width===1004&&singleExport.phys.length===1&&singleExport.phys[0].unit===1&&
   singleExport.phys[0].x===singleExport.phys[0].y&&Math.abs(singleExport.phys[0].x*.0254-300)<.02&&
   Math.abs(singleExport.width/singleExport.phys[0].x*1000-85)<.1);
  const narrowProject=await download(page,'#save','width85-project.json');
  await page.locator('#wmm').fill('120');
  check('Typing a custom physical width resizes the preview immediately',Math.abs((await stageSize(page)).width-120/25.4*96)<=1);
  const validSize=await stageSize(page);
  await page.locator('#wmm').fill('');
  assert.deepEqual(await stageSize(page),validSize);
  check('An unfinished width preserves the last valid preview and blocks export',await page.locator('#expFull').isDisabled());
  await page.locator('#wmm').fill('174');
  await page.locator('#pfile').setInputFiles(narrowProject);
  await page.waitForFunction(()=>document.getElementById('wmm').value==='85'&&!document.querySelector('.app').inert);
  check('Opening a project restores its physical width on screen',Math.abs((await stageSize(page)).width-singleCol.width)<=1);
  const beforePreview=await page.evaluate(()=>projectJSON());
  await page.locator('#previewZoom').selectOption('200');
  check('Preview magnification doubles screen size without changing project data',
   Math.abs((await stageSize(page)).width-singleCol.width*2)<=1&&await page.evaluate(()=>projectJSON())===beforePreview);
  check('The preview reports its current magnification',/200/.test(await page.locator('#previewInfo').textContent()));
  for(const [zoom,index] of [['200',8],['50',0]]){
   await page.locator('#previewZoom').selectOption(zoom);
   const pos=await page.evaluate(i=>({x:(cells[i].x+cells[i].w/2)*displayScale,y:(cells[i].y+cells[i].h/2)*displayScale}),index);
   await page.locator('#stage').click({position:pos});
   check(`Panel hit testing follows ${zoom} percent preview magnification`,await page.evaluate(i=>selCell===i,index));
  }
  await page.locator('#wmm').fill('500');await page.locator('#previewZoom').selectOption('200');
  check('Large previews scroll inside the workspace without stretching the page',await page.evaluate(()=>{
   const main=document.getElementById('main');
   return main.scrollWidth>main.clientWidth&&document.documentElement.scrollWidth<=innerWidth+1;
  }));
  check('The left edge of an oversized preview remains reachable',await page.evaluate(()=>{
   const main=document.getElementById('main');main.scrollLeft=0;
   return stage.getBoundingClientRect().left>=main.getBoundingClientRect().left;
  }));
  check('The right edge of an oversized preview remains reachable',await page.evaluate(()=>{
   const main=document.getElementById('main');main.scrollLeft=main.scrollWidth;
   return stage.getBoundingClientRect().right<=main.getBoundingClientRect().right+1;
  }));
  // Imported projects can legally have much taller rows than the grid editor creates.
  const ordinaryProject=await page.evaluate(()=>JSON.parse(projectJSON()));
  await page.locator('#previewZoom').selectOption('100');
  await page.evaluate(async original=>{
   const tall=structuredClone(original);
   tall.layoutName='custom';tall.customDef={rows:Array.from({length:10},()=>({rh:10,cells:Array(10).fill(1)}))};
   tall.cells=Array.from({length:100},()=>({...original.cells[0],arrows:[]}));
   await loadProject(tall);
  },ordinaryProject);
  const tallProject=await page.evaluate(()=>projectJSON());
  await page.locator('#previewZoom').selectOption('200');
  check('Very tall valid projects keep preview allocation within safe limits and render all 100 panels',await page.evaluate(()=>{
   if(cells.length!==100||stage.width<=0||stage.height<=0||stage.width>8192||stage.height>8192||stage.width*stage.height>16000000)return false;
   const g=stage.getContext('2d'),last=cells[99];
   return g.getImageData(0,0,1,1).data[3]===255&&
    g.getImageData(Math.floor((last.x+last.w/2)*displayScale),Math.floor((last.y+last.h/2)*displayScale),1,1).data[3]===255&&
    g.getImageData(stage.width-1,stage.height-1,1,1).data[3]===255;
  }));
  check('Limited previews report the actual magnification and requested zoom',
   /Limited to \d+(?:\.\d+)?% \(requested 200%\)/.test(await page.locator('#previewInfo').textContent()));
  check('Limiting preview allocation preserves the complete project',await page.evaluate(()=>projectJSON())===tallProject);
  await page.evaluate(async original=>loadProject(original),ordinaryProject);
  check('Normal projects return to the requested magnification after a limited preview',
   Math.abs((await stageSize(page)).width-500/25.4*96*2)<=1&&!/Limited/.test(await page.locator('#previewInfo').textContent()));
  await page.locator('#previewZoom').selectOption('fit');
  await page.waitForFunction(()=>{const main=document.getElementById('main'),r=stage.getBoundingClientRect();return r.width<=main.clientWidth&&r.height<=main.clientHeight;});
  const fitSize=await stageSize(page);
  await page.setViewportSize({width:1100,height:750});
  await page.waitForFunction(previous=>stage.getBoundingClientRect().width<previous,fitSize.width);
  check('Fit preview follows workspace size changes',await page.evaluate(()=>{
   const main=document.getElementById('main'),r=stage.getBoundingClientRect();return r.width<=main.clientWidth&&r.height<=main.clientHeight;
  }));
  await page.setViewportSize({width:1500,height:1000});
  await page.locator('[data-mm="174"]').click();await page.locator('[data-dpi="600"]').click();
  await page.waitForFunction(previous=>Math.abs(stage.getBoundingClientRect().width-previous)<=1,fitSize.width);
  const fixtures=await page.evaluate(()=>Array.from({length:9},(_,i)=>{
   const c=document.createElement('canvas');c.width=i===0?160:800;c.height=i===0?120:600;
   const g=c.getContext('2d');g.fillStyle=`hsl(${40*i},60%,30%)`;g.fillRect(0,0,c.width,c.height);
   g.strokeStyle='white';g.lineWidth=3;g.strokeRect(8,8,c.width-16,c.height-16);g.beginPath();g.arc(c.width/2,c.height/2,c.height/4,0,2*Math.PI);g.stroke();
   g.fillStyle='white';g.font=`${c.width/14}px sans-serif`;g.fillText('SOURCE '+(i+1),c.width/4,c.height/2);return c.toDataURL().split(',')[1];
  }));
  await page.locator('#file').setInputFiles(fixtures.map((v,i)=>({name:`synthetic-${i+1}.png`,mimeType:'image/png',buffer:Buffer.from(v,'base64')})));
  await page.waitForFunction(()=>images.length===9&&!document.querySelector('.app').inert);
  for(let i=0;i<9;i++){
   const pos=await page.evaluate(i=>({x:(cells[i].x+cells[i].w/2)*displayScale,y:(cells[i].y+cells[i].h/2)*displayScale}),i);
   await page.locator('#stage').click({position:pos});await page.locator('.thumb').nth(i).click();
  }
  await page.locator('#addArrow').click();await page.locator('#rotF').fill('33');await page.locator('#rotF').dispatchEvent('input');
  await page.locator('#zoom').fill('135');await page.locator('#zoom').dispatchEvent('input');
  await page.locator('#frShow').check();await page.locator('#grid').check();
  check('Low-resolution source produces a warning',await page.locator('#outInfo').evaluate(e=>e.classList.contains('warn')));
  const exportFile=await download(page,'#expFull','export600.png');
  check('Double-column 600-dpi export remains 4110 pixels wide',pngInfo(exportFile).width===4110);
  await page.locator('#previewZoom').selectOption('200');
  const zoomedExport=await download(page,'#expFull','export-preview200.png');
  check('Changing preview magnification leaves exported PNG bytes unchanged',fs.readFileSync(exportFile).equals(fs.readFileSync(zoomedExport)));
  await page.locator('#previewZoom').selectOption('fit');
  const projectFile=await download(page,'#save','project.json');
  const original=JSON.parse(fs.readFileSync(projectFile));
  check('All nine images placed',original.cells.filter(c=>c.imgId).length===9);
  check('PNG download has data',fs.statSync(exportFile).size>1000);
  await saved(page);await page.reload();await ready(page);await saved(page);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(projectJSON())),original);
  check('Autosave restores images and transforms',true);
  await page.locator('#previewZoom').selectOption('fit');
  page.once('dialog',d=>d.accept());await page.locator('#newp').click();
  await page.locator('#pfile').setInputFiles(projectFile);await page.waitForFunction(()=>images.length===9&&!document.querySelector('.app').inert);
  const again=await download(page,'#expFull','export-restored.png');
  check('Manual project round-trip reproduces PNG bytes',fs.readFileSync(exportFile).equals(fs.readFileSync(again)));
  check('Grid does not appear in exported image',await page.evaluate(()=>{const a=renderOffscreen(true).toDataURL();gridShow=false;const b=renderOffscreen(true).toDataURL();return a===b;}));
  check('pHYs replacement leaves one 600-dpi chunk',await page.evaluate(async()=>{
   const b=await new Promise(r=>renderOffscreen(true).toBlob(r));const bytes=withPhys(withPhys(new Uint8Array(await b.arrayBuffer()),96),600);
   let at=8,count=0,valid=true;const d=new DataView(bytes.buffer);
   while(at+12<=bytes.length){const n=d.getUint32(at),kind=String.fromCharCode(...bytes.slice(at+4,at+8));
    if(kind==='pHYs'){count++;valid&&=n===9&&d.getUint32(at+8)===23622&&d.getUint32(at+12)===23622&&bytes[at+16]===1&&d.getUint32(at+17)===crc32(bytes.slice(at+4,at+17));}at+=n+12;}
   return count===1&&valid;
  }));
  await page.locator('#wmm').fill('500');await page.locator('#dpi').fill('2400');
  check('Oversized export is blocked before allocation',await page.locator('#expFull').isDisabled());
  await page.locator('#wmm').fill('');check('Invalid numeric input is blocked',await page.locator('#expFull').isDisabled());
  await page.locator('#wmm').fill('-1');await saved(page);await page.reload();await ready(page);await saved(page);
  check('Unfinished invalid output settings never lose saved images',await page.evaluate(()=>images.length===9&&document.getElementById('wmm').value==='-1'&&document.getElementById('expFull').disabled));
  await page.locator('#wmm').fill('174');await page.locator('#dpi').fill('600');
  await page.locator('#previewZoom').selectOption('fit');
  await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb){cb(null);};});
  await page.locator('#expFull').click();await page.waitForFunction(()=>document.getElementById('actionStatus').textContent.startsWith('Export failed:'));
  check('Null encoder result reports a recoverable error',!(await page.locator('#expFull').isDisabled()));
  await page.evaluate(()=>HTMLCanvasElement.prototype.toBlob=window.originalToBlob);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=function(cb){window.releaseEncoder=()=>cb(null);};});
  await page.locator('#expFull').click();await page.locator('#dpi').fill('300');
  check('Changing settings during encoding cannot start another export',await page.locator('#expFull').isDisabled());
  await page.evaluate(()=>{window.releaseEncoder();HTMLCanvasElement.prototype.toBlob=window.originalToBlob;});
  await page.waitForFunction(()=>!exportBusy);await page.locator('#dpi').fill('600');
  check('Invalid project preserves current work',await page.evaluate(async()=>{const before=projectJSON(),bad=JSON.parse(before);bad.images[0].src='data:image/png;base64,broken';try{await loadProject(bad);return false;}catch(e){return before===projectJSON();}}));
  const lastPos=await page.evaluate(()=>({x:(cells[8].x+cells[8].w/2)*displayScale,y:(cells[8].y+cells[8].h/2)*displayScale}));
  await page.locator('#stage').click({position:lastPos});await page.locator('#addArrow').click();
  const firstPos=await page.evaluate(()=>{const b=stage.getBoundingClientRect();return {x:b.left+(cells[0].x+cells[0].w/2)*displayScale,y:b.top+(cells[0].y+cells[0].h/2)*displayScale};});
  await page.mouse.move(firstPos.x,firstPos.y);await page.mouse.wheel(0,-100);
  await page.waitForFunction(()=>selCell===0);
  check('Switching panels with the wheel clears stale arrow selection',await page.locator('#arrowW').isDisabled());
  await page.locator('#lblText').fill('x'.repeat(600));
  check('Label entry cannot exceed the project format limit',await page.locator('#lblText').inputValue().then(v=>v.length===500));
  await page.locator('#lblText').fill('');
  await page.evaluate(()=>{cells[selCell].arrows=Array.from({length:199},()=>({x1:.7,y1:.7,x2:.45,y2:.45,color:'#ff3b30',width:6}));sync();});
  await page.locator('#addArrow').click();
  check('Arrow insertion stops at the project format limit',await page.locator('#addArrow').isDisabled());
  await page.locator('#preset').selectOption('g24');
  check('Grid 2 x 4 is two rows and four columns',await page.evaluate(()=>new Set(cells.map(c=>c.y)).size===2&&new Set(cells.map(c=>c.x)).size===4));
  check('Old 2 x 4 projects preserve four-row geometry',await page.evaluate(async()=>{const o=JSON.parse(projectJSON());o.v=2;await loadProject(o);return layoutName==='custom'&&new Set(cells.map(c=>c.y)).size===4&&new Set(cells.map(c=>c.x)).size===2;}));
  const customAnswers=['3','10']; const customHandler=d=>d.accept(customAnswers.shift());page.on('dialog',customHandler);
  await page.locator('#preset').selectOption('custom');page.off('dialog',customHandler);
  check('Custom layouts retain labels after Z',await page.evaluate(()=>cells.length===30&&panelLetter(26)==='AA'&&panelLetter(29)==='AD'));
  const beforeInvalidCustom=await page.evaluate(()=>projectJSON());
  const invalidAnswers=['0','3'];const invalidHandler=d=>d.type()==='prompt'?d.accept(invalidAnswers.shift()):d.accept();page.on('dialog',invalidHandler);
  await page.locator('#preset').selectOption('custom');page.off('dialog',invalidHandler);
  check('Invalid custom dimensions preserve current layout',await page.evaluate(before=>projectJSON()===before,beforeInvalidCustom));
  check('All-hidden subset is rejected',await page.evaluate(()=>{cells.forEach(c=>c.page2=true);updateReadout();return document.getElementById('expQuiz').disabled;}));
  await saved(page);
  // Fresh context: a project larger than localStorage's former quota must survive reload.
  const largeContext=await browser.newContext({viewport:{width:1500,height:1000}}), large=await largeContext.newPage();
  await large.goto(url);await ready(large);
  const noise=await large.evaluate(()=>{const c=document.createElement('canvas');c.width=1400;c.height=1400;const g=c.getContext('2d'),d=g.createImageData(c.width,c.height);let seed=123;
   for(let i=0;i<d.data.length;i+=4){for(let j=0;j<3;j++){seed=(Math.imul(seed,1664525)+1013904223)|0;d.data[i+j]=seed>>>24;}d.data[i+3]=255;}g.putImageData(d,0,0);return c.toDataURL().split(',')[1];});
  await large.locator('#file').setInputFiles({name:'synthetic-large.png',mimeType:'image/png',buffer:Buffer.from(noise,'base64')});
  await large.waitForFunction(()=>images.length===1);await saved(large);
  check('Large project exceeds former 5 MiB quota',await large.evaluate(()=>projectJSON().length>5*1024*1024));
  await large.reload();await ready(large);await saved(large);
  check('Large-image autosave survives reload',await large.evaluate(()=>images.length===1&&images[0].w===1400));
  // Force transaction failure after a working session; users must see the failure.
  await large.evaluate(()=>{storeAccess=async()=>{throw new Error('test quota exceeded');};gutter=12;render();});
  await large.waitForFunction(()=>document.getElementById('saveStatus').classList.contains('warn'));
  check('Storage failure is visible and remains unsaved',await large.evaluate(()=>saveRevision>storedRevision));
  // Access-denied browser must still start and permit manual project saving.
  const deniedContext=await browser.newContext();await deniedContext.addInitScript(()=>{
   Object.defineProperty(window,'indexedDB',{get(){throw new Error('storage denied');}});
   Object.defineProperty(window,'localStorage',{get(){throw new Error('storage denied');}});
  });
  const denied=await deniedContext.newPage();await denied.goto(url);await ready(denied);
  check('Blocked storage does not prevent startup',await denied.locator('#stage').evaluate(c=>c.width>0));
  check('Blocked storage warns user',await denied.locator('#saveStatus').evaluate(e=>e.classList.contains('warn')));
  await download(denied,'#save','no-storage-project.json');
  check('Manual project download works without storage',fs.existsSync(path.join(output,'no-storage-project.json')));
  // Legacy localStorage migrates only after a committed IndexedDB write.
  const legacyContext=await browser.newContext();await legacyContext.addInitScript(data=>{localStorage.setItem('figure-builder-v2',JSON.stringify(data));}, {...original,v:2});
  const legacy=await legacyContext.newPage();await legacy.goto(url);await ready(legacy);await saved(legacy);
  check('Legacy browser autosave migrates without losing images',await legacy.evaluate(async()=>images.length===9&&localStorage.getItem('figure-builder-v2')===null&&JSON.parse(await storeAccess()).images.length===9));
  await page.evaluate(async data=>{await loadProject(data);document.getElementById('grid').checked=false;gridShow=false;drawScreen();},original);
  const recovered=await download(page,'#expFull','export-after-errors.png');
  check('Export recovers after rejected inputs and encoder errors',fs.readFileSync(exportFile).equals(fs.readFileSync(recovered)));
  await saved(page);
  await page.screenshot({path:path.join(output,'ui.png'),fullPage:true});
  check('No page JavaScript errors in tested workflow',errors.length===0);
  check('No page HTTP requests in tested offline workflow',requests.length===0);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({browser:await browser.version(),checks,errors,requests},null,2));
  console.log(JSON.stringify({passed:checks.length,output,checks},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
