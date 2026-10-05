import { itemPacking, pieceQuantity, round, makePayload } from './core.js';
const pick = (object, keys) => Object.fromEntries(keys.filter(k => object[k] !== undefined).map(k => [k, object[k]]));
export function prefillInvoice(invoice, masters, config, taxes = []) {
  const lines = invoice.line_items.map(l => {
    const master = masters[String(l.item_id)];
    if (!master) throw new Error(`Could not load item master for ${l.name || l.item_id}.`);
    const packing = itemPacking(master, config.itemFields);
    const pieces = packing.pieces || 1;
    const tax = l.tax_id ? taxes.find(t => String(t.id) === String(l.tax_id)) || {id:String(l.tax_id),name:l.tax_name || 'ERP tax',percentage:Number(l.tax_percentage || 0)} : null;
    return {...packing, original:l, line_item_id:l.line_item_id, item_id:String(l.item_id), name:l.name || master.name, sku:master.sku, unit:l.unit || master.unit,
      quantity:Number(l.quantity) / (config.invoiceQuantityMode === 'pieces' ? pieces : 1),
      rate:Number(l.rate) / (config.invoiceQuantityMode === 'order' ? pieces : 1),
      tax, tax_exemption_id:l.tax_exemption_id, salesorder_item_id:l.salesorder_item_id,
      discount:l.discount ?? 0, stock:master.available_stock,
      tracked:!!(master.is_serial_number_tracking_enabled || master.is_batch_tracking_enabled || master.is_storage_location_enabled || l.serial_numbers?.length || l.batches?.length || l.storages?.length)};
  });
  const discount = String(invoice.discount ?? 0);
  return {original:invoice, lines, customer:{contact_id:String(invoice.customer_id),contact_name:invoice.customer_name,gst_no:invoice.gst_no,billing_address:invoice.billing_address || {},shipping_address:invoice.shipping_address || {}},
    values:{invoice_number:invoice.invoice_number || '',date:invoice.date, salesperson_id:invoice.salesperson_id || '',location_id:invoice.location_id || '',payment_terms:invoice.payment_terms ?? 0,
      place_of_supply:invoice.place_of_supply || '',shipping_gst_no:invoice.shipping_gst_no || '',notes:invoice.notes || '',discount:parseFloat(discount) || 0,discountType:discount.includes('%')?'percent':'amount',rounded:false,adjustment:Number(invoice.adjustment || 0),sameAsBilling:false,
      custom:Object.fromEntries(Object.entries(config.customFields).map(([k,m]) => [k,(invoice.custom_fields || []).find(f => String(f.customfield_id) === String(m.id))?.value ?? (k==='pending'?false:'')]))}};
}
const discountAmount = (base, value) => String(value).includes('%') ? base * parseFloat(value) / 100 : Number(value || 0);
export function editTotals(lines, values, original = {}) {
  let subtotal=0, tax=0, discount=0; const taxes = new Map();
  const raw = lines.map(l => round(pieceQuantity(l)*l.rate));
  const sum=raw.reduce((a,b)=>a+b,0);
  const entityDiscount=discountAmount(sum, values.discountType==='percent'?`${values.discount}%`:values.discount);
  lines.forEach((l,i)=>{
    const d=original.discount_type==='item_level'?discountAmount(raw[i],l.discount):entityDiscount*(sum?raw[i]/sum:0);
    const percentage=Number(l.tax?.percentage || 0)/100;
    let base=raw[i], taxValue;
    if(original.is_inclusive_tax){base=raw[i]/(1+percentage);const net=(raw[i]-d)/(1+percentage);taxValue=original.is_discount_before_tax===false?raw[i]-base:raw[i]-d-net;}
    else taxValue=(original.is_discount_before_tax===false?base:base-d)*percentage;
    subtotal+=base;discount+=original.is_inclusive_tax&&original.is_discount_before_tax!==false?d/(1+percentage):d;
    taxValue=round(taxValue);tax+=taxValue;
    if(l.tax)taxes.set(l.tax.name,round((taxes.get(l.tax.name)||0)+taxValue));
  });
  subtotal=round(subtotal);discount=round(discount);tax=round(tax);
  const taxable=round(subtotal-discount), before=round(taxable+tax+Number(original.shipping_charge||0));
  const adjustment=values.rounded?round(Math.round(before)-before):Number(values.adjustment||0);
  return {subtotal,discount,taxable,tax,adjustment,total:round(before+adjustment),taxes:[...taxes]};
}
export function makeUpdatePayload(state, values, config) {
  if(!state.original?.invoice_id)throw new Error('Missing original invoice ID.');
  const p=makePayload(state,values,config), original=state.original;
  Object.assign(p,pick(original,['currency_id','exchange_rate','reference_number','terms','shipping_charge','shipping_charge_tax_id','gst_treatment','is_inclusive_tax','is_discount_before_tax','discount_type','template_id','tax_id','tax_exemption_id','tags']));
  p.invoice_number=values.invoice_number;
  if(values.date===original.date && Number(values.payment_terms)===Number(original.payment_terms) && original.due_date)p.due_date=original.due_date;
  p.gst_no=state.customer.gst_no || '';
  p.billing_address=state.customer.billing_address;
  p.shipping_address=values.sameAsBilling?state.customer.billing_address:state.customer.shipping_address;
  p.shipping_gst_no=values.shipping_gst_no;
  p.salesperson_id=values.salesperson_id;
  p.adjustment=editTotals(state.lines,values,original).adjustment;
  p.adjustment_description=original.adjustment_description || 'Rounding';
  if(original.discount_type==='item_level')p.discount=original.discount ?? 0;
  const fields=new Map((original.custom_fields||[]).map(f=>[String(f.customfield_id),{customfield_id:String(f.customfield_id),value:f.value}]));
  for(const [k,m] of Object.entries(config.customFields))if(m.id)fields.set(String(m.id),{customfield_id:String(m.id),value:values.custom[k]});
  p.custom_fields=[...fields.values()];
  p.line_items=p.line_items.map((l,i)=>({...pick(state.lines[i].original||{},['line_item_id','description','name','unit','hsn_or_sac','location_id','project_id','tags','item_custom_fields','discount','salesorder_item_id','tax_exemption_code','tds_tax_id']),...l,...(original.discount_type==='item_level'?{discount:state.lines[i].discount ?? 0}:{}),...(state.lines[i].line_item_id?{line_item_id:String(state.lines[i].line_item_id)}:{})}));
  return p;
}
