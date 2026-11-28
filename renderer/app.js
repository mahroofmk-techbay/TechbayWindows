let state = null;
let selectedTable = null; // null = Takeaway
let draftLines = [];

function showNotice(msg) {
  const el = document.getElementById("topNotice");
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 4500);
}

function enqueueSync(entity, payload) {
  if (!Array.isArray(state.syncQueue)) state.syncQueue = [];
  state.syncQueue.push({
    id: `${entity}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  const targetPanel = document.getElementById(tabId);
  if (targetPanel) targetPanel.classList.add("active");
  const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (activeBtn) document.getElementById("headerTitle").textContent = activeBtn.textContent;
}

function applyAuthVisibility() {
  const isAuthed = Boolean(state && state.auth && state.auth.authorized);
  document.getElementById("authGate").style.display = isAuthed ? "none" : "flex";
  const shell = document.getElementById("appShell");
  if (isAuthed) shell.classList.add("active");
  else shell.classList.remove("active");

  if (isAuthed) {
    const label = state.auth.clientName
      ? `Client: ${state.auth.clientName} (${state.auth.clientId})`
      : `Client: ${state.auth.clientId}`;
    document.getElementById("activeClientLabel").textContent = label;
  }
}

function selectTakeaway() {
  selectedTable = null;
  draftLines = [];
  document.getElementById("activeTargetLabel").textContent = "Takeaway";
  document.getElementById("posGridTargetLabel").textContent = "Target: Takeaway";
  renderBillingBox();
  renderTablesGrid();
}

function onTouchTable(tbl) {
  selectedTable = tbl;
  document.getElementById("activeTargetLabel").textContent = `${tbl.table_name} (${tbl.status})`;
  document.getElementById("posGridTargetLabel").textContent = `Target: ${tbl.table_name}`;

  draftLines = [];
  if (tbl.status === "ACTIVE" && tbl.active_kot_sync_id && Array.isArray(state.kots)) {
    const kot = state.kots.find((k) => k.sync_id === tbl.active_kot_sync_id && k.status === "ACTIVE");
    if (kot && Array.isArray(kot.items)) {
      draftLines = kot.items.map((it) => ({
        name: it.name,
        price: Number(it.price || 0),
        qty: Number(it.qty || 1)
      }));
    }
  }

  renderTablesGrid();
  renderBillingBox();

  const choice = confirm(
    `${tbl.table_name} (${tbl.status})\n\nOK = Add More items (POS Grid)\nCancel = Stay in Billing Box to Generate Bill`
  );
  if (choice) {
    showTab("tab-dashboard");
  }
}

function addItemToDraft(prod, qty = 1) {
  if (!prod) return;
  const cleanQty = Math.max(1, Number(qty || 1));
  const existing = draftLines.find((l) => l.name === prod.name && Number(l.price) === Number(prod.salePrice));
  if (existing) {
    existing.qty = Number(existing.qty) + cleanQty;
  } else {
    draftLines.push({
      name: prod.name,
      price: Number(prod.salePrice || 0),
      qty: cleanQty
    });
  }
  renderBillingBox();
}

function renderTablesGrid() {
  const tables = state.tables || [];
  const activeCount = tables.filter((t) => t.status === "ACTIVE").length;
  const emptyCount = tables.length - activeCount;
  document.getElementById("tableSummaryCount").textContent = `Active: ${activeCount} | Empty: ${emptyCount}`;

  const container = document.getElementById("tableCardsContainer");
  container.innerHTML = "";
  for (const tbl of tables) {
    const isActive = tbl.status === "ACTIVE";
    const isSel = selectedTable && selectedTable.sync_id === tbl.sync_id;
    const card = document.createElement("div");
    card.className = `table-card ${isActive ? "active" : "empty"} ${isSel ? "selected" : ""}`;
    card.innerHTML = `
      <div style="font-weight:700;font-size:15px;">${tbl.table_name}</div>
      <span class="badge ${isActive ? "active" : "empty"}">${tbl.status}</span>
      <div style="font-size:12px;color:#475569;">${isActive ? "Tap: Add More / Bill" : "Tap to start order"}</div>
    `;
    card.addEventListener("click", () => onTouchTable(tbl));
    container.appendChild(card);
  }
}

function renderBillingBox() {
  const body = document.getElementById("billingBoxBody");
  body.innerHTML = "";
  let subtotal = 0;

  draftLines.forEach((line, idx) => {
    const lineTotal = Number(line.price || 0) * Number(line.qty || 0);
    subtotal += lineTotal;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${line.name}</td>
      <td>${line.qty}</td>
      <td>${Number(line.price || 0).toFixed(2)}</td>
      <td>${lineTotal.toFixed(2)}</td>
      <td><button type="button" class="danger" data-del="${idx}">✕</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => {
      draftLines.splice(idx, 1);
      renderBillingBox();
    });
    body.appendChild(tr);
  });

  const discount = Math.min(subtotal, Math.max(0, Number(document.getElementById("billDiscount").value || 0)));
  const total = Math.max(0, subtotal - discount);
  document.getElementById("billingBoxTotal").textContent = `Total: ${total.toFixed(2)}`;
}

function renderPosTiles() {
  const q = (document.getElementById("posSearch").value || "").trim().toLowerCase();
  const container = document.getElementById("posProductTiles");
  container.innerHTML = "";
  for (const p of state.products || []) {
    if (q && !p.name.toLowerCase().includes(q)) continue;
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML = `<div style="font-weight:700;">${p.name}</div><div style="margin-top:6px;">${Number(p.salePrice || 0).toFixed(2)}</div>`;
    tile.addEventListener("click", () => {
      addItemToDraft(p, 1);
      showTab("tab-tables");
      showNotice(`Added ${p.name}`);
    });
    container.appendChild(tile);
  }
}

function renderReceipt() {
  const sale = state.sales.find((s) => s.id === receiptSaleSelect.value) || state.sales[state.sales.length - 1];
  if (!sale) {
    receiptPreview.textContent = "No sales recorded yet.";
    return;
  }
  if (sale.billText) {
    receiptPreview.textContent = sale.billText;
    return;
  }
  receiptPreview.textContent =
    `${state.company.name}\n` +
    `${state.company.address || ""} | ${state.company.phone || ""}\n` +
    `--------------------------------\n` +
    `Receipt #: ${sale.receiptNo} | Date: ${sale.date}\n` +
    `Customer: ${sale.customerName}\n` +
    `${sale.productName} x ${sale.qty} @ ${Number(sale.unitPrice || 0).toFixed(2)} = ${Number(sale.total || 0).toFixed(2)}\n`;
}

function renderReport() {
  const salesSum = state.sales.reduce((acc, s) => acc + Number(s.total || 0), 0);
  const srSum = state.saleReturns.reduce((acc, r) => acc + Number(r.refundAmount || 0), 0);
  const purchSum = state.purchases.reduce((acc, p) => acc + Number(p.total || 0), 0);
  const expSum = (state.expenses || []).reduce((acc, e) => acc + Number(e.amount || 0), 0);
  reportSummary.innerHTML = `
    <p><strong>Gross Sales:</strong> ${salesSum.toFixed(2)}</p>
    <p><strong>Sale Returns:</strong> ${srSum.toFixed(2)}</p>
    <p><strong>Net Sales:</strong> ${(salesSum - srSum).toFixed(2)}</p>
    <p><strong>Total Purchases:</strong> ${purchSum.toFixed(2)}</p>
    <p><strong>Total Expenses:</strong> ${expSum.toFixed(2)}</p>
    <p><strong>Pending Cloud Sync Items:</strong> ${state.syncQueue.length}</p>
  `;
}

function renderAll() {
  if (!state) return;
  applyAuthVisibility();

  compName.value = state.company.name || "";
  compPhone.value = state.company.phone || "";
  compTax.value = state.company.taxId || "";
  compAddress.value = state.company.address || "";
  cloudEndpoint.value = state.company.cloudEndpoint || "";
  cloudApiKey.value = state.company.cloudApiKey || "";

  renderTablesGrid();
  renderBillingBox();
  renderPosTiles();

  quickBillProduct.innerHTML = state.products
    .map((p, idx) => `<option value="${idx}">${p.name} (${Number(p.salePrice || 0).toFixed(2)})</option>`)
    .join("");

  tblProducts.innerHTML = state.products
    .map(
      (p) =>
        `<tr><td>${p.sku || "-"}</td><td>${p.name}</td><td>${Number(p.purchasePrice || 0).toFixed(2)}</td><td>${Number(p.salePrice || 0).toFixed(2)}</td><td>${p.stock}</td></tr>`
    )
    .join("");

  saleProduct.innerHTML = state.products
    .map((p) => `<option value="${p.id}">${p.name} (Stock: ${p.stock}, ${Number(p.salePrice || 0).toFixed(2)})</option>`)
    .join("");
  purchProduct.innerHTML = state.products
    .map((p) => `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`)
    .join("");

  tblCustomers.innerHTML = state.customers
    .map((c) => `<tr><td>${c.name}</td><td>${c.phone}</td><td>${c.address}</td></tr>`)
    .join("");
  saleCustomer.innerHTML =
    `<option value="">Walk-in Customer</option>` +
    state.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");

  tblSales.innerHTML = state.sales
    .map((s) => `<tr><td>${s.receiptNo}</td><td>${s.customerName}</td><td>${Number(s.total || 0).toFixed(2)}</td><td>${s.date}</td></tr>`)
    .join("");
  srSaleSelect.innerHTML = state.sales
    .map((s) => `<option value="${s.id}">${s.receiptNo} - ${Number(s.total || 0).toFixed(2)}</option>`)
    .join("");
  receiptSaleSelect.innerHTML = state.sales
    .map((s) => `<option value="${s.id}">${s.receiptNo} (${s.date})</option>`)
    .join("");

  tblSaleReturns.innerHTML = state.saleReturns
    .map((r) => `<tr><td>${r.id}</td><td>${r.receiptNo}</td><td>${Number(r.refundAmount || 0).toFixed(2)}</td><td>${r.date}</td></tr>`)
    .join("");

  tblPurchases.innerHTML = state.purchases
    .map((p) => `<tr><td>${p.id}</td><td>${p.supplier}</td><td>${p.productName}</td><td>${p.qty}</td><td>${Number(p.total || 0).toFixed(2)}</td></tr>`)
    .join("");
  prPurchaseSelect.innerHTML = state.purchases
    .map((p) => `<option value="${p.id}">${p.id} - ${p.productName} (Qty: ${p.qty})</option>`)
    .join("");

  tblPurchaseReturns.innerHTML = state.purchaseReturns
    .map((r) => `<tr><td>${r.id}</td><td>${r.purchaseId}</td><td>${r.qty}</td><td>${r.date}</td></tr>`)
    .join("");

  tblExpenses.innerHTML = (state.expenses || [])
    .map((e) => `<tr><td>${e.title}</td><td>${e.category}</td><td>${Number(e.amount || 0).toFixed(2)}</td><td>${e.date}</td></tr>`)
    .join("");

  renderReceipt();
  renderReport();
}

// Navigation
document.querySelectorAll(".nav-btn").forEach((btn) =>
  btn.addEventListener("click", () => showTab(btn.dataset.tab))
);

// Authorization Gate
btnAuthorizeClient.addEventListener("click", async () => {
  const clientId = authClientId.value.trim();
  const accessKey = authAccessKey.value.trim();
  authGateStatus.textContent = "Verifying workspace & pulling data...";

  const res = await window.posApi.authorizeClient({ clientId, accessKey });
  authGateStatus.textContent = res.message;

  if (res.ok) {
    state = await window.posApi.getAll();
    selectedTable = null;
    draftLines = [];
    renderAll();
    showTab("tab-tables");
    showNotice(res.message);
  }
});

btnLogoutClient.addEventListener("click", async () => {
  await window.posApi.logoutClient();
  state = await window.posApi.getAll();
  authClientId.value = "";
  authAccessKey.value = "";
  authGateStatus.textContent = "";
  renderAll();
});

// Tables & Billing Box Actions
btnSelectTakeaway.addEventListener("click", selectTakeaway);

btnAddTable.addEventListener("click", async () => {
  const name = prompt("Enter new table name:");
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  const syncId = `tbl-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-5)}`;
  const tbl = { sync_id: syncId, table_name: cleanName, status: "EMPTY", active_kot_sync_id: "" };
  state.tables.push(tbl);
  enqueueSync("table", tbl);
  await persist();
  showNotice(`Added ${cleanName}`);
});

btnQuickAddItem.addEventListener("click", () => {
  const prod = state.products[Number(quickBillProduct.value)];
  addItemToDraft(prod, Number(quickBillQty.value || 1));
});

billDiscount.addEventListener("input", renderBillingBox);
posSearch.addEventListener("input", renderPosTiles);

btnAddMoreKot.addEventListener("click", async () => {
  if (!draftLines.length) {
    showNotice("Add items before sending KOT");
    return;
  }
  const tableSyncId = selectedTable ? selectedTable.sync_id : "";
  const tableName = selectedTable ? selectedTable.table_name : "Takeaway";
  let kot = null;

  if (selectedTable && selectedTable.active_kot_sync_id) {
    kot = state.kots.find((k) => k.sync_id === selectedTable.active_kot_sync_id && k.status === "ACTIVE");
  }
  if (!kot) {
    kot = {
      sync_id: `kot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      table_sync_id: tableSyncId,
      table_name: tableName,
      status: "ACTIVE",
      items: [],
      created_at: new Date().toISOString()
    };
    state.kots.unshift(kot);
  }

  for (const item of draftLines) {
    const existing = kot.items.find((x) => x.name === item.name && Number(x.price) === Number(item.price));
    if (existing) existing.qty = Number(existing.qty) + Number(item.qty);
    else kot.items.push({ ...item });
  }

  if (selectedTable) {
    selectedTable.status = "ACTIVE";
    selectedTable.active_kot_sync_id = kot.sync_id;
    const idx = state.tables.findIndex((t) => t.sync_id === selectedTable.sync_id);
    if (idx >= 0) state.tables[idx] = { ...selectedTable };
    enqueueSync("table", selectedTable);
  }

  enqueueSync("kot", {
    ...kot,
    status: "OPEN",
    items_json: JSON.stringify(kot.items)
  });

  await persist();
  showNotice(`KOT saved for ${tableName}`);
});

btnGenerateBill.addEventListener("click", async () => {
  if (!draftLines.length) {
    showNotice("Add items to generate a bill");
    return;
  }

  const subtotal = draftLines.reduce((acc, l) => acc + Number(l.price || 0) * Number(l.qty || 0), 0);
  const discount = Math.min(subtotal, Math.max(0, Number(billDiscount.value || 0)));
  const total = Math.max(0, subtotal - discount);
  const customerName = (billCustomerName.value || "Walk-in Customer").trim() || "Walk-in Customer";
  const paymentMethod = billPaymentMethod.value || "Cash";
  const targetName = selectedTable ? selectedTable.table_name : "Takeaway";
  const dateStr = new Date().toISOString().slice(0, 10);
  const receiptNo = "RCPT-" + (state.sales.length + 1001);
  const syncId = `bill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let billText =
    `${state.company.name}\n` +
    `${state.company.address || ""}\n` +
    `--------------------------------\n` +
    `Receipt: ${receiptNo} | ${targetName}\n` +
    `Customer: ${customerName} | Pay: ${paymentMethod}\n` +
    `--------------------------------\n`;
  for (const l of draftLines) {
    billText += `${l.name} x${l.qty} @ ${Number(l.price).toFixed(2)} = ${(Number(l.price) * Number(l.qty)).toFixed(2)}\n`;
  }
  billText +=
    `--------------------------------\n` +
    `Subtotal: ${subtotal.toFixed(2)}\n` +
    `Discount: ${discount.toFixed(2)}\n` +
    `TOTAL: ${total.toFixed(2)}\n`;

  const sale = {
    id: "S" + Date.now(),
    sync_id: syncId,
    receiptNo,
    customerId: null,
    customerName,
    productName: draftLines.map((l) => `${l.name} x${l.qty}`).join(", "),
    qty: draftLines.reduce((acc, l) => acc + Number(l.qty || 0), 0),
    unitPrice: total,
    subtotal,
    discount,
    total,
    payment_method: paymentMethod,
    date: dateStr,
    billText
  };

  state.sales.push(sale);
  enqueueSync("sale", sale);

  if (selectedTable) {
    if (selectedTable.active_kot_sync_id) {
      const kot = state.kots.find((k) => k.sync_id === selectedTable.active_kot_sync_id);
      if (kot) kot.status = "SETTLED";
      enqueueSync("kot", {
        sync_id: selectedTable.active_kot_sync_id,
        table_sync_id: selectedTable.sync_id,
        table_name: selectedTable.table_name,
        status: "SETTLED",
        items_json: "[]"
      });
    }
    selectedTable.status = "EMPTY";
    selectedTable.active_kot_sync_id = "";
    const idx = state.tables.findIndex((t) => t.sync_id === selectedTable.sync_id);
    if (idx >= 0) state.tables[idx] = { ...selectedTable };
    enqueueSync("table", selectedTable);
  }

  latestBillPreview.textContent = billText;
  draftLines = [];
  billDiscount.value = "0";
  selectedTable = null;
  document.getElementById("activeTargetLabel").textContent = "Takeaway";
  receiptSaleSelect.value = sale.id;

  await persist();
  showNotice(`Bill ${receiptNo} generated`);
});

btnPrintFromBox.addEventListener("click", () => window.posApi.printReceipt());
btnPrintNow.addEventListener("click", () => window.posApi.printReceipt());
btnTestPrint.addEventListener("click", () => window.posApi.printReceipt());

// Setup, Products, Customers, Purchase, Returns, Expenses
btnSaveCompany.addEventListener("click", async () => {
  state.company = {
    name: compName.value.trim() || "Techbay Store",
    phone: compPhone.value.trim(),
    taxId: compTax.value.trim(),
    address: compAddress.value.trim(),
    cloudEndpoint: cloudEndpoint.value.trim(),
    cloudApiKey: cloudApiKey.value.trim()
  };
  await persist();
  showNotice("Setup saved");
});

btnAddProduct.addEventListener("click", async () => {
  const name = prodName.value.trim();
  if (!name) return;
  const prod = {
    id: "P" + Date.now(),
    sync_id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sku: prodSku.value.trim() || "SKU",
    name,
    purchasePrice: Number(prodBuy.value || 0),
    salePrice: Number(prodSell.value || 0),
    stock: Number(prodStock.value || 0)
  };
  state.products.push(prod);
  enqueueSync("product", prod);
  prodName.value = prodSku.value = prodBuy.value = prodSell.value = prodStock.value = "";
  await persist();
  showNotice(`Added ${prod.name}`);
});

btnAddCustomer.addEventListener("click", async () => {
  const name = custName.value.trim();
  if (!name) return;
  const cust = {
    id: "C" + Date.now(),
    name,
    phone: custPhone.value.trim(),
    address: custAddress.value.trim()
  };
  state.customers.push(cust);
  custName.value = custPhone.value = custAddress.value = "";
  await persist();
  showNotice(`Added customer ${cust.name}`);
});

btnCreatePurchase.addEventListener("click", async () => {
  const prod = state.products.find((p) => p.id === purchProduct.value);
  const qty = Number(purchQty.value || 0);
  if (!prod || qty <= 0) return;
  prod.stock = Number(prod.stock || 0) + qty;
  const purch = {
    id: "PUR" + Date.now(),
    supplier: purchSupplier.value.trim() || "General Supplier",
    productName: prod.name,
    qty,
    total: Number(prod.purchasePrice || 0) * qty,
    date: new Date().toISOString().slice(0, 10)
  };
  state.purchases.push(purch);
  enqueueSync("product", prod);
  purchSupplier.value = purchQty.value = "";
  await persist();
  showNotice("Purchase recorded");
});

btnAddPurchaseReturn.addEventListener("click", async () => {
  const purch = state.purchases.find((p) => p.id === prPurchaseSelect.value);
  const qty = Number(prQty.value || 0);
  if (!purch || qty <= 0) return;
  const prod = state.products.find((p) => p.name === purch.productName);
  if (prod) {
    prod.stock = Math.max(0, Number(prod.stock || 0) - qty);
    enqueueSync("product", prod);
  }
  state.purchaseReturns.push({
    id: "PR" + Date.now(),
    purchaseId: purch.id,
    qty,
    date: new Date().toISOString().slice(0, 10)
  });
  prQty.value = "";
  await persist();
  showNotice("Purchase return recorded");
});

btnAddExpense.addEventListener("click", async () => {
  const title = expTitle.value.trim();
  const amount = Number(expAmount.value || 0);
  if (!title || amount <= 0) return;
  const exp = {
    id: "E" + Date.now(),
    sync_id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    category: expCategory.value.trim() || "General",
    amount,
    date: new Date().toISOString().slice(0, 10)
  };
  state.expenses.push(exp);
  enqueueSync("expense", exp);
  expTitle.value = expCategory.value = expAmount.value = "";
  await persist();
  showNotice("Expense added");
});

btnAddSaleReturn.addEventListener("click", async () => {
  const sale = state.sales.find((s) => s.id === srSaleSelect.value);
  const refundAmount = Number(srAmount.value || 0);
  if (!sale || refundAmount <= 0) return;
  state.saleReturns.push({
    id: "SR" + Date.now(),
    saleId: sale.id,
    receiptNo: sale.receiptNo,
    refundAmount,
    date: new Date().toISOString().slice(0, 10)
  });
  srAmount.value = "";
  await persist();
  showNotice("Sale return recorded");
});

receiptSaleSelect.addEventListener("change", renderReceipt);

btnSyncCloud.addEventListener("click", async () => {
  syncStatus.textContent = "Syncing...";
  const res = await window.posApi.syncNow();
  syncStatus.textContent = res.message;
  state = await window.posApi.getAll();
  renderAll();
});

(async function init() {
  state = await window.posApi.getAll();
  renderAll();
  if (state && state.auth && state.auth.authorized && state.auth.clientId) {
    syncStatus.textContent = "Syncing...";
    const res = await window.posApi.syncNow();
    syncStatus.textContent = res.message;
    state = await window.posApi.getAll();
    renderAll();
  }
})();
