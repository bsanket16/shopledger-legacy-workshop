'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../lib/pricing');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

function orderFixture(items, coupon) {
  const totals = pricing.computeTotals(items, coupon || '');
  return {
    id: 9001,
    date: '21/11/2026',
    customer: 'In-memory customer',
    paymentMode: 'cash',
    status: 'completed',
    items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('CURRENT BEHAVIOUR: invoice totals and GST breakdown match the billed order', () => {
  const order = orderFixture([
    { id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 640, qty: 1 },
    { id: 2, name: 'Sunflower oil', sku: 'OIL-1', hsn: '1512', price: 190, qty: 2 }
  ], 'SAVE10');

  const printed = invoice.computeInvoiceFigures(order);
  const html = invoice.render(order);

  assert.equal(order.total, 963.9);
  assert.equal(printed.subtotal, order.subtotal);
  assert.equal(printed.discount, order.discount);
  assert.equal(printed.tax, order.tax);
  assert.equal(printed.cgst, 22.95);
  assert.equal(printed.sgst, 22.95);
  assert.equal(printed.total, order.total);
  assert.match(html, /CGST<\/td><td class="r">₹22\.95/);
  assert.match(html, /SGST<\/td><td class="r">₹22\.95/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹963\.90/);
  assert.doesNotMatch(html, /Reconciliation Notice/);
});

test('CURRENT BEHAVIOUR: invoice preserves totals stored when a historical order was billed', () => {
  const order = orderFixture([
    { id: 7, name: 'Historical item', sku: 'HIST-1', hsn: '1006', price: 100, qty: 1 }
  ], 'SAVE10');

  // Represents an order billed under earlier coupon terms/configuration.
  order.discount = 10;
  order.tax = 4.5;
  order.total = 94.5;

  const printed = invoice.computeInvoiceFigures(order);
  const html = invoice.render(order);

  assert.equal(printed.subtotal, order.subtotal);
  assert.equal(printed.discount, 10);
  assert.equal(printed.tax, 4.5);
  assert.equal(printed.cgst, 2.25);
  assert.equal(printed.sgst, 2.25);
  assert.equal(printed.total, 94.5);
  assert.equal(printed.lineTaxDetailsAvailable, false);
  assert.equal(printed.rows[0].lineTax, null);
  assert.equal(printed.rows[0].gstPercent, null);
  assert.match(html, /CGST<\/td><td class="r">₹2\.25/);
  assert.match(html, /SGST<\/td><td class="r">₹2\.25/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹94\.50/);
  assert.match(html, /Item-level GST details are unavailable for this historical order/);
});

test('CURRENT BEHAVIOUR: invoice uses checkout HSN slabs and GST split', () => {
  const items = [
    { id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 640, qty: 1 },
    { id: 2, name: 'Tea', sku: 'TEA-1', hsn: '0902', price: 140, qty: 1 }
  ];

  const billed = pricing.computeTotals(items, '');
  const printed = invoice.computeInvoiceFigures(orderFixture(items, ''));

  assert.equal(billed.subtotal, 780);
  assert.equal(billed.tax, 57.2);
  assert.equal(billed.total, 837.2);
  assert.equal(printed.subtotal, 780);
  assert.equal(printed.rows[0].gstPercent, 5);
  assert.equal(printed.rows[1].gstPercent, 18);
  assert.equal(printed.tax, 57.2);
  assert.equal(printed.cgst, 28.6);
  assert.equal(printed.sgst, 28.6);
  assert.equal(printed.total, 837.2);
});

test('CURRENT BEHAVIOUR: invoice follows checkout per-line rounding for fractional unit prices', () => {
  const items = [
    { id: 5, name: 'Small item A', sku: 'SMALL-A', hsn: '1006', price: 0.05, qty: 1 },
    { id: 6, name: 'Small item B', sku: 'SMALL-B', hsn: '1006', price: 0.05, qty: 1 }
  ];

  const billed = pricing.computeTotals(items, '');
  const printed = invoice.computeInvoiceFigures(orderFixture(items, ''));

  assert.equal(billed.tax, 0);
  assert.equal(printed.tax, billed.tax);
  assert.equal(printed.total, billed.total);
});

test('CURRENT BEHAVIOUR: invoice applies checkout coupon cap and taxable-base rules', () => {
  const items = [
    { id: 3, name: 'Bulk goods', sku: 'BULK-1', hsn: '9999', price: 1500, qty: 2 }
  ];

  const billed = pricing.computeTotals(items, 'WHOLESALE15');
  const printed = invoice.computeInvoiceFigures(orderFixture(items, 'WHOLESALE15'));

  assert.equal(billed.subtotal, 3000);
  assert.equal(billed.discount, 400);
  assert.equal(billed.tax, 468);
  assert.equal(billed.total, 3068);
  assert.equal(printed.tax, 468);
  assert.equal(printed.discount, 400);
  assert.equal(printed.total, 3068);
});

test('CURRENT BEHAVIOUR: invoice respects the coupon minimum order', () => {
  const items = [
    { id: 4, name: 'Small purchase', sku: 'SMALL-1', hsn: '1006', price: 100, qty: 1 }
  ];

  const billed = pricing.computeTotals(items, 'SAVE10');
  const printed = invoice.computeInvoiceFigures(orderFixture(items, 'SAVE10'));

  assert.equal(billed.discount, 0);
  assert.equal(printed.discount, 0);
  assert.equal(printed.total, 105);
});

test('CURRENT BEHAVIOUR: GST reconciliation matches checkout totals and tax', () => {
  const order = orderFixture([
    { id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 640, qty: 1 },
    { id: 2, name: 'Tea', sku: 'TEA-1', hsn: '0902', price: 140, qty: 1 }
  ], '');

  // In-memory only: the report receives this object and never accesses data/db.json.
  const result = reports.getGstReconciliation({ orders: [order] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].invoiceTax, 57.2);
  assert.equal(result.rows[0].ledgerTax, 57.2);
  assert.equal(result.rows[0].invoiceTotal, 837.2);
  assert.equal(result.rows[0].ledgerTotal, 837.2);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});
