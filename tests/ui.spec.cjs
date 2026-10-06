const {test,expect}=require('@playwright/test');
const fs=require('fs');
async function start(page){await page.goto('/dist/InvoicePreview.html');await expect(page.locator('#connectionStatus')).toHaveText('Preview · sample data');}
async function customer(page){await page.locator('#customerSearch').fill('Malabar');await page.getByRole('option').filter({hasText:'Malabar Trading Company'}).click();await expect(page.locator('#billingAddress')).toContainText('Kochi');await expect(page.locator('#salesOrder')).toBeEnabled();await expect(page.locator('#itemSearch')).toBeFocused();}
async function item(page,term){await page.locator('#itemSearch').fill(term);await page.getByRole('option').filter({hasText:term}).first().click();}
async function scanItem(page,code){await page.locator('#itemSearch').fill(code);await page.locator('#itemSearch').press('Tab');await expect(page.locator('#itemSearch')).toHaveValue('');}
async function required(page){await page.locator('#cf_billType').selectOption('Credit');await page.locator('#cf_transport').selectOption('Own delivery');await page.locator('#salesperson').selectOption('s1');}
test('search, address fill, quantities, discount, review and remove',async({page})=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);await customer(page);await scanItem(page,'PAP-A4-75');await expect(page.locator('#lineCount')).toHaveText('1');await page.getByRole('spinbutton',{name:'Quantity for Premium A4 Copier Paper'}).fill('10');await page.locator('[data-field=discount]').first().fill('10');await expect(page.locator('#grandTotal')).toHaveText('₹28,728.00');await expect(page.locator('#shippingAddress')).toHaveValue('');await page.locator('#sameAsBilling').check();await expect(page.locator('#shippingAddress')).toHaveValue(/24, Market Road/);await required(page);await page.locator('#saveButton').click();await expect(page.locator('#reviewDialog')).toBeVisible();await expect(page.locator('#confirmSave')).toBeDisabled();await page.getByRole('button',{name:'Back to editing'}).click();await page.getByRole('button',{name:'Remove Premium A4 Copier Paper'}).click();await expect(page.locator('#emptyItems')).toBeVisible();expect(errors).toEqual([]);});
test('sales order import and customer switch preserve existing item behavior',async({page})=>{await start(page);await customer(page);await page.locator('#salesOrder').selectOption('so1');await expect(page.locator('#lineCount')).toHaveText('2');await expect(page.locator('#grandTotal')).toHaveText('₹53,854.00');await page.locator('#customerSearch').fill('Sree');await expect(page.locator('#lineCount')).toHaveText('2');await expect(page.locator('#gstNumber')).toHaveValue('');await page.getByRole('option').filter({hasText:'Sree Krishna'}).click();await expect(page.locator('#billingAddress')).toContainText('Thrissur');});
test('standalone file works without HTTP server and mobile does not overflow',async({page})=>{await page.goto('file://'+process.cwd()+'/dist/InvoicePreview.html');await expect(page.locator('#connectionStatus')).toHaveText('Preview · sample data');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'dist/MobilePreview.png',fullPage:true});});
test('capture filled desktop preview',async({page})=>{await start(page);await customer(page);await page.locator('#salesOrder').selectOption('so1');await expect(page.locator('#lineCount')).toHaveText('2');await required(page);await page.locator('#cf_agent').selectOption('Direct');await page.locator('#cf_vehicle').selectOption('KL 01 AB 2345');await page.locator('[data-field=discount]').first().fill('5');await page.locator('#notice').evaluate(e=>e.hidden=true);await page.screenshot({path:'dist/InvoicePreview.png',fullPage:true});});
test('production SDK adapter sends one draft creation and locks after success',async({page})=>{
 const mock=fs.readFileSync('preview/mock-sdk.js','utf8');
 await page.route('**/zf_sdk.js',r=>r.fulfill({contentType:'text/javascript',body:mock+`;window.testConfig=window.RAJADHANI_PREVIEW_CONFIG;delete window.RAJADHANI_PREVIEW_CONFIG;const originalRequest=window.ZFAPPS.request;window.sent=[];window.ZFAPPS.request=async o=>{if(o.method==='POST'){window.sent.push(o);return {data:{body:JSON.stringify({code:0,invoice:{invoice_id:'created1',invoice_number:'INV-TEST',status:'draft',total:319.2}})}};}return originalRequest(o);};`}));
 await page.route('**/app/config.json',r=>{const c=JSON.parse(fs.readFileSync('app/config.json'));c.connectionLinkName='test';c.invoiceQuantityMode='pieces';for(const [k,v]of Object.entries(c.customFields)){v.id='test-'+k;v.required=false;}c.requireSalesperson=false;r.fulfill({json:c});});
 await page.goto('/app/widget.html');await expect(page.locator('#connectionStatus')).toHaveText('ERP connected');await customer(page);await item(page,'Premium');await page.locator('[data-field=discount]').fill('12.5');await page.locator('#saveButton').click();await page.locator('#confirmSave').click();await expect(page.locator('#notice')).toContainText('INV-TEST saved');await expect(page.locator('#saveButton')).toBeDisabled();const sent=await page.evaluate(()=>window.sent);expect(sent.length).toBe(1);expect(sent[0].connection_link_name).toBe('test');expect(sent[0].url_query).toContainEqual({key:'send',value:'false'});const payload=JSON.parse(sent[0].body.raw);expect(payload.line_items[0].item_id).toBe('i1');expect(payload.line_items[0].discount).toBe('12.5%');expect(payload.discount_type).toBe('item_level');expect(payload.is_discount_before_tax).toBe(true);expect(payload.discount).toBeUndefined();expect(payload.adjustment).toBe(-0.01);
});

test('line discount amounts and summary update after editing and removing rows',async({page})=>{
 await start(page);await customer(page);await page.locator('#salesOrder').selectOption('so1');
 const rows=page.locator('#lineItems tr');await expect(rows).toHaveCount(2);
 await rows.nth(0).locator('[data-field=discount]').fill('10');
 await rows.nth(1).locator('[data-field=discount]').fill('25');
 const check=async()=>{
  const amounts=await page.locator('[data-discount]').allTextContents();
  const sum=amounts.reduce((s,v)=>s+Number(v.replace(/[^0-9.]/g,'')),0);
  await expect(page.locator('#discountAmount')).toHaveText('− '+new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(sum));
 };
 await check();await rows.nth(0).locator('[data-field=quantity]').fill('3');await check();
 await rows.nth(0).locator('[data-field=rate]').fill('100');await check();
 await rows.nth(1).getByRole('button',{name:/Remove/}).click();await check();
 await rows.nth(0).locator('[data-field=discount]').fill('100');
 await expect(page.locator('#grandTotal')).toHaveText('₹0.00');
 await rows.nth(0).getByRole('button',{name:/Remove/}).click();await check();
 await expect(page.locator('#discountAmount')).toHaveText('− ₹0.00');
});

test('ERP popup widths expose net amount and remove controls; mobile can scroll',async({page})=>{
 await start(page);await customer(page);await page.locator('#salesOrder').selectOption('so1');
 await expect(page.locator('#lineItems tr')).toHaveCount(2);
 for(const width of [1440,1160,1050,900,760]){
  await page.setViewportSize({width,height:680});
  const layout=await page.locator('#invoiceItemsCard .tablewrap').evaluate(w=>{
   const right=w.getBoundingClientRect().right;
   const cells=[...w.querySelectorAll('tbody tr:first-child td')];
   return {fits:w.scrollWidth<=w.clientWidth+1,lastVisible:cells.at(-1).getBoundingClientRect().right<=right+1,netVisible:cells.at(-2).getBoundingClientRect().right<=right+1};
  });
  expect(layout,`viewport ${width}`).toEqual({fits:true,lastVisible:true,netVisible:true});
  if(width===1160)await page.screenshot({path:'dist/OfferInvoicePopup.png',fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});
 const mobile=await page.locator('#invoiceItemsCard .tablewrap').evaluate(w=>{
  w.scrollLeft=w.scrollWidth;
  return {scrolled:w.scrollLeft>0,removeVisible:w.querySelector('tbody tr .remove').getBoundingClientRect().right<=w.getBoundingClientRect().right+1};
 });
 expect(mobile).toEqual({scrolled:true,removeVisible:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('no Start over and odd-paise GST components round before invoice total',async({page})=>{
 await start(page);
 await expect(page.getByRole('button',{name:/Start over/})).toHaveCount(0);
 await customer(page);await scanItem(page,'PAP-A4-75');
 const row=page.locator('#lineItems tr').first();
 await expect(row.locator('[data-field=discount]')).toBeEnabled();
 await row.locator('[data-field=quantity]').fill('1');
 await row.locator('[data-field=rate]').fill('220.5');
 await row.locator('[data-field=tax]').selectOption({label:'GST 5 (5%)'});
 await expect(page.locator('#taxBreakdown')).toContainText('CGST₹55.13');
 await expect(page.locator('#taxBreakdown')).toContainText('SGST₹55.13');
 await expect(page.locator('#taxTotal')).toHaveText('₹110.26');
 await expect(page.locator('#roundValue')).toHaveText('-₹0.26');
 await expect(page.locator('#grandTotal')).toHaveText('₹2,315.00');
});
