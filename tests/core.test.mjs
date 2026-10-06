import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const core=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../app/js/core.js',import.meta.url))).toString('base64'));
const {calculate,validateInvoice,makePayload,decodeResponse}=core;
const lines=[{item_id:'1234567890123456789',quantity:2,rate:100,tax:{id:'t18',name:'GST 18',percentage:18}},{item_id:'2',quantity:1,rate:50,tax:{id:'t5',name:'GST 5',percentage:5}}];
const state={customer:{contact_id:'9876543210987654321',billing_address:{city:'Kochi'},shipping_address:{city:'Thrissur'}},lines};
const config={invoiceQuantityMode:'pieces',customFields:{transport:{id:'cf1',label:'Transport',required:true}},requireSalesperson:true};
const values={date:'2026-09-17',place_of_supply:'KL',salesperson_id:'s1',rounded:false,custom:{transport:'Own delivery'},notes:'Test'};
test('mixed tax rates and item percentage discounts before tax',()=>{const t=calculate(lines.map(l=>({...l,discount:10})));assert.equal(t.subtotal,250);assert.equal(t.discount,25);assert.equal(t.tax,34.65);assert.equal(t.total,259.65);});
test('item discounts and whole-unit round off',()=>{const t=calculate(lines.map(l=>({...l,discount:10})),true);assert.equal(t.total,260);assert.equal(t.adjustment,.35);});
test('zero subtotal remains finite',()=>assert.equal(calculate([],0).total,0));

test('round off goes down through .49 and up from .50',()=>{
 assert.equal(calculate([{item_id:'x',quantity:1,pieces:1,rate:100.49}],true).total,100);
 assert.equal(calculate([{item_id:'x',quantity:1,pieces:1,rate:100.5}],true).total,101);
});

test('not found scan rows are ignored in totals and block save until removed',()=>{
 const notFound={item_id:'scan:x',notFound:true,quantity:1,rate:999,pieces:1};
 assert.equal(calculate([notFound,...lines]).subtotal,250);
 const errors=validateInvoice({...state,lines:[notFound]},values,config);
 assert.ok(errors.some(e=>e.includes('Item not found')));
 assert.ok(errors.some(e=>e.includes('Add at least one item')));
});
test('reject invalid quantities and excessive discounts while allowing unmapped custom fields',()=>{const errors=validateInvoice({...state,lines:[{...lines[0],quantity:0,discount:110}]},{...values,discount:110},{...config,customFields:{transport:{label:'Transport',id:'',required:true}}});assert.ok(errors.some(e=>e.includes('quantity')));assert.ok(errors.some(e=>e.includes('discount')));assert.ok(!errors.some(e=>e.includes('custom-field ID')));});
test('required custom fields are enforced even before their ERP field is mapped',()=>{const errors=validateInvoice(state,{...values,custom:{transport:''}},config);assert.ok(errors.some(e=>e.includes('Transport is required')));const unmapped=validateInvoice(state,{...values,custom:{transport:''}},{...config,customFields:{transport:{label:'Transport',id:'',required:true}}});assert.ok(unmapped.some(e=>e.includes('Transport is required')));});
test('shipping GSTIN is optional but must contain exactly 15 characters when entered',()=>{
 const validState={...state,lines:[{...lines[0],discount:5}]};
 assert.ok(validateInvoice(validState,{...values,shipping_gst_no:'123'},config).some(e=>e.includes('exactly 15 characters')));
 assert.ok(!validateInvoice(validState,{...values,shipping_gst_no:''},config).some(e=>e.includes('Shipping GSTIN')));
 assert.ok(!validateInvoice(validState,{...values,shipping_gst_no:'32ABCDE1234F1Z5'},config).some(e=>e.includes('Shipping GSTIN')));
});
test('payload preserves IDs, mappings, tax IDs and links without sending email',()=>{const p=makePayload(state,{...values,shipping_address:'Manual shipping'},config);assert.equal(p.customer_id,'9876543210987654321');assert.equal(p.line_items[0].item_id,'1234567890123456789');assert.equal(p.line_items[0].tax_id,'t18');assert.equal(p.discount,undefined);assert.equal(p.discount_type,'item_level');assert.equal(p.is_discount_before_tax,true);assert.equal(p.line_items[0].discount,'0%');assert.deepEqual(p.custom_fields,[{customfield_id:'cf1',value:'Own delivery'}]);assert.deepEqual(p.shipping_address,{address:'Manual shipping'});assert.equal(p.send,undefined);});
test('interstate payload uses the item IGST preference',()=>{
 const line={...lines[0],taxPreferences:[
  {tax_specification:'intra',tax_specific_type:'tax',tax_id:'gst18',tax_name:'GST 18',tax_percentage:18},
  {tax_specification:'inter',tax_specific_type:'igst',tax_id:'igst18',tax_name:'IGST 18',tax_percentage:18}
 ]};
 assert.equal(makePayload({...state,lines:[line]},values,config).line_items[0].tax_id,'gst18');
 assert.equal(makePayload({...state,lines:[line]},{...values,place_of_supply:'TN'},config).line_items[0].tax_id,'igst18');
});
test('same-as-billing uses billing address without editing the customer',()=>assert.equal(makePayload(state,{...values,sameAsBilling:true},config).shipping_address.city,'Kochi'));
test('editable shipping address overrides customer shipping address',()=>assert.deepEqual(makePayload(state,{...values,shipping_address:'Edited Ship Address'},config).shipping_address,{address:'Edited Ship Address'}));
test('customer shipping address is not copied unless provided or same-as-billing is checked',()=>assert.equal(makePayload(state,values,config).shipping_address,undefined));
test('ERP API failures are distinguishable from ambiguous network errors',()=>{assert.throws(()=>decodeResponse({data:{body:'{"code":14,"message":"Denied"}'}}),e=>e.apiRejected===true&&e.message==='Denied');assert.equal(decodeResponse({data:{body:'{"code":0,"invoice":{"invoice_id":"99"}}'}}).invoice.invoice_id,'99');});
test('popup resize stays within conservative browser bounds and denial identifies scope',async()=>{
 const source=fs.readFileSync(new URL('../app/js/erp.js',import.meta.url),'utf8').replace("import { decodeResponse } from './core.js';",`const decodeResponse = ${decodeResponse.toString()};`);
 const {ERP}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 globalThis.window={outerWidth:900,outerHeight:700,get top(){throw new Error('cross-origin');}};
 let resize;
 const api=new ERP({connectionLinkName:'erp_admin',apiBase:'https://www.zohoapis.in/erp/v3'}, {extension:{init:async()=>{}},get:async()=>({organization:{organization_id:'org1'}}),invoke:async(_,args)=>{resize=args;},request:async()=>({data:{body:JSON.stringify({code:14,message:'You are not authorized to perform this operation'})}})});
 await api.init();assert.deepEqual(resize,{width:'760px',height:'610px'});
 await assert.rejects(()=>api.searchCustomers('a'),e=>e.apiRejected&&e.message.includes('ERP.contacts.READ'));
 delete globalThis.window;
});

test('invoice refresh tries alternate host SDK shapes after saving',async()=>{
 const source=fs.readFileSync(new URL('../app/js/erp.js',import.meta.url),'utf8').replace("import { decodeResponse } from './core.js';",`const decodeResponse = ${decodeResponse.toString()};`);
 const {ERP}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const calls=[];
 const api=new ERP({connectionLinkName:'erp_admin',organizationId:'org',apiBase:'https://www.zohoapis.in/erp/v3'},{invoke:async(...args)=>{calls.push(args);if(calls.length<2)throw new Error('unsupported');}});
 assert.equal(await api.refreshInvoices(),true);
 assert.deepEqual(calls,[['REFRESH_DATA','invoice'],['REFRESH_DATA',{entity:'invoice'}]]);
});

test('customer name search sends explicit contains filter and excludes unrelated records',async()=>{
 const source=fs.readFileSync(new URL('../app/js/erp.js',import.meta.url),'utf8').replace("import { decodeResponse } from './core.js';",`const decodeResponse = ${decodeResponse.toString()};`);
 const {ERP}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let options;
 const api=new ERP({connectionLinkName:'erp_admin',organizationId:'org',apiBase:'https://www.zohoapis.in/erp/v3'},{request:async o=>{options=o;return {contacts:[{contact_name:'AMEES STOR'},{contact_name:'Akkara Stores'}],page_context:{has_more_page:true}};}});
 api.ready=true;const result=await api.searchCustomers(' AKKARA ');
 assert.deepEqual(result.contacts,[{contact_name:'Akkara Stores'}]);
 assert.ok(options.url_query.some(v=>v.key==='contact_name_contains'&&v.value==='AKKARA'));
 assert.equal(result.page_context.has_more_page,true);
});

test('salesperson lookup falls back to users when salespersons endpoint is unavailable',async()=>{
 const source=fs.readFileSync(new URL('../app/js/erp.js',import.meta.url),'utf8').replace("import { decodeResponse } from './core.js';",`const decodeResponse = ${decodeResponse.toString()};`);
 const {ERP}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const paths=[];
 const api=new ERP({connectionLinkName:'erp_admin',organizationId:'org',apiBase:'https://www.zohoapis.in/erp/v3'},{request:async o=>{paths.push(new URL(o.url).pathname);if(o.url.endsWith('/salespersons'))return {message:'No salesperson resource'};return {users:[{user_id:'u1',name:'Raj Admin',status:'active'},{user_id:'u2',name:'Inactive',status:'inactive'}],page_context:{has_more_page:false}};}});
 api.ready=true;
 assert.deepEqual(await api.salespersons(),[{salesperson_id:'u1',salesperson_name:'Raj Admin'}]);
 assert.deepEqual(paths,['/erp/v3/salespersons','/erp/v3/users']);
});

test('MU Set uses Ratio, MU Pieces uses one, and line amount uses piece quantity',()=>{
 const packing=core.itemPacking({custom_fields:[{label:'MU',value:'Set'},{label:'Ratio',value:12}]});
 assert.equal(packing.pieces,12);
 const line={...lines[0],...packing,quantity:3,rate:10};
 assert.equal(core.pieceQuantity(line),36);assert.equal(calculate([line]).subtotal,360);
 assert.equal(core.itemPacking({custom_fields:[{label:'MU',value:'Pieces'},{label:'Ratio',value:12}]}).pieces,1);
 assert.ok(core.itemPacking({custom_fields:[{label:'MU',value:'Set'},{label:'Ratio',value:0}]}).packingError);
 const p=makePayload({...state,lines:[line]},values,config);assert.equal(p.line_items[0].quantity,36);assert.equal(p.line_items[0].rate,10);
 const o=makePayload({...state,lines:[line]},values,{...config,invoiceQuantityMode:'order'});assert.equal(o.line_items[0].quantity,3);assert.equal(o.line_items[0].rate,120);
});

test('item packing reads the Zoho item master labels M Unit and Ratio',()=>{
 const packing=core.itemPacking({custom_fields:[{label:'M Unit',value:'SET'},{label:'Ratio',value:'1'}]});
 assert.deepEqual(packing,{mu:'Set',pieces:1});
 const mapped=core.itemPacking({custom_fields:[{api_name:'cf_m_unit',label:'M Unit',value:'SET'},{customfield_id:'987',label:'Ratio',value:'3'}]},{mu:'M Unit',ratio:'987'});
 assert.deepEqual(mapped,{mu:'Set',pieces:3});
 const hash=core.itemPacking({custom_field_hash:{cf_m_unit:'SET',cf_ratio:'4'}});
 assert.deepEqual(hash,{mu:'Set',pieces:4});
});

test('packing retains repeated parent and variant custom fields and mapped hash IDs',()=>{
 assert.deepEqual(core.itemPacking({custom_fields:[{label:'M Unit',value:'SET'},{label:'Ratio',value:3},{label:'M Unit',value:'SET'},{label:'Ratio',value:''}]}),{mu:'Set',pieces:3});
 assert.deepEqual(core.itemPacking({custom_field_hash:{'123':'SET','456':6}},{mu:'123',ratio:'456'}),{mu:'Set',pieces:6});
});

test('packing infers set items from Zoho item category when M Unit is absent',()=>{
 const item={unit:'pcs',group_name:'CHURIDAR',cf_ratio:'3',custom_fields:[
  {label:'Item Category',api_name:'cf_item_category',customfield_id:'4160832000000047001',value:'3 PIECE SET'},
  {label:'Ratio',api_name:'cf_ratio',customfield_id:'4160832000000046007',value:'3'}
 ],custom_field_hash:{cf_item_category:'3 PIECE SET',cf_ratio:'3'}};
 assert.deepEqual(core.itemPacking(item),{mu:'Set',pieces:3});
 assert.equal(calculate([{...lines[0],...core.itemPacking(item),quantity:2,rate:1095}]).subtotal,6570);
});


test('different item discounts reduce only their own taxable base',()=>{
 const discounted=[{...lines[0],discount:10},{...lines[1],discount:20}];
 const t=calculate(discounted);
 assert.equal(t.subtotal,250);assert.equal(t.discount,30);assert.equal(t.taxable,220);
 assert.equal(t.tax,34.4);assert.equal(t.total,254.4);
 const p=makePayload({...state,lines:discounted},values,config);
 assert.deepEqual(p.line_items.map(l=>l.discount),['10%','20%']);
});
test('discount is mandatory and must be greater than zero',()=>{
 assert.equal(calculate([{...lines[0],discount:100}]).total,0);
 assert.equal(calculate(lines).discount,0);
 assert.deepEqual(core.lineAmounts({quantity:3,pieces:2,rate:1.11,discount:12.5}),{gross:6.66,discount:0.83,taxable:5.83});
 assert.equal(calculate([{...lines[0],tax:null,discount:50}]).total,100);
 for(const discount of [undefined,0,-1,100.1,NaN,Infinity,'10%']) {
  assert.ok(validateInvoice({...state,lines:[{...lines[0],discount}]},values,config).some(e=>e.includes('discount percentage')));
 }
 for(const discount of [0.01,12.5,100]) {
  assert.deepEqual(validateInvoice({...state,lines:[{...lines[0],discount}]},values,config),[]);
 }
});

test('odd-paise GST rounds both components before invoice round-off and payload adjustment',()=>{
 const offerLines=[{...lines[0],quantity:4,rate:735,discount:25,tax:{id:'gst5',name:'GST 5',percentage:5}}];
 const t=calculate(offerLines,true,true);
 assert.equal(t.taxable,2205);assert.equal(t.cgst,55.13);assert.equal(t.sgst,55.13);
 assert.equal(t.tax,110.26);assert.equal(t.adjustment,-0.26);assert.equal(t.total,2315);
 const p=makePayload({...state,lines:offerLines},{...values,rounded:true},config);
 assert.equal(p.adjustment,-0.26);
 assert.equal(core.round(t.taxable+t.cgst+t.sgst+p.adjustment),2315);
 const interstate=calculate(offerLines,true,false);
 assert.equal(interstate.tax,110.25);assert.equal(interstate.adjustment,-0.25);
});
test('multiple lines accumulate independently rounded GST components',()=>{
 const items=[{...lines[0],quantity:1,rate:1,discount:0,tax:{id:'gst5',name:'GST 5',percentage:5}}];
 const t=calculate([...items,...items],false,true);
 assert.equal(t.cgst,0.06);assert.equal(t.sgst,0.06);assert.equal(t.tax,0.12);assert.equal(t.total,2.12);
 const zero=calculate([{...items[0],discount:100}],true,true);
 assert.equal(zero.tax,0);assert.equal(zero.total,0);
});
