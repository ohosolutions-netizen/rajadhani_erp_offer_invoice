const {test,expect}=require('@playwright/test');
async function start(page,{reject=false,missing=false,many=false}={}){
 await page.route('**/zf_sdk.js',route=>route.fulfill({contentType:'text/javascript',body:`
 window.sent=[];window.invocations=[];
 const invoice={invoice_id:'inv1',invoice_number:'INV-EDIT-1',customer_id:'c1',customer_name:'Test Customer',currency_code:'INR',date:'2026-09-17',payment_terms:30,salesperson_id:'s1',place_of_supply:'KL',gst_no:'GSTIN',billing_address:{city:'Kochi'},shipping_address:{city:'Thrissur'},discount:0,discount_type:'entity_level',is_discount_before_tax:true,adjustment:.25,notes:'Existing remarks',line_items:Array.from({length:${many?30:1}},(_,i)=>({line_item_id:'li'+i,item_id:'i1',name:'Test Set',quantity:6,rate:100,tax_id:'t1',tax_name:'GST 18',tax_percentage:18}))};
 const item={item_id:'i1',name:'Test Set',cf_m_unit:'SET',cf_ratio:3,rate:100,tax_id:'t1'};
 window.ZFAPPS={extension:{init:async()=>{}},get:async key=>key==='organization'?{organization:{organization_id:'org',currency_code:'INR'}}:key==='invoice'?${missing?'{}':"{invoice:{invoice_id:'inv1'}}"}:{},invoke:async(...args)=>{window.invocations.push(args)},request:async o=>{
 const path=new URL(o.url).pathname.replace('/erp/v3','');
 if(o.method==='PUT'){window.sent.push(o);return ${reject?"{code:14,message:'Invoice locked due to payments'}":"{code:0,invoice:{...invoice,total:708.25}}"};}
 if(path==='/invoices/inv1')return {code:0,invoice};
 if(path==='/items/i1')return {item};
 if(path==='/items')return {items:[item]};
 if(path==='/contacts')return {contacts:[]};
 if(path==='/settings/taxes')return {taxes:[{tax_id:'t1',tax_name:'GST 18',tax_percentage:18}]};
 if(path==='/salespersons')return {salespersons:[{salesperson_id:'s1',salesperson_name:'Salesperson'}]};
 if(path==='/locations')return {locations:[]};
 throw Error(path);
 }};
 `}));
 await page.goto('/app/widget.html');
 await expect(page.locator('#notice')).toContainText(missing?'No invoice context':'Editing INV-EDIT-1');
}
test('prefill, edit, PUT, refresh, success message and locked UI',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
 await expect(page.locator('#invoiceNumber')).toHaveValue('INV-EDIT-1');await expect(page.locator('#billingAddress')).toContainText('Kochi');
 await expect(page.getByLabel('Quantity for Test Set',{exact:true})).toHaveValue('2');
 await page.getByLabel('Quantity for Test Set',{exact:true}).fill('4');await expect(page.locator('[data-piece="0"]')).toHaveText('12');
 await page.locator('#saveButton').click();await page.locator('#confirmSave').click();
 await expect(page.locator('#notice')).toBeVisible();await expect(page.locator('#notice')).toContainText('updated in ERP');
 await expect(page.locator('#saveButton')).toBeDisabled();await expect(page.locator('#invoiceNumber')).toBeDisabled();
 const {sent,invocations}=await page.evaluate(()=>({sent,invocations}));expect(sent).toHaveLength(1);expect(sent[0].method).toBe('PUT');expect(sent[0].url).toMatch(/\/invoices\/inv1$/);expect(JSON.parse(sent[0].body.raw).line_items[0]).toMatchObject({line_item_id:'li0',quantity:12,rate:100});expect(invocations).toContainEqual(['REFRESH_DATA','invoice']);expect(errors).toEqual([]);
});
test('ERP rejection preserves message and permits closing',async({page})=>{await start(page,{reject:true});await page.locator('#saveButton').click();await page.locator('#confirmSave').click();await expect(page.locator('#saveStatus')).toHaveText('Invoice locked due to payments');await page.getByRole('button',{name:'Back to editing'}).click();await page.locator('#closeWidget').click();expect(await page.evaluate(()=>invocations)).toContainEqual(['CLOSE']);});
test('missing context prevents editing',async({page})=>{await start(page,{missing:true});expect(await page.locator('#invoiceForm').evaluate(e=>e.inert)).toBe(true);await expect(page.locator('#closeWidget')).toBeEnabled();});
test('popup stays bounded and added item scrolls inside line panel',async({page})=>{await start(page,{many:true});await page.locator('#itemSearch').fill('Test');await page.getByRole('option').filter({hasText:'Test Set'}).click();await expect(page.locator('#lineCount')).toHaveText('31');expect(await page.locator('.tablewrap').evaluate(e=>e.scrollTop>0)).toBe(true);
 for(const viewport of [{width:1200,height:740},{width:860,height:610},{width:390,height:500}]){await page.setViewportSize(viewport);expect(await page.evaluate(()=>({x:document.documentElement.scrollWidth<=innerWidth,y:document.documentElement.scrollHeight<=innerHeight}))).toEqual({x:true,y:true});expect(await page.locator('.tablewrap').evaluate(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight)).toBe(true);}
 await page.setViewportSize({width:1200,height:740});await page.screenshot({path:'test-results/edit-modal.png'});
});
