# Rajadhani Invoice Edit

Separate Zoho ERP widget for editing the invoice currently open in its details page. The reference create-widget project and its ZIPs are not modified.

## Upload and placement

Upload **dist/RajadhaniInvoiceEdit.zip** as a new widget/extension package in your Zoho ERP developer/widget configuration, then install it in your organization and authorize its connection. Keep the existing invoice creation widget installed separately. Open an invoice details page and choose **Rajadhani Edit Invoice** from its widget button actions.

The ZIP root contains `plugin-manifest.json` and `app/`. Its sole placement is:

```json
{
  "location": "invoice.details.button",
  "name": "Rajadhani Edit Invoice",
  "url": "/app/widget.html",
  "logo": "/app/img/logo.svg",
  "widget_type": "modal"
}
```

Use this widget placement, not a native Custom Button configured with Open URL. The host launches an iframe modal. The SDK resize request uses the host viewport when accessible and conservative browser bounds otherwise; the host may constrain dimensions. The form has three bounded panels. Line items scroll independently and newly added/scanned items scroll into view; wide tables scroll inside their panel, not the document. Small screens allow internal scrolling in the other panels as well.

## Connection and scopes

`app/config.json` retains `https://www.zohoapis.in/erp/v3`, `connectionLinkName: erp_admin`, and runtime organization detection. The manifest retains the reference connection metadata (`serviceName`, user access and sharing metadata). Match `sharedBy` and connection ownership to the target organization if installing elsewhere; no credentials are packaged.

Authorize these scopes and reauthorize the connection after scope changes:

- `ERP.invoices.ALL`, or `ERP.invoices.READ` plus `ERP.invoices.UPDATE`.
- `ERP.contacts.READ` (or ALL) for customer lookup.
- `ERP.items.ALL` for items and master fields.
- `ERP.settings.READ` (or ALL) for tax/settings/location access, subject to tenant permissions.
- `ERP.users.ALL` for the salesperson fallback.
- `ERP.salesorders.READ` only if extending the existing links into sales-order lookups. Existing line links are preserved; the edit widget does not import sales orders.

## Edit behavior

1. Initialize `ZFAPPS.extension.init()` and read organization context.
2. Read `ZFAPPS.get("invoice")`. An absent invoice ID blocks editing and leaves Close available.
3. GET `/invoices/{invoice_id}` for an authoritative snapshot, including when the host supplies only the ID. Load the item masters and lookup lists.
4. Prefill the invoice customer, number/date, salesperson, terms, GST/place of supply, invoice-specific addresses, lines, discounts, existing adjustment and remarks. Customer GSTIN and addresses are displayed from the invoice snapshot. Selecting a different customer loads that customer's defaults without discarding the invoice lines. Same-as-billing explicitly copies billing into shipping in the update only.
5. Review changes, then PUT `/invoices/{invoice_id}` with `send=false`. There is no invoice POST or email request. No status transition is requested. ERP is authoritative for edit eligibility and final totals.
6. Existing line IDs, sales-order line links, descriptions, line custom fields and relevant tax metadata are retained. New lines omit line IDs; removed lines are omitted. Unmapped invoice custom fields are retained. Mapped custom fields can be edited or cleared.
7. After confirmed success, lock the form and show the saved invoice and ERP total. Try `REFRESH_DATA, "invoice"`, then `REFRESH_DATA, { entity: "invoice" }`, then `REFRESH_DATA`; only if all fail, attempt top-window reload when permitted. A successful host refresh/reload may dismiss the modal.
8. ERP rejections (status, payments, approval, lock periods or permissions) display the returned error and permit return to editing or closing. An ambiguous transport result disables further saves and asks the user to close/reopen after checking the invoice. Close falls back to the host modal's × control when the SDK close action is unsupported.

## Packing, tax and field configuration

`invoiceQuantityMode` is copied from the reference and defaults to `pieces`: ERP quantity is P. quantity, and ERP rate is per piece. Prefill divides ERP quantity by pieces per pack to recover order quantity. With `order`, ERP quantity is order quantity and ERP rate is per pack; prefill divides rate by pieces per pack. Confirm the configured convention matches invoices created outside the reference widget.

M Unit and Ratio are read from item/master custom fields using `itemFields.mu` and `itemFields.ratio` overrides or the reference label/hash detection. SET uses Ratio, Pieces uses 1. Missing M Unit with a SET category uses `cf_ratio`. P. quantity = order quantity × pieces per pack; amount = P. quantity × rate. Missing/invalid packing fields prevent save rather than guessing quantities. Existing duplicate item lines remain separate; repeated new scans increment the new row.

Invoice tax-inclusive/exclusive and before/after-discount flags are preserved. Entity discounts are editable in the summary; item-level discounts appear beneath item names and accept an amount or a percentage such as `5%`. Existing adjustment is prefilled as a numeric amount; Round off recalculates a whole-currency adjustment. Totals are estimates; specialized shipping taxes/withholding and ERP-specific rounding may differ from the displayed estimate. The confirmed total comes from ERP.

Map delivery/business fields by setting their invoice `customfield_id` in `customFields` in `app/config.json`. Empty IDs keep those controls out of the update; original unmapped values remain untouched. Optional `lookupSources` supports reference-style configured lookups. Serial/batch/storage allocation items retain the reference restriction and require the native ERP editor. Existing sales-order links are displayed as a preserved-link indicator rather than imported again.

## Source and build

Requires Node.js 22+ (tested with Node 24), npm, Python 3 for the UI-test server, and `zip`/`unzip` for packaging.

```sh
npm ci
npm test
npm run test:ui
npm run build
```

`npm test` runs core tests without a browser. To provision Playwright when desired: `npx playwright install chromium`. `npm run build` validates the placement and required assets, builds the upload ZIP and `dist/RajadhaniInvoiceEditSource.zip`, and checks both ZIPs. It never reads or overwrites a parent ZIP. The source ZIP contains app sources, configuration, build script, tests, lockfile and this README; fixtures and tests are excluded from the upload ZIP. Optional toolkit validation: `npx zet validate`.

## Verification for this delivery

- Core tests: **26 passed**, covering prefill, packing arithmetic, update payloads, existing/new/deleted line IDs, custom fields, errors, refresh fallbacks and popup bounds.
- ZET: **Validation Rules passed successfully** (the toolkit's unrelated update-check cache emitted a permissions warning).
- Playwright: four browser tests are provided, but execution was blocked before tests ran because the required Chromium headless-shell binary is missing. No installed Chrome/Edge fallback was found. Browser layout and end-to-end UI behavior remain unverified here.
- No live ERP invoice was updated during development. Installation and host-specific behavior require an authorized ERP session.

Official references: [ERP invoice API](https://www.zoho.com/erp/api/v3/invoices/), [invoice context and widget locations](https://www.zoho.com/finance/developer/widget-sdk-documentation/inventory/v1/module-reference/invoice/), [modal manifest setting](https://www.zoho.com/invoice/developer/widgets/sdk-method.html), [refresh helper](https://www.zoho.com/finance/developer/widget-sdk-documentation/books/v1/client-library/ui_methods/refresh/).
