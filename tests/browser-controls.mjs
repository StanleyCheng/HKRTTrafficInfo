export async function openLayers(page) {
  if (await page.locator('.layers-popover').count()) return;
  await page.locator('.map-toolbar').getByRole('button', { name: /^(Map layers|地圖圖層)(?:$| ·)/ }).evaluate(button => button.click());
  await page.locator('.layers-popover').waitFor();
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

