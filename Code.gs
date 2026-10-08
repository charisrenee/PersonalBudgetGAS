const SHEET_ID = 'SheetID'; // the long ID in your Sheet's URL

const HEADERS = {
  Budget: ['ID', 'Month', 'Type', 'Name', 'Amount', 'Repeat', 'Account'],
  Transactions: ['ID', 'Date', 'Month', 'Type', 'Category', 'Direction', 'Amount', 'Note', 'Added by', 'Added at', 'Account', 'To account'],
  Goals: ['ID', 'Name', 'Target', 'Due', 'Status', 'Created', 'Account'],
  Accounts: ['ID', 'Name', 'Kind', 'Starting balance', 'Start date', 'Status'],
  Log: ['Time', 'User', 'Action', 'Details']
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Budget')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ▶ Run ONCE from the editor (and again after each upgrade — it's safe to re-run).
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.entries(HEADERS).forEach(([name, headers]) => {
    const s = ss.getSheetByName(name) || ss.insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    s.setFrozenRows(1);
  });
  // Keep "2026-10" style months as plain text
  ss.getSheetByName('Budget').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Transactions').getRange('C:C').setNumberFormat('@');
  ss.getSheetByName('Goals').getRange('D:D').setNumberFormat('@');

  const b = ss.getSheetByName('Budget');
  if (b.getLastRow() === 1) {
    const starter = [
      ['Income', 'Paycheck', 4000],
      ['Fixed', 'Rent', 1500], ['Fixed', 'Phone', 60], ['Fixed', 'Subscriptions', 30],
      ['Flex', 'Groceries', 500], ['Flex', 'Dining out', 200], ['Flex', 'Gas', 150], ['Flex', 'Fun', 150],
      ['Unplanned', 'Buffer', 200]
    ];
    const m = thisMonth_();
    appendRows_(b, starter.map(r => [Utilities.getUuid(), m, ...r, 'Monthly', '']));
  }
  const acc = ss.getSheetByName('Accounts');
  if (acc.getLastRow() === 1) {
    appendRows_(acc, [[Utilities.getUuid(), 'Checking', 'Checking', 0, today_(), 'Active']]);
  }
}

// ---------- helpers ----------
function sh_(name) { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name); }
function tz_() { return Session.getScriptTimeZone(); }
function thisMonth_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM'); }
function today_() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function monthStr_(v) {
  const m = v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM') : String(v || '');
  return /^\d{4}-\d{2}$/.test(m) ? m : '';
}
// IDs are UUIDs; strip anything else so a hand-edited cell can't inject markup
function id_(v) { return String(v || '').replace(/[^\w-]/g, ''); }

// ---------- input safety ----------
const TX_TYPES = ['Income', 'Fixed', 'Flex', 'Unplanned', 'Savings', 'GoalSpend', 'Transfer', 'Adjust'];
const TX_DIRS = ['In', 'Out', 'Refund', 'Move', 'Pot'];
const BUDGET_TYPES = ['Income', 'Fixed', 'Flex', 'Unplanned', 'Savings'];
const ACCT_KINDS = ['Checking', 'Savings', 'Cash', 'Credit card', 'Investment', 'Loan', 'Other asset'];

// Text starting with = + - @ would be run as a formula by Sheets; a leading ' keeps it plain text
function safe_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function safeRow_(row) { return row.map(safe_); }

function checkDate_(d) {
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? toDate_(d) : null;
  const [y, m, day] = String(d).split('-').map(Number);
  if (!dt || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== day) throw new Error('Invalid date');
}
function checkMonth_(m) { if (!/^\d{4}-\d{2}$/.test(String(m))) throw new Error('Invalid month'); }
function checkTx_(t) {
  if (!t || typeof t !== 'object') throw new Error('Invalid transaction');
  checkDate_(t.date);
  if (!TX_TYPES.includes(t.type)) throw new Error('Invalid transaction type');
  if (!TX_DIRS.includes(t.direction)) throw new Error('Invalid transaction direction');
  if (!isFinite(Number(t.amount))) throw new Error('Invalid amount');
}
function toDate_(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function user_() { return Session.getActiveUser().getEmail(); }
function log_(action, details) { appendRows_(sh_('Log'), [[new Date(), user_(), action, JSON.stringify(details)]]); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function appendRows_(s, rows) {
  if (!rows.length) return;
  s.getRange(s.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows.map(safeRow_));
}

function deleteRows_(s, rowNums) {
  [...new Set(rowNums)].sort((a, b) => b - a).forEach(r => s.deleteRow(r));
}

function findTxRow_(s, id) {
  const ids = s.getRange(1, 1, s.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (id_(ids[i][0]) === id) return i + 1;
  return 0;
}

function readBudget_() {
  return sh_('Budget').getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: id_(r[0]), month: monthStr_(r[1]), type: String(r[2]), name: String(r[3]),
    amount: Number(r[4]) || 0, repeat: r[5] === 'Once' ? 'Once' : 'Monthly', account: String(r[6] || '')
  })).filter(b => b.id);
}

function readGoals_() {
  return sh_('Goals').getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: id_(r[0]), name: String(r[1]), target: Number(r[2]) || 0,
    due: monthStr_(r[3]), status: r[4] === 'Done' ? 'Done' : 'Active', account: String(r[6] || '')
  })).filter(g => g.id);
}

function readAccounts_() {
  const tz = tz_();
  return sh_('Accounts').getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: id_(r[0]), name: String(r[1]), kind: String(r[2] || 'Checking'),
    start: Number(r[3]) || 0,
    date: r[4] ? Utilities.formatDate(new Date(r[4]), tz, 'yyyy-MM-dd') : '2000-01-01',
    status: r[5] === 'Closed' ? 'Closed' : 'Active'
  })).filter(a => a.id);
}

// Does a budget line carry into `month` when copying forward?
function carries_(b, month, goals) {
  if (b.repeat === 'Once') return false;
  if (b.type === 'Savings') {
    const g = goals.find(g => g.name === b.name);
    return !!g && g.status === 'Active' && month <= g.due;
  }
  return true;
}

// Give `month` its own budget by copying the most recent earlier month
function ensurePlan_(month) {
  const rows = readBudget_();
  if (rows.some(r => r.month === month)) return;
  const src = rows.map(r => r.month).filter(m => m < month).sort().pop();
  if (!src) return;
  const goals = readGoals_();
  const copy = rows.filter(r => r.month === src && carries_(r, month, goals))
                   .map(r => [Utilities.getUuid(), month, r.type, r.name, r.amount, r.repeat, r.account]);
  appendRows_(sh_('Budget'), copy);
  log_('copy budget', { from: src, to: month });
}

// Add or edit a budget line; optionally push the change into later months that have budgets
function savePlan_(item, forward) {
  checkMonth_(item.month);
  if (!BUDGET_TYPES.includes(item.type)) throw new Error('Invalid budget type');
  ensurePlan_(item.month);
  const s = sh_('Budget'), rows = readBudget_();
  const amount = Number(item.amount) || 0;
  const repeat = item.repeat === 'Once' ? 'Once' : 'Monthly';
  const old = rows.find(r => r.month === item.month &&
    (item.id ? r.id === item.id : (r.type === item.type && r.name === item.name)));
  const key = old || item;
  const vals = [item.type, item.name, amount, repeat, item.account || ''];
  const updates = [], appends = [], deletes = [];

  if (old) updates.push(old.row); else appends.push(item.month);
  if (forward) {
    [...new Set(rows.map(r => r.month))].filter(m => m > item.month).forEach(m => {
      const hit = rows.find(r => r.month === m && r.type === key.type && r.name === key.name);
      if (repeat === 'Once') { if (hit) deletes.push(hit.row); }
      else if (hit) updates.push(hit.row);
      else appends.push(m);
    });
  }
  updates.forEach(row => s.getRange(row, 3, 1, 5).setValues([safeRow_(vals)]));
  appendRows_(s, appends.map(m => [Utilities.getUuid(), m, ...vals]));
  deleteRows_(s, deletes);
  log_(old ? 'edit budget' : 'add budget', Object.assign({}, item, { forward: !!forward }));
}

function txRow_(t, id) {
  checkTx_(t);
  return [id, toDate_(t.date), t.date.slice(0, 7), t.type, t.category, t.direction,
          Math.abs(Number(t.amount)) || 0, t.note || '', user_(), new Date(), t.account || '', t.to || ''];
}

function addTxRow_(t) {
  const id = Utilities.getUuid();
  appendRows_(sh_('Transactions'), [txRow_(t, id)]);
  return id;
}

// ---------- called from the page ----------
function getAll() {
  const tz = tz_();
  const tx = sh_('Transactions').getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
    id: id_(r[0]), date: Utilities.formatDate(new Date(r[1]), tz, 'yyyy-MM-dd'),
    type: String(r[3]), category: String(r[4]), direction: String(r[5]), amount: Number(r[6]) || 0,
    note: String(r[7] || ''), by: String(r[8] || '').split('@')[0],
    account: String(r[10] || ''), to: String(r[11] || '')
  }));
  return { budget: readBudget_(), goals: readGoals_(), accounts: readAccounts_(), tx,
           today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') };
}

function init() {
  return withLock_(() => { ensurePlan_(thisMonth_()); return getAll(); });
}

function ensurePlan(month) {
  return withLock_(() => { ensurePlan_(month); return getAll(); });
}

function savePlanItem(item, forward) {
  return withLock_(() => { savePlan_(item, forward); return getAll(); });
}

function deletePlanItem(id, forward) {
  return withLock_(() => {
    const s = sh_('Budget'), rows = readBudget_();
    const b = rows.find(r => r.id === id);
    if (b) {
      const del = [b.row];
      if (forward) rows.filter(r => r.month > b.month && r.type === b.type && r.name === b.name).forEach(r => del.push(r.row));
      log_('delete budget', { month: b.month, type: b.type, name: b.name, amount: b.amount, forward: !!forward });
      deleteRows_(s, del);
    }
    return getAll();
  });
}

// remember = also save t.account as the default account for this budget line (this month onward)
function addTx(t, remember) {
  return withLock_(() => {
    const id = addTxRow_(t);
    if (remember && t.account) {
      const s = sh_('Budget'), m = t.date.slice(0, 7);
      readBudget_().filter(r => r.type === t.type && r.name === t.category && r.month >= m)
                   .forEach(r => s.getRange(r.row, 7).setValue(safe_(String(t.account))));
    }
    log_('add transaction', t);
    return Object.assign(getAll(), { lastId: id });
  });
}

function updateTx(id, t) {
  return withLock_(() => {
    checkTx_(t);
    const s = sh_('Transactions'), i = findTxRow_(s, id);
    if (!i) throw new Error('That transaction no longer exists');
    const before = s.getRange(i, 1, 1, 12).getValues()[0];
    s.getRange(i, 2, 1, 7).setValues([safeRow_([toDate_(t.date), t.date.slice(0, 7), t.type, t.category, t.direction,
                                       Math.abs(Number(t.amount)) || 0, t.note || ''])]);
    s.getRange(i, 11, 1, 2).setValues([safeRow_([t.account || '', t.to || ''])]);
    log_('edit transaction', { before, after: t });
    return getAll();
  });
}

function deleteTx(id) {
  return withLock_(() => {
    const s = sh_('Transactions'), i = findTxRow_(s, id);
    if (i) {
      log_('delete transaction', s.getRange(i, 1, 1, 12).getValues()[0]);
      s.deleteRow(i);
    }
    return getAll();
  });
}

// Put back a deleted transaction (used by Undo)
function restoreTx(t) {
  return withLock_(() => {
    t.id = id_(t.id);
    appendRows_(sh_('Transactions'), [txRow_(t, t.id)]);
    log_('restore transaction', t);
    return getAll();
  });
}

function saveGoal(g) {
  return withLock_(() => {
    const s = sh_('Goals'), goals = readGoals_();
    const existing = g.id ? goals.find(x => x.id === g.id) : null;
    const name = existing ? existing.name : String(g.name || '').trim();
    if (!name) throw new Error('Goal needs a name');
    checkMonth_(g.due);
    checkMonth_(g.month);

    if (existing) {
      s.getRange(existing.row, 3, 1, 2).setValues([[Number(g.target) || 0, g.due]]);
      s.getRange(existing.row, 7).setValue(safe_(String(g.account || '')));
    } else {
      if (goals.some(x => x.name === name)) throw new Error('You already have a goal with that name');
      appendRows_(s, [[Utilities.getUuid(), name, Number(g.target) || 0, g.due, 'Active', new Date(), g.account || '']]);
      if (Number(g.start) > 0) {
        checkDate_(g.today);
        addTxRow_({ type: 'Savings', category: name, direction: 'Pot', amount: g.start, date: g.today, note: 'Starting balance' });
      }
    }
    savePlan_({ month: g.month, type: 'Savings', name, amount: g.monthly, repeat: 'Monthly' }, true);
    deleteRows_(sh_('Budget'), readBudget_().filter(r => r.type === 'Savings' && r.name === name && r.month > g.due).map(r => r.row));
    log_(existing ? 'edit goal' : 'add goal', g);
    return getAll();
  });
}

function completeGoal(id, month) {
  return withLock_(() => {
    const g = readGoals_().find(x => x.id === id);
    if (g) {
      sh_('Goals').getRange(g.row, 5).setValue('Done');
      deleteRows_(sh_('Budget'), readBudget_().filter(r => r.type === 'Savings' && r.name === g.name && r.month > month).map(r => r.row));
      log_('complete goal', g.name);
    }
    return getAll();
  });
}

function saveAccount(a) {
  return withLock_(() => {
    const s = sh_('Accounts'), accts = readAccounts_();
    const existing = a.id ? accts.find(x => x.id === a.id) : null;
    const status = a.status === 'Closed' ? 'Closed' : 'Active';
    if (!ACCT_KINDS.includes(a.kind)) throw new Error('Invalid account kind');
    if (existing) {
      s.getRange(existing.row, 3, 1, 4).setValues([[a.kind, Number(a.start) || 0, toDate_(a.date), status]]);
    } else {
      const name = String(a.name || '').trim();
      if (!name) throw new Error('Account needs a name');
      if (accts.some(x => x.name === name)) throw new Error('You already have an account with that name');
      appendRows_(s, [[Utilities.getUuid(), name, a.kind, Number(a.start) || 0, toDate_(a.date), 'Active']]);
    }
    log_(existing ? 'edit account' : 'add account', a);
    return getAll();
  });
}