// Test a served static export under its configured base path.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://127.0.0.1:8787/HKRTTrafficInfo';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [], apis = [];
page.on('pageerror', error => errors.push(error.message));
await context.addInitScript(() => {
 localStorage.setItem('hk-traffic-language-v1','en');
 localStorage.setItem('hk-traffic-layers-v1',JSON.stringify({tram:true,taxi:true,access:true,'mtr-bus':true}));
 localStorage.setItem('hk-traffic-session-v1',JSON.stringify({version:1,mapMode:'2d',followLocation:false,view:{lng:114.16,lat:22.282,zoom:16},openControl:'nearby'}));
 Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(){return 0},clearWatch(){}}});
});
await context.route('**/api/**',route=>{apis.push(route.request().url());return route.fulfill({status:503,body:'Static hosting has no API routes'})});
await context.route(url=>url.hostname.endsWith('.gov.hk'),route=>route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'Fixture feed unavailable'}));
try {
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.locator('.nearby-tram .nearby-place').first().waitFor();
 await page.locator('.nearby-access .nearby-place').first().waitFor();
 await page.locator('.nearby-taxi .nearby-place').first().waitFor();
 await page.getByText('Some transport modes require the full hosted version.',{exact:false}).waitFor();
 assert.equal(await page.locator('.nearby-status a').count(),1);
 assert.deepEqual(apis,[],'Published-information layers must not call unavailable same-origin routes');
 assert.deepEqual(errors,[]);
 console.log('PASS static mobile: tram/access/taxi catalogues and Nearby work; hosted-only arrivals link to full version; no server API requests');
} finally {await context.close();await browser.close()}
