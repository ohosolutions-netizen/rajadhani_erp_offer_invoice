// Preview fixtures only. This file is never included in the ERP widget ZIP.
(() => {
const fields = {
 billType:{label:'Bill type',id:'demo-bill',required:true},saleType:{label:'Type',id:'demo-type',required:true},billCreatedBy:{label:'Bill created by',id:'demo-user',required:true},transport:{label:'Transport',id:'demo-transport',required:true},agent:{label:'Agent name',id:'demo-agent'},vehicle:{label:'Vehicle number',id:'demo-vehicle'},whatsapp:{label:'WhatsApp number',id:'demo-whatsapp'},mobile:{label:'Mobile number',id:'demo-mobile',required:true},shippingPhone:{label:'Shipping phone',id:'demo-shipphone'},pending:{label:'Invoice pending',id:'demo-pending'}
};
const lookups = {
 billType:[{id:'Cash',name:'Cash'},{id:'Credit',name:'Credit'},{id:'Credit-Account',name:'Credit-Account'}],saleType:[{id:'Wholesale',name:'Wholesale'},{id:'Retail',name:'Retail'}],transport:[{id:'Own delivery',name:'Own delivery'},{id:'Customer pickup',name:'Customer pickup'},{id:'Parcel service',name:'Parcel service'}],agent:[{id:'Direct',name:'Direct'},{id:'Arun Kumar',name:'Arun Kumar'}],vehicle:[{id:'KL 01 AB 2345',name:'KL 01 AB 2345'},{id:'KL 01 CD 6789',name:'KL 01 CD 6789'}]
};
window.RAJADHANI_PREVIEW_CONFIG = {
 connectionLinkName:'preview-only',organizationId:'preview-org',customFields:fields,invoiceQuantityMode:'pieces',itemFields:{mu:'cf_m_unit',ratio:'cf_ratio'},lookupSources:Object.fromEntries(Object.keys(lookups).map(key=>[key,{path:`/preview/${key}`,key:'records',idKey:'id',labelKey:'name'}]))
};
const customers = [
 {contact_id:'c1',contact_name:'Malabar Trading Company',company_name:'Malabar Trading Company',email:'accounts@example.com',mobile:'+91 98765 43210',gst_no:'32ABCDE1234F1Z5',place_of_contact:'KL',payment_terms:30,currency_code:'INR',billing_address:{address:'24, Market Road',city:'Kochi',state:'Kerala',zip:'682001',country:'India'},shipping_address:{address:'Warehouse 3, Industrial Estate',city:'Kochi',state:'Kerala',zip:'682030',country:'India',phone:'+91 98765 43210'}},
 {contact_id:'c2',contact_name:'Sree Krishna Stores',company_name:'Sree Krishna Stores',email:'store@example.com',mobile:'+91 98470 12345',place_of_contact:'KL',payment_terms:15,currency_code:'INR',billing_address:{address:'18, Main Road',city:'Thrissur',state:'Kerala',zip:'680001',country:'India'},shipping_address:{address:'18, Main Road',city:'Thrissur',state:'Kerala',zip:'680001',country:'India'}},
 {contact_id:'c3',contact_name:'Coastal Distributors',company_name:'Coastal Distributors',mobile:'+91 98950 67890',place_of_contact:'KL',payment_terms:0,currency_code:'INR',billing_address:{address:'7, Beach Road',city:'Kozhikode',state:'Kerala',zip:'673001',country:'India'},shipping_address:{address:'7, Beach Road',city:'Kozhikode',state:'Kerala',zip:'673001',country:'India'}}
];
const taxes=[{tax_id:'t5',tax_name:'GST 5',tax_percentage:5},{tax_id:'t12',tax_name:'GST 12',tax_percentage:12},{tax_id:'t18',tax_name:'GST 18',tax_percentage:18},{tax_id:'t0',tax_name:'Zero rated',tax_percentage:0}];
const items=[
 ['i1','Premium A4 Copier Paper','PAP-A4-75',285,480,'ream',10,'480256','t12'],
 ['i2','Spiral Notebook · 200 pages','NB-SP-200',68,1250,'piece',12,'482010','t12'],
 ['i3','Ballpoint Pen · Blue','PEN-BL-10',95,340,'box',10,'960810','t18'],
 ['i4','Document File · A4','FILE-A4',32,670,'piece',20,'482030','t18'],
 ['i5','Packing Tape · 48 mm','TAPE-48',42,900,'roll',6,'391910','t18'],
 ['i6','Pencil Set · HB','PEN-HB-12',58,260,'box',12,'960910','t12']
].map(([item_id,name,sku,rate,stock_on_hand,unit,pieces,hsn_or_sac,tax_id],index)=>{const tax=taxes.find(t=>t.tax_id===tax_id);return {item_id,item_master_id:`m${index+1}`,name,sku,rate,stock_on_hand,unit,hsn_or_sac,tax_id:'',tax_percentage:0,tax_name:'',item_tax_preferences:[{tax_specification:'intra',tax_specific_type:'tax',tax_id:tax.tax_id,tax_name:tax.tax_name,tax_percentage:tax.tax_percentage,tax_name_formatted:`${tax.tax_name} [${tax.tax_percentage}%]`},{tax_specification:'inter',tax_specific_type:'igst',tax_id:`i${tax.tax_id}`,tax_name:`IGST ${tax.tax_percentage}`,tax_percentage:tax.tax_percentage,tax_name_formatted:`IGST ${tax.tax_percentage} [${tax.tax_percentage}%]`}],pieces,status:'active'};});
const itemMasters=items.map(i=>({item_master_id:i.item_master_id,item_master_name:i.name,custom_field_hash:{cf_m_unit:'SET',cf_ratio:i.pieces},custom_fields:[{api_name:'cf_m_unit',label:'M Unit',value:'SET'},{api_name:'cf_ratio',label:'Ratio',value:i.pieces}]}));
const salesOrders=[
 {salesorder_id:'so1',salesorder_number:'SO-00124',status:'confirmed',customer_id:'c1',customer_name:'Malabar Trading Company',date:'2026-09-18',salesperson_id:'s1',line_items:[{...items[0],line_item_id:'sol1',quantity:10,quantity_invoiced:0},{...items[1],line_item_id:'sol2',quantity:24,quantity_invoiced:0}]},
 {salesorder_id:'so2',salesorder_number:'SO-00131',status:'confirmed',customer_id:'c2',customer_name:'Sree Krishna Stores',date:'2026-09-19',salesperson_id:'s2',line_items:[{...items[0],line_item_id:'sol3',quantity:6,quantity_invoiced:2},{...items[2],line_item_id:'sol4',quantity:5,quantity_invoiced:0}]},
 {salesorder_id:'so3',salesorder_number:'SO-00133',status:'partially_invoiced',customer_id:'c3',customer_name:'Coastal Distributors',date:'2026-09-19',salesperson_id:'s1',line_items:[{...items[0],line_item_id:'sol5',quantity:15,quantity_invoiced:5}]}
];
window.ZFAPPS = {
 extension:{init:async()=>({})},invoke:async()=>({}),get:async key=>key==='organization'?{organization:{organization_id:'preview-org',name:'Rajadhani · UI preview',currency_code:'INR'}}:{user:{name:'Anjali K'}},
 request:async options=>{
  await new Promise(resolve=>setTimeout(resolve,150));
  const path=new URL(options.url).pathname.replace('/erp/v3',''),q=Object.fromEntries((options.url_query||[]).map(v=>[v.key,v.value]));let response={};
  if(options.method==='POST')throw new Error('Preview cannot create ERP records.');
  if(path==='/contacts')response={contacts:customers.filter(c=>(c.contact_name+' '+c.mobile).toLowerCase().includes((q.contact_name_contains||q.search_text||'').toLowerCase()))};
  else if(path.startsWith('/contacts/'))response={contact:customers.find(c=>c.contact_id===path.split('/').pop())};
  else if(path==='/items')response={items:items.filter(i=>(i.name+' '+i.sku).toLowerCase().includes((q.search_text||'').toLowerCase()))};
  else if(path.startsWith('/items/'))response={item:items.find(i=>i.item_id===path.split('/').pop())};
  else if(path.startsWith('/itemmasters/'))response={item_master:itemMasters.find(i=>i.item_master_id===path.split('/').pop())};
  else if(path==='/settings/taxes')response={taxes};
  else if(path==='/salespersons')response={salespersons:[{salesperson_id:'s1',salesperson_name:'Arun Kumar'},{salesperson_id:'s2',salesperson_name:'Meera Nair'}]};
  else if(path==='/locations')response={locations:[{location_id:'loc1',location_name:'Main warehouse · Kochi'},{location_id:'loc2',location_name:'Thrissur branch'}]};
  else if(path==='/salesorders')response={salesorders:salesOrders.filter(o=>!q.customer_id || String(o.customer_id)===String(q.customer_id)).map(({line_items,...o})=>o)};
  else if(path.startsWith('/salesorders/'))response={salesorder:salesOrders.find(o=>o.salesorder_id===path.split('/').pop())};
  else if(path.startsWith('/preview/'))response={records:lookups[path.split('/').pop()]||[]};
  else throw new Error('No preview fixture for '+path);
  return {data:{body:JSON.stringify({code:0,...response,page_context:{has_more_page:false}})}};
 }
};
})();
