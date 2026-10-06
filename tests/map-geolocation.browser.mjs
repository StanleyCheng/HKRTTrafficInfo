// With a dev server running: node tests/map-geolocation.browser.mjs [baseURL] [evidenceDir]
// Requires Playwright and a browser installed outside this project's dependencies.
// PLAYWRIGHT_MODULE accepts a package name or file URL to its index.mjs.
// PLAYWRIGHT_CHANNEL selects an installed browser (default chrome); set it to an
// empty string to use Playwright's bundled Chromium. GPS_TEST_FILTER limits cases.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || process.env.GPS_TEST_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || process.env.GPS_TEST_OUTPUT || '.impeccable/review');
const filter = process.env.GPS_TEST_FILTER ? new RegExp(process.env.GPS_TEST_FILTER) : null;
const copy = {
 tc:{name:'顯示我的位置',pending:'正在取得位置…',centre:'顯示全港交通'},
 en:{name:'Show my location',pending:'Finding your location…',centre:'Show all Hong Kong traffic'},
};
const results = [];
(async () => {
 const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',headless:true});
 const contexts = [];
 async function create({language='en',viewport={width:1440,height:1000},reducedMotion='no-preference',unsupported=false,native=false,throws=false,tileFailure=false}={}) {
  const context = await browser.newContext({viewport,reducedMotion,...(native?{permissions:['geolocation'],geolocation:{latitude:22.2819,longitude:114.1585,accuracy:20}}:{})});
  contexts.push(context);
  if(tileFailure) await context.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await context.addInitScript(({language,unsupported,native,throws}) => {
   localStorage.setItem('hk-traffic-language-v1',language === 'tc' ? 'zh' : language);
   localStorage.setItem('hk-traffic-basemap-v1','osm');
   window.__gpsRequests=[]; window.__throwNext=throws;
   window.__setViews=[];
   window.__errors=[];
   window.addEventListener('error',e=>window.__errors.push(e.message));
   if (unsupported) Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});
   else if (!native) Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    getCurrentPosition(success,error,options) {window.__gpsRequests.push({success,error,options}); if(window.__throwNext){window.__throwNext=false;throw new Error('Geolocation service failed');}},
   }});
   let leaflet;
   Object.defineProperty(window,'L',{configurable:true,get(){return leaflet},set(value){
    leaflet=value;
    if(value.__gpsInstrumented)return;
    value.__gpsInstrumented=true;
    value.Map.addInitHook(function(){window.__map=this;});
    const original=value.Map.prototype.setView;
    value.Map.prototype.setView=function(coords,zoom,options){
     window.__setViews.push({coords:Array.isArray(coords)?coords:[coords.lat,coords.lng],zoom,options});
     return original.call(this,coords,zoom,options);
    };
   }});
  },{language,unsupported,native,throws});
  const page = await context.newPage();
  await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('.leaflet-container').waitFor({timeout:60000});
  await page.waitForFunction(()=>window.__map?._loaded,{timeout:30000});
  const gps=page.getByRole('button',{name:copy[language].name,exact:true});
  await gps.waitFor({timeout:10000});
  await page.waitForFunction(name=>!document.querySelector(`button[aria-label="${name}"]`)?.disabled,copy[language].name);
  return {page,gps,context,language};
 }
 async function success(page,index=0,{latitude=22.2819,longitude=114.1585,accuracy=25}={}){
  await page.evaluate(({index,latitude,longitude,accuracy})=>window.__gpsRequests[index].success({coords:{latitude,longitude,accuracy,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()}),{index,latitude,longitude,accuracy});
  await page.waitForFunction(()=>window.__map.getZoom()>=16);
 }
 async function failure(page,code,index=0){
  await page.evaluate(({code,index})=>window.__gpsRequests[index].error({code,message:'Simulated hardware error',PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3}),{code,index});
  await page.locator('.location-error[role="alert"]').waitFor();
 }
 async function test(name,fn){
  if(filter && !filter.test(name)) return;
  try{await fn();results.push({name,ok:true});console.log('PASS '+name);}
  catch(error){results.push({name,ok:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}
 }
 await fs.mkdir(evidence,{recursive:true});
 try {
  for(const language of ['en','tc']){
   await test(language+': placement, no automatic request, pending lock, success, accuracy and retry',async()=>{
    const {page,gps}=await create({language});
    assert.equal(await page.evaluate(()=>window.__gpsRequests.length),0,'Mount must not request location');
    assert.equal(await gps.getAttribute('title'),copy[language].name);
    assert.equal(await gps.evaluate(el=>el.previousElementSibling?.getAttribute('aria-label')),await page.locator('.map-tools > button').first().getAttribute('aria-label'));
    const box=await gps.boundingBox();
    const centre=await page.locator('.map-tools > button').first().boundingBox();
    assert.equal(box.x,centre.x,'GPS must align with centre button');
    assert.ok(box.y>=centre.y+centre.height,'GPS must be below centre button');
    assert.ok(box.width>=44&&box.height>=44,'GPS minimum44px target');
    await gps.focus();await page.keyboard.press('Enter');
    const pending=page.getByRole('button',{name:copy[language].pending,exact:true});
    assert.equal(await pending.isDisabled(),true);
    assert.equal(await pending.getAttribute('title'),copy[language].pending);
    const options=await page.evaluate(()=>window.__gpsRequests[0].options);
    assert.deepEqual(options,{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
    await pending.evaluate(el=>{el.click();el.click()});
    assert.equal(await page.evaluate(()=>window.__gpsRequests.length),1,'Repeat clicks while pending must not add requests');
    await success(page);
    await page.waitForFunction(()=>Math.abs(window.__map.getCenter().lat-22.2819)<0.00001&&Math.abs(window.__map.getCenter().lng-114.1585)<0.00001);
    assert.equal(await gps.isDisabled(),false);
    assert.equal(await page.locator('.user-location-dot').count(),1,'One location dot must display');
    assert.equal(await page.locator('.user-location-accuracy').count(),1,'One accuracy circle must display');
    const radius=await page.evaluate(()=>{let radius;window.__map.eachLayer(layer=>{if(layer.options?.className==='user-location-accuracy')radius=layer.getRadius()});return radius});
    assert.equal(radius,25,'Accuracy radius must use geolocation metres');
    assert.equal(await page.evaluate(()=>window.__map.getZoom()),16,'City zoom must become street zoom');
    await page.evaluate(()=>window.__map.setZoom(18,{animate:false}));
    await gps.click();await success(page,1,{latitude:22.2824,longitude:114.1592,accuracy:12});
    assert.equal(await page.evaluate(()=>window.__map.getZoom()),18,'Location must preserve closer zoom');
    assert.equal(await page.locator('.user-location-dot').count(),1,'Refreshing must replace old dot');
    assert.equal(await page.locator('.user-location-accuracy').count(),1,'Refreshing must replace old accuracy circle');
    assert.deepEqual(await page.evaluate(()=>window.__errors),[],'No browser runtime errors');
    await page.context().close();
   });
   for(const [code,label] of [[1,'permission denied'],[2,'position unavailable'],[3,'timeout']]){
    await test(language+': '+label+' recovery and successful retry',async()=>{
     const {page,gps}=await create({language});
     await gps.click();await failure(page,code);
     const alert=await page.locator('.location-error[role="alert"]').innerText();
     assert.ok(alert.trim().length>15,'Failure must explain recovery');
     assert.ok(language==='tc'?/[\u3400-\u9fff]/.test(alert):/location|permission|allow|try|timed/i.test(alert),'Failure must be localized');
     assert.equal(await gps.isDisabled(),false,'Error must unlock control');
     await gps.click();await success(page,1);
     assert.equal(await page.locator('.location-error[role="alert"]').count(),0,'Successful retry must clear alert');
     assert.equal(await page.locator('.user-location-dot').count(),1);
     console.log('  '+alert.replace(/\n/g,' '));
     await page.context().close();
    });
   }
   await test(language+': unsupported browser offers recovery',async()=>{
    const {page,gps}=await create({language,unsupported:true});
    await gps.click();await page.locator('.location-error[role="alert"]').waitFor();
    const alert=await page.locator('.location-error[role="alert"]').innerText();
    assert.ok(alert.trim().length>15);
    assert.ok(language==='tc'?/[\u3400-\u9fff]/.test(alert):/browser|support/i.test(alert));
    assert.equal(await gps.isDisabled(),false);
    console.log('  '+alert.replace(/\n/g,' '));
    await page.context().close();
   });
  }
  await test('Synchronous geolocation exception explains unavailable state and allows retry',async()=>{
   const {page,gps}=await create({throws:true});
   await gps.click();await page.locator('.location-error[role="alert"]').waitFor();
   assert.match(await page.locator('.location-error[role="alert"]').innerText(),/location is unavailable.*location services/i);
   assert.equal(await gps.isDisabled(),false);
   await gps.click();await success(page,1);
   assert.equal(await page.locator('.location-error[role="alert"]').count(),0);
   assert.equal(await page.locator('.user-location-dot').count(),1);
   assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
   await page.context().close();
  });
  await test('Pending request and failure follow a language change immediately',async()=>{
   const {page,gps}=await create();
   await gps.click();await page.getByRole('button',{name:'Chinese',exact:true}).click();
   const pending=page.getByRole('button',{name:copy.tc.pending,exact:true});
   await pending.waitFor();assert.equal(await pending.isDisabled(),true);
   assert.equal(await page.locator('.map-area [role="status"]').innerText(),copy.tc.pending);
   await failure(page,1);
   assert.match(await page.locator('.location-error[role="alert"]').innerText(),/未獲准使用你的位置/);
   await page.getByRole('button',{name:'關閉定位提示',exact:true}).click();
   assert.equal(await page.locator('.location-error[role="alert"]').count(),0);
   await page.context().close();
  });
  await test('Failed retry removes an earlier location fix instead of displaying stale GPS',async()=>{
   const {page,gps}=await create();
   await gps.click();await success(page);
   assert.equal(await page.locator('.user-location-dot').count(),1);
   await gps.click();await failure(page,2,1);
   assert.equal(await page.locator('.user-location-dot').count(),0,'Failed retry must remove stale location dot');
   assert.equal(await page.locator('.user-location-accuracy').count(),0,'Failed retry must remove stale accuracy circle');
   await page.context().close();
  });
  await test('Location dot stays above a colocated traffic marker',async()=>{
   const {page,gps}=await create();
   await gps.click();await success(page);
   await page.evaluate(()=>window.__collisionMarker=window.L.marker([22.2819,114.1585],{
    icon:window.L.divIcon({className:'camera-marker gps-test-collision',html:'<div class="marker-inner" style="--marker-color:#ec6a36"><svg viewBox="0 0 24 24"><path d="M3 21 12 3l9 18z"/></svg></div>',iconSize:[30,30],iconAnchor:[15,15]}),
   }).addTo(window.__map));
   const dotPane=await page.locator('.user-location-dot').evaluate(el=>Number(getComputedStyle(el.closest('.leaflet-pane')).zIndex));
   const trafficPane=await page.locator('.gps-test-collision').evaluate(el=>Number(getComputedStyle(el.closest('.leaflet-pane')).zIndex));
   await page.screenshot({path:path.join(evidence,'gps-marker-collision.png'),fullPage:true});
   assert.ok(dotPane>trafficPane,`GPS dot pane ${dotPane} must be above traffic marker pane ${trafficPane}`);
   await page.context().close();
  });
  await test('Narrow mobile simultaneous basemap and location alerts stack without overlap',async()=>{
   const {page,gps}=await create({viewport:{width:320,height:568},tileFailure:true});
   await page.locator('.map-error[role="alert"]').waitFor();
   await gps.click();await failure(page,2);
   const alerts=page.locator('.map-area [role="alert"]');
   assert.equal(await alerts.count(),2);
   const boxes=await alerts.evaluateAll(elements=>elements.map(el=>{const {x,y,width,height}=el.getBoundingClientRect();return {x,y,width,height}}));
   await page.screenshot({path:path.join(evidence,'gps-simultaneous-alerts.png'),fullPage:true});
   const [a,b]=boxes;
   const overlap=a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
   assert.equal(overlap,false,`Basemap and location alerts overlap: ${JSON.stringify(boxes)}`);
   for(const box of boxes)assert.ok(box.x>=0&&box.x+box.width<=320,'Alerts must fit mobile width');
   await page.context().close();
  });
  await test('Reduced motion disables location map animation',async()=>{
   const {page,gps}=await create({reducedMotion:'reduce'});
   await gps.click();await success(page);
   const locationView=await page.evaluate(()=>window.__setViews.find(v=>v.coords[0]===22.2819&&v.coords[1]===114.1585));
   assert.equal(locationView.options.animate,false);
   assert.equal(await page.evaluate(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches),true);
   await page.context().close();
  });
  await test('Native Chromium geolocation grant centers map and creates location dot',async()=>{
   const {page,gps}=await create({native:true});
   await gps.click();
   await page.locator('.user-location-dot').waitFor();
   const center=await page.evaluate(()=>({lat:window.__map.getCenter().lat,lng:window.__map.getCenter().lng,zoom:window.__map.getZoom()}));
   assert.ok(Math.abs(center.lat-22.2819)<0.00001&&Math.abs(center.lng-114.1585)<0.00001);
   assert.ok(center.zoom>=16);
   await page.context().close();
  });
  for(const [label,viewport,language] of [['desktop',{width:1440,height:1000},'en'],['mobile',{width:390,height:844},'tc'],['narrow-mobile',{width:320,height:568},'en'],['mobile-landscape',{width:844,height:390},'en']]){
   await test(label+': visible GPS target, centre alignment and no horizontal overflow',async()=>{
    const {page,gps}=await create({viewport,language});
    const gpsbox=await gps.boundingBox();
    const centrebox=await page.locator('.map-tools > button').first().boundingBox();
    assert.equal(gpsbox.x,centrebox.x);
    assert.ok(gpsbox.y>=centrebox.y+centrebox.height);
    assert.ok(gpsbox.x>=0&&gpsbox.y>=0&&gpsbox.x+gpsbox.width<=viewport.width&&gpsbox.y+gpsbox.height<=viewport.height,'GPS must fit viewport');
    assert.ok(await gps.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),'GPS must not be covered by overlays');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No document horizontal overflow');
    await gps.focus();
    const focus=await gps.evaluate(el=>({outline:getComputedStyle(el).outlineWidth,style:getComputedStyle(el).outlineStyle}));
    assert.ok(parseFloat(focus.outline)>0&&focus.style!=='none','Keyboard focus must be visible');
    if(label==='desktop'||label==='mobile'){
     await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].some(tile=>tile.complete&&tile.naturalWidth>0),{timeout:30000}).catch(()=>{});
     await page.screenshot({path:path.join(evidence,label+'.png'),fullPage:true});
    }
    await page.context().close();
   });
  }
 } finally {
  await Promise.all(contexts.map(c=>c.close().catch(()=>{})));
  await browser.close();
  await fs.writeFile(path.join(evidence,'gps-browser-results.json'),JSON.stringify({origin,results},null,2));
 }
 if(results.some(r=>!r.ok))process.exitCode=1;
 console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));
})().catch(e=>{console.error(e);process.exitCode=1});




