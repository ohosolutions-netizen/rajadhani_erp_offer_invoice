export const pieceQuantity = line => line.quantity * (line.pieces === null ? 0 : (line.pieces ?? 1));
export function itemPacking(item, fields = {}) {
  const normalize = value => String(value || '').trim().toLowerCase().replace(/[\s_.-]+/g, '');
  const withoutPrefix = value => value.replace(/^(cf|customfield)/, '');
  function labelMatches(value, wantedLabels) {
    const normalized = normalize(value);
    return wantedLabels.includes(normalized) || wantedLabels.includes(withoutPrefix(normalized));
  }
  function readHash(object, labels) {
    const wantedLabels = labels.map(normalize);
    for (const [key, value] of Object.entries(object || {})) {
      if (labelMatches(key, wantedLabels)) return value;
    }
    return undefined;
  }
  function read(mapping, labels) {
    const wantedLabels = labels.map(normalize);
    const mapped = normalize(mapping);
    const custom = item.custom_fields || [];
    const matches = custom.filter(f => {
      const apiName = normalize(f.api_name);
      const fieldId = normalize(f.customfield_id);
      const fieldLabel = normalize(f.label);
      return mapped ? apiName === mapped || fieldId === mapped || fieldLabel === mapped : labelMatches(fieldLabel, wantedLabels) || labelMatches(apiName, wantedLabels);
    });
    // Parent and variant responses can repeat the same custom field.
    // Prefer the last non-empty value (the variant), retaining the parent fallback.
    const populated = matches.filter(f => f.value !== undefined && f.value !== null && f.value !== '');
    if (populated.length) return populated[populated.length - 1].value;
    if (mapping && item[mapping] != null) return item[mapping];
    const hashLabels = mapping ? [mapping] : labels;
    const hashValue = readHash(item.custom_field_hash, hashLabels) ?? readHash(item.customfield_hash, hashLabels);
    if (hashValue != null) return hashValue;
    const direct = Object.keys(item).find(key => labelMatches(key, wantedLabels));
    if (direct) return item[direct];
    return undefined;
  }
  const ratioValue = read(fields.ratio || fields.piecesPerPack, ['ratio', 'pieces per pack', 'piecesperpack', 'pack ratio']);
  const ratio = Number(ratioValue);
  let mu = String(read(fields.mu, ['mu', 'm unit', 'munit', 'm_unit', 'measurement unit']) ?? '').trim().toLowerCase();
  if (!mu) {
    const category = String(read(fields.category, ['item category', 'itemcategory', 'category']) ?? item.item_category ?? item.category_name ?? item.group_name ?? item.name ?? '').toLowerCase();
    if (/\bsets?\b/.test(category)) mu = 'set';
    else if (Number.isInteger(ratio) && ratio > 1) mu = 'set';
    else if (['pcs','pc','piece','pieces'].includes(String(item.unit || '').trim().toLowerCase())) mu = 'pieces';
  }
  if (['piece','pieces','pcs','pc'].includes(mu)) return {mu:'Pieces',pieces:1};
  if (['set','sets'].includes(mu)) {
    if (Number.isInteger(ratio) && ratio > 0) return {mu:'Set',pieces:ratio};
    return {mu:'Set',pieces:null,packingError:'Set items require a positive whole-number Ratio in the item master.'};
  }
  return {mu:mu || 'Unknown',pieces:null,packingError:'M Unit must be Set or Pieces. Map M Unit and Ratio to the item master fields.'};
}
export const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function taxPreference(preferences = [], intraState = true) {
  const value = tax => `${tax?.tax_name || tax?.tax_group_name || tax?.name || ''}`.toLowerCase();
  const specification = tax => String(tax?.tax_specification || '').toLowerCase();
  const type = tax => String(tax?.tax_specific_type || '').toLowerCase();
  return intraState
    ? preferences.find(tax => specification(tax) === 'intra')
      || preferences.find(tax => type(tax) === 'tax' && !value(tax).includes('igst'))
    : preferences.find(tax => specification(tax) === 'inter')
      || preferences.find(tax => type(tax) === 'igst')
      || preferences.find(tax => value(tax).includes('igst'));
}
export function lineAmounts(line) {
  const gross = round(pieceQuantity(line) * line.rate);
  const discount = round(gross * (line.discount ?? 0) / 100);
  return { gross, discount, taxable: round(gross - discount) };
}
export function hasValidDiscount(line) {
  const discount = line.discount;
  return Number.isFinite(discount) && discount > 0 && discount <= 100;
}
export function calculate(lines, rounded = false, intraState = false) {
  const invoiceLines = lines.filter(l => !l.notFound);
  const subtotal = round(invoiceLines.reduce((s, l) => s + round(pieceQuantity(l) * l.rate), 0));
  const discountAmount = round(invoiceLines.reduce((sum, line) => sum + lineAmounts(line).discount, 0));
  const taxable = round(subtotal - discountAmount);
  const taxMap = new Map();
  const tax = round(invoiceLines.reduce((s, l) => {
    const base = lineAmounts(l).taxable;
    // Round each GST component independently, as ERP does for line taxes.
    // Never assign the odd paise to just one side of CGST/SGST.
    const rawTax = base * (l.tax?.percentage || 0) / 100;
    const amount = intraState ? round(round(rawTax / 2) * 2) : round(rawTax);
    if (l.tax) taxMap.set(l.tax.name, round((taxMap.get(l.tax.name) || 0) + amount));
    return s + amount;
  }, 0));
  const beforeRounding = round(taxable + tax);
  const adjustment = rounded ? round(Math.round(beforeRounding) - beforeRounding) : 0;
  return { subtotal, discount: discountAmount, taxable, tax, cgst: intraState ? round(tax / 2) : 0, sgst: intraState ? round(tax / 2) : 0, adjustment, total: round(beforeRounding + adjustment), taxes: [...taxMap] };
}
export function validateInvoice(state, values, config) {
  const errors = [];
  if (!state.customer) errors.push('Select a customer from the ERP search results.');
  if (!values.date) errors.push('Choose an invoice date.');
  if (!/^[A-Z]{2}$/.test(values.place_of_supply)) errors.push('Enter a valid two-letter place-of-supply state code.');
  if (values.shipping_gst_no && values.shipping_gst_no.length !== 15) errors.push('Shipping GSTIN must contain exactly 15 characters, or be left blank.');
  const invoiceLines = state.lines.filter(l => !l.notFound);
  if (!invoiceLines.length) errors.push('Add at least one item.');
  if (state.lines.some(l => l.notFound)) errors.push('Remove or correct scanned items marked Item not found.');
  if (config.requireSalesperson && !values.salesperson_id) errors.push('Select a salesperson.');
  if (config.requireLocation && !values.location_id) errors.push('Select a business location.');
  if (!['pieces','order'].includes(config.invoiceQuantityMode)) errors.push('Confirm how order quantity and P. quantity should be saved to ERP before saving.');
  invoiceLines.forEach((line, index) => {
    if (!hasValidDiscount(line)) errors.push(`Item ${index + 1}${line.name ? ` (${line.name})` : ''}: enter a discount percentage greater than 0 and up to 100.`);
    if (line.packingError) errors.push(`Item ${index + 1}: ${line.packingError}`);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.rate) || line.rate < 0) errors.push(`Item ${index + 1}: enter a positive quantity and a non-negative rate.`);
    if (!line.tax && !line.tax_exemption_id) errors.push(`Item ${index + 1}: choose an ERP tax or use an item with a configured exemption.`);
    if (line.tracked) errors.push(`Item ${index + 1} needs serial, batch or storage allocation. Use the native ERP invoice editor for this item.`);
  });
  for (const [key, mapping] of Object.entries(config.customFields)) {
    const value = values.custom[key];
    if (mapping.required && (value === '' || value == null)) errors.push(`${mapping.label} is required.`);
  }
  return [...new Set(errors)];
}
export function makePayload(state, values, config) {
  const intraState = values.place_of_supply === (config.organizationStateCode || 'KL');
  const totals = calculate(state.lines, values.rounded, intraState);
  const payload = {
    customer_id: String(state.customer.contact_id), date: values.date,
    place_of_supply: values.place_of_supply,
    line_items: state.lines.filter(l => !l.notFound).map((l, index) => {
      const preferredTax = taxPreference(l.taxPreferences, intraState);
      const taxId = preferredTax?.tax_id || preferredTax?.tax_group_id || (!l.taxPreferences?.length ? l.tax?.id : null);
      return ({
      item_id: String(l.item_id), quantity: config.invoiceQuantityMode === 'pieces' ? pieceQuantity(l) : l.quantity, rate: config.invoiceQuantityMode === 'order' ? l.rate * (l.pieces ?? 1) : l.rate, item_order: index + 1,
      discount: `${l.discount ?? 0}%`,
      ...(taxId ? { tax_id: String(taxId) } : { tax_exemption_id: l.tax_exemption_id }),
      ...(l.salesorder_item_id ? { salesorder_item_id: String(l.salesorder_item_id) } : {})
    });}),
    discount_type: 'item_level', is_discount_before_tax: true, is_inclusive_tax: false,
    adjustment: totals.adjustment, adjustment_description: 'Rounding', notes: values.notes,
    custom_fields: Object.entries(config.customFields).filter(([k, m]) => m.id && values.custom[k] !== '' && values.custom[k] != null).map(([k, m]) => ({ customfield_id: String(m.id), value: values.custom[k] }))
  };
  if (values.salesperson_id) payload.salesperson_id = String(values.salesperson_id);
  if (values.location_id) payload.location_id = String(values.location_id);
  if (values.shipping_gst_no) payload.shipping_gst_no = values.shipping_gst_no;
  if (values.shipping_address) payload.shipping_address = { address: values.shipping_address };
  else if (values.sameAsBilling) payload.shipping_address = state.customer.billing_address || {};
  // Customer billing address and currency are deliberately inherited by ERP.
  return payload;
}
export function decodeResponse(response) {
  let body = response?.data?.body ?? response?.body ?? response;
  if (typeof body === 'string') body = JSON.parse(body);
  if (!body || typeof body !== 'object') throw new Error('ERP returned an unreadable response.');
  if (body.code != null && Number(body.code) !== 0) {
    const err = new Error(body.message || `ERP error ${body.code}`); err.apiRejected = true; throw err;
  }
  return body;
}
