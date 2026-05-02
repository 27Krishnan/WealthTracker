/**
 * WealthTracker Logic
 */


let appState = {
    assets: [],
    totalNetWorth: 0,
    editingId: null,
    sortColumn: 'value',
    sortOrder: 'desc',
    mfSortColumn: 'name',
    mfSortOrder: 'asc',
    goldSortColumn: 'name',
    goldSortOrder: 'asc',
    cashSortColumn: 'name',
    cashSortOrder: 'asc',
    propertySortColumn: 'value',
    propertySortOrder: 'desc',
    portfolioFilter: 'all',
    portfolios: ["Zerodha", "Angel One", "Upstox", "Physical Gold", "Mutual Funds"],
    realizedPnL: [], // To track booked profits
    history: [], // [{date: 'YYYY-MM-DD', value: 0}]
    targets: {
        stocks: 50,
        mf: 30,
        gold: 10,
        cash: 10,
        property: 0
    },
    health: {
        score: 0,
        factors: []
    }
};

const LIVE_PRICES_URL = 'live_prices.json';

// --- Helper for Safe DOM Updates ---
function setSafeText(id, text, className = null) {
    const el = document.getElementById(id);
    if (el) {
        el.innerText = text;
        if (className) el.className = className;
    } else {
        // console.warn(`Element with ID '${id}' not found.`);
    }
}

// --- Initialization moved to ---

function deleteRealizedPnL(index) {
    if (confirm("Are you sure you want to delete this profit record?")) {
        appState.realizedPnL.splice(index, 1);
        saveData();
        render();
        showToast("Profit record deleted", "success");
    }
}

function editRealizedPnL(index) {
    const p = appState.realizedPnL[index];
    const newPrice = prompt(`Edit Sell Price for ${p.name}:`, p.sellPrice);
    if (newPrice !== null) {
        const price = parseFloat(newPrice);
        if (!isNaN(price)) {
            p.sellPrice = price;
            p.profit = (price - p.buyPrice) * p.quantity;
            saveData();
            render();
            showToast("Profit record updated", "success");
        }
    }
}


function startLiveSync() {
    pollLivePrices();
    pollMFData();
    pollMFNav();  // Poll live MF NAVs
    setInterval(() => {
        pollLivePrices();
        pollMFData();
        pollMFNav();  // Update NAVs every 5 minutes
    }, 300000); // Poll every 5 minutes
}

async function pollLivePrices() {
    try {
        // --- Dynamic Script Reload (CORS Bypass for file://) ---
        // We need to reload the bridge script to get fresh data from the Python sync
        const oldScript = document.getElementById('price-bridge-script');
        if (oldScript) oldScript.remove();

        const newScript = document.createElement('script');
        newScript.id = 'price-bridge-script';

        // Wait a small bit for script to execute
        await new Promise(r => setTimeout(r, 1000));

        let data = window.priceDataBridge;
        if (!data || !data.prices || Object.keys(data.prices).length === 0) {
            throw new Error('Live data empty or bridge not loaded');
        }

        const prices = data.prices || {};
        let updatedCount = 0;

        // Helper to normalize strings for comparison (removes spaces, dots, and common suffix junk)
        const normalize = (s) => (s || "").toUpperCase()
            .replace(/LIMITED/g, "")
            .replace(/LTD/g, "")
            .replace(/INDUSTRIES/g, "")
            .replace(/CORP/g, "")
            .replace(/CORPN/g, "")
            .replace(/[\s\W_]/g, "");

        Object.keys(prices).forEach(priceKey => {
            const priceData = prices[priceKey];
            const normKey = normalize(priceKey);
            const ltp = typeof priceData === 'object' ? priceData.ltp : priceData;
            const prevClose = typeof priceData === 'object' ? priceData.prevClose : ltp;

            // Find asset by name or symbol - use aggressive normalization
            let asset = appState.assets.find(a =>
                normalize(a.name) === normKey ||
                normalize(a.symbol) === normKey ||
                normalize(a.name) === normalize(priceData.symbol)
            );

            if (asset) {
                // Safeguard: Ensure values are sane
                if (ltp > 0) {
                    if (asset.name.includes('SGB')) {
                        console.log("MATCH LIVE SGB:", asset.name, ltp, prevClose);
                    }
                    asset.ltp = ltp;
                    asset.prevClose = prevClose || ltp;
                    asset.value = ltp * asset.quantity;

                    // Added Dividend Info
                    if (typeof priceData === 'object') {
                        asset.divRate = priceData.divRate || 0;
                        asset.divYield = priceData.divYield || 0;
                    }

                    updatedCount++;
                }
            } else {
                if (priceKey.includes('SGB')) {
                    console.log("NO MATCH for Bridge Key:", priceKey, "Norm:", normKey);
                    // Debug appState assets
                    console.log("Assets checked:", appState.assets.map(a => normalize(a.name)));
                }
            }
        });

        if (updatedCount > 0) {
            console.log("Updated Assets Count:", updatedCount);
            saveData();
            render();
        }
        updateLiveStatus(true); // Data verified, so we are LIVE
    } catch (err) {
        console.warn("Live sync failed:", err.message);
        updateLiveStatus(false);
    }
}

async function pollMFNav() {
    try {
        let navData = null;

        // Try bridge file first
        if (window.mfNavBridge) {
            navData = window.mfNavBridge;
        } else {
            // Try fetching JSON file
            const response = await fetch('mf_nav_live.json', { cache: 'no-store' });
            if (response.ok) navData = await response.json();
        }

        if (!navData) return;

        let updated = false;

        // Update NAVs for all MF assets
        appState.assets.forEach(asset => {
            if (asset.category === 'mf') {
                // Try to find live NAV using fund name or folio
                const navKey = Object.keys(navData).find(key =>
                    key.includes(asset.name) ||
                    (asset.folio && key.includes(asset.folio))
                );

                if (navKey && navData[navKey]) {
                    const liveNav = navData[navKey].nav;
                    if (liveNav && liveNav !== asset.ltp) {
                        asset.ltp = liveNav;
                        // Recalculate current value based on new NAV
                        if (asset.quantity > 0) {
                            asset.value = liveNav * asset.quantity;
                        }
                        updated = true;
                    }
                }
            }
        });

        if (updated) {
            saveData();
            render();
            console.log('Live MF NAVs updated');
        }

        // --- Auto-SIP Processing ---
        processAutoSIPs(navData);

        updateLiveStatus(true); // Data verified, so we are LIVE

    } catch (err) {
        console.warn("MF NAV sync failed:", err.message);
        updateLiveStatus(false);
    }
}

async function pollMFData() {
    try {
        let data = {};
        
        // --- HARDCODED METADATA (Bypasses all bridge/cache issues) ---
        const INLINED_MF_DATA = {
            "Axis Focused Fund Direct Growth (91078883676)": { "monthly_sip": 500.0, "sip_date": 15 },
            "Axis Large Cap Fund Direct Growth (91075921522)": { "monthly_sip": 500.0, "sip_date": 15 },
            "Axis Small Fund Direct Growth (91078429486)": { "monthly_sip": 500.0, "sip_date": 15 },
            "ICICI Prudential Value Fund Direct Plan (41839077)": { "monthly_sip": 2000.0, "sip_date": 28 },
            "Quant Mid Cap Fund-Direct Plan-Growth (51066783381)": { "monthly_sip": 1000.0, "sip_date": 27 },
            "SBI Focused Fund Direct Plan Growth (46084161)": { "monthly_sip": 0.0, "sip_date": 0 },
            "SBI Small Cap Fund Direct Plan Growth": { "invested": 35000.0, "units": 264.0, "monthly_sip": 500.0, "sip_date": 15, "nav": 188.0, "value": 49535.0 },
            "UTI Nifty 50 Index Fund Direct Plan (588353567847)": { "monthly_sip": 1000.0, "sip_date": 28 }
        };

        if (window.mfDataBridge) {
            data = { ...window.mfDataBridge };
        } else {
            const response = await fetch('mf_data.json', { cache: 'no-store' });
            if (response.ok) data = await response.json();
        }

        // Force-merge inlined data
        Object.keys(INLINED_MF_DATA).forEach(k => {
            data[k] = { ...(data[k] || {}), ...INLINED_MF_DATA[k], fund_name: k, display_name: k };
        });

        if (!data) return;

        // --- SIMULATION MODE ---
        const plannedAssets = {
            "Quant Mid Cap Fund (Planned Top-up)": {
                "display_name": "Quant Mid Cap Fund (Planned Top-up +₹2k)",
                "fund_name": "Quant Mid Cap Fund Direct Growth",
                "units": 0, "nav": 221.78, "invested": 0, "value": 0, "start_date": new Date().toISOString().split('T')[0],
                "monthly_sip": 2000, "portfolio": "Planned", "is_planned": true
            }
        };
        data = { ...data, ...plannedAssets };
        // -----------------------------------------------------------

        let updated = false;
        const initialCount = appState.assets.length;
        const validKeys = new Set(Object.keys(data));

        // 1. Remove stale 'mf' assets that are NOT in the new data
        // This cleans up old duplicates (e.g. "SBI Small Cap" vs "SBI Small Cap (Folio)")
        appState.assets = appState.assets.filter(a => {
            if (a.category === 'mf') {
                // Keep if in bridge file OR if manually added/updated by user
                // Use fund_name or display_name from metrics to match
                const match = Object.values(data).find(m =>
                    (m.folio && a.folio === m.folio) ||
                    (a.name === (m.display_name || m.fund_name))
                );
                return match || a.manuallyUpdated;
            }
            return true;
        });

        if (appState.assets.length !== initialCount) {
            console.log(`Cleaned up ${initialCount - appState.assets.length} stale MF assets.`);
            updated = true;
        }

        // 2. Update or Add new funds
        Object.keys(data).forEach(fundName => {
            const metrics = data[fundName];
            const finalName = metrics.display_name || metrics.fund_name;
            const folio = metrics.folio || "";

            // Try to find by Folio FIRST (most reliable), then Name
            let asset = appState.assets.find(a =>
                (folio && a.folio === folio) ||
                (a.name === finalName && a.category === 'mf')
            );

            if (asset) {
                // Update existing
                asset.name = finalName; // Force name update in case it changed

                // Always update these automation fields even if manually updated
                asset.monthlySIP = metrics.monthly_sip || asset.monthlySIP || 0;
                asset.sipDate = metrics.sip_date || asset.sipDate || null;
                
                // Only update these fields if NOT manually updated by user
                if (!asset.manuallyUpdated) {
                    asset.invested = metrics.invested || asset.invested;
                    asset.quantity = metrics.units || asset.quantity;
                    asset.purchaseDate = metrics.start_date || asset.purchaseDate;
                    
                    // Only update lastTransDate if the bridge date is STRICLY newer
                    const bridgeDate = parseRobustDate(metrics.last_trans_date);
                    const currentTransDate = parseRobustDate(asset.lastTransDate);
                    if (bridgeDate && (!currentTransDate || bridgeDate > currentTransDate)) {
                        asset.lastTransDate = metrics.last_trans_date;
                    }
                }

                asset.folio = folio || asset.folio;
                if (!asset.prevClose) asset.prevClose = (metrics.nav || asset.ltp);

                asset.portfolio = metrics.portfolio || asset.portfolio || "Mutual Funds";
                asset.xirrOverride = metrics.xirr || asset.xirrOverride;
                asset.cagrOverride = metrics.cagr || asset.cagrOverride;
                
                // LTP (NAV) and Value should always be fresh
                asset.ltp = metrics.nav || asset.ltp;
                asset.value = (asset.quantity || 0) * (asset.ltp || 0);
                
                updated = true;
            } else if (metrics.value > 0) {
                // Add new (Only if it's high confidence data from JSON)
                appState.assets.push({
                    id: Date.now() + Math.random(),
                    name: finalName,
                    folio: folio,
                    category: "mf",
                    quantity: metrics.units,
                    invested: metrics.invested,
                    value: metrics.value,
                    ltp: metrics.nav,
                    prevClose: metrics.nav,
                    purchaseDate: metrics.start_date || new Date().toISOString().split('T')[0],
                    lastTransDate: metrics.last_trans_date || "",
                    monthlySIP: metrics.monthly_sip || 0,
                    sipDate: metrics.sip_date || null,
                    portfolio: metrics.portfolio || "Mutual Funds",
                    xirrOverride: metrics.xirr || 0,
                    cagrOverride: metrics.cagr || 0
                });
                updated = true;
            }
        });

        if (updated) {
            saveData();
            render();
            // Force re-render of MF table specifically if search is empty
            const mfSearch = document.getElementById('mf-search');
            if (mfSearch) renderMFTable(mfSearch.value);
        }
        updateLiveStatus(true);
    } catch (e) {
        console.warn("MF data poll failed:", e);
    }
}

function updateLiveStatus(active, time = "") {
    const status = document.getElementById('live-status');
    const text = status.querySelector('.status-text');

    if (active) {
        status.classList.add('active');
        // Use provided time OR current browser time for fresh status
        const displayTime = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        text.innerText = `LIVE: ${displayTime}`;
    } else {
        status.classList.remove('active');
        text.innerText = "OFFLINE";
    }
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'error', or 'info'
 * @param {number} duration - Duration in ms (default 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Choose icon based on type
    let icon = '💡';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // Auto-dismiss after duration
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            container.removeChild(toast);
        }, 300); // Match slideOut animation duration
    }, duration);
}

function setupEventListeners() {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const assetForm = document.getElementById('asset-form');
    const searchInput = document.getElementById('table-search');

    setupTabs();

    if (searchInput) searchInput.addEventListener('input', (e) => renderTable(e.target.value));
    const mfSearch = document.getElementById('mf-search');
    if (mfSearch) mfSearch.addEventListener('input', (e) => renderMFTable(e.target.value));
    const goldSearch = document.getElementById('gold-search');
    if (goldSearch) goldSearch.addEventListener('input', (e) => renderGoldTable(e.target.value));
    const cashSearch = document.getElementById('cash-search');
    if (cashSearch) cashSearch.addEventListener('input', (e) => renderCashTable(e.target.value));

    if (fileInput) fileInput.addEventListener('change', handleFileSelect);

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('active');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('active');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        const files = e.dataTransfer.files;
        handleFiles(files);
    });

    assetForm.addEventListener('submit', handleManualSave);
    const tradeForm = document.getElementById('trade-form');
    if (tradeForm) tradeForm.addEventListener('submit', executeTrade);


    // Sort Listeners
    document.querySelectorAll('#assets-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (appState.sortColumn === column) {
                appState.sortOrder = appState.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                appState.sortColumn = column;
                appState.sortOrder = 'desc';
            }
            renderTable(searchInput.value);
        });
    });

    // MF Table Sort Listeners
    document.querySelectorAll('#mf-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (appState.mfSortColumn === column) {
                appState.mfSortOrder = appState.mfSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                appState.mfSortColumn = column;
                appState.mfSortOrder = 'desc';
            }
            renderMFTable(document.getElementById('mf-search')?.value || '');
        });
    });

    // Gold Table Sort Listeners
    document.querySelectorAll('#gold-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (appState.goldSortColumn === column) {
                appState.goldSortOrder = appState.goldSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                appState.goldSortColumn = column;
                appState.goldSortOrder = 'desc';
            }
            renderGoldTable(document.getElementById('gold-search')?.value || '');
        });
    });

    // Cash Table Sort Listeners
    document.querySelectorAll('#cash-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (appState.cashSortColumn === column) {
                appState.cashSortOrder = appState.cashSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                appState.cashSortColumn = column;
                appState.cashSortOrder = 'desc';
            }
            renderCashTable(document.getElementById('cash-search')?.value || '');
        });
    });

    // Modal category listener
    const modalCatSelect = document.getElementById('asset-category');
    if (modalCatSelect) {
        modalCatSelect.addEventListener('change', updateModalUI);
    }

    // Close modals on background click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeTradeModal();
            closeDrillDown();
            closePortfolioModal();
            closeTargetsModal();
            closeReconcileModal();
            const manualModal = document.getElementById('manual-entry-modal');
            if (manualModal) manualModal.classList.add('hidden');
        }
    });
}

function handlePortfolioFilter(val) {
    appState.portfolioFilter = val;
    // Sync both dropdowns if the UI has multiple (Dashboard and MF tabs)
    const filters = ['portfolio-filter', 'mf-portfolio-filter'];
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
    render();
}

/**
 * Dynamically populates all portfolio dropdowns in the UI
 */
function populatePortfolioDropdowns() {
    const filters = ['portfolio-filter', 'mf-portfolio-filter'];
    const modalSelect = document.getElementById('asset-portfolio');

    // 1. Populate filters (with "All Portfolios" option)
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        const currentVal = el.value || 'all';
        el.innerHTML = '<option value="all">All Portfolios</option>';
        appState.portfolios.forEach(p => {
            el.innerHTML += `<option value="${p}">${p}</option>`;
        });
        el.value = currentVal;
    });

    // 2. Populate modal select
    if (modalSelect) {
        const currentVal = modalSelect.value;
        let html = '';
        appState.portfolios.forEach(p => {
            html += `<option value="${p}">${p}</option>`;
        });

        // Ensure "Other" is always available in the modal dropdown
        if (!appState.portfolios.includes('Other')) {
            html += '<option value="Other">Other</option>';
        }

        modalSelect.innerHTML = html;
        if (currentVal) modalSelect.value = currentVal;
    }
}

function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            // Update Tab Buttons
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update Content
            contents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${target}-tab`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// --- Data Handling ---
function loadData() {
    // --- FORCE RESET FOR v3.2.1 (Clears old buggy transaction dates) ---
    const VERSION = '3.2.1';
    if (localStorage.getItem('app_version') !== VERSION) {
        console.log('Force Reset: Cleaning up old session data for v3.2.1...');
        localStorage.clear();
        localStorage.setItem('app_version', VERSION);
        // Force immediate reload to start fresh from corrected metadata
        location.reload(true);
        return;
    }

    // Load Portfolios
    const savedPortfolios = localStorage.getItem('wealth_tracker_portfolios');
    if (savedPortfolios) {
        try {
            appState.portfolios = JSON.parse(savedPortfolios);
        } catch (e) { console.error("Error loading portfolios", e); }
    }

    // Load History
    const savedHistory = localStorage.getItem('wealth_tracker_history');
    if (savedHistory) {
        try {
            appState.history = JSON.parse(savedHistory);
        } catch (e) { console.error("Error loading history", e); }
    }

    // Load Realized P&L
    const savedPnL = localStorage.getItem('wealth_tracker_realized_pnl');
    if (savedPnL) {
        try {
            appState.realizedPnL = JSON.parse(savedPnL);
        } catch (e) { console.error("Error loading realized P&L", e); }
    }

    // Load Assets
    const saved = localStorage.getItem('wealth_tracker_data');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Handle both old flat array format and new object format
            if (Array.isArray(parsed)) {
                appState.assets = parsed;
            } else if (parsed && parsed.assets) {
                appState.assets = parsed.assets;
                if (parsed.history) appState.history = parsed.history;
                if (parsed.targets) appState.targets = parsed.targets;
                if (parsed.realizedPnL) appState.realizedPnL = parsed.realizedPnL;
            } else {
                appState.assets = [];
            }
            
            if (!Array.isArray(appState.assets)) appState.assets = [];

            // Migration: Standardize categories
            appState.assets.forEach(a => {
                if (a.category && a.category.toLowerCase().includes('mutual fund')) a.category = 'mf';
                if (a.category && a.category.toLowerCase().includes('gold')) a.category = 'gold';
                if (a.category && a.category.toLowerCase().includes('stock')) a.category = 'stocks';
                if (a.category && a.category.toLowerCase().includes('cash')) a.category = 'cash';

                // Portfolio Migration: Standardize names
                if (!a.portfolio || a.portfolio === 'Other' || a.portfolio === 'Uploaded') {
                    a.portfolio = (a.category === 'mf') ? 'Mutual Funds' : 'Zerodha';
                }
                if (a.portfolio === 'MF' || a.portfolio === 'Coin') a.portfolio = 'Mutual Funds';
            });

            // Ensure essential sort properties exist
            appState.goldSortColumn = appState.goldSortColumn || 'name';
            appState.goldSortOrder = appState.goldSortOrder || 'asc';
            appState.cashSortColumn = appState.cashSortColumn || 'name';
            appState.cashSortOrder = appState.cashSortOrder || 'asc';
            appState.portfolioFilter = appState.portfolioFilter || 'all';
        } catch (e) {
            console.error("Error loading assets", e);
            appState.assets = [];
        }
    } else {
        appState.assets = [];
    }

    // Auto-load stocks from holdings bridge if available
    if (window.holdingsBridge && window.holdingsBridge.length > 0) {
        // ONLY remove Zerodha stocks/gold. KEEP Angel One and others!
        appState.assets = appState.assets.filter(a => (a.category !== 'stocks' && a.category !== 'gold') || (a.portfolio && a.portfolio !== 'Zerodha'));

        // Add stocks from bridge
        let nextId = Math.max(...appState.assets.map(a => a.id || 0), 0) + 1;
        window.holdingsBridge.forEach(stock => {
            let cat = 'stocks';
            if (stock.name.includes('SGB') || stock.name.includes('GOLD') || stock.name.includes('SOVEREIGN')) {
                cat = 'gold';
            }
            appState.assets.push({
                id: nextId++,
                category: cat,
                name: stock.name,
                quantity: stock.quantity,
                invested: stock.invested,
                value: stock.value,
                ltp: stock.ltp,
                prevClose: stock.ltp, // Default to ltp if unknown
                divYield: 0,
                divRate: 0,
                portfolio: 'Zerodha', // Default portfolio for bridge data
                source: 'bridge',
                lastUpdated: new Date().toLocaleDateString()
            });
        });
    }

    // Auto-load Mutual Funds from bridge
    if (window.mfDataBridge) {
        // Keep manual overrides
        const manualMFs = appState.assets.filter(a => a.category === 'mf' && a.manuallyUpdated);
        appState.assets = appState.assets.filter(a => a.category !== 'mf');

        let nextId = Math.max(...appState.assets.map(a => a.id || 0), 0) + 1;

        Object.values(window.mfDataBridge).forEach(mf => {
            const manual = manualMFs.find(m => m.name === mf.fund_name || (m.folio && m.folio === mf.folio));
            if (manual) {
                manual.ltp = mf.nav;
                manual.value = (manual.quantity || mf.units) * mf.nav;
                appState.assets.push(manual);
            } else {
                appState.assets.push({
                    id: nextId++,
                    category: 'mf',
                    name: mf.fund_name,
                    quantity: mf.units,
                    invested: mf.invested,
                    value: mf.value,
                    ltp: mf.nav,
                    purchaseDate: mf.start_date,
                    lastTransDate: mf.last_trans_date,
                    monthlySIP: mf.monthly_sip,
                    portfolio: 'Mutual Funds',
                    lastUpdated: mf.last_updated
                });
            }
        });

        // Add manual funds not in bridge
        manualMFs.forEach(m => {
            if (!appState.assets.find(a => a.id === m.id)) appState.assets.push(m);
        });
    }
}


function saveData() {
    const data = {
        assets: appState.assets,
        history: appState.history,
        targets: appState.targets,
        realizedPnL: appState.realizedPnL
    };
    
    // 1. Local Storage Save (Save individual keys for legacy compatibility)
    localStorage.setItem('wealth_tracker_data', JSON.stringify(data));
    localStorage.setItem('wealth_tracker_history', JSON.stringify(appState.history));
    localStorage.setItem('wealth_tracker_portfolios', JSON.stringify(appState.portfolios));
    localStorage.setItem('wealth_tracker_realized_pnl', JSON.stringify(appState.realizedPnL));
    if (appState.targets) localStorage.setItem('wealth_tracker_targets', JSON.stringify(appState.targets));
    
    // 2. Automatic Cloud Sync (Google Sheets)
    syncToCloud(data);
}

// Global variable for Google Sheets Web App URL
// You need to replace this with your actual URL from Step 2
let GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyFsEbMhfpkSpq-w30J75s4vhkzmfJ5TJP1KD-bSFg-VSWmIsQiZyLATc9-sc5_x8Wo/exec";

async function syncToCloud(data) {
    if (!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL.includes("YOUR_APPS_SCRIPT")) {
        console.log("Cloud sync skipped: No URL provided.");
        return;
    }
    
    try {
        const response = await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors', // Apps Script requires no-cors for simple posts
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log("Cloud Sync Triggered...");
        document.getElementById('sync-status').classList.add('active');
        setTimeout(() => document.getElementById('sync-status').classList.remove('active'), 2000);
    } catch (e) {
        console.error("Cloud Sync Failed:", e);
    }
}

function exportToExcel() {
    try {
        const data = appState.assets.map(a => ({
            Category: a.category.toUpperCase(),
            Name: a.name,
            Folio: a.folio || '-',
            Quantity: a.quantity || 0,
            Invested: a.invested || 0,
            LTP: a.ltp || 0,
            Value: a.value || 0,
            PnL: (a.value - a.invested) || 0,
            ROI: a.invested > 0 ? (((a.value - a.invested) / a.invested) * 100).toFixed(2) + '%' : '0%',
            PurchaseDate: a.purchaseDate || '-',
            SIP_Amount: a.monthlySIP || 0
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Portfolio");
        
        const timestamp = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `WealthTracker_Export_${timestamp}.xlsx`);
        showToast("Portfolio exported to Excel successfully!", "success");
    } catch (e) {
        console.error(e);
        showToast("Export failed!", "error");
    }
}

async function syncToGoogleSheets() {
    const data = {
        assets: appState.assets,
        history: appState.history,
        targets: appState.targets
    };
    
    showToast("Syncing with Google Sheets...", "info");
    await syncToCloud(data);
    showToast("Google Sheets Sync Complete!", "success");
}

async function pullFromSheets() {
    if (!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL.includes("YOUR_APPS_SCRIPT")) {
        showToast("Configuration missing: Check script URL", "error");
        return;
    }

    try {
        showToast("Pulling data from Google Sheets...", "info");
        const response = await fetch(GOOGLE_SHEETS_URL);
        const data = await response.json();
        
        if (data && data.assets) {
            // Merge or overwrite logic
            if (confirm(`Found ${data.assets.length} items in Google Sheets. Overwrite current dashboard data?`)) {
                // Map Google Sheet fields back to app state
                appState.assets = data.assets.map(a => ({
                    ...a,
                    id: a.id || (Date.now() + Math.random()),
                    quantity: parseFloat(a.quantity) || 0,
                    invested: parseFloat(a.invested) || 0,
                    value: parseFloat(a.value) || 0,
                    ltp: parseFloat(a.ltp) || 0,
                    manuallyUpdated: true // Keep them manual to prevent accidental overwrites
                }));
                
                saveData();
                render();
                showToast("Data pulled from Sheets successfully!", "success");
            }
        }
    } catch (e) {
        console.error("Pull failed:", e);
        showToast("Pull from Sheets failed! Check console for errors.", "error");
    }
}

function calculateTotal() {
    return appState.assets.reduce((sum, a) => sum + (a.is_planned ? 0 : (parseFloat(a.value) || 0)), 0);
}

/**
 * Saves a daily snapshot of the total net worth for history tracking
 */
function saveSnapshot() {
    if (appState.assets.length === 0) return;

    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
    const currentTotal = calculateTotal();

    if (currentTotal <= 0) return;

    // Check if we already have a snapshot for today
    const lastSnapshot = appState.history[appState.history.length - 1];

    if (!lastSnapshot || lastSnapshot.date !== dateKey) {
        appState.history.push({ date: dateKey, value: currentTotal });

        // Keep only last 180 days
        if (appState.history.length > 180) {
            appState.history = appState.history.slice(-180);
        }

        localStorage.setItem('wealth_tracker_history', JSON.stringify(appState.history));
        console.log(`✓ Daily snapshot saved: ${dateKey} - ₹${currentTotal}`);
    } else if (Math.abs(lastSnapshot.value - currentTotal) > 500) {
        // Significant intra-day change (e.g., upload or manual edit), update today's snapshot
        lastSnapshot.value = currentTotal;
        localStorage.setItem('wealth_tracker_history', JSON.stringify(appState.history));
    }
}

// --- File Handling ---
function handleFileSelect(e) {
    handleFiles(e.target.files);
}

async function handleFiles(files) {
    for (const file of files) {
        console.log("Processing file:", file.name);
        showToast(`Uploading ${file.name}...`, 'info', 2000);

        try {
            await parseExcel(file);
            showToast(`✓ Successfully uploaded ${file.name}`, 'success');
        } catch (error) {
            console.error('Error parsing file:', error);
            showToast(`✗ Failed to upload ${file.name}: ${error.message}`, 'error', 5000);
        }
    }
    render();
}

function parseExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                let rowsProcessed = 0;
                const isAngelOne = file.name.toLowerCase().includes('angelone');

                // Try to find useful data in sheets
                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];

                    // Angel One files often have incorrect range metadata stopping at the first empty block
                    if (isAngelOne && sheet['!ref']) {
                        const range = XLSX.utils.decode_range(sheet['!ref']);
                        if (range.e.r < 50) {
                            console.log(`Forcing wider range for Angel One: ${sheet['!ref']} -> A1:S100`);
                            range.e.r = 100;
                            range.e.c = Math.max(range.e.c, 18); // Ensure we get enough columns
                            sheet['!ref'] = XLSX.utils.encode_range(range);
                        }
                    }

                    // Read all rows first
                    const allRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                    // Angel One files have metadata in rows 1-17, data starts at row 18
                    let jsonData;
                    if (isAngelOne) {
                        console.log(`Detected Angel One file - total rows from sheet_to_json: ${allRows.length}`);

                        // The library stops at empty rows, so read as raw 2D array instead
                        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });
                        console.log(`Total rows including empty: ${rawData.length}`);

                        // Find the row containing "Company" header
                        let headerRowIndex = -1;
                        for (let i = 0; i < rawData.length; i++) {
                            const row = rawData[i];
                            if (Array.isArray(row) && row.some(cell => cell && typeof cell === 'string' && (cell.trim() === 'Company' || cell.trim() === 'Company Name'))) {
                                headerRowIndex = i;
                                console.log(`Found header at row ${i + 1}`);
                                break;
                            }
                        }

                        if (headerRowIndex !== -1 && headerRowIndex + 1 < rawData.length) {
                            // Extract headers and data rows
                            const headers = rawData[headerRowIndex];
                            const dataRows = rawData.slice(headerRowIndex + 1).filter(row =>
                                Array.isArray(row) && row.some(cell => cell !== null && cell !== '')
                            );

                            // Convert to JSON using the headers
                            jsonData = dataRows.map(row => {
                                const obj = {};
                                headers.forEach((header, idx) => {
                                    if (header) obj[header] = row[idx] || '';
                                });
                                return obj;
                            });

                            console.log(`Converted ${jsonData.length} data rows to JSON`);
                        } else {
                            console.warn('Could not find Company header in Angel One file, using fallback');
                            jsonData = allRows.slice(14); // Fallback to skip metadata
                        }
                    } else {
                        jsonData = allRows;
                    }

                    if (jsonData.length > 0) {
                        processParsedData(jsonData, file.name);
                        rowsProcessed += jsonData.length;
                    }
                });

                if (rowsProcessed === 0) {
                    reject(new Error('No valid data found in file'));
                } else {
                    resolve();
                }
            } catch (error) {
                reject(new Error('Invalid Excel file format'));
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

let pendingUploadData = null;

async function processParsedData(data, fileName) {
    if (!data || data.length === 0) {
        showToast("No valid data found in file", "error");
        return;
    }

    pendingUploadData = data;
    openReconcileModal(fileName);
}

function openReconcileModal(fileName) {
    const modal = document.getElementById('reconcile-modal');
    modal.classList.remove('hidden');
    
    const select = document.getElementById('reconcile-portfolio-select');
    select.innerHTML = '<option value="">-- Create New --</option>' + 
        appState.portfolios.map(p => `<option value="${p}">${p}</option>`).join('');
    
    document.getElementById('reconcile-step-1').classList.remove('hidden');
    document.getElementById('reconcile-step-2').classList.add('hidden');
    document.getElementById('reconcile-desc').innerText = `Uploading: ${fileName}. Detected ${pendingUploadData.length} items.`;
}

// Helper to normalize and get values from a row
function getRowValue(row, keys) {
    const normalizedRow = {};
    Object.keys(row).forEach(k => {
        const cleanK = k.toLowerCase().replace(/\s/g, '').replace(/[^a-z0-9]/gi, '');
        normalizedRow[cleanK] = row[k];
    });

    for (const k of keys) {
        const cleanK = k.toLowerCase().replace(/\s/g, '').replace(/[^a-z0-9]/gi, '');
        if (normalizedRow[cleanK] !== undefined) return normalizedRow[cleanK];
    }
    return null;
}

function getAssetName(row) {
    let name = getRowValue(row, ['Instrument', 'Company', 'CompanyName', 'Stock', 'Name', 'Symbol', 'Asset', 'StockSymbol']);
    if (!name) return null;
    // Aggressive normalization: Remove suffixes like -EQ, -BE, -IV, -N1 etc.
    return String(name).split('-')[0].split(' ')[0].toUpperCase().trim();
}

function closeReconcileModal() {
    document.getElementById('reconcile-modal').classList.add('hidden');
    pendingUploadData = null;
}

let reconciliationResults = {
    portfolio: "",
    newAssets: [],
    soldAssets: []
};

function proceedToReconcile() {
    const selected = document.getElementById('reconcile-portfolio-select').value;
    const newName = document.getElementById('reconcile-new-name').value.trim();
    const portfolio = newName || selected || "Unnamed Portfolio";

    if (!appState.portfolios.includes(portfolio)) {
        appState.portfolios.push(portfolio);
        saveData();
    }

    // Find existing assets in this portfolio
    const existingAssets = appState.assets.filter(a => a.portfolio === portfolio);
    
    // Parse new assets and map by normalized name
    const newAssetsMap = {};
    pendingUploadData.forEach(row => {
        const name = getAssetName(row);
        if (name) {
            // If multiple entries for same stock, sum them up
            const qty = parseFloat(getRowValue(row, ['TotalQuantity', 'Quantity', 'Qty', 'Size', 'PositionSize', 'Qty.'])) || 0;
            if (newAssetsMap[name]) {
                newAssetsMap[name].quantity += qty;
            } else {
                newAssetsMap[name] = { name: name, quantity: qty, row: row };
            }
        }
    });

    const sold = [];
    existingAssets.forEach(ea => {
        const normName = ea.name.split('-')[0].split(' ')[0].toUpperCase().trim();
        const newData = newAssetsMap[normName];

        if (!newData) {
            // Full sale: Asset missing in new file
            sold.push({ ...ea, soldQty: ea.quantity, type: 'full' });
        } else if (newData.quantity < ea.quantity) {
            // Partial sale: Quantity decreased
            sold.push({ ...ea, soldQty: ea.quantity - newData.quantity, type: 'partial' });
        }
    });

    reconciliationResults = {
        portfolio: portfolio,
        newAssets: pendingUploadData,
        soldAssets: sold
    };

    if (sold.length > 0) {
        showSoldAssetsStep(sold);
    } else {
        finalizeReconciliation();
    }
}

function showSoldAssetsStep(sold) {
    document.getElementById('reconcile-step-1').classList.add('hidden');
    document.getElementById('reconcile-step-2').classList.remove('hidden');
    document.getElementById('reconcile-desc').innerHTML = `⚠️ Detected ${sold.length} sales/missing assets.<br><small>Enter sell price to book profit or check 'Ignore' if error.</small>`;

    const list = document.getElementById('sold-assets-list');
    list.innerHTML = sold.map(a => `
        <div class="sold-item" id="sold-item-${a.id}" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div>
                    <div style="font-weight: 600;">${a.name} <span style="color: ${a.type === 'partial' ? '#ff9500' : '#ff5252'}; font-size: 0.7rem;">(${a.type === 'partial' ? 'Partial Sale' : 'Full Sale'})</span></div>
                    <div style="font-size: 0.8rem; color: #888;">Sold Qty: ${a.soldQty} | Avg Cost: ${formatCurrency(a.invested / a.quantity)}</div>
                </div>
                <label style="font-size: 0.7rem; color: #aaa; cursor: pointer;">
                    <input type="checkbox" class="ignore-sold" data-id="${a.id}" onchange="toggleSoldInput(this, ${a.id})"> Ignore
                </label>
            </div>
            <div class="sell-input-container" id="input-container-${a.id}" style="margin-top: 5px; display: flex; align-items: center; gap: 10px;">
                <label style="font-size: 0.8rem;">Sell Price:</label>
                <input type="number" step="0.01" class="sell-price-input" data-id="${a.id}" data-qty="${a.soldQty}" placeholder="Enter Price" 
                       style="background: #1a1a1a; border: 1px solid #333; color: white; padding: 5px; border-radius: 4px; width: 100px;">
            </div>
        </div>
    `).join('');
}

function toggleSoldInput(checkbox, id) {
    const container = document.getElementById(`input-container-${id}`);
    const input = container.querySelector('.sell-price-input');
    if (checkbox.checked) {
        container.style.opacity = "0.3";
        input.disabled = true;
        input.value = "";
    } else {
        container.style.opacity = "1";
        input.disabled = false;
    }
}

function finalizeReconciliation() {
    // 1. Process Profits for Sold Assets
    const inputs = document.querySelectorAll('.sell-price-input');
    inputs.forEach(input => {
        if (input.disabled) return; // Skip ignored items

        const assetId = input.dataset.id;
        const sellPrice = parseFloat(input.value) || 0;
        const soldQty = parseFloat(input.dataset.qty) || 0;
        const asset = appState.assets.find(a => String(a.id) === String(assetId));

        if (asset && sellPrice > 0) {
            const avgBuyPrice = asset.invested / asset.quantity;
            const profit = (sellPrice - avgBuyPrice) * soldQty;
            
            appState.realizedPnL.push({
                date: new Date().toISOString(),
                name: asset.name,
                portfolio: asset.portfolio,
                profit: profit,
                quantity: soldQty,
                sellPrice: sellPrice,
                buyPrice: avgBuyPrice
            });
        }
    });

    // 2. Remove assets that were FULLY sold, or update those PARTIALLY sold
    reconciliationResults.soldAssets.forEach(sa => {
        const asset = appState.assets.find(a => a.id === sa.id);
        if (!asset) return;

        if (sa.type === 'full') {
            appState.assets = appState.assets.filter(a => a.id !== sa.id);
        } else {
            // Partial sale: Update remaining quantity and invested value
            const remainingQty = asset.quantity - sa.soldQty;
            const avgCost = asset.invested / asset.quantity;
            asset.quantity = remainingQty;
            asset.invested = remainingQty * avgCost;
            // Value and LTP will be updated by the new file merge below
        }
    });

    // 3. MERGE New Data (Overwrite old assets in same portfolio)
    appState.assets = appState.assets.filter(a => a.portfolio !== reconciliationResults.portfolio);

    // 3. Add new assets with ROBUST column matching
    reconciliationResults.newAssets.forEach((row, index) => {
        let name = getAssetName(row);
        let qty = getRowValue(row, ['TotalQuantity', 'Quantity', 'Qty', 'Size', 'PositionSize', 'Qty.']) || 0;
        let val = getRowValue(row, ['MarketValue', 'CurrentValue', 'Value', 'Total', 'Curval', 'ValueAtMarketPrice', 'Cur.val']);
        let p_l = getRowValue(row, ['OverallGainLoss', 'PL', 'P_L', 'Profit', 'Gain', 'UnrealizedProfitLoss']) || 0;
        
        let avgCost = getRowValue(row, ['AvgTradingPrice', 'Avgcost', 'BuyAvg', 'AverageCost', 'AvgPrice', 'AverageCostPrice', 'Avg.cost']);
        let invested = getRowValue(row, ['InvestedValue', 'Invested', 'InvestedAmount', 'CostBasis', 'ValueAtCost']) || (avgCost * qty) || (val - p_l);
        let ltp = getRowValue(row, ['LTP', 'LastPrice', 'Price', 'CurrentMarketPrice']) || (qty > 0 ? val / qty : 0);
        let date = getRowValue(row, ['Date', 'PurchaseDate', 'BuyDate', 'InceptionDate']) || new Date().toISOString().split('T')[0];

        // Guard: Skip invalid or summary rows
        if (!name || isNaN(qty) || qty <= 0) return;

        appState.assets.push({
            id: Date.now() + index + Math.random(),
            name: String(name),
            portfolio: reconciliationResults.portfolio,
            category: "stocks",
            quantity: parseFloat(qty),
            invested: parseFloat(invested),
            value: parseFloat(val) || (parseFloat(qty) * parseFloat(ltp)),
            ltp: parseFloat(ltp),
            prevClose: parseFloat(ltp), // Default
            purchaseDate: date,
            lastUpdated: new Date().toISOString()
        });
    });

    saveData();
    render();
    closeReconcileModal();
    showToast(`Portfolio ${reconciliationResults.portfolio} updated successfully!`, "success");
}

// --- Modal Handling ---
function openManualEntry(category, editId = null) {
    const modal = document.getElementById('manual-entry-modal');
    const catSelect = document.getElementById('asset-category');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('asset-form');

    appState.editingId = editId;

    if (editId) {
        const asset = appState.assets.find(a => a.id === editId);
        if (asset) {
            title.innerText = "Edit Asset";
            document.getElementById('asset-category').value = asset.category;
            document.getElementById('asset-name').value = asset.name;
            document.getElementById('asset-folio').value = asset.folio || "";
            document.getElementById('asset-qty').value = asset.quantity;
            document.getElementById('asset-invested').value = asset.invested;
            document.getElementById('asset-value').value = asset.value;
            document.getElementById('asset-date').value = asset.purchaseDate;
            document.getElementById('asset-last-date').value = asset.lastTransDate || "";
            document.getElementById('asset-sip').value = asset.monthlySIP || "";
            document.getElementById('asset-sip-date').value = asset.sipDate || "";
            document.getElementById('asset-portfolio').value = asset.portfolio || "Other";
        }
    } else {
        form.reset();
        if (category !== 'any') {
            catSelect.value = category;
            title.innerText = `Update ${catSelect.options[catSelect.selectedIndex].text}`;
        } else {
            title.innerText = "Add New Asset";
        }
    }

    // Initial UI update
    updateModalUI();
    modal.classList.remove('hidden');
}

/**
 * Dynamically updates field visibility and labels in manual entry modal
 */
function updateModalUI() {
    const cat = document.getElementById('asset-category').value;
    const isMF = cat === 'mf';
    const isCash = cat === 'cash';

    // MF specific fields
    document.getElementById('last-trans-col').style.display = isMF ? 'block' : 'none';
    document.getElementById('sip-col').style.display = isMF ? 'block' : 'none';
    document.getElementById('sip-date-col').style.display = isMF ? 'block' : 'none';
    document.getElementById('folio-col').style.display = isMF ? 'block' : 'none';

    // Cash specific simplifications
    document.getElementById('qty-col').style.display = (isCash || cat === 'property') ? 'none' : 'block';

    // Property specific renaming
    if (cat === 'property') {
        document.getElementById('asset-name-label').innerText = "Property Name / Location";
        document.getElementById('asset-value-label').innerText = "Current Market Value (₹)";
        document.getElementById('asset-invested').placeholder = "Total Purchase Price";
    }

    document.getElementById('invested-col').style.display = isCash ? 'none' : 'block';

    // Label Renaming
    const nameLabel = document.getElementById('asset-name-label');
    const valueLabel = document.getElementById('asset-value-label');
    const nameInput = document.getElementById('asset-name');

    if (isCash) {
        nameLabel.innerText = "Account / Bank Name";
        valueLabel.innerText = "Current Balance (₹)";
        nameInput.placeholder = "e.g. HDFC Bank, Cash in Hand";
    } else {
        nameLabel.innerText = "Fund Name / Asset";
        valueLabel.innerText = "Current Value (₹)";
        nameInput.placeholder = "e.g. 24K Gold, Axis Small Cap";
    }
}

function closeModal() {
    document.getElementById('manual-entry-modal').classList.add('hidden');
    document.getElementById('asset-form').reset();
    appState.editingId = null;
}

function handleManualSave(e) {
    e.preventDefault();
    const cat = document.getElementById('asset-category').value;
    const name = document.getElementById('asset-name').value;
    const val = document.getElementById('asset-value').value;
    const invested = document.getElementById('asset-invested').value;
    const date = document.getElementById('asset-date').value;
    const qty = document.getElementById('asset-qty').value;

    if (!name || !val) {
        alert("Please fill in all fields.");
        return;
    }

    const ltp = (parseFloat(val) && parseFloat(qty)) ? (parseFloat(val) / parseFloat(qty)) : 0;

    const assetData = {
        id: appState.editingId || Date.now(),
        category: cat,
        name: name,
        folio: document.getElementById('asset-folio').value || "",
        quantity: parseFloat(qty) || 1,
        invested: parseFloat(invested) || parseFloat(val),
        value: parseFloat(val),
        ltp: ltp,
        purchaseDate: date || new Date().toISOString().split('T')[0],
        lastTransDate: document.getElementById('asset-last-date').value,
        monthlySIP: parseFloat(document.getElementById('asset-sip').value) || 0,
        sipDate: parseInt(document.getElementById('asset-sip-date').value) || null,
        portfolio: document.getElementById('asset-portfolio').value,
        lastUpdated: new Date().toLocaleDateString(),
        manuallyUpdated: true,
        lastManualUpdate: Date.now()
    };

    // Auto-calculate invested amount if SIP data is available
    const sip = assetData.monthlySIP;
    const startDate = assetData.purchaseDate;
    const endDate = assetData.lastTransDate;

    if (sip && sip > 0 && startDate && endDate) {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);

            // Calculate months between start and end (inclusive)
            const months = (end.getFullYear() - start.getFullYear()) * 12
                + (end.getMonth() - start.getMonth()) + 1;

            if (months > 0) {
                const calculatedInvested = sip * months;
                assetData.invested = calculatedInvested;
                console.log(`Auto-calculated invested: ₹${sip} × ${months} months = ₹${calculatedInvested}`);
            }
        } catch (e) {
            console.warn('Could not auto-calculate invested amount:', e);
        }
    }

    if (appState.editingId) {
        const idx = appState.assets.findIndex(a => a.id === appState.editingId);
        if (idx > -1) appState.assets[idx] = assetData;
    } else {
        appState.assets.push(assetData);
    }

    saveData();
    closeModal();
    render();
}

function calculateCAGR(invested, current, purchaseDate) {
    if (!invested || !current || !purchaseDate || invested <= 0) return 0;
    const start = new Date(purchaseDate);
    const end = new Date();
    const diffTime = end - start;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    if (diffDays < 1) return 0;

    const years = diffDays / 365.25;
    try {
        if (years < 1) {
            // Return Absolute ROI for short-term holdings to avoid insane annualized figures
            return ((current / invested) - 1) * 100;
        }
        const cagr = (Math.pow(current / invested, 1 / years) - 1) * 100;
        return isFinite(cagr) ? Math.min(Math.max(cagr, -99), 5000) : 0; // Cap at 5000% for display sanity
    } catch (e) {
        return 0;
    }
}

function deleteAsset(id) {
    if (confirm("Remove this asset?")) {
        appState.assets = appState.assets.filter(a => a.id !== id);
        saveData();
        render();
    }
}

/**
 * Dynamically updates the list of portfolios based on current assets
 * ONLY adds new portfolios that don't already exist. Does not remove.
 */
function updatePortfolios() {
    const existing = new Set(appState.portfolios);
    let added = false;
    appState.assets.forEach(a => {
        if (a.portfolio && !existing.has(a.portfolio)) {
            appState.portfolios.push(a.portfolio);
            existing.add(a.portfolio);
            added = true;
        }
    });

    if (added) {
        appState.portfolios.sort();
        saveData();
    }
}

function addPortfolio(name) {
    if (!name || appState.portfolios.includes(name)) return;
    appState.portfolios.push(name);
    appState.portfolios.sort();
    saveData();
    populatePortfolioDropdowns();
    renderPortfolioManager();
}

function deletePortfolio(name) {
    if (confirm(`Are you sure you want to delete "${name}"? This won't delete the assets, but they will be unassigned.`)) {
        appState.portfolios = appState.portfolios.filter(p => p !== name);
        saveData();
        populatePortfolioDropdowns();
        renderPortfolioManager();
    }
}

function renamePortfolio(oldName, newName) {
    if (!newName || appState.portfolios.includes(newName)) return;

    // 1. Update portfolio list
    appState.portfolios = appState.portfolios.map(p => p === oldName ? newName : p);

    // 2. Update all assets that used this portfolio
    appState.assets.forEach(a => {
        if (a.portfolio === oldName) a.portfolio = newName;
    });

    saveData();
    populatePortfolioDropdowns();
    renderPortfolioManager();
    render(); // Update tables too
}

/** 
 * UI for Managing Portfolios 
 */
function openPortfolioManager() {
    document.getElementById('portfolio-modal').classList.remove('hidden');
    renderPortfolioManager();
}

function closePortfolioModal() {
    document.getElementById('portfolio-modal').classList.add('hidden');
}

function renderPortfolioManager() {
    const list = document.getElementById('portfolio-list');
    if (!list) return;

    list.innerHTML = appState.portfolios.map(p => `
        <div class="pm-item">
            <input type="text" class="pm-name-input" value="${p}" 
                   onchange="renamePortfolio('${p}', this.value)"
                   title="Click to rename">
            <div class="pm-actions">
                <button class="btn-action btn-delete" onclick="deletePortfolio('${p}')" title="Delete Portfolio">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
}



// --- UI Rendering ---
// --- UI Rendering ---

function render() {
    updatePortfolios();
    populatePortfolioDropdowns();
    appState.totalNetWorth = calculateTotal();

    // Summary Cards
    document.getElementById('overall-net-worth').innerText = formatCurrency(appState.totalNetWorth);

    // Growth Indicator
    const growthEl = document.getElementById('networth-growth');
    if (growthEl) {
        if (appState.history.length > 1) {
            const current = appState.totalNetWorth;
            const previous = appState.history[appState.history.length - 2].value;
            const diff = current - previous;
            const pct = (previous > 0 ? (diff / previous * 100) : 0).toFixed(2);

            growthEl.innerText = `${diff >= 0 ? '+' : ''}${formatCurrency(diff)} (${pct}%) since last snapshot`;
            growthEl.className = 'growth-indicator ' + (diff >= 0 ? 'positive' : 'negative');
        } else {
            growthEl.innerText = 'Tracking history...';
            growthEl.className = 'growth-indicator';
        }
    }

    // Helper to calculate category metrics
    const catMetrics = (cat) => {
        const assets = appState.assets.filter(a => a.category.toLowerCase() === cat.toLowerCase());
        const value = assets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);

        // For Cash category, Invested should equal Value to prevent P&L confusion
        const invested = cat.toLowerCase() === 'cash' ? value : assets.reduce((sum, a) => sum + (parseFloat(a.invested) || 0), 0);

        const pnl = value - invested;
        const roi = invested > 0 ? (pnl / invested * 100) : 0;

        // Day Change Calculation
        const dayChgRs = assets.reduce((sum, a) => {
            const ltp = a.ltp || (a.quantity > 0 ? a.value / a.quantity : 0);
            const prevClose = a.prevClose || ltp;
            return sum + (a.quantity * (ltp - prevClose));
        }, 0);
        const prevValue = value - dayChgRs;
        const dayChgPct = prevValue > 0 ? (dayChgRs / prevValue * 100) : 0;

        return { invested, value, pnl, roi, dayChgRs, dayChgPct, count: assets.length };
    };

    const updateCard = (cat, metrics) => {
        const prefix = cat.toLowerCase();
        setSafeText(`${prefix}-value`, formatCurrency(metrics.value));
        setSafeText(`${prefix}-invested`, formatCurrency(metrics.invested));

        setSafeText(`${prefix}-pnl`, formatCurrency(metrics.pnl), 'pnl-value ' + (metrics.pnl >= 0 ? 'positive' : 'negative'));

        const dayPnlText = `${formatCurrency(metrics.dayChgRs)} (${metrics.dayChgPct.toFixed(2)}%)`;
        setSafeText(`${prefix}-day-pnl`, dayPnlText, 'pnl-value ' + (metrics.dayChgRs >= 0 ? 'positive' : 'negative'));

        setSafeText(`${prefix}-roi`, metrics.roi.toFixed(2) + '%', 'roi-value ' + (metrics.roi >= 0 ? 'positive' : 'negative'));
        setSafeText(`${prefix}-cagr`, metrics.roi.toFixed(2) + '%', 'roi-value ' + (metrics.roi >= 0 ? 'positive' : 'negative')); // Fallback for CAGR

        if (prefix === 'stocks') {
            setSafeText('stocks-count', `${metrics.count} Holdings`);
        }
    };

    updateCard('gold', catMetrics('gold'));
    updateCard('stocks', catMetrics('stocks'));
    updateCard('mf', catMetrics('mf'));
    updateCard('cash', catMetrics('cash'));
    updateCard('property', catMetrics('property'));

    // Update Realized P&L Displays
    const stocksProfit = appState.realizedPnL
        .filter(p => p.portfolio !== 'Mutual Funds')
        .reduce((sum, p) => sum + p.profit, 0);
    const mfProfit = appState.realizedPnL
        .filter(p => p.portfolio === 'Mutual Funds')
        .reduce((sum, p) => sum + p.profit, 0);
    
    setSafeText('stocks-realized-pnl', formatCurrency(stocksProfit), 'pnl-value ' + (stocksProfit >= 0 ? 'positive' : 'negative'));
    setSafeText('mf-realized-pnl', formatCurrency(mfProfit), 'pnl-value ' + (mfProfit >= 0 ? 'positive' : 'negative'));

    // Render Realized P&L Table
    const pnlBody = document.getElementById('realized-pnl-body');
    if (pnlBody) {
        if (!appState.realizedPnL || appState.realizedPnL.length === 0) {
            pnlBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 20px;">No realized profits recorded yet.</td></tr>';
        } else {
            pnlBody.innerHTML = [...appState.realizedPnL].reverse().map((p, idx) => {
                const actualIdx = appState.realizedPnL.length - 1 - idx;
                return `
                <tr>
                    <td>${new Date(p.date).toLocaleDateString()}</td>
                    <td>${p.name}</td>
                    <td>${p.portfolio}</td>
                    <td>${p.quantity}</td>
                    <td>${formatCurrency(p.buyPrice)}</td>
                    <td>${formatCurrency(p.sellPrice)}</td>
                    <td class="${p.profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(p.profit)}</td>
                    <td>
                        <button class="btn-icon" onclick="editRealizedPnL(${actualIdx})" title="Edit">✏️</button>
                        <button class="btn-icon" onclick="deleteRealizedPnL(${actualIdx})" title="Delete">🗑️</button>
                    </td>
                </tr>
            `;}).join('');
        }
    }

    // Passive Income Calculation
    const stockAssets = appState.assets.filter(a => a.category === 'stocks' || a.category === 'holdings');
    const annualPassiveIncome = stockAssets.reduce((sum, a) => sum + ((parseFloat(a.quantity) || 0) * (parseFloat(a.divRate) || 0)), 0);
    const monthlyPassiveIncome = annualPassiveIncome / 12;
    const portfolioYield = appState.totalNetWorth > 0 ? (annualPassiveIncome / appState.totalNetWorth * 100) : 0;

    const yearlyEl = document.getElementById('passive-income-yearly');
    const monthlyEl = document.getElementById('passive-income-monthly');
    const yieldEl = document.getElementById('passive-income-yield');

    if (yearlyEl) yearlyEl.innerText = formatCurrency(annualPassiveIncome);
    if (monthlyEl) monthlyEl.innerText = formatCurrency(monthlyPassiveIncome);
    if (yieldEl) yieldEl.innerText = portfolioYield.toFixed(2) + '%';

    // Health Score Update
    const health = calculateHealthScore();
    const healthValEl = document.getElementById('portfolio-health-val');
    const healthStatusEl = document.getElementById('health-status');
    const healthCard = document.querySelector('.health-card');

    if (healthValEl) healthValEl.innerText = health.score;
    if (healthStatusEl) {
        healthStatusEl.innerText = health.status;
        healthStatusEl.style.color = health.color;
    }
    if (healthCard) {
        healthCard.style.borderLeftColor = health.color;
    }

    renderTable();
    renderMFTable();
    renderGoldTable();
    renderCashTable();
    renderPropertyTable();
    renderAnalytics();
    renderOptimization();

    // Save daily snapshot if needed
    saveSnapshot();
}

function renderTable(filter = "") {
    const tbody = document.getElementById('assets-body');
    tbody.innerHTML = "";

    // Update Header Indicators
    document.querySelectorAll('#assets-table th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === appState.sortColumn) {
            th.classList.add(appState.sortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });

    let filtered = appState.assets.filter(a =>
        a.category !== 'mf' && a.category !== 'gold' && a.category !== 'cash' &&
        (appState.portfolioFilter === 'all' || a.portfolio === appState.portfolioFilter) &&
        (
            a.name.toLowerCase().includes(filter.toLowerCase()) ||
            a.category.toLowerCase().includes(filter.toLowerCase())
        )
    );

    // Dynamic Sort
    filtered.sort((a, b) => {
        let valA, valB;

        const invA = a.invested || a.value;
        const invB = b.invested || b.value;
        const ltpA = a.ltp || (a.quantity > 0 ? a.value / a.quantity : 0);
        const ltpB = b.quantity > 0 ? b.value / b.quantity : 0;
        const pcA = a.prevClose || ltpA;
        const pcB = b.prevClose || ltpB;

        switch (appState.sortColumn) {
            case 'category': valA = a.category; valB = b.category; break;
            case 'name': valA = a.name; valB = b.name; break;
            case 'quantity': valA = a.quantity; valB = b.quantity; break;
            case 'avg_cost': valA = a.quantity > 0 ? invA / a.quantity : 0; valB = b.quantity > 0 ? invB / b.quantity : 0; break;
            case 'ltp': valA = ltpA; valB = ltpB; break;
            case 'invested': valA = invA; valB = invB; break;
            case 'value': valA = a.value; valB = b.value; break;
            case 'pnl': valA = a.value - invA; valB = b.value - invB; break;
            case 'day_chg_rs': valA = a.quantity * (ltpA - pcA); valB = b.quantity * (ltpB - pcB); break;
            case 'day_chg_pct': valA = pcA > 0 ? (ltpA - pcA) / pcA : 0; valB = pcB > 0 ? (ltpB - pcB) / pcB : 0; break;
            case 'roi':
                valA = invA > 0 ? (a.value - invA) / invA : 0;
                valB = invB > 0 ? (b.value - invB) / invB : 0;
                break;
            case 'cagr':
                valA = calculateCAGR(invA, a.value, a.purchaseDate);
                valB = calculateCAGR(invB, b.value, b.purchaseDate);
                break;
            default: valA = a.value; valB = b.value;
        }

        if (typeof valA === 'string') {
            return appState.sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return appState.sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    // --- Portfolio Summary Calculation ---
    const summaryBar = document.getElementById('portfolio-summary-bar');
    if (summaryBar) {
        if (appState.portfolioFilter === 'all') {
            summaryBar.classList.add('hidden');
        } else {
            summaryBar.classList.remove('hidden');
            let totalInv = 0, totalVal = 0, totalDayChg = 0;

            filtered.forEach(a => {
                const investedAmount = a.invested || a.value || 0;
                const ltp = a.ltp || (a.quantity > 0 ? a.value / a.quantity : 0);
                const prevClose = a.prevClose || ltp;

                totalInv += investedAmount;
                totalVal += (a.value || 0);
                totalDayChg += (a.quantity * (ltp - prevClose));
            });

            const totalPnl = totalVal - totalInv;
            const totalRoi = totalInv > 0 ? (totalPnl / totalInv * 100) : 0;
            const prevVal = totalVal - totalDayChg;
            const totalDayPct = prevVal > 0 ? (totalDayChg / prevVal * 100) : 0;

            document.getElementById('port-count').innerText = filtered.length;
            document.getElementById('port-invested').innerText = formatCurrency(totalInv);
            document.getElementById('port-value').innerText = formatCurrency(totalVal);

            const pnlEl = document.getElementById('port-pnl');
            pnlEl.innerText = formatCurrency(totalPnl);
            pnlEl.className = 'value ' + (totalPnl >= 0 ? 'positive' : 'negative');

            const roiEl = document.getElementById('port-roi');
            roiEl.innerText = totalRoi.toFixed(2) + '%';
            roiEl.className = 'value ' + (totalRoi >= 0 ? 'positive' : 'negative');

            const dayPnlEl = document.getElementById('port-day-pnl');
            if (dayPnlEl) {
                dayPnlEl.innerText = `${formatCurrency(totalDayChg)} (${totalDayPct.toFixed(2)}%)`;
                dayPnlEl.className = 'value ' + (totalDayChg >= 0 ? 'positive' : 'negative');
            }
        }
    }

    filtered.forEach(asset => {
        const investedAmount = asset.invested || asset.value || 0;
        const ltp = asset.ltp || (asset.quantity > 0 ? asset.value / asset.quantity : 0);
        const avgCost = asset.quantity > 0 ? investedAmount / asset.quantity : 0;
        const pnl = asset.value - investedAmount;
        const roi = investedAmount > 0 ? (pnl / investedAmount * 100) : 0;

        const prevClose = (asset.prevClose && asset.prevClose > 0.1 && Math.abs(asset.prevClose - ltp) / ltp < 0.8) ? asset.prevClose : ltp;
        const dayChgRs = asset.quantity * (ltp - prevClose);
        const dayChgPct = prevClose > 0 ? ((ltp - prevClose) / prevClose * 100) : 0;

        const cagr = calculateCAGR(investedAmount, asset.value, asset.purchaseDate);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="category-tag">${asset.category}</span></td>
            <td><span class="portfolio-tag">${asset.portfolio || 'Zerodha'}</span></td>
            <td><strong>${asset.name}</strong></td>
            <td>${asset.quantity}</td>
            <td>${formatCurrency(avgCost)}</td>
            <td>${formatCurrency(ltp)}</td>
            <td>${formatCurrency(investedAmount)}</td>
            <td>${formatCurrency(asset.value)}</td>
            <td style="color: #ffd700; font-weight: 500;">${(asset.divYield || 0).toFixed(2)}%</td>
            <td class="${pnl >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(pnl)}</td>
            <td class="${dayChgRs >= 0 ? 'text-success' : 'text-danger'}">${dayChgRs.toFixed(2)}</td>
            <td class="${dayChgPct >= 0 ? 'text-success' : 'text-danger'}">${dayChgPct.toFixed(2)}%</td>
            <td class="${roi >= 0 ? 'text-success' : 'text-danger'}">${roi.toFixed(2)}%</td>
            <td class="${cagr >= 0 ? 'text-success' : 'text-danger'}">${cagr.toFixed(2)}%</td>
            <td>
                <button class="btn-action btn-buy" onclick="openTradeModal(${asset.id}, 'buy')">➕</button>
                <button class="btn-action btn-sell" onclick="openTradeModal(${asset.id}, 'sell')">➖</button>
                <button class="btn-action btn-edit-row" onclick="openManualEntry('any', ${asset.id})">✏️</button>
                <button class="btn-action btn-delete" onclick="deleteAsset(${asset.id})">🗑️</button>
            </td>

        `;
        tbody.appendChild(tr);
    });
}

function formatCurrency(val) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(val || 0);
}

function renderMFTable(filter = "") {
    const tbody = document.getElementById('mf-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    console.log('Rendering MF Table. Filter:', filter, 'PortfolioFilter:', appState.portfolioFilter);
    console.log('Total Assets for MF Category:', appState.assets.filter(a => a.category === 'mf').length);

    // Use MF-specific sort state
    let sortCol = appState.mfSortColumn || 'name';

    let filtered = appState.assets
        .filter(a => (a.category || "").toLowerCase() === 'mf')
        .filter(a => {
            if (appState.portfolioFilter === 'all') return true;
            const p = a.portfolio || "Mutual Funds";
            const f = appState.portfolioFilter;
            // Robust check including legacy MF
            if ((f === "Mutual Funds" || f === "MF") && (p === "MF" || p === "Mutual Funds")) return true;
            return p === f;
        })
        .filter(a => {
            const name = (a.name || "").toLowerCase();
            const search = (filter || "").toLowerCase();
            return name.includes(search);
        });

    console.log('Filtered MF Count:', filtered.length);
    if (filtered.length > 0) console.log('First Filtered MF:', filtered[0].name, 'Portfolio:', filtered[0].portfolio);

    // Sort using MF sort state
    filtered.sort((a, b) => {
        let valA = a[sortCol] || 0;
        let valB = b[sortCol] || 0;

        if (typeof valA === 'string') {
            return appState.mfSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return appState.mfSortOrder === 'asc' ? valA - valB : valB - valA;
    });

    // --- MF Portfolio Summary Calculation ---
    const summaryBar = document.getElementById('mf-portfolio-summary-bar');
    if (summaryBar) {
        if (appState.portfolioFilter === 'all') {
            summaryBar.classList.add('hidden');
        } else {
            summaryBar.classList.remove('hidden');
            let totalInv = 0, totalVal = 0, totalDayChg = 0;
            filtered.forEach(a => {
                const investedAmount = (a.invested || a.value || 0);
                const ltp = a.ltp || (a.quantity > 0 ? a.value / a.quantity : 0);
                const prevClose = a.prevClose || ltp;

                totalInv += investedAmount;
                totalVal += (a.value || 0);
                totalDayChg += (a.quantity * (ltp - prevClose));
            });
            const totalPnl = totalVal - totalInv;
            const totalRoi = totalInv > 0 ? (totalPnl / totalInv * 100) : 0;
            const prevVal = totalVal - totalDayChg;
            const totalDayPct = prevVal > 0 ? (totalDayChg / prevVal * 100) : 0;

            const countEl = document.getElementById('mf-port-count');
            if (countEl) countEl.innerText = filtered.length;

            const investedEl = document.getElementById('mf-port-invested');
            if (investedEl) investedEl.innerText = formatCurrency(totalInv);

            const valueEl = document.getElementById('mf-port-value');
            if (valueEl) valueEl.innerText = formatCurrency(totalVal);

            const pnlEl = document.getElementById('mf-port-pnl');
            if (pnlEl) {
                pnlEl.innerText = formatCurrency(totalPnl);
                pnlEl.className = 'value ' + (totalPnl >= 0 ? 'positive' : 'negative');
            }

            const roiEl = document.getElementById('mf-port-roi');
            if (roiEl) {
                roiEl.innerText = totalRoi.toFixed(2) + '%';
                roiEl.className = 'value ' + (totalRoi >= 0 ? 'positive' : 'negative');
            }


            const dayPnlEl = document.getElementById('mf-port-day-pnl');
            if (dayPnlEl) {
                dayPnlEl.innerText = `${formatCurrency(totalDayChg)} (${totalDayPct.toFixed(2)}%)`;
                dayPnlEl.className = 'value ' + (totalDayChg >= 0 ? 'positive' : 'negative');
            }
        }
    }

    filtered.forEach(asset => {
        const investedAmount = asset.invested || 0;
        const pnl = asset.value - investedAmount;
        const roi = investedAmount > 0 ? (pnl / investedAmount * 100) : 0;
        const cagr = asset.cagrOverride || calculateCAGR(investedAmount, asset.value, asset.purchaseDate);
        const xirr = asset.xirrOverride || calculateXIRR(asset);
        const ltp = asset.ltp || (asset.quantity > 0 ? asset.value / asset.quantity : 0);

        const tr = document.createElement('tr');
        if (asset.is_planned) {
            tr.classList.add('planned-row');
            tr.innerHTML = `
                <td><strong>${asset.name}</strong> <span class="badge-planned">PLANNED</span></td>
                <td><span class="portfolio-tag">${asset.portfolio}</span></td>
                <td>-</td>
                <td>-</td>
                <td>${formatCurrency(asset.monthlySIP)}</td>
                <td>-</td>
                <td>0.000</td>
                <td>-</td>
                <td>${formatCurrency(ltp)}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>
                    <button class="btn-action" onclick="alert('This is a planned SIP. Start it in your broker app!')">ℹ️</button>
                    <button class="btn-action btn-delete" onclick="deleteAsset(${asset.id})">🗑️</button>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td><strong>${asset.name}</strong></td>
                <td><span class="portfolio-tag">${asset.portfolio || (asset.category === 'mf' ? 'Mutual Funds' : 'Other')}</span></td>
                <td>${asset.purchaseDate || '-'}</td>
                <td>${asset.lastTransDate || '-'}</td>
                <td>${formatCurrency(asset.monthlySIP)}</td>
                <td>${asset.sipDate || '-'}</td>
                <td>${asset.quantity ? asset.quantity.toFixed(3) : '0.000'}</td>
                <td>${formatCurrency(asset.quantity > 0 ? investedAmount / asset.quantity : 0)}</td>
                <td>${formatCurrency(ltp)}</td>
                <td>${formatCurrency(investedAmount)}</td>
                <td><strong>${formatCurrency(asset.value)}</strong></td>
                <td class="${pnl >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(pnl)}</td>
                <td class="${roi >= 0 ? 'text-success' : 'text-danger'}">${roi.toFixed(2)}%</td>
                <td class="${xirr >= 0 ? 'text-success' : 'text-danger'}">${xirr.toFixed(2)}%</td>
                <td class="${cagr >= 0 ? 'text-success' : 'text-danger'}">${cagr.toFixed(2)}%</td>
                <td>
                    <button class="btn-action btn-buy" onclick="openTradeModal(${asset.id}, 'buy')">➕</button>
                    <button class="btn-action btn-sell" onclick="openTradeModal(${asset.id}, 'sell')">➖</button>
                    <button class="btn-action" onclick="openManualEntry('mf', ${asset.id})">✏️</button>
                    <button class="btn-action btn-delete" onclick="deleteAsset(${asset.id})">🗑️</button>
                </td>

            `;
        }
        tbody.appendChild(tr);
    });
}

function renderGoldTable(filter = "") {
    const tbody = document.getElementById('gold-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    let filtered = appState.assets.filter(a => a.category === 'gold' && a.name.toLowerCase().includes(filter.toLowerCase()));

    // Sort
    const sortCol = appState.goldSortColumn || 'name';
    filtered.sort((a, b) => {
        let valA = a[sortCol] || 0;
        let valB = b[sortCol] || 0;
        if (typeof valA === 'string') return appState.goldSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return appState.goldSortOrder === 'asc' ? valA - valB : valB - valA;
    });

    filtered.forEach(asset => {
        const invested = asset.invested || 0;
        const pnl = asset.value - invested;
        const roi = invested > 0 ? (pnl / invested * 100) : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${asset.name}</strong></td>
            <td>${asset.quantity}</td>
            <td>${formatCurrency(asset.ltp)}</td>
            <td>${formatCurrency(invested)}</td>
            <td><strong>${formatCurrency(asset.value)}</strong></td>
            <td class="${pnl >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(pnl)}</td>
            <td class="${roi >= 0 ? 'text-success' : 'text-danger'}">${roi.toFixed(2)}%</td>
            <td>
                <button class="btn-action btn-edit-row" onclick="openManualEntry('gold', ${asset.id})">✏️</button>
                <button class="btn-action btn-delete" onclick="deleteAsset(${asset.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderCashTable(filter = "") {
    const tbody = document.getElementById('cash-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    let filtered = appState.assets.filter(a => a.category === 'cash' && a.name.toLowerCase().includes(filter.toLowerCase()));

    // Sort
    const sortCol = appState.cashSortColumn || 'name';
    filtered.sort((a, b) => {
        let valA = a[sortCol] || 0;
        let valB = b[sortCol] || 0;
        if (typeof valA === 'string') return appState.cashSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return appState.cashSortOrder === 'asc' ? valA - valB : valB - valA;
    });

    filtered.forEach(asset => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${asset.name}</strong></td>
            <td><span class="portfolio-tag">${asset.portfolio || 'Cash'}</span></td>
            <td><strong>${formatCurrency(asset.value)}</strong></td>
            <td>${asset.lastUpdated || '-'}</td>
            <td>
                <button class="btn-action btn-edit-row" onclick="openManualEntry('cash', ${asset.id})">✏️</button>
                <button class="btn-action btn-delete" onclick="deleteAsset(${asset.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function calculateXIRR(asset) {
    if (!asset.purchaseDate || !asset.monthlySIP || asset.monthlySIP <= 0 || asset.value <= 0) {
        // Fallback to CAGR if SIP not provided
        return calculateCAGR(asset.invested, asset.value, asset.purchaseDate);
    }

    const start = new Date(asset.purchaseDate);
    const end = new Date();
    const last = asset.lastTransDate ? new Date(asset.lastTransDate) : end;

    // Create flows
    let flows = [];
    let d = new Date(start);
    let totalInvestedCalculated = 0;

    while (d <= last) {
        flows.push({ date: new Date(d), amount: -asset.monthlySIP });
        totalInvestedCalculated += asset.monthlySIP;
        d.setMonth(d.getMonth() + 1);
    }

    // Add final value
    flows.push({ date: end, amount: asset.value });

    // If investment period is too short (< 1 year), use absolute return
    const totalYears = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    if (totalYears < 1) {
        // Use Absolute ROI instead of annualizing for short periods
        const investedAmount = asset.invested || totalInvestedCalculated; // Prefer actual invested field
        if (investedAmount > 0) {
            return ((asset.value / investedAmount) - 1) * 100;
        }
        return 0;
    }

    // Simple XIRR approximation (Bisection method)
    let low = -0.99, high = 50.0; // -99% to 5000% (High range)
    let guess = 0;
    let npv = 0;

    for (let i = 0; i < 60; i++) {
        guess = (low + high) / 2;
        npv = 0;

        flows.forEach(f => {
            const years = (f.date - start) / (1000 * 60 * 60 * 24 * 365.25);
            npv += f.amount / Math.pow(1 + guess, years);
        });

        if (Math.abs(npv) < 0.0001) break;
        if (npv > 0) low = guess;
        else high = guess;
    }

    const xirr = guess * 100;
    // Cap at extremely high/low but allow up to 5000%
    return Math.min(Math.max(xirr, -99.9), 5000);
}

// ------------------------------------------------------------------
// Analytics & Charting Logic
// ------------------------------------------------------------------

// Static Sector Map for Top Indian Stocks & Funds
const SECTOR_MAP = {
    'HDFCBANK': 'Financials', 'ICICIBANK': 'Financials', 'SBIN': 'Financials', 'KOTAKBANK': 'Financials', 'AXISBANK': 'Financials', 'BAJFINANCE': 'Financials',
    'RELIANCE': 'Energy', 'ONGC': 'Energy', 'NTPC': 'Energy', 'POWERGRID': 'Energy', 'TATASTEEL': 'Materials', 'JSWSTEEL': 'Materials',
    'TCS': 'Technology', 'INFY': 'Technology', 'HCLTECH': 'Technology', 'WIPRO': 'Technology', 'TECHM': 'Technology',
    'ITC': 'Consumer Goods', 'HUL': 'Consumer Goods', 'NESTLEIND': 'Consumer Goods', 'TITAN': 'Consumer Goods', 'ASIANPAINT': 'Consumer Goods',
    'LT': 'Construction', 'ULTRACEMCO': 'Materials',
    'SUNPHARMA': 'Healthcare', 'CIPLA': 'Healthcare', 'DRREDDY': 'Healthcare', 'APOLLOHOSP': 'Healthcare',
    'MARUTI': 'Automotive', 'M&M': 'Automotive', 'TATAMOTORS': 'Automotive', 'BAJAJ-AUTO': 'Automotive',
    'ADANIENT': 'Diversified', 'ADANIPORTS': 'Infrastructure',
    'BHARTIARTL': 'Telecom',
    'NIFTYBEES': 'Index / ETF', 'BANKBEES': 'Index / ETF', 'GOLDBEES': 'Precious Metals', 'SILVERBEES': 'Precious Metals',
    'JIOFIN': 'Financials', 'IRFC': 'Financials', 'IREDA': 'Financials', 'PFC': 'Financials', 'REC': 'Financials',
    'HAL': 'Defence', 'BEL': 'Defence', 'MAZDOCK': 'Defence', 'COCHINSHIP': 'Defence',
    'RVNL': 'Railways', 'IRCTC': 'Railways',
    'ZOMATO': 'Consumer Tech', 'NAZARA': 'Consumer Tech', 'PAYTM': 'Financials', 'PBFINTECH': 'Financials',
    'CDSL': 'Financials', 'BSE': 'Financials', 'IEX': 'Energy',
    'UTI Nifty 50': 'Index Fund'
};

const LARGE_CAP_LIST = [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ITC', 'SBIN', 'BHARTIARTL', 'ICICIBANK', 'KOTAKBANK', 'LT', 'AXISBANK', 'HUL',
    'ADANIENT', 'ADANIPORTS', 'ASIANPAINT', 'MARUTI', 'TITAN', 'ULTRACEMCO', 'SUNPHARMA', 'BAJFINANCE', 'CIPLA',
    'JSWSTEEL', 'TATASTEEL', 'M&M', 'NTPC', 'POWERGRID', 'ONGC', 'COALINDIA', 'WIPRO', 'HCLTECH', 'NESTLEIND',
    'HAL', 'BEL', 'TATAMOTORS', 'BAJAJ-AUTO', 'JIOFIN', 'GRASIM', 'BPCL', 'GAIL', 'HINDALCO', 'ADANIGREEN', 'LGEINDIA', 'TMCV',
    'ADANIPOWER', 'ICICIGI', 'ICICIPRULI', 'IRCTC', 'IDEA'
];

const MID_CAP_LIST = [
    'MAZDOCK', 'RVNL', 'IRFC', 'IREDA', 'PFC', 'REC', 'MFSL', 'BLUESTARCO', 'BIOCON', 'COROMANDEL', 'ASTRAL',
    'TORNTPOWER', 'BHARATFORG', 'PERSISTENT', 'INDUSINDBK', 'FEDERALBNK', 'AUROPHARMA', 'HINDPETRO', 'SRF',
    'HDFCAMC', 'CUMMINSIND', 'MPHASIS', 'KEI', 'AUBANK', 'GMRAIRPORT', 'SUZLON', 'BDL', 'POLYCAB',
    'LTF', 'WAAREEENER', 'ABCAPITAL', 'PHOENIXLTD', 'UPL', 'ATGL', 'TATACOMM', 'HEROMOTOCO', 'ASHOKLEY',
    'HUDCO', 'TATAELXSI', 'NYKAA', 'TATATECH', 'KALYANKJIL', 'NMDC', 'KPITTECH', 'BSE', 'PRESTIGE', 'OIL',
    'M&MFIN', 'COFORGE', 'NATIONALUM', 'ALKEM', 'MUTHOOTFIN', 'ZOMATO', 'PAYTM', 'PBFINTECH', 'PREMIERENE',
    'WELCORP', 'IDFCFIRSTB', 'TIMKEN', 'EMCURE', 'VMM', 'PRUDENT', 'KTKBANK', 'IEX', 'CDSL', 'CAMS', 'MCX', 'BSOFT', 'NAZARA',
    'GSPL', 'MANAPPURAM', 'TTKPRESTIG', 'HAPPYFORGE', 'SUPREMEIND', 'ECLERX', 'NSDL',
    'NATCOPHARM', 'BANSALWIRE', 'JLHL', 'LENSKART', 'BANSAL', 'AREM',
    'ITBEES', 'SILVERBEES', 'GOLDBEES', 'MMFL', // Manappuram Finance or similar
    'PGINVIT', 'TATACHEM', 'CLEAN', 'DEVYANI'
];

// Mapping for full names to symbols (for matching with CAP lists)
const STOCK_NAME_MAPPING = {
    'INDIAN RAILWAY FIN CORP': 'IRFC',
    'INDIAN RENEW': 'IREDA',
    'JUPITER LIFE': 'JLHL',
    'NATIONAL SECURITIES DEP': 'NSDL',
    'ICICIAMC': 'ICICIGI', // Assumption for ICICI Lombard or similar
    'BANKBEES': 'HDFCBANK', // Proxy for Cap classification (Large)
    'NIFTYBEES': 'RELIANCE', // Proxy for Cap classification (Large)
    'HDFCNIFETF': 'HDFCBANK', // HDFC Nifty ETF
    'SETFNIF50': 'SBIN', // SBI Nifty ETF
    'PHARMABEES': 'SUNPHARMA', // Proxy for Mid/Large (Pharma usually Large)
    'CONSUMBEES': 'ITC', // Proxy for Large (Consumer usually Large)
    'SILVERBEES': 'SILVERBEES', // Ensure it hits the Mid Cap list
    'ITBEES': 'TCS', // Proxy for Large Cap
    'BANSAL WIRE': 'BANSAL',
    'ARE&M': 'AREM',
    'AMARA RAJA': 'AREM',
    'LENSKART': 'LENSKART',
    'PGINVIT-IV': 'PGINVIT',
    'POWERGRID INFRA': 'PGINVIT',
    'TATA STEEL LIMITED': 'TATASTEEL',
    'DEVYANI INTERNATIONAL': 'DEVYANI',
    'VODAFONE IDEA': 'IDEA',
    'CLEAN SCIENCE': 'CLEAN',
    'TATA CHEMICALS': 'TATACHEM'
};

let chartInstances = {};

function getSector(asset) {
    if (asset.category === 'gold') return 'Precious Metals';
    if (asset.category === 'cash') return 'Cash / Liquid';

    // Check Map first
    const symbol = asset.name.split('.')[0].toUpperCase().replace(/[^\w]/g, ''); // Normalize

    // Exact Match
    if (SECTOR_MAP[symbol]) return SECTOR_MAP[symbol];

    // Fuzzy / Keyword Match
    const nameUpper = asset.name.toUpperCase();
    if (nameUpper.includes('BANK') || nameUpper.includes('FINANCE')) return 'Financials';
    if (nameUpper.includes('PHARMA') || nameUpper.includes('LAB')) return 'Healthcare';
    if (nameUpper.includes('AUTO') || nameUpper.includes('MOTORS')) return 'Automotive';
    if (nameUpper.includes('TECH') || nameUpper.includes('SOFT')) return 'Technology';
    if (nameUpper.includes('POWER') || nameUpper.includes('ENERGY')) return 'Energy';
    if (nameUpper.includes('BEES') || nameUpper.includes('ETF')) return 'Index / ETF';

    if (asset.category === 'mf') return 'Mutual Funds';

    return 'Others';
}

function renderAnalytics() {
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        alert("CRITICAL ERROR: Chart.js library is missing!\nThe charts cannot load because the 'chart.js' file is not found or blocked by the browser.\n\nPlease check if 'chart.js' exists in the folder.");
        return;
    }

    // Check if canvases exist (we might be on a different tab, though they should be in DOM)
    // We remove the early return to allow independent rendering of available components

    // 1. Aggregate Data
    const allocation = {}; // Stocks, MF, Gold, Cash
    const sectors = {}; // Financials, Tech, etc.
    const cap = { 'Large Cap': 0, 'Mid Cap': 0, 'Small Cap': 0, 'Others': 0 };

    let totalValue = 0;

    // Use appState instead of 'data' to ensure we have the latest global state
    const assets = (typeof appState !== 'undefined' && appState.assets) ? appState.assets : [];

    if (assets.length === 0) {
        console.warn("No assets to verify for analytics.");
    }

    assets.forEach(asset => {
        if (asset.is_planned) return; // Skip simulated assets

        const val = asset.value || 0;
        totalValue += val;

        // Allocation
        let type = 'Stocks';
        if (asset.category === 'mf') type = 'Mutual Funds';
        if (asset.category === 'gold') type = 'Gold & Silver';
        if (asset.category === 'cash') type = 'Cash';
        if (asset.category === 'property') type = 'Real Estate';
        allocation[type] = (allocation[type] || 0) + val;

        // Sector
        const sector = getSector(asset);
        sectors[sector] = (sectors[sector] || 0) + val;

        // Cap / Health (Heuristic based on value/type)
        if (asset.category === 'mf') {
            const nameLower = asset.name.toLowerCase();
            if (nameLower.includes('small')) cap['Small Cap'] += val;
            else if (nameLower.includes('mid')) cap['Mid Cap'] += val;
            else if (nameLower.includes('large') || nameLower.includes('index') || nameLower.includes('blue') || nameLower.includes('nifty')) cap['Large Cap'] += val;
            else cap['Others'] += val; // Flexi or Focused
        } else if (asset.category === 'stocks') {
            const nameUpper = asset.name.toUpperCase();

            // 1. Check mapping for full names (e.g. "INDIAN RAILWAY..." -> "IRFC")
            let symbol = asset.name.split(' ')[0].toUpperCase().replace(/[^\w]/g, '');
            for (const key in STOCK_NAME_MAPPING) {
                if (nameUpper.startsWith(key)) { // "INDIAN RAILWAY..." starts with "INDIAN RAILWAY"
                    symbol = STOCK_NAME_MAPPING[key];
                    break;
                }
            }

            // 2. Classify based on Symbol
            if (LARGE_CAP_LIST.some(lc => symbol === lc || nameUpper.startsWith(lc))) {
                cap['Large Cap'] += val;
            } else if (MID_CAP_LIST.some(mc => symbol === mc || nameUpper.startsWith(mc))) {
                cap['Mid Cap'] += val;
            } else {
                cap['Small Cap'] += val; // Default stocks to Small if not found in Large/Mid lists
            }
        } else {
            // Gold / Cash -> Others
            cap['Others'] += val;
        }
    });

    // Color Palette (Glassy / Neon)
    const colors = [
        'rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)', 'rgba(255, 206, 86, 0.7)',
        'rgba(75, 192, 192, 0.7)', 'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)',
        'rgba(199, 199, 199, 0.7)', 'rgba(83, 102, 255, 0.7)', 'rgba(255, 99, 255, 0.7)'
    ];

    // Ensure Chart.js components are registered (v4 requirement for some builds)
    if (Chart.register && Chart.registerables) {
        Chart.register(...Chart.registerables);
    }

    // Helper to Create/Update Chart
    const createChart = (canvasId, type, labels, dataValues, label, onClickHandler) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Check for usage of global 'data' vs 'appState'
        // We use appState.assets above, so data is good.

        // Debug Data
        if (dataValues.every(v => v === 0)) {
            console.warn(`[Analytics] ${label} has all zero values.`);
            // Render anyway to show empty chart
        }

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        try {
            const config = {
                type: type,
                data: {
                    labels: labels,
                    datasets: [{
                        label: label,
                        data: dataValues,
                        backgroundColor: colors,
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                color: '#e0e6ed',
                                font: { family: 'Outfit' }
                            }
                        },
                        title: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    let label = context.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += formatCurrency(context.parsed.y || context.parsed);
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    onClick: (e, elements, chart) => {
                        if (elements && elements.length > 0 && onClickHandler) {
                            const index = elements[0].index;
                            const label = chart.data.labels[index];
                            const value = chart.data.datasets[0].data[index];
                            onClickHandler(label, value);
                        }
                    },
                    onHover: (event, chartElement) => {
                        event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
                    }
                }
            };

            // Adjust options for different chart types if needed
            if (type === 'doughnut' || type === 'pie') {
                config.options.plugins.tooltip.callbacks.label = function (context) {
                    let label = context.label || '';
                    if (label) label += ': ';
                    label += formatCurrency(context.raw);
                    return label;
                };
            }

            chartInstances[canvasId] = new Chart(ctx, config);
        } catch (err) {
            console.error(`Status: Failed to render ${canvasId}:`, err);
            alert(`Chart Error (${canvasId}): ${err.message}`);
        }
    };

    // --- Interactive Handlers ---

    // 1. Allocation Click
    const handleAllocationClick = (label, value) => {
        const assets = appState.assets.filter(a => {
            let type = 'Stocks';
            if (a.category === 'mf') type = 'Mutual Funds';
            if (a.category === 'gold') type = 'Gold & Silver';
            if (a.category === 'cash') type = 'Cash';
            if (a.category === 'property') type = 'Real Estate';
            return type === label;
        });
        showDrillDown(`${label} Breakdown`, assets, value);
    };

    // 2. Sector Click
    const handleSectorClick = (label, value) => {
        // Reuse specific sector click logic defined below or inline it
        let assets = [];
        if (label === 'Others') {
            const topNames = topSectors.slice(0, 8).map(s => s[0]);
            assets = appState.assets.filter(a => !topNames.includes(getSector(a)));
        } else {
            assets = appState.assets.filter(a => getSector(a) === label);
        }
        showDrillDown(`${label} Sector`, assets, value);
    };

    // 3. Cap Click
    const handleCapClick = (label, value) => {
        const assets = appState.assets.filter(a => {
            if (a.category === 'mf') {
                const nameLower = a.name.toLowerCase();
                if (label === 'Small Cap' && nameLower.includes('small')) return true;
                if (label === 'Mid Cap' && nameLower.includes('mid')) return true;
                if (label === 'Large Cap' && (nameLower.includes('large') || nameLower.includes('index') || nameLower.includes('blue') || nameLower.includes('nifty'))) return true;
                if (label === 'Others' && !nameLower.includes('small') && !nameLower.includes('mid') && !nameLower.includes('large') && !nameLower.includes('index')) return true;
            } else if (a.category === 'stocks') {
                const nameUpper = a.name.toUpperCase();

                // 1. Check mapping for full names (e.g. "INDIAN RAILWAY..." -> "IRFC")
                let symbol = a.name.split(' ')[0].toUpperCase().replace(/[^\w]/g, '');
                for (const key in STOCK_NAME_MAPPING) {
                    if (nameUpper.startsWith(key)) {
                        symbol = STOCK_NAME_MAPPING[key];
                        break;
                    }
                }

                const isLarge = LARGE_CAP_LIST.some(lc => symbol === lc || nameUpper.startsWith(lc));
                const isMid = MID_CAP_LIST.some(mc => symbol === mc || nameUpper.startsWith(mc));

                if (label === 'Large Cap' && isLarge) return true;
                if (label === 'Mid Cap' && isMid) return true;
                if (label === 'Small Cap' && !isLarge && !isMid) return true;
            } else {
                if (label === 'Others') return true; // Cash/Gold/Property
            }
            return false;
        });
        showDrillDown(`${label} Holdings`, assets, value);
    };

    // Render Trend Chart (History)
    if (appState.history && appState.history.length > 0) {
        createChart('trendChart', 'line', appState.history.map(h => h.date), appState.history.map(h => h.value), 'Net Worth History', null);
    }

    // Render Allocation Chart
    createChart('allocationChart', 'doughnut', Object.keys(allocation), Object.values(allocation), 'Asset Allocation', handleAllocationClick);

    // Render Sector Chart
    // Sort sectors by value for better visualization
    const sortedSectors = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
    // Take top 8 sectors, lump rest into 'Others'
    let topSectors = sortedSectors;
    if (sortedSectors.length > 8) {
        const top = sortedSectors.slice(0, 8);
        const otherVal = sortedSectors.slice(8).reduce((sum, item) => sum + item[1], 0);
        top.push(['Others', otherVal]);
        topSectors = top;
    }

    createChart('sectorChart', 'pie', topSectors.map(s => s[0]), topSectors.map(s => s[1]), 'Sector Exposure', handleSectorClick);

    // Render Cap Chart
    createChart('capChart', 'bar', Object.keys(cap), Object.values(cap), 'Market Cap Distribution', handleCapClick);

    // Call Rebalance Report
    renderRebalanceReport();
}

// --- Portfolio Optimization ---
function renderOptimization() {
    const tbody = document.getElementById('optimization-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Thresholds: Value < 5000 OR Qty < 5 (except for Gold/Cash)
    const candidates = appState.assets.filter(a => {
        if (a.category === 'gold' || a.category === 'cash') return false;
        if (a.is_planned) return false;
        return (a.value < 5000) || (a.quantity < 5);
    });

    if (candidates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #888;">No optimization recommendations. Your portfolio looks clean! ✨</td></tr>';
        return;
    }

    candidates.sort((a, b) => a.value - b.value);

    candidates.forEach(asset => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${asset.name}</strong></td>
            <td><span class="portfolio-tag">${asset.portfolio || 'N/A'}</span></td>
            <td>${asset.quantity}</td>
            <td>${formatCurrency(asset.value)}</td>
            <td>
                <button class="btn-action btn-delete" onclick="sellAsset(${asset.id})">Mark as Sold</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function sellAsset(id) {
    const asset = appState.assets.find(a => a.id === id);
    if (!asset) return;

    if (confirm(`Are you sure you want to mark ${asset.name} as SOLD?\nThis will remove it from your tracker.`)) {
        appState.assets = appState.assets.filter(a => a.id !== id);
        saveData();
        render();
        showToast(`${asset.name} marked as sold and removed.`, 'success');
    }
}

// --- Drill Down Modal Logic ---
function showDrillDown(title, assets, totalCategoryValue) {
    const modal = document.getElementById('drilldown-modal');
    document.getElementById('drilldown-title').innerText = title;
    const tbody = document.getElementById('drilldown-body');
    tbody.innerHTML = '';

    // Sort by value desc
    assets.sort((a, b) => (b.value || 0) - (a.value || 0));

    assets.forEach(asset => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #333';

        const val = asset.value || 0;
        const pct = totalCategoryValue ? ((val / totalCategoryValue) * 100).toFixed(1) : 0;

        tr.innerHTML = `
            <td style="padding: 8px;">
                <div style="font-weight: 600;">${asset.name}</div>
                <div style="font-size: 0.8rem; color: #aaa;">${(asset.category === 'mf' && (asset.portfolio === 'Zerodha' || !asset.portfolio)) ? 'MF' : (asset.portfolio || 'N/A')}</div>
            </td>
            <td style="padding: 8px; text-align: right;">${formatCurrency(val)}</td>
            <td style="padding: 8px; text-align: right; color: #aaa;">${pct}%</td>
        `;
        tbody.appendChild(tr);
    });

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeDrillDown() {
    const modal = document.getElementById('drilldown-modal');
    modal.classList.add('hidden');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

// --- Rebalancing & Targets ---
function openTargetsModal() {
    const modal = document.getElementById('targets-modal');
    document.getElementById('target-stocks').value = appState.targets.stocks;
    document.getElementById('target-mf').value = appState.targets.mf;
    document.getElementById('target-gold').value = appState.targets.gold;
    document.getElementById('target-property').value = appState.targets.property || 0;
    document.getElementById('target-cash').value = appState.targets.cash;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeTargetsModal() {
    const modal = document.getElementById('targets-modal');
    modal.classList.add('hidden');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

function saveTargets() {
    const stocks = parseFloat(document.getElementById('target-stocks').value) || 0;
    const mf = parseFloat(document.getElementById('target-mf').value) || 0;
    const gold = parseFloat(document.getElementById('target-gold').value) || 0;
    const property = parseFloat(document.getElementById('target-property').value) || 0;
    const cash = parseFloat(document.getElementById('target-cash').value) || 0;

    const total = stocks + mf + gold + property + cash;
    const warning = document.getElementById('target-total-warning');
    const totalSpan = document.getElementById('target-total-val');

    if (Math.abs(total - 100) > 0.01) {
        warning.style.display = 'block';
        totalSpan.innerText = total;
        return;
    }

    warning.style.display = 'none';
    appState.targets = { stocks, mf, gold, property, cash };
    saveData();
    closeTargetsModal();
    render();
    if (document.getElementById('analytics-tab').classList.contains('active')) {
        renderAnalytics();
    }
    showToast('Target Allocations Saved!', 'success');
}

function calculateHealthScore() {
    const totalVal = calculateTotal();
    if (totalVal <= 0) return { score: 0, status: 'N/A', color: '#888', factors: [] };

    let score = 100;
    const factors = [];
    const assets = appState.assets.filter(a => !a.is_planned);

    // 1. Concentration Check (Max 10% per stock)
    const largeHoldings = assets.filter(a => a.category === 'stocks' && (a.value / totalVal) > 0.10);
    if (largeHoldings.length > 0) {
        score -= (largeHoldings.length * 5);
        factors.push(`Risk: ${largeHoldings.length} stock(s) > 10% of portfolio`);
    }

    // 2. Sector Check
    const sectors = {};
    assets.forEach(a => {
        const s = getSector(a);
        sectors[s] = (sectors[s] || 0) + a.value;
    });

    Object.keys(sectors).forEach(s => {
        if (s !== 'Cash / Liquid' && (sectors[s] / totalVal) > 0.30) {
            score -= 15;
            factors.push(`Risk: High concentration in ${s} (>30%)`);
        }
    });

    // 3. Liquidity Buffer (5-15% is ideal)
    const cashVal = assets.filter(a => a.category === 'cash').reduce((sum, a) => sum + a.value, 0);
    const cashPct = (cashVal / totalVal) * 100;
    if (cashPct < 5) {
        score -= 10;
        factors.push('Liquidity: Low cash buffer (<5%)');
    } else if (cashPct > 25) {
        score -= 5;
        factors.push('Liquidity: Excessive idle cash (>25%)');
    }

    // Status label
    let status = 'Excellent';
    let color = '#4cd964';
    if (score < 40) { status = 'Critical'; color = '#ff3b30'; }
    else if (score < 60) { status = 'Average'; color = '#ff9500'; }
    else if (score < 85) { status = 'Good'; color = '#ffcc00'; }

    return { score: Math.max(0, score), status, color, factors };
}

function renderRebalanceReport() {
    const tbody = document.getElementById('rebalance-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const totalVal = calculateTotal();
    const categories = [
        { id: 'stocks', label: 'Stocks / Equity', target: appState.targets.stocks },
        { id: 'mf', label: 'Mutual Funds', target: appState.targets.mf },
        { id: 'gold', label: 'Gold & Silver', target: appState.targets.gold },
        { id: 'property', label: 'Real Estate / Property', target: appState.targets.property || 0 },
        { id: 'cash', label: 'Cash / Bank', target: appState.targets.cash }
    ];

    categories.forEach(cat => {
        const catValue = appState.assets.filter(a => {
            if (cat.id === 'stocks') return a.category === 'stocks' || a.category === 'holdings';
            return a.category.toLowerCase() === cat.id;
        }).reduce((sum, a) => sum + (a.value || 0), 0);

        const currentPct = totalVal > 0 ? (catValue / totalVal * 100) : 0;
        const diffPct = currentPct - cat.target;
        const diffRs = (cat.target / 100 * totalVal) - catValue;

        const tr = document.createElement('tr');
        const actionText = diffRs > 100 ? `🟢 Buy ${formatCurrency(diffRs)}` : (diffRs < -100 ? `🔴 Sell ${formatCurrency(Math.abs(diffRs))}` : '✅ Balanced');
        const actionColor = diffRs > 100 ? '#4cd964' : (diffRs < -100 ? '#ff3b30' : '#888');

        tr.innerHTML = `
            <td>${cat.label}</td>
            <td>${formatCurrency(catValue)}</td>
            <td>${currentPct.toFixed(1)}%</td>
            <td>${cat.target}%</td>
            <td class="${Math.abs(diffPct) > 5 ? 'negative' : 'positive'}">${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%</td>
            <td style="font-weight: 600; color: ${actionColor}">${actionText}</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Initialization ---

function openTradeModal(assetId, mode) {
    const asset = appState.assets.find(a => a.id === assetId);
    if (!asset) return;

    document.getElementById('trade-asset-id').value = assetId;
    switchTradeTab(mode);
    document.getElementById('trade-modal').classList.remove('hidden');
}

function closeTradeModal() {
    document.getElementById('trade-modal').classList.add('hidden');
    document.getElementById('trade-form').reset();
}

function switchTradeTab(mode) {
    const isBuy = mode === 'buy';
    document.getElementById('trade-mode').value = mode;
    document.getElementById('trade-title').innerText = isBuy ? 'Buy Asset' : 'Sell Asset';
    document.getElementById('trade-qty-label').innerText = isBuy ? 'Quantity to Buy' : 'Quantity to Sell';
    document.getElementById('trade-price-label').innerText = isBuy ? 'Buy Price per Unit (₹)' : 'Sell Price per Unit (₹)';
    document.getElementById('trade-execute-btn').innerText = isBuy ? 'Execute Buy' : 'Execute Sell';

    document.getElementById('tab-buy').classList.toggle('active', isBuy);
    document.getElementById('tab-sell').classList.toggle('active', !isBuy);
}

function executeTrade(e) {
    if (e) e.preventDefault();

    const assetId = Number(document.getElementById('trade-asset-id').value);
    const mode = document.getElementById('trade-mode').value;
    const qty = parseFloat(document.getElementById('trade-qty').value);
    const price = parseFloat(document.getElementById('trade-price').value);

    if (isNaN(qty) || qty <= 0) {
        showToast("Enter a valid quantity", "error");
        return;
    }

    const assetIdx = appState.assets.findIndex(a => a.id === assetId);
    if (assetIdx === -1) return;

    const asset = appState.assets[assetIdx];

    if (mode === 'buy') {
        const oldQty = asset.quantity || 0;
        const oldInvested = asset.invested || 0;

        asset.quantity = oldQty + qty;
        asset.invested = oldInvested + (qty * price);
    } else {
        if (qty > (asset.quantity + 0.0001)) { // Allow minor floating point diff
            showToast("Cannot sell more than owned quantity!", "error");
            return;
        }

        if (Math.abs(qty - asset.quantity) < 0.0001) {
            if (confirm(`Selling all units of ${asset.name}. Remove from portfolio?`)) {
                appState.assets.splice(assetIdx, 1);
            } else {
                asset.quantity = 0;
                asset.invested = 0;
            }
        } else {
            // Proportional reduction of invested cost
            const costPerUnit = asset.invested / asset.quantity;
            asset.invested -= (costPerUnit * qty);
            asset.quantity -= qty;
        }
    }

    // Update value based on latest LTP
    if (appState.assets[assetIdx]) {
        const updatedAsset = appState.assets[assetIdx];
        const ltp = updatedAsset.ltp || (updatedAsset.quantity > 0 ? updatedAsset.value / updatedAsset.quantity : 0);
        updatedAsset.value = updatedAsset.quantity * ltp;
    }

    saveData();
    closeTradeModal();
    render();
    showToast(`Trade executed: ${mode.toUpperCase()} ${qty} ${asset.name}`, "success");
}


function processAutoSIPs(navData) {
    if (!navData) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let processedAny = false;

    appState.assets.forEach(asset => {
        if (asset.category === 'mf' && asset.sipDate && asset.monthlySIP > 0) {
            // Normalize lastTransDate
            let lastDateStr = asset.lastTransDate || asset.purchaseDate;
            if (!lastDateStr) return;

            let lastDate = parseRobustDate(lastDateStr);
            if (!lastDate || isNaN(lastDate.getTime())) return;

            // Start checking from the lastDate
            let checkDate = new Date(lastDate);
            
            // Loop through each month to see if we missed any SIPs
            while (true) {
                // Advance to the next month's SIP date
                checkDate.setMonth(checkDate.getMonth() + 1);
                checkDate.setDate(asset.sipDate);
                
                // If the next calculated SIP date is in the future, stop
                if (checkDate > today) break;

                // Find NAV for this fund
                const navKey = Object.keys(navData).find(key =>
                    key.includes(asset.name) ||
                    (asset.folio && key.includes(asset.folio))
                );

                if (navKey && navData[navKey]) {
                    const nav = navData[navKey].nav;
                    if (nav > 0) {
                        const unitsAdded = asset.monthlySIP / nav;
                        
                        // Prevention: Don't add if already added for this month (robustness check)
                        const processedMonthKey = `${checkDate.toLocaleString('default', { month: 'short' })}-${checkDate.getFullYear()}`;
                        if (asset.lastProcessedSipMonth === processedMonthKey) {
                            console.log(`Skipping SIP for ${asset.name} - ${processedMonthKey} already processed.`);
                            continue;
                        }

                        asset.quantity = (asset.quantity || 0) + unitsAdded;
                        asset.invested = (asset.invested || 0) + asset.monthlySIP;
                        asset.value = asset.quantity * nav;
                        asset.ltp = nav;
                        
                        asset.lastProcessedSipMonth = processedMonthKey;
                        
                        // Robust Local Format (YYYY-MM-DD)
                        const y = checkDate.getFullYear();
                        const m = String(checkDate.getMonth() + 1).padStart(2, '0');
                        const d = String(checkDate.getDate()).padStart(2, '0');
                        asset.lastTransDate = `${y}-${m}-${d}`;

                        processedAny = true;
                        showToast(`SIP Catch-up: ₹${asset.monthlySIP} added to ${asset.name} for ${processedMonthKey}`, "success");
                        console.log(`Auto-SIP Executed for ${asset.name} (${processedMonthKey}): +${unitsAdded.toFixed(4)} @ ₹${nav} on ${asset.lastTransDate}`);
                    }
                } else {
                    // If we can't find NAV, stop processing for this fund to avoid incorrect units
                    console.warn(`Could not find NAV for ${asset.name}, stopping SIP catch-up.`);
                    break;
                }
            }
        }
    });

    if (processedAny) {
        saveData();
        render();
    }
}

/**
 * Robust date parser for various formats (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD-MMM-YYYY)
 */
function parseRobustDate(dateStr) {
    if (!dateStr) return null;
    
    // Handle DD-MMM-YYYY (e.g. 28-Jan-2026)
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    
    const cleanStr = dateStr.toLowerCase().replace(/[\/\.]/g, '-');
    const parts = cleanStr.split('-');
    
    if (parts.length < 3) return new Date(dateStr);

    let d, m, y;
    
    // Check if parts[1] is a month name
    const monthIdx = monthNames.indexOf(parts[1]);
    
    if (monthIdx !== -1) {
        // Format: DD-MMM-YYYY
        d = parseInt(parts[0]);
        m = monthIdx;
        y = parseInt(parts[2]);
    } else {
        // Format: YYYY-MM-DD or DD-MM-YYYY
        if (parts[0].length === 4) {
             y = parseInt(parts[0]);
             m = parseInt(parts[1]) - 1;
             d = parseInt(parts[2]);
        } else {
             d = parseInt(parts[0]);
             m = parseInt(parts[1]) - 1;
             y = parseInt(parts[2]);
        }
    }

    // Normalize 2-digit years
    if (y < 100) {
        y += (y > 80) ? 1900 : 2000;
    }
    
    return new Date(y, m, d);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('App Initializing...');
    loadData();
    populatePortfolioDropdowns();
    setupEventListeners();
    startLiveSync();
    render();
});

function renderPropertyTable(filter = "") {
    const tbody = document.getElementById('property-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    let filtered = appState.assets.filter(a =>
        a.category === 'property' &&
        a.name.toLowerCase().includes(filter.toLowerCase())
    );

    // Sort
    const sortCol = appState.propertySortColumn || 'value';
    const sortOrder = appState.propertySortOrder || 'desc';

    filtered.sort((a, b) => {
        let valA, valB;
        switch (sortCol) {
            case 'name': valA = a.name; valB = b.name; break;
            case 'purchaseDate': valA = a.purchaseDate; valB = b.purchaseDate; break;
            case 'invested': valA = a.invested; valB = b.invested; break;
            case 'value': valA = a.value; valB = b.value; break;
            case 'pnl': valA = (a.value - a.invested); valB = (b.value - b.invested); break;
            case 'cagr':
                valA = calculateCAGR(a.invested, a.value, a.purchaseDate);
                valB = calculateCAGR(b.invested, b.value, b.purchaseDate);
                break;
            default: valA = a.value; valB = b.value;
        }
        if (typeof valA === 'string') return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    filtered.forEach(asset => {
        const pnl = asset.value - asset.invested;
        const cagr = calculateCAGR(asset.invested, asset.value, asset.purchaseDate);
        const purchaseDate = asset.purchaseDate || '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${asset.name}</strong></td>
            <td>${purchaseDate}</td>
            <td>${formatCurrency(asset.invested)}</td>
            <td>${formatCurrency(asset.value)}</td>
            <td class="${pnl >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(pnl)}</td>
            <td class="${cagr >= 0 ? 'text-success' : 'text-danger'}">${cagr.toFixed(2)}%</td>
            <td>
                <button class="btn-action btn-edit-row" onclick="openManualEntry('property', ${asset.id})">✏️</button>
                <button class="btn-action btn-delete" onclick="deleteAsset(${asset.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Passive Income Modal Logic ---
function openPassiveIncomeModal() {
    const modal = document.getElementById('passive-income-modal');
    if (modal) {
        modal.classList.remove('hidden');
        renderPassiveIncomeDetails();
    }
}

function closePassiveIncomeModal() {
    const modal = document.getElementById('passive-income-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function renderPassiveIncomeDetails() {
    const tbody = document.getElementById('passive-income-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    // Filter dividend paying assets
    const assets = appState.assets.filter(a =>
        (a.category === 'stocks' || a.category === 'holdings') &&
        (parseFloat(a.divRate) || 0) > 0
    );

    // Sort by estimated annual income
    assets.sort((a, b) => {
        const incA = (a.quantity * a.divRate);
        const incB = (b.quantity * b.divRate);
        return incB - incA;
    });

    if (assets.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No dividend paying assets found</td></tr>";
        return;
    }

    assets.forEach(asset => {
        const qty = parseFloat(asset.quantity) || 0;
        const divRate = parseFloat(asset.divRate) || 0;
        const estAnnual = qty * divRate;

        // Calculate yield based on current value (or invested if value is 0/missing)
        const currentVal = parseFloat(asset.value) || (qty * (parseFloat(asset.ltp) || 0));
        const yieldPct = currentVal > 0 ? (estAnnual / currentVal * 100) : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${asset.name}</strong></td>
            <td>${qty}</td>
            <td>${formatCurrency(divRate)}</td>
            <td class="text-success">${formatCurrency(estAnnual)}</td>
            <td>${yieldPct.toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
    });
}
