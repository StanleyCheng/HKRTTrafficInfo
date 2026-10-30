// Requires an external Playwright runtime, like the other browser scenarios.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = process.argv[3] || '/tmp/hkrt-tram-eta';
import network from '../data/tram-network.json' with {type:'json'};
import { commuterCatalogue, tramPaths } from '../lib/commuter-catalogue.ts';
const browser=await chromium.launch({channel:'chrome',headless:true});
const published=network.routes.find(r=>r.id==='4003-1');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQAAAABJRU5ErkJggg==','base64');
await fs.mkdir(evidence,{recursive:true});
try {for(const mode of ['2d','3d'])for(const [width,language] of [[1440,'en'],[390,'zh']]){
const now=Date.now(), observedAt=new Date(now).toISOString();
const cameras=commuterCatalogue('tram');
const anchors=[10,11].map((index,i)=>{const [lat,lng]=published.points[index];const c=cameras.find(c=>c.lat===lat&&c.lng===lng);c.arrivals=[{route:'4003',destination:'跑馬地',destinationEn:'Happy Valley',minutes:i?2:0,eta:new Date(now+(i?90000:-30000)).toISOString(),observedAt,scheduled:false,tram:{routeId:'4003',direction:'eastbound',vehicleId:null}}];c.dataUpdated=observedAt;return c;});

 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({mode,language,point})=>{if(!localStorage.getItem('hk-traffic-session-v1')){localStorage.setItem('hk-traffic-language-v1',language);localStorage.setItem('hk-traffic-basemap-v1','osm');localStorage.setItem('hk-traffic-layers-v1',JSON.stringify({tram:true}));localStorage.setItem('hk-traffic-session-v1',JSON.stringify({version:1,mapMode:mode,view:{lng:point.lng,lat:point.lat,zoom:15},followLocation:false,openControl:'layers',layerCategory:'tram',routeVisibility:{'all:tram':false,'tram:4003':true}}));}let leaflet;Object.defineProperty(window,'L',{configurable:true,get:()=>leaflet,set(value){leaflet=value;value.Map.addInitHook(function(){window.__map=this;});}});},{mode,language,point:anchors[1]});
 await context.route('**/app/traffic-map-3d.tsx*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('map.current = m;','map.current = m; window.__nativeMap = m;')});});
 await context.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:pixel}));
 await context.route(url=>url.hostname.endsWith('.gov.hk'),r=>r.fulfill({status:503,body:'Unrelated source'}));
 await context.route('**/api/**',route=>{const u=new URL(route.request().url());return route.fulfill({json:u.pathname==='/api/tram'?(u.searchParams.has('stop')?{ok:true,camera:cameras.find(c=>c.sourceId===u.searchParams.get('stop'))}:{ok:true,cameras,paths:tramPaths(),observedAt,stale:false,complete:true}):{ok:true,cameras:[],boards:[],trains:[],stops:[],vessels:[],piers:[],notices:[],warnings:[]}});});
 try{
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 const stationSwitch=page.getByRole('switch',{name:language==='en'?'Tram stations':'電車站',exact:true});await stationSwitch.waitFor();
 await page.locator('img[src*="/vehicles/tram.webp"]').first().waitFor();
 const pathCount=()=>page.evaluate(mode=>{if(mode==='3d')return window.__nativeMap?.getSource('hk-transport')?.serialize().data.features.filter(f=>f.properties.color==='#278273').length??0;let n=0;window.__map?.eachLayer(l=>{if(l.options.color==='#278273'&&l.getLatLngs)n++;});return n;},mode);
 assert.equal(await pathCount(),2);
 await stationSwitch.uncheck();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hk-traffic-session-v1')).showTramStops===false);
 assert.equal(await page.locator('[data-marker-id="'+anchors[1].id+'"]').count(),0);
 assert.ok(await page.locator('img[src*="/vehicles/tram.webp"]').count());assert.equal(await pathCount(),2);
 await page.reload();await stationSwitch.waitFor();assert.equal(await stationSwitch.isChecked(),false);await stationSwitch.check();
 await page.locator('.layers-popover .control-popover-head button').click();
 await page.locator('[data-marker-id="'+anchors[1].id+'"]').locator('.marker-inner').click();
 const details=page.locator('.item-detail').last();await details.getByRole('heading',{name:language==='en'?anchors[1].nameEn:anchors[1].name,exact:true}).waitFor();await details.locator('.arrival-minutes').first().waitFor();
 assert.match(await details.locator('.arrival-destination').first().innerText(),language==='en'?/Happy Valley/:/跑馬地/);
 const expectedMinutes = Math.max(0, Math.ceil((Date.parse(anchors[1].arrivals[0].eta) - Date.now()) / 60000));
 assert.equal(Number((await details.locator('.arrival-minutes').first().innerText()).match(/^\d+/)?.[0]), expectedMinutes);
 await page.screenshot({path:`${evidence}/eta-${mode}-${width}.png`});
 await details.locator('.arrival-board').first().getByRole('button',{name:/^(Show route|顯示路線)/}).first().click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hk-traffic-session-v1')).routeVisibility['tram:4003']===true);
 await page.waitForFunction(()=>document.querySelectorAll('.item-detail').length===0);assert.equal(await pathCount(),2);
 await page.locator('[data-testid="map-mode-toggle"]').click();await page.locator('img[src*="/vehicles/tram.webp"]').first().waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hk-traffic-session-v1')).showTramStops),true);assert.deepEqual(errors,[]);
 console.log(`PASS ${mode} ${width}px ${language}: ETA, route display, icons, stop toggle, reload and renderer switch`);
 }catch(e){await page.screenshot({path:`${evidence}/error-${mode}-${width}.png`});console.log((await page.locator('body').innerText()).slice(-5000));throw e;}finally{await context.close();}
}}finally{await browser.close();}
