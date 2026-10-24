export async function openLayers(page) {
  if (!await page.locator('.layers-popover').count()) {
    await page.locator('.map-toolbar').getByRole('button', { name: /^(Map layers|地圖圖層)(?:$| ·)/ }).evaluate(button => button.click());
    await page.locator('.layers-popover').waitFor();
  }
  const other = page.locator('.other-map-layers');
  if (await other.count() && await other.getAttribute('open') === null) await other.locator('summary').evaluate(button => button.click());
}

export async function openSearch(page) {
  await closeControls(page);
  await page.locator('.map-toolbar').getByRole('button', { name: /^(Search|搜尋)$/ }).evaluate(button => button.click());
  await page.locator('.search-popover').waitFor();
}

export async function closeControls(page) {
  const close = page.locator('.map-control-popover .close-button');
  if (await close.count()) await close.evaluate(button => button.click());
  await page.locator('.map-control-popover').waitFor({ state: 'detached' });
}

export async function reloadAll(page) {
  await closeControls(page);
  const info = page.locator('.traffic-info-toggle');
  if (await info.getAttribute('aria-expanded') !== 'true') await info.evaluate(button => button.click());
  await page.locator('.status-refresh').click();
  await info.evaluate(button => button.click());
}


export async function toggleMapDisplay(page, key) {
  await openLayers(page);
  await page.locator('.transport-layers').getByRole('switch', { name: key === 'stops' ? /^(Bus stops|巴士站)$/ : /^(Route stop labels|路線車站標籤)$/ }).click();
  await closeControls(page);
}
