// PLAYWRIGHT_MODULE points to an existing Playwright runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openLayers, closeControls, toggleMapDisplay } from './browser-controls.mjs';
import { commuterCatalogue } from '../lib/commuter-catalogue.ts';
import { metresBetween } from '../lib/nearest.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = process.argv[3] || '/tmp/hkrt-commuter-browser';
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const contexts = [];
const selection = { operator: 'kmb', company: 'KMB', route: '1', bound: 'O', serviceType: '1', stopId: 'FIX', stopSeq: 1 };
async function create(width, language, mode = '2d', route = false, nearbyOverlay = false) {
 const context = await browser.newContext({ viewport: { width, height: width > 700 ? 1000 : 844 }, hasTouch: width < 700, reducedMotion: 'reduce' }); contexts.push(context);
 const errors = [], calls = { route: 0, arrivals: 0, bus: 0 };
 await context.addInitScript(({language,mode,route,selection,nearbyOverlay}) => {
  if (!localStorage.getItem('fixture-setup')) {
   localStorage.setItem('fixture-setup', 'yes');
   localStorage.setItem('hk-traffic-language-v1', language);
   localStorage.setItem('hk-traffic-basemap-v1', 'osm');
   localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ tram:true, access:!nearbyOverlay, taxi:!nearbyOverlay, 'mtr-bus':!nearbyOverlay, kmb:route }));
   localStorage.setItem('hk-traffic-session-v1', JSON.stringify({version:1,view:{lng:114.16,lat:22.282,zoom:16},mapMode:mode,camera3D:{pitch:35,bearing:42},followLocation:false,openControl:route?null:'nearby',showBusStops:true,routeLabels:true,busSelection:route?selection:null}));
  }
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(){return 0},clearWatch(){}}});
  let leaflet; Object.defineProperty(window,'L',{configurable:true,get(){return leaflet},set(value){leaflet=value;value.Map.addInitHook(function(){window.__map=this})}});
 },{language,mode,route,selection,nearbyOverlay});
 await context.route('**/app/traffic-map-3d.tsx*',async route=>{const response=await route.fetch();const source=await response.text();await route.fulfill({response,body:source.replace('map.current = m;','map.current = m; window.__nativeMap = m;')})});
 await context.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:pixel}));
 await context.route(url=>url.hostname.endsWith('.gov.hk'),route=>route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'Unrelated fixture'}));
 await context.route('**/api/**', route=>{
  const url=new URL(route.request().url()), kind=url.pathname.split('/').at(-1), at=Date.now(), observedAt=new Date(at).toISOString();
  const base={ok:true,observedAt,fetchedAt:observedAt,complete:true,stale:false};
  if(kind==='mtr-bus') {calls.bus++; const camera=commuterCatalogue('mtr-bus').find(c=>c.sourceId==='K12-U010');return route.fulfill({json:{...base,cameras:[{...camera,dataUpdated:observedAt,arrivals:[{route:'K12',destination:'八號花園',destinationEn:'Eightland Garden',eta:new Date(at+120000).toISOString(),minutes:2,scheduled:false}]}]}})}
  if(kind==='pedestrian')return route.fulfill({json:{...base,cameras:[],paths:[{id:'fixture-walk',color:'#137f87',points:[[22.282,114.16],[22.283,114.161]]}]}});
  if(kind==='bus-route'&&url.searchParams.get('stopArrivals')==='1'){calls.arrivals++;return route.fulfill({json:{...base,arrivals:[{route:'1',destination:'終點',destinationEn:'Generation '+calls.arrivals,eta:new Date(at+120000).toISOString(),minutes:2,scheduled:false}]}})}
  if(kind==='bus-route'){calls.route++;return route.fulfill({json:{...base,route:{key:'fixture-route',operator:'kmb',company:'KMB',route:'1',geometry:'road',coordinates:[[114.160,22.282],[114.165,22.288]],stops:[{id:'FIX',seq:1,nameTc:'起點',nameEn:'Origin',lng:114.160,lat:22.282,distance:0},{id:'END',seq:2,nameTc:'終點',nameEn:'Terminus',lng:114.165,lat:22.288,distance:900}]},vehicles:[],reverse:[]}})}
  return route.fulfill({json:{...base,boards:[],trains:[],stops:[],vessels:[],piers:[],warnings:[]}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__map?._loaded || window.__nativeMap?.getLayer('hk-3d-buildings'));
 return {context,page,calls,errors};
}
async function step(page,ms){for(let elapsed=0;elapsed<ms;elapsed+=5000)await page.clock.runFor(Math.min(5000,ms-elapsed));await page.waitForTimeout(150)}
try {
 for(const [width,language] of [[1440,'en'],[390,'zh']]) {
  const f=await create(width,language),{page}=f;
  await page.locator('.nearby-popover').waitFor();
  await page.locator('.nearby-tram .nearby-place').first().waitFor();
  await page.locator('.nearby-access .nearby-place').first().waitFor();
  await page.locator('.nearby-taxi .nearby-place').first().waitFor();
  const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth,panel:document.querySelector('.nearby-popover').getBoundingClientRect().right>innerWidth||document.querySelector('.nearby-popover').getBoundingClientRect().left<0}));assert.deepEqual(overflow,{document:false,panel:false});
  await page.locator('.nearby-radius select').selectOption('2000');
  await page.screenshot({path:`${evidence}/nearby-${width}.png`});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.nearby-popover').waitFor();assert.equal(await page.locator('.nearby-radius select').inputValue(),'2000');
  await page.locator('.nearby-popover .close-button').click();
  await page.evaluate(()=>window.__map.setView([22.4444,114.1695],16,{animate:false}));
  await page.locator('.nearby-toggle').click();
  await page.locator('.nearby-bus .nearby-place').filter({hasText:'K12'}).first().waitFor();
  assert.match(await page.locator('.nearby-bus').innerText(),/2/);
  await page.locator('.nearby-bus .nearby-place').filter({hasText:'K12'}).first().click();
  await page.locator('.item-popup .arrival-board').waitFor();
  assert.match(await page.locator('.item-popup').innerText(),/K12/);
  assert.deepEqual(f.errors,[]);
  console.log(`PASS ${width}px ${language}: four layers, Nearby, current departures, radius and panel restoration`);
 }
 for(const mode of ['2d','3d']) for(const [width,language] of [[1440,'en'],[390,'zh']]) {
  const f=await create(width,language,mode,false,true),{page}=f;
  const toggle=page.getByRole('switch',{name:language==='en'?'Show nearby on map':'在地圖顯示附近交通'});
  const centre={lng:114.16,lat:22.282};
  const taxis=commuterCatalogue('taxi').map(camera=>({camera,distance:metresBetween(camera,centre)}));
  const close=taxis.find(place=>place.distance<500).camera;
  const middle=taxis.find(place=>place.distance>500&&place.distance<1000).camera;
  const outer=taxis.find(place=>place.distance>1000&&place.distance<2000).camera;
  const marker=camera=>page.locator(`.camera-marker[data-marker-id="${camera.id}"]`);
  await page.locator('.nearby-taxi .nearby-place').first().waitFor();
  await page.locator('.nearby-rail .nearby-place').first().waitFor();
  const layers=await page.evaluate(()=>localStorage.getItem('hk-traffic-layers-v1'));
  const list=await page.locator('.nearby-taxi').innerText();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal(await marker(close).count(),0);
  await toggle.click();await marker(close).waitFor({state:'attached'});await marker(middle).waitFor({state:'attached'});
  assert.equal(await marker(outer).count(),0,'Outside the current radius');
  assert.equal(await page.locator('.nearby-taxi').innerText(),list,'Switch leaves the list intact');
  const tramIds=await page.locator('.camera-marker[data-marker-id^="tram-"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.markerId));
  assert.ok(tramIds.length>0);assert.equal(new Set(tramIds).size,tramIds.length,'Normal layer and Nearby markers are deduplicated');
  await page.locator('.nearby-radius select').selectOption('500');await marker(middle).waitFor({state:'detached'});assert.equal(await marker(close).count(),1);
  await page.locator('.nearby-radius select').selectOption('2000');await marker(outer).waitFor({state:'attached'});
  await toggle.click();await marker(close).waitFor({state:'detached'});
  assert.ok(await page.locator('.camera-marker[data-marker-id^="tram-"]').count()>0,'The independently selected layer remains');
  await toggle.click();await marker(close).waitFor({state:'attached'});
  const box=await toggle.boundingBox();assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=width);
  await page.screenshot({path:`${evidence}/nearby-map-toggle-${mode}-${width}.png`});
  await page.locator('.nearby-popover .close-button').click();
  const before=f.calls.bus;await step(page,65000);assert.ok(f.calls.bus>before,'Overlay feeds keep refreshing after closing the panel');
  assert.equal(await marker(close).count(),1);
  await page.reload({waitUntil:'domcontentloaded'});await marker(close).waitFor({state:'attached'});
  assert.equal(await page.locator('.nearby-popover').count(),0,'Closed panel stays closed on reopening');
  await page.locator('.nearby-toggle').click();
  assert.equal(await toggle.getAttribute('aria-checked'),'true');assert.equal(await page.locator('.nearby-radius select').inputValue(),'2000');
  assert.equal(await page.evaluate(()=>localStorage.getItem('hk-traffic-layers-v1')),layers,'Nearby never changes normal layer choices');
  assert.deepEqual(f.errors,[]);
  console.log(`PASS ${width}px ${language} ${mode}: nearby overlay, radius, independent layers, deduplication, closed-panel polling and persistence`);
 }
 for(const width of [1440,390]) {
 const f=await create(width,'en','3d',true),{page}=f;
 await page.locator('.native-marker[data-marker-id="route-stop:fixture-route:2"]').waitFor();
 const initial=await page.evaluate(()=>({zoom:window.__nativeMap.getZoom(),pitch:window.__nativeMap.getPitch(),bearing:window.__nativeMap.getBearing()}));assert.deepEqual(initial,{zoom:15,pitch:35,bearing:42});
 await page.locator('.native-marker[data-marker-id="route-stop:fixture-route:2"]').click();
 await page.locator('.native-item-popup .arrival-board').waitFor();
 const before=f.calls.arrivals;await step(page,65000);assert.ok(f.calls.arrivals>=before+2,'Open 3D stop popup polls independently');
 const popupCalls=f.calls.arrivals;await page.reload({waitUntil:'domcontentloaded'});await page.locator('.native-item-popup .arrival-board').waitFor();assert.ok(f.calls.arrivals>popupCalls,'Reopening restores the route-stop detail and requests current arrivals');
 await page.locator('.native-item-popup .maplibregl-popup-close-button').click();
 await toggleMapDisplay(page,'stops');await toggleMapDisplay(page,'labels');
 await page.evaluate(()=>window.__nativeMap.jumpTo({center:[114.18,22.30],zoom:14.25,pitch:48,bearing:-12}));
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hk-traffic-session-v1')).view?.zoom===15.25);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__nativeMap?.getLayer('hk-3d-buildings'));
 for(let i=0;f.calls.route<2&&i<80;i++)await page.waitForTimeout(100);assert.ok(f.calls.route>=2);
 const restored=await page.evaluate(()=>({lng:window.__nativeMap.getCenter().lng,lat:window.__nativeMap.getCenter().lat,zoom:window.__nativeMap.getZoom(),pitch:window.__nativeMap.getPitch(),bearing:window.__nativeMap.getBearing()}));
 assert.ok(Math.abs(restored.lng-114.18)<.00001&&Math.abs(restored.lat-22.30)<.00001);assert.equal(restored.zoom,14.25);assert.equal(restored.pitch,48);assert.equal(restored.bearing,-12);
 await openLayers(page);assert.equal(await page.getByRole('switch',{name:'Bus stops',exact:true}).isChecked(),false);assert.equal(await page.getByRole('switch',{name:'Route stop labels',exact:true}).isChecked(),false);await closeControls(page);assert.ok(f.calls.route>=2,'Route reloads current data after reopening');
 assert.deepEqual(f.errors,[]);console.log('PASS '+width+'px 3D: popup polling and persisted mode, route, centre, zoom, tilt, bearing, stop/label controls');
 await page.screenshot({path:`${evidence}/restored-3d-${width}.png`});
 }
} finally {for(const context of contexts)await context.close();await browser.close()}
