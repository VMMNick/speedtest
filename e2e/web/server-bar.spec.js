import { test, expect } from './fixtures.js';

// Новий формат Cloudflare /meta: colo — об'єкт; довга назва провайдера
test.use({
  viewport: { width: 700, height: 900 },
  mock: {
    meta: {
      clientIp: '203.0.113.7',
      asOrganization: 'LLC Joint Small Enterprise Teviant With A Very Long Provider Name',
      city: 'Uzhhorod',
      country: 'UA',
      colo: { iata: 'WAW', city: 'Warsaw', lat: 52.16, lon: 20.96 },
    },
  },
});

test('панель сервера: без [object Object] і без наїзду тексту на сусідній блок', async ({ app, errors }) => {
  const name = app.locator('#server-name');
  await expect(name).toContainText('Uzhhorod (WAW)');
  await expect(name).not.toContainText('object');

  // Текст обрізається у своїй колонці, а не залазить під іконку провайдера
  const nameBox = await name.boundingBox();
  const ispIcon = await app.locator('.server-bar .icon--wifi').boundingBox();
  expect(nameBox && ispIcon && nameBox.x + nameBox.width <= ispIcon.x).toBe(true);
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // ellipsis
  await expect(name).toHaveAttribute('title', /Uzhhorod \(WAW\)/);
  expect(errors).toEqual([]);
});
