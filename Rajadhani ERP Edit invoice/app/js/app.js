import { prefillInvoice, makeUpdatePayload, editTotals } from './edit.js';
import { ERP } from './erp.js';
import { calculate, validateInvoice, makePayload, pieceQuantity, itemPacking } from './core.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const config = await fetch(new URL('../config.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('Cannot load widget configuration'); return r.json(); });
const api = new ERP(config, window.ZFAPPS);
const state = { customer: null, lines: [], taxes: [], currency: 'INR', busy: false, saved: false, uncertain: false, customerVersion: 0, pendingOperations: 0 };
let approvedPayload = null;
function currentTotals(v) { return editTotals(state.lines,v,state.original); }
function lockForm(locked) { $('invoiceForm').inert=locked; $('saveButton').disabled=locked; }
lockForm(true);
function pending(delta) { state.pendingOperations += delta; $('saveButton').disabled = state.pendingOperations > 0 || state.saved || state.uncertain; }
const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: state.currency }).format(Number.isFinite(n) ? n : 0);
function notice(message, kind = '') { $('notice').textContent = message; $('notice').className = `notice ${kind}`; $('notice').hidden = !message; }
function error(err) { notice(err.message || String(err), 'error'); }
function fieldMarkup(key) {
  const f = config.customFields[key];
  const type = /phone|mobile|whatsapp/i.test(key) ? 'tel' : 'text';
  const input = config.lookupSources[key] ? `<select id="cf_${key}" ${f.required ? 'required' : ''}><option value="">Select ${esc(f.label.toLowerCase())}</option></select>` : `<input id="cf_${key}" type="${type}" ${f.required ? 'required' : ''} placeholder="${key === 'billCreatedBy' ? 'Current ERP user' : esc(f.label)}">`;
  if (key === 'pending') return `<label class="check"><input id="cf_pending" type="checkbox"> Invoice pending</label>${!f.id ? '<small class="unmapped">Not sent until mapped</small>' : ''}`;
  return `<div class="field"><label for="cf_${key}">${esc(f.label)} ${f.required && f.id ? '<em>*</em>' : ''}</label>${input}${!f.id ? '<small class="mappinghint">Not sent to ERP yet</small>' : ''}</div>`;
}
$('billingFields').innerHTML = ['billType','saleType','billCreatedBy','mobile','whatsapp','shippingPhone'].map(fieldMarkup).join('');
$('dispatchFields').innerHTML = ['transport','agent','vehicle'].map(fieldMarkup).join('');
$('pendingField').innerHTML = fieldMarkup('pending');
$('invoiceDate').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10);
function getValues() {
  return { invoice_number:$('invoiceNumber').value.trim(), adjustment:Number($('adjustment').value), date: $('invoiceDate').value, place_of_supply: $('placeOfSupply').value.trim().toUpperCase(), payment_terms: $('paymentTerms').value === '' ? 0 : Number($('paymentTerms').value), salesperson_id: $('salesperson').value, location_id: $('location').value,
    shipping_gst_no: $('shippingGst').value.trim(), notes: $('notes').value.trim(), sameAsBilling: $('sameAsBilling').checked,
    discount: Number($('discount').value), discountType: $('discountType').value, rounded: $('roundOff').checked,
    custom: Object.fromEntries(Object.keys(config.customFields).map(k => [k, k === 'pending' ? $('cf_pending').checked : $(`cf_${k}`).value.trim()])) };
}
function totals() {
  const v = getValues(); const t = currentTotals(v);
  for (const [id, key] of Object.entries({subtotal:'subtotal',discountAmount:'discount',taxable:'taxable',taxTotal:'tax',roundValue:'adjustment',grandTotal:'total'})) $(id).textContent = `${id === 'discountAmount' ? '− ' : ''}${money(t[key])}`;
  $('taxBreakdown').innerHTML = t.taxes.map(([name, amount]) => `<div class="summaryrow"><span>${esc(name)}</span><span>${esc(money(amount))}</span></div>`).join('');
  $('totalDetail').textContent = `${state.lines.length} item${state.lines.length === 1 ? '' : 's'} in this invoice`;
  $('lineCount').textContent = state.lines.length;
  $('qtySummary').textContent = `${state.lines.length} items · ${Math.round(state.lines.reduce((s,l)=>s+l.quantity,0)*1000)/1000} order qty · ${Math.round(state.lines.reduce((s,l)=>s+(l.pieces ? pieceQuantity(l) : 0),0)*1000)/1000} pieces`;
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notice('Item ERP response copied. Paste it here and I will map M Unit and Ratio exactly.', 'success');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    notice(copied ? 'Item ERP response copied. Paste it here and I will map M Unit and Ratio exactly.' : 'Could not copy automatically. Open the browser console and copy the Rajadhani item debug output.', copied ? 'success' : 'error');
  }
}
function renderLines(focusIndex = null) {
  $('emptyItems').hidden = !!state.lines.length;
  $('lineItems').innerHTML = state.lines.map((l,i) => `<tr><td>${i+1}</td><td class="itemname"><strong>${esc(l.name)}</strong>${state.original?.discount_type==='item_level'?`<label>Discount <input value="${esc(l.discount ?? 0)}" data-row="${i}" data-field="discount" aria-label="Discount for ${esc(l.name)}" placeholder="0 or 5%"></label>`:''}<small>${esc(l.sku || 'No SKU')} · HSN ${esc(l.hsn_or_sac || '—')}</small>${l.packingError ? `<small class="packingerror">${esc(l.packingError)}</small>${l.itemDebug ? `<button class="debugcopy" type="button" data-debug="${i}">Copy item response</button>` : ''}` : ''}</td><td>${esc(l.stock ?? '—')}<small>${esc(l.mu || l.unit || 'units')}</small></td><td>${esc(l.pieces || '—')}</td><td><input type="number" min="0.001" step="any" value="${l.quantity}" data-row="${i}" data-field="quantity" aria-label="Quantity for ${esc(l.name)}" required></td><td data-piece="${i}">${l.pieces ? l.pieces*l.quantity : '—'}</td><td><input type="number" min="0" step="0.01" value="${l.rate}" data-row="${i}" data-field="rate" aria-label="Rate for ${esc(l.name)}" required></td><td><select data-row="${i}" data-field="tax" aria-label="Tax for ${esc(l.name)}"><option value="">${l.tax_exemption_id ? 'ERP exempt' : 'Select tax'}</option>${state.taxes.map(t=>`<option value="${esc(t.id)}" ${String(l.tax?.id)===String(t.id)?'selected':''}>${esc(t.name)} (${t.percentage}%)</option>`).join('')}</select></td><td class="right" data-amount="${i}">${esc(money(pieceQuantity(l)*l.rate))}</td><td><button class="remove" type="button" data-remove="${i}" aria-label="Remove ${esc(l.name)}">×</button></td></tr>`).join('');
  totals();
  if (focusIndex != null) requestAnimationFrame(() => $('lineItems').children[focusIndex]?.scrollIntoView({block:'nearest'}));
}
$('lineItems').addEventListener('input', e => {
  const {row,field} = e.target.dataset; if (row == null || !field) return;
  const l=state.lines[Number(row)]; l[field] = field === 'tax' ? state.taxes.find(t=>String(t.id) === e.target.value) : field === 'discount' ? e.target.value : Number(e.target.value);
  document.querySelector(`[data-amount="${row}"]`).textContent = money(pieceQuantity(l)*l.rate);
  document.querySelector(`[data-piece="${row}"]`).textContent = l.pieces ? Math.round(l.pieces*l.quantity*1000)/1000 : '—'; totals();
});
$('lineItems').addEventListener('click', e => {
  const debug=e.target.closest('[data-debug]');
  if (debug) {
    const line=state.lines[Number(debug.dataset.debug)];
    if (line?.itemDebug) copyText(JSON.stringify(line.itemDebug, null, 2));
    return;
  }
  const b=e.target.closest('[data-remove]'); if (b) { state.lines.splice(Number(b.dataset.remove),1);renderLines(); }
});
['discount','discountType','roundOff','adjustment'].forEach(id=>$(id).addEventListener('input',totals));
function address(a) { return a ? [a.attention,a.address,a.street2,[a.city,a.state,a.zip].filter(Boolean).join(', '),a.country].filter(Boolean).join('\n') || 'No address recorded in ERP.' : 'No address recorded in ERP.'; }
function addresses() { $('billingAddress').textContent=address(state.customer?.billing_address);$('shippingAddress').textContent=address($('sameAsBilling').checked ? state.customer?.billing_address : state.customer?.shipping_address); }
$('sameAsBilling').addEventListener('change', addresses);
function selectOptions(id, records, idKey, nameKey, placeholder) { const current=$(id).value;$(id).replaceChildren(new Option(placeholder,''),...records.filter(r=>r.status!=='inactive'&&r.is_active!==false).map(r=>new Option(r[nameKey] || r.name || String(r[idKey]),String(r[idKey]))));if(records.some(r=>String(r[idKey])===current))$(id).value=current; }
async function chooseCustomer(record) {
  if(state.saved||state.busy||state.uncertain)return;
  const version=++state.customerVersion;
  state.customer=null; renderLines(); $('salesOrder').disabled=true;$('salesOrder').replaceChildren(new Option('Loading sales orders…',''));
  $('customerSearch').value=record.contact_name; $('customerHint').textContent='Loading customer details…';
  pending(1);
  try {
    const c=await api.customer(record.contact_id); if(version!==state.customerVersion)return;
    if(!c)throw new Error('ERP did not return the selected customer.');
    if(c.status==='inactive')throw new Error('This customer is inactive. Choose an active customer.');
    if(c.currency_code && api.organization?.currency_code && c.currency_code!==api.organization.currency_code)throw new Error('This customer uses another currency. Use the native ERP editor to apply exchange rates and price lists.');
    state.customer=c;state.currency=c.currency_code || api.organization?.currency_code || 'INR';$('currencyLabel').textContent=state.currency;
    $('customerSearch').value=c.contact_name; $('customerHint').textContent=[c.company_name,c.email].filter(Boolean).join(' · ') || 'Customer loaded from ERP';
    $('gstNumber').value=c.gst_no || ''; $('shippingGst').value=c.shipping_gst_no || '';
    $('placeOfSupply').value=c.place_of_contact || c.place_of_supply || ''; $('paymentTerms').value=c.payment_terms ?? 0;
    $('cf_mobile').value=c.mobile || c.contact_persons?.find(p=>p.is_primary_contact)?.mobile || c.phone || '';
    $('cf_shippingPhone').value=c.shipping_address?.phone || '';
    for(const [k,m] of Object.entries(config.customFields)) { const source=(c.custom_fields||[]).find(f=>m.customerApiName && f.api_name===m.customerApiName); if(source && k!=='pending')$(`cf_${k}`).value=source.value ?? ''; }
    addresses();totals();
    $('salesOrder').replaceChildren(new Option('Existing links preserved',''));$('salesOrder').disabled=true;
  }catch(e){if(version===state.customerVersion){error(e);$('customerHint').textContent=state.customer?'Customer loaded; sales order lookup failed.':'Could not load customer. Search again.';$('salesOrder').replaceChildren(new Option('Sales orders unavailable',''));}}finally{pending(-1);}
}
function searchable(inputId, resultsId, search, key, describe, choose) {
  const input=$(inputId), box=$(resultsId); let timer, sequence=0, page=1, query='';
  const close=()=>{box.hidden=true;input.setAttribute('aria-expanded','false');};
  async function run(append=false) {
    const token=++sequence; if(!append){page=1;query=input.value.trim();box.innerHTML='<p>Searching ERP…</p>';}
    box.hidden=false;input.setAttribute('aria-expanded','true');
    try { const r=await search(query,page);if(token!==sequence)return;const records=(r[key]||[]).filter(x=>x.status!=='inactive' && x.is_active!==false);
      if(!append)box.replaceChildren();else box.querySelector('[data-more]')?.remove();
      if(!records.length&&!append)box.innerHTML='<p>No matching records. Try a different search.</p>';
      records.forEach(record=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','option');const [name,detail]=describe(record);b.innerHTML=`${esc(name)}<span>${esc(detail)}</span>`;b.onclick=async()=>{close();try{await choose(record);}catch(e){error(e);}};box.append(b);});
      const ctx=Array.isArray(r.page_context)?r.page_context[0]:r.page_context;if(ctx?.has_more_page){const b=document.createElement('button');b.type='button';b.dataset.more='true';b.textContent='Load more results →';b.onclick=()=>{page++;run(true);};box.append(b);}
    }catch(e){if(token===sequence)box.innerHTML=`<p>${esc(e.message)}</p>`;}
  }
  input.addEventListener('input',()=>{sequence++;clearTimeout(timer);box.replaceChildren();close();timer=setTimeout(()=>run(),280);});
  input.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='ArrowDown'){e.preventDefault();if(box.hidden)run();else box.querySelector('button')?.focus();}if(e.key==='Enter'){e.preventDefault();const options=box.querySelectorAll('button[role=option]');if(options.length===1&&!box.hidden)options[0].click();else run();}});
  box.addEventListener('keydown',e=>{const buttons=[...box.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(e.key==='Escape'){close();input.focus();}});
  document.addEventListener('click',e=>{if(!box.contains(e.target)&&e.target!==input)close();});
  return run;
}
searchable('customerSearch','customerResults',(q,p)=>api.searchCustomers(q,p),'contacts',c=>[c.contact_name,[c.company_name,c.mobile || c.email].filter(Boolean).join(' · ')],chooseCustomer);
$('customerSearch').addEventListener('input',()=>{state.customerVersion++;state.customer=null;renderLines();$('salesOrder').disabled=true;$('salesOrder').replaceChildren(new Option('Select a customer first',''));$('gstNumber').value='';$('shippingGst').value='';$('placeOfSupply').value='';$('paymentTerms').value='';['mobile','whatsapp','shippingPhone'].forEach(k=>$(`cf_${k}`).value='');$('customerHint').textContent='Choose a matching ERP customer';addresses();});
function normalizeTax(t){return {id:String(t.tax_id || t.tax_group_id),name:t.tax_name || t.tax_group_name || t.name,percentage:Number(t.tax_percentage ?? t.tax_group_percentage ?? 0)};}
function debugSnapshot(selectedRecord, itemResponse, masterId, masterResponse, mergedItem, masterError) {
  const clean = value => JSON.parse(JSON.stringify(value, (key, data) => key === '__rajadhaniDebug' ? undefined : data));
  return {
    selectedRecord: clean(selectedRecord),
    itemResponse: clean(itemResponse),
    masterId: masterId ?? null,
    masterResponse: masterResponse ? clean(masterResponse) : null,
    mergedItem: clean(mergedItem),
    ...(masterError ? {masterError} : {})
  };
}
async function fullItem(record) {
  const item = await api.item(record.item_id);
  if (!item) throw new Error('ERP did not return item details.');
  const masterId = item.item_master_id || record.item_master_id || item.group_id || record.group_id;
  if (!masterId) {
    item.__rajadhaniDebug = debugSnapshot(record, item, null, null, item);
    console.info('Rajadhani item debug', item.__rajadhaniDebug);
    return item;
  }
  try {
    const master = await api.itemMaster(masterId);
    if (!master) {
      item.__rajadhaniDebug = debugSnapshot(record, item, masterId, null, item);
      console.info('Rajadhani item debug', item.__rajadhaniDebug);
      return item;
    }
    const merged = {
      ...master,
      ...item,
      custom_fields: [...(master.custom_fields || []), ...(item.custom_fields || [])],
      custom_field_hash: {...(master.custom_field_hash || master.customfield_hash || {}), ...(item.custom_field_hash || item.customfield_hash || {})}
    };
    merged.__rajadhaniDebug = debugSnapshot(record, item, masterId, master, merged);
    console.info('Rajadhani item debug', merged.__rajadhaniDebug);
    return merged;
  } catch (err) {
    notice(`Item master custom fields could not be loaded for ${item.name || record.name}. Check ERP.items.READ/settings access or map the item custom-field IDs in app/config.json. ${err.message}`, 'error');
    item.__rajadhaniDebug = debugSnapshot(record, item, masterId, null, item, err.message);
    console.info('Rajadhani item debug', item.__rajadhaniDebug);
    return item;
  }
}
async function lineFromItem(item, extra={}) {
  let tax=state.taxes.find(t=>String(t.id)===String(item.tax_id));
  if(item.tax_id&&!tax){tax=normalizeTax(item);if(tax.name && Number.isFinite(tax.percentage))state.taxes.push(tax);else tax=null;}
  const packing = itemPacking(item, config.itemFields);
  return {item_id:String(item.item_id),name:item.name,sku:item.sku,hsn_or_sac:item.hsn_or_sac,stock:item.available_stock ?? item.stock_on_hand,unit:item.unit,rate:Number(item.rate||0),quantity:1,tax,tax_exemption_id:item.tax_exemption_id,...packing,itemDebug:item.__rajadhaniDebug,tracked:!!(item.is_serial_number_tracking_enabled||item.is_batch_tracking_enabled||item.is_storage_location_enabled),...extra};
}
async function addItem(record) {
  if(state.saved||state.busy||state.uncertain)return;
  if(!state.customer)throw new Error('Select a customer before adding items.');
  const version=state.customerVersion;pending(1);
  try{const item=await fullItem(record);if(version!==state.customerVersion)return;
    const line=await lineFromItem(item);if(line.tracked)throw new Error('This item requires batch, serial or storage allocation. Please use the native ERP invoice editor.');
    const existingIndex=state.lines.findIndex(l=>l.item_id===line.item_id&&!l.salesorder_item_id&&!l.line_item_id);if(existingIndex>=0)state.lines[existingIndex].quantity++;else state.lines.push(line);
    $('itemSearch').value='';renderLines(existingIndex>=0?existingIndex:state.lines.length-1);$('itemSearch').focus();
  }finally{pending(-1);}
}
const browse=searchable('itemSearch','itemResults',(q,p)=>api.searchItems(q,p),'items',i=>[i.name,`${i.sku || 'No SKU'} · ${money(Number(i.rate||0))} · Stock ${i.available_stock ?? i.stock_on_hand ?? '—'}`],addItem);
$('browseItems').onclick=()=>{$('itemSearch').focus();browse();};
async function loadLookups() {
  const jobs=[
    {name:'customers',run:()=>api.searchCustomers('',1)},
    {name:'items',run:()=>api.searchItems('',1)},
    {name:'taxes',run:async()=>{state.taxes=(await api.all('/settings/taxes','taxes')).filter(t=>t.is_active!==false).map(normalizeTax);renderLines();}},
    {name:'salespersons',run:async()=>{const source=config.lookupSources.salesperson;if(source)selectOptions('salesperson',await api.all(source.path,source.key,source.query),source.idKey,source.labelKey,'Select salesperson');else selectOptions('salesperson',await api.salespersons(),'salesperson_id','salesperson_name','Select salesperson');}},
    {name:'locations',run:async()=>{selectOptions('location',await api.all('/locations','locations'),'location_id','location_name','Organization default');}},
    ...Object.entries(config.lookupSources).filter(([key])=>key!=='salesperson').map(([key,source])=>({name:config.customFields[key]?.label||key,run:async()=>{if(!$(`cf_${key}`))return;selectOptions(`cf_${key}`,await api.all(source.path,source.key,source.query),source.idKey,source.labelKey,`Select ${config.customFields[key].label.toLowerCase()}`);}}))
  ];
  const results=await Promise.allSettled(jobs.map(j=>j.run()));const failures=results.flatMap((r,i)=>r.status==='rejected'?[`${jobs[i].name}: ${r.reason.message}`]:[]);
  if(failures.length)notice(`Some ERP lists could not load. ${failures.join(' • ')}`,'error');
  else notice('');
  return failures;
}
function setValue(id, value) {
  const el=$(id); const text=String(value ?? '');
  if(el.tagName==='SELECT' && text && ![...el.options].some(o=>o.value===text))el.add(new Option(text,text));
  el.value=text;
}
async function connect() {
  lockForm(true);
  try {
    await api.init();
    const invoice=await api.currentInvoice();
    await loadLookups();
    const masters={};
    for(const l of invoice.line_items)if(!masters[l.item_id])masters[l.item_id]=await fullItem(l);
    const mapped=prefillInvoice(invoice,masters,config,state.taxes);
    Object.assign(state,{original:invoice,customer:mapped.customer,lines:mapped.lines,currency:invoice.currency_code||'INR'});
    for(const l of state.lines)if(l.tax&&!state.taxes.some(t=>t.id===l.tax.id))state.taxes.push(l.tax);
    const v=mapped.values;
    for(const [id,key] of Object.entries({invoiceNumber:'invoice_number',invoiceDate:'date',salesperson:'salesperson_id',location:'location_id',paymentTerms:'payment_terms',placeOfSupply:'place_of_supply',shippingGst:'shipping_gst_no',notes:'notes',discount:'discount',discountType:'discountType',adjustment:'adjustment'}))setValue(id,v[key]);
    for(const [k,value] of Object.entries(v.custom))if(k==='pending')$('cf_pending').checked=value===true||value==='true';else setValue(`cf_${k}`,value);
    $('customerSearch').value=invoice.customer_name || invoice.customer_id;
    $('gstNumber').value=invoice.gst_no || '';
    $('currencyLabel').textContent=state.currency;
    $('sameAsBilling').checked=false;
    $('discount').disabled=invoice.discount_type==='item_level';
    $('discountType').disabled=invoice.discount_type==='item_level';
    $('salesOrder').replaceChildren(new Option(invoice.salesorder_number || 'Existing links preserved',''));
    $('salesOrder').disabled=true;
    addresses();renderLines();
    lockForm(false);
    notice(`Editing ${invoice.invoice_number || invoice.invoice_id}. ERP will validate whether this invoice can be updated.`);
  }catch(e){error(e);}
}
$('settingsButton').onclick=()=>{$('connectionName').value=config.connectionLinkName;$('orgId').value=config.organizationId;$('settingsDialog').showModal();};
$('connectButton').onclick=async()=>{if(state.lines.length||state.customer){notice('Start over before changing the ERP connection.');$('settingsDialog').close();return;}config.connectionLinkName=$('connectionName').value.trim();config.organizationId=$('orgId').value.trim();$('settingsDialog').close();await connect();};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('resetButton').onclick=()=>$('resetDialog').showModal();$('confirmReset').onclick=()=>location.reload();
$('invoiceForm').addEventListener('submit',e=>{
  e.preventDefault();if(state.saved||state.busy||state.uncertain)return;
  if(state.pendingOperations){notice('Wait for ERP records to finish loading before reviewing.');return;}
  const v=getValues(),errors=validateInvoice(state,v,config);if(!Number.isFinite(v.adjustment))errors.push('Enter a valid rounding adjustment.');
  for(const l of state.lines){if(!/^\d+(\.\d+)?%?$/.test(String(l.discount ?? 0)) || (String(l.discount).includes('%') ? parseFloat(l.discount)>100 : Number(l.discount)>pieceQuantity(l)*l.rate))errors.push('Enter a valid line discount (amount or percentage).');}
  if(errors.length){notice(errors.join(' '),'error');return;}
  approvedPayload=makeUpdatePayload(state,v,config);const t=currentTotals(v);
  $('reviewContent').innerHTML=`<div class="summaryrow"><span>Customer</span><strong>${esc(state.customer.contact_name)}</strong></div><div class="summaryrow"><span>Invoice date</span><strong>${esc(v.date)}</strong></div>${state.lines.map(l=>`<div class="summaryrow"><span>${esc(l.name)} · ${l.quantity} × ${l.pieces ?? "?"} = ${l.pieces ? pieceQuantity(l) : "?"} pieces</span><strong>${esc(money(pieceQuantity(l)*l.rate))}</strong></div>`).join('')}<div class="grandtotal"><span>Estimated invoice total</span><strong>${esc(money(t.total))}</strong></div><p>This updates the existing invoice. The customer will not be emailed. ERP calculates the final total.</p>`;
  $('saveStatus').textContent='';$('confirmSave').disabled=false;$('reviewDialog').showModal();
});
$('confirmSave').onclick=async()=>{
  if(state.busy||state.saved||state.uncertain||!approvedPayload)return;
  state.busy=true;lockForm(true);$('confirmSave').disabled=true;$('saveStatus').textContent='Saving invoice to ERP…';
  try{const result=await api.updateInvoice(state.original.invoice_id,approvedPayload);if(!result.invoice?.invoice_id || String(result.invoice.invoice_id)!==String(state.original.invoice_id))throw new Error('ERP did not confirm the updated invoice ID.');
    state.saved=true;$('reviewDialog').close();$('invoiceNumber').value=result.invoice.invoice_number || result.invoice.invoice_id;$('saveButton').disabled=true;$('saveButton').textContent='Saved to ERP ✓';
    notice(`Invoice ${result.invoice.invoice_number || result.invoice.invoice_id} updated in ERP (${result.invoice.status || 'updated'}). Final total: ${money(Number(result.invoice.total))}.`,'success');
    $('invoiceForm').querySelectorAll('input,select,textarea,button').forEach(e=>e.disabled=true);
    await api.refreshInvoices();
  }catch(e){if(e.apiRejected){lockForm(false);$('saveStatus').textContent=e.message;$('confirmSave').disabled=false;}else{state.uncertain=true;$('saveButton').disabled=true;$('saveStatus').textContent='Could not confirm the result. Close this modal and check the invoice details before reopening the editor. '+e.message;}}finally{state.busy=false;}
};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('customerSearch').focus();}});

$('closeWidget').onclick=async()=>{try{await api.sdk.invoke('CLOSE');}catch{notice('Use the ERP modal close (×) button to close this editor.');}};
renderLines();await connect();
