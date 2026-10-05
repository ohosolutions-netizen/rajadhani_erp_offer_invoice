import { decodeResponse } from './core.js';
export class ERP {
  constructor(config, sdk) { this.config = config; this.sdk = sdk; this.ready = false; }
  async init() {
    if (!this.sdk) throw new Error('Open this widget inside Zoho ERP to connect to your records.');
    await this.sdk.extension.init();
    const context = await this.sdk.get('organization');
    this.organization = context.organization || context;
    this.config.organizationId ||= String(this.organization.organization_id || '');
    this.ready = true;
    // Physical screen dimensions overestimate the usable browser viewport.
    // Read the host viewport when same-origin; otherwise reserve generous chrome margins.
    let viewportWidth = window.outerWidth || 1100;
    let viewportHeight = window.outerHeight || 800;
    try {
      viewportWidth = window.top.innerWidth;
      viewportHeight = window.top.innerHeight;
    } catch { /* Cross-origin host: use conservative browser-window bounds. */ }
    const width = Math.max(280, Math.min(1280, viewportWidth - 40));
    const height = Math.max(240, Math.min(820, viewportHeight - 90));
    try {
      await this.sdk.invoke('RESIZE', { width: `${width}px`, height: `${height}px` });
    } catch { /* Host may constrain popup dimensions. */ }
    return this.organization;
  }
  async request(path, query = {}, method = 'GET', payload) {
    if (!this.ready) throw new Error('ERP is not connected. Open the widget inside Zoho ERP.');
    if (!this.config.connectionLinkName || !this.config.organizationId) throw new Error('Complete the ERP connection settings to load records.');
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Lookup paths must be relative ERP API paths.');
    const options = {
      url: `${this.config.apiBase.replace(/\/$/, '')}${path}`, method,
      url_query: Object.entries({ organization_id: this.config.organizationId, ...query }).filter(([,v]) => v !== '' && v != null).map(([key, value]) => ({ key, value: String(value) })),
      connection_link_name: this.config.connectionLinkName
    };
    if (payload) {
      options.header = [{ key: 'Content-Type', value: 'application/json' }];
      options.body = { mode: 'raw', raw: JSON.stringify(payload) };
    }
    try {
      return decodeResponse(await this.sdk.request(options));
    } catch (err) {
      if (/not authorized|permission|oauth|scope/i.test(err.message || '')) {
        const scope = path.startsWith('/contacts') ? 'ERP.contacts.READ' : path.startsWith('/salesorders') ? 'ERP.salesorders.READ' : path.startsWith('/invoices') ? (method === 'PUT' ? 'ERP.invoices.UPDATE' : 'ERP.invoices.READ') : 'ERP.settings.READ';
        err.message = `${err.message} Access denied for ${path}. Check ${scope} in erp_admin, reauthorize the connection for the current user, and verify access to organization ${this.config.organizationId}.`;
      }
      throw err;
    }
  }
  async all(path, key, query = {}) {
    const records = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.request(path, { ...query, page, per_page: 200 });
      if (!Array.isArray(result[key])) throw new Error(`ERP did not return ${key} for ${path}. Check the configured lookup.`);
      records.push(...result[key]);
      const context = Array.isArray(result.page_context) ? result.page_context[0] : result.page_context;
      if (!context?.has_more_page) return records;
    }
    throw new Error(`Too many records in ${path}; configure a narrower lookup.`);
  }
  async salespersons() {
    const normalize = records => records
      .filter(r => r.status !== 'inactive' && r.is_active !== false)
      .map(r => ({
        salesperson_id: String(r.salesperson_id || r.user_id || r.id || ''),
        salesperson_name: r.salesperson_name || r.name || r.full_name || r.email || r.user_name || String(r.salesperson_id || r.user_id || r.id || '')
      }))
      .filter(r => r.salesperson_id && r.salesperson_name);
    try {
      const result = await this.request('/salespersons', { page: 1, per_page: 200 });
      const records = result.salespersons || result.users || result.data;
      if (Array.isArray(records)) return normalize(records);
    } catch {
      // Not every ERP tenant exposes a salespersons endpoint.
    }
    return normalize(await this.all('/users', 'users'));
  }
  async searchCustomers(text, page = 1) {
    const query = text.trim();
    const result = await this.request('/contacts', { contact_type: 'customer', contact_name_contains: query, page, per_page: 25 });
    // Some ERP tenants ignore search_text; use the documented name filter and
    // never display unrelated records if the server ignores that filter too.
    if (query && Array.isArray(result.contacts)) {
      const needle = query.normalize('NFKC').toLocaleLowerCase();
      result.contacts = result.contacts.filter(c => String(c.contact_name || '').normalize('NFKC').toLocaleLowerCase().includes(needle));
    }
    return result;
  }
  searchItems(text, page = 1) { return this.request('/items', { search_text: text, page, per_page: 25 }); }
  async customer(id) { return (await this.request(`/contacts/${encodeURIComponent(id)}`)).contact; }
  async item(id) { return (await this.request(`/items/${encodeURIComponent(id)}`)).item; }
  async itemMaster(id) { return (await this.request(`/itemmasters/${encodeURIComponent(id)}`)).item_master; }
  async salesOrder(id) { return (await this.request(`/salesorders/${encodeURIComponent(id)}`)).salesorder; }
  async currentInvoice() {
    const context = await this.sdk.get('invoice');
    const invoice = context?.invoice || context;
    const id = invoice?.invoice_id;
    if (!id) throw new Error('No invoice context. Open Rajadhani Edit Invoice from an invoice details page.');
    // Always fetch authoritative details, even when the host supplies a partial snapshot.
    const full = (await this.request(`/invoices/${encodeURIComponent(id)}`)).invoice;
    if (!full || String(full.invoice_id) !== String(id) || !Array.isArray(full.line_items)) throw new Error('ERP did not return complete invoice details. Close and reopen the editor.');
    return full;
  }
  updateInvoice(id, payload) {
    if (!id) throw new Error('An existing invoice ID is required.');
    return this.request(`/invoices/${encodeURIComponent(id)}`, { send: false }, 'PUT', payload);
  }
  async refreshInvoices() {
    for (const args of [['REFRESH_DATA', 'invoice'], ['REFRESH_DATA', { entity: 'invoice' }], ['REFRESH_DATA']]) {
      try { await this.sdk.invoke(...args); return true; } catch { /* Try the next host-supported shape. */ }
    }
    try { window.top.location.reload(); return true; } catch { return false; }
  }
}
