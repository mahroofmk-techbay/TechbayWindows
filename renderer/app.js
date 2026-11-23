let state = null;

function enqueueSync(entity, payload) {
  state.syncQueue.push({
    id: `${entity}_${Date.now()}`,
    entity,
    payload,
    createdAt: new Date().toISOString()
  });
}

async function persist() {
  await window.posApi.saveAll(state);
  renderAll();
}

function showTab(tabId) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.getElementById(tabId).classList.add("active");
}

function renderAll() {
  // Company
  compName.value = state.company.name || "";
  compPhone.value = state.company.phone || "";
  compTax.value = state.company.taxId || "";
  compAddress.value = state.company.address || "";
  cloudEndpoint.value = state.company.cloudEndpoint || "";
  cloudApiKey.value = state.company.cloudApiKey || "";

  // Products table & dropdowns
  tblProducts.innerHTML = state.products.map(p =>
    `<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.purchasePrice}</td><td>${p.salePrice}</td><td>${p.stock}</td></tr>`
  ).join("");
  saleProduct.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name} (Stock: ${p.stock}, ₹${p.salePrice})</option>`).join("");
  purchProduct.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`).join("");

  // Customers
  tblCustomers.innerHTML = state.customers.map(c =>
    `<tr><td>${c.name}</td><td>${c.phone}</td><td>${c.address}</td></tr>`
  ).join("");
  saleCustomer.innerHTML = `<option value="">Walk-in Customer</option>` +
    state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

  // Sales
  tblSales.innerHTML = state.sales.map(s =>
    `<tr><td>${s.receiptNo}</td><td>${s.customerName}</td><td>${s.total.toFixed(2)}</td><td>${s.date}</td></tr>`
  ).join("");
  srSaleSelect.innerHTML = state.sales.map(s => `<option value="${s.id}">${s.receiptNo} - ${s.total.toFixed(2)}</option>`).join("");
  receiptSaleSelect.innerHTML = state.sales.map(s => `<option value="${s.id}">${s.receiptNo} (${s.date})</option>`).join("");

  // Sale Returns
  tblSaleReturns.innerHTML = state.saleReturns.map(r =>
    `<tr><td>${r.id}</td><td>${r.receiptNo}</td><td>${r.refundAmount.toFixed(2)}</td><td>${r.date}</td></tr>`
  ).join("");

  // Purchases
  tblPurchases.innerHTML = state.purchases.map(p =>
    `<tr><td>${p.id}</td><td>${p.supplier}</td><td>${p.productName}</td><td>${p.qty}</td><td>${p.total.toFixed(2)}</td></tr>`
  ).join("");
  prPurchaseSelect.innerHTML = state.purchases.map(p => `<option value="${p.id}">${p.id} - ${p.productName} (Qty: ${p.qty})</option>`).join("");

  // Purchase Returns
  tblPurchaseReturns.innerHTML = state.purchaseReturns.map(r =>
    `<tr><td>${r.id}</td><td>${r.purchaseId}</td><td>${r.qty}</td><td>${r.date}</td></tr>`
  ).join("");

  renderReceipt();
  renderReport();
}

function renderReceipt() {
  const sale = state.sales.find(s => s.id === receiptSaleSelect.value) || state.sales[state.sales.length - 1];
  if (!sale) {
    receiptPreview.innerHTML = "No sales recorded yet.";
    return;
  }
  receiptPreview.innerHTML = `
    <h3>${state.company.name}</h3>
    <p>${state.company.address || ""} | ${state.company.phone || ""} | Tax ID: ${state.company.taxId || "-"}</p>
    <hr/>
    <p><strong>Receipt #:</strong> ${sale.receiptNo} | <strong>Date:</strong> ${sale.date}</p>
    <p><strong>Customer:</strong> ${sale.customerName}</p>
    <p>${sale.productName} x ${sale.qty} @ ${sale.unitPrice.toFixed(2)} = <strong>${sale.total.toFixed(2)}</strong></p>
  `;
}

function renderReport() {
  const salesSum = state.sales.reduce((acc, s) => acc + s.total, 0);
  const srSum = state.saleReturns.reduce((acc, r) => acc + r.refundAmount, 0);
  const purchSum = state.purchases.reduce((acc, p) => acc + p.total, 0);
  reportSummary.innerHTML = `
    <p><strong>Gross Sales:</strong> ${salesSum.toFixed(2)}</p>
    <p><strong>Sale Returns:</strong> ${srSum.toFixed(2)}</p>
    <p><strong>Net Sales:</strong> ${(salesSum - srSum).toFixed(2)}</p>
    <p><strong>Total Purchases:</strong> ${purchSum.toFixed(2)}</p>
    <p><strong>Pending Cloud Sync Items:</strong> ${state.syncQueue.length}</p>
  `;
}

document.querySelectorAll("nav button").forEach(btn =>
  btn.addEventListener("click", () => showTab(btn.dataset.tab))
);

btnSaveCompany.addEventListener("click", async () => {
  state.company = {
    name: compName.value.trim() || "My Business",
    phone: compPhone.value.trim(),
    taxId: compTax.value.trim(),
    address: compAddress.value.trim(),
    cloudEndpoint: cloudEndpoint.value.trim(),
    cloudApiKey: cloudApiKey.value.trim()
  };
  enqueueSync("company", state.company);
  await persist();
});

btnAddProduct.addEventListener("click", async () => {
  const prod = {
    id: "P" + Date.now(),
    sku: prodSku.value.trim() || "SKU",
    name: prodName.value.trim(),
    purchasePrice: Number(prodBuy.value || 0),
    salePrice: Number(prodSell.value || 0),
    stock: Number(prodStock.value || 0)
  };
  if (!prod.name) return;
  state.products.push(prod);
  enqueueSync("product", prod);
  prodName.value = prodSku.value = prodBuy.value = prodSell.value = prodStock.value = "";
  await persist();
});

btnAddCustomer.addEventListener("click", async () => {
  const cust = {
    id: "C" + Date.now(),
    name: custName.value.trim(),
    phone: custPhone.value.trim(),
    address: custAddress.value.trim()
  };
  if (!cust.name) return;
  state.customers.push(cust);
  enqueueSync("customer", cust);
  custName.value = custPhone.value = custAddress.value = "";
  await persist();
});

btnCreateSale.addEventListener("click", async () => {
  const prod = state.products.find(p => p.id === saleProduct.value);
  const qty = Number(saleQty.value || 0);
  if (!prod || qty <= 0) return;
  prod.stock = Math.max(0, prod.stock - qty);
  const cust = state.customers.find(c => c.id === saleCustomer.value);
  const sale = {
    id: "S" + Date.now(),
    receiptNo: "RCPT-" + (state.sales.length + 1001),
    customerId: cust ? cust.id : null,
    customerName: cust ? cust.name : "Walk-in Customer",
    productName: prod.name,
    qty,
    unitPrice: prod.salePrice,
    total: prod.salePrice * qty,
    date: new Date().toISOString().slice(0, 10)
  };
  state.sales.push(sale);
  enqueueSync("sale", sale);
  receiptSaleSelect.value = sale.id;
  await persist();
  showTab("receipt");
});

btnAddSaleReturn.addEventListener("click", async () => {
  const sale = state.sales.find(s => s.id === srSaleSelect.value);
  const refundAmount = Number(srAmount.value || 0);
  if (!sale || refundAmount <= 0) return;
  const ret = {
    id: "SR" + Date.now(),
    saleId: sale.id,
    receiptNo: sale.receiptNo,
    refundAmount,
    date: new Date().toISOString().slice(0, 10)
  };
  state.saleReturns.push(ret);
  enqueueSync("saleReturn", ret);
  srAmount.value = "";
  await persist();
});

btnCreatePurchase.addEventListener("click", async () => {
  const prod = state.products.find(p => p.id === purchProduct.value);
  const qty = Number(purchQty.value || 0);
  if (!prod || qty <= 0) return;
  prod.stock += qty;
  const purch = {
    id: "PUR" + Date.now(),
    supplier: purchSupplier.value.trim() || "General Supplier",
    productName: prod.name,
    qty,
    total: prod.purchasePrice * qty,
    date: new Date().toISOString().slice(0, 10)
  };
  state.purchases.push(purch);
  enqueueSync("purchase", purch);
  purchSupplier.value = "";
  await persist();
});

btnAddPurchaseReturn.addEventListener("click", async () => {
  const purch = state.purchases.find(p => p.id === prPurchaseSelect.value);
  const qty = Number(prQty.value || 0);
  if (!purch || qty <= 0) return;
  const prod = state.products.find(p => p.name === purch.productName);
  if (prod) prod.stock = Math.max(0, prod.stock - qty);
  const pr = {
    id: "PR" + Date.now(),
    purchaseId: purch.id,
    qty,
    date: new Date().toISOString().slice(0, 10)
  };
  state.purchaseReturns.push(pr);
  enqueueSync("purchaseReturn", pr);
  await persist();
});

receiptSaleSelect.addEventListener("change", renderReceipt);
btnPrintNow.addEventListener("click", () => window.posApi.printReceipt());

btnSyncCloud.addEventListener("click", async () => {
  syncStatus.textContent = "Syncing...";
  const res = await window.posApi.syncNow();
  syncStatus.textContent = res.message;
  state = await window.posApi.getAll();
  renderReport();
});

(async function init() {
  state = await window.posApi.getAll();
  renderAll();
})();
