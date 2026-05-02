/**
 * Holdings data bridge - exposes stock data to the app
 * Similar pattern to mf_data_bridge.js
 */

// Holdings data from CSV (auto-generated from holdings.csv)
window.holdingsBridge = [
    { "name": "AARTIPHARM", "quantity": 5, "avgCost": 609.55, "ltp": 776.8, "invested": 3047.75, "value": 3884 },
    { "name": "ADANIPOWER", "quantity": 60, "avgCost": 19.84, "ltp": 152.74, "invested": 1190.4, "value": 9164.4 },
    { "name": "ARE&M", "quantity": 4, "avgCost": 534.11, "ltp": 865.7, "invested": 2136.45, "value": 3462.8 },
    { "name": "BANKBEES", "quantity": 36, "avgCost": 416.23, "ltp": 619.79, "invested": 14984.14, "value": 22312.44 },
    { "name": "BORORENEW", "quantity": 7, "avgCost": 505.1, "ltp": 496.65, "invested": 3535.7, "value": 3476.55 },
    { "name": "CIPLA", "quantity": 3, "avgCost": 872.5, "ltp": 1330.8, "invested": 2617.5, "value": 3992.4 },
    { "name": "CLEAN", "quantity": 3, "avgCost": 1410.87, "ltp": 797.25, "invested": 4232.6, "value": 2391.75 },
    { "name": "CONSUMBEES", "quantity": 39, "avgCost": 129.79, "ltp": 131.16, "invested": 5061.81, "value": 5115.24 },
    { "name": "ECLERX", "quantity": 1, "avgCost": 2278.05, "ltp": 4185.9, "invested": 2278.05, "value": 4185.9 },
    { "name": "FEDERALBNK", "quantity": 23, "avgCost": 128.5, "ltp": 287, "invested": 2955.5, "value": 6601 },
    { "name": "GOLDBEES", "quantity": 125, "avgCost": 64.88, "ltp": 125.04, "invested": 8109.75, "value": 15630 },
    { "name": "GOODLUCK", "quantity": 5, "avgCost": 914, "ltp": 1152, "invested": 4570, "value": 5760 },
    { "name": "GSPL", "quantity": 15, "avgCost": 284.9, "ltp": 306.25, "invested": 4273.5, "value": 4593.75 },
    { "name": "HAL", "quantity": 2, "avgCost": 1215, "ltp": 4068.1, "invested": 2430, "value": 8136.2 },
    { "name": "IDFCFIRSTB", "quantity": 82, "avgCost": 67.47, "ltp": 85.11, "invested": 5532.87, "value": 6979.02 },
    { "name": "IEX", "quantity": 15, "avgCost": 121.57, "ltp": 120.95, "invested": 1823.5, "value": 1814.25 },
    { "name": "IITL", "quantity": 17, "avgCost": 235.93, "ltp": 138.46, "invested": 4010.81, "value": 2353.82 },
    { "name": "IRCTC", "quantity": 4, "avgCost": 662.18, "ltp": 620, "invested": 2648.7, "value": 2480 },
    { "name": "ISGEC", "quantity": 1, "avgCost": 1556.45, "ltp": 769.2, "invested": 1556.45, "value": 769.2 },
    { "name": "ITBEES", "quantity": 130, "avgCost": 38.3, "ltp": 39.35, "invested": 4979, "value": 5115.5 },
    { "name": "ITC", "quantity": 15, "avgCost": 337, "ltp": 326.05, "invested": 5055, "value": 4890.75 },
    { "name": "JIOFIN", "quantity": 18, "avgCost": 329.29, "ltp": 268.1, "invested": 5927.3, "value": 4825.8 },
    { "name": "KALYANKJIL", "quantity": 12, "avgCost": 62.96, "ltp": 380.25, "invested": 755.55, "value": 4563 },
    { "name": "KKCL", "quantity": 7, "avgCost": 757, "ltp": 480.85, "invested": 5299, "value": 3365.95 },
    { "name": "KTKBANK", "quantity": 25, "avgCost": 203.5, "ltp": 200.3, "invested": 5087.5, "value": 5007.5 },
    { "name": "MANAPPURAM", "quantity": 15, "avgCost": 109.1, "ltp": 300.9, "invested": 1636.5, "value": 4513.5 },
    { "name": "MMFL", "quantity": 10, "avgCost": 482.94, "ltp": 431.15, "invested": 4829.35, "value": 4311.5 },
    { "name": "NATCOPHARM", "quantity": 6, "avgCost": 793, "ltp": 823.55, "invested": 4758, "value": 4941.3 },
    { "name": "NAZARA", "quantity": 38, "avgCost": 262.65, "ltp": 259, "invested": 9980.7, "value": 9842 },
    { "name": "NIFTYBEES", "quantity": 77, "avgCost": 192.91, "ltp": 290.65, "invested": 14853.78, "value": 22380.05 },
    { "name": "NTPC", "quantity": 1, "avgCost": 413.6, "ltp": 365.1, "invested": 413.6, "value": 365.1 },
    { "name": "OPTIEMUS", "quantity": 9, "avgCost": 301.8, "ltp": 408.55, "invested": 2716.2, "value": 3676.95 },
    { "name": "PGINVIT-IV", "quantity": 31, "avgCost": 111.91, "ltp": 93.27, "invested": 3469.35, "value": 2891.37 },
    { "name": "PHARMABEES", "quantity": 250, "avgCost": 22.5, "ltp": 22.49, "invested": 5625, "value": 5622.5 },
    { "name": "PRUDENT", "quantity": 2, "avgCost": 2391, "ltp": 2573.5, "invested": 4782, "value": 5147 },
    { "name": "RESPONIND", "quantity": 1, "avgCost": 275.55, "ltp": 189.86, "invested": 275.55, "value": 189.86 },
    { "name": "SBIN", "quantity": 5, "avgCost": 445.6, "ltp": 1066.4, "invested": 2228, "value": 5332 },
    { "name": "SGBJUN31I-GB", "quantity": 9, "avgCost": 5876, "ltp": 15903.85, "invested": 52884, "value": 143134.65 },
    { "name": "SILVERBEES", "quantity": 50, "avgCost": 111.69, "ltp": 224.46, "invested": 5584.72, "value": 11223 },
    { "name": "SUPREMEIND", "quantity": 1, "avgCost": 3925, "ltp": 3678.6, "invested": 3925, "value": 3678.6 },
    { "name": "TATACHEM", "quantity": 4, "avgCost": 943.5, "ltp": 704.1, "invested": 3774, "value": 2816.4 },
    { "name": "TATASTEEL", "quantity": 26, "avgCost": 120.2, "ltp": 197.06, "invested": 3125.2, "value": 5123.56 },
    { "name": "TATATECH", "quantity": 11, "avgCost": 1007.76, "ltp": 617.65, "invested": 11085.4, "value": 6794.15 },
    { "name": "TCS", "quantity": 4, "avgCost": 3343.65, "ltp": 2941.6, "invested": 13374.6, "value": 11766.4 },
    { "name": "TIMKEN", "quantity": 2, "avgCost": 2839.2, "ltp": 3245, "invested": 5678.4, "value": 6490 },
    { "name": "TMCV", "quantity": 8, "avgCost": 98, "ltp": 458.25, "invested": 783.98, "value": 3666 },
    { "name": "TMPV", "quantity": 8, "avgCost": 216.6, "ltp": 369.9, "invested": 1732.82, "value": 2959.2 },
    { "name": "TTKPRESTIG", "quantity": 7, "avgCost": 693.2, "ltp": 568.75, "invested": 4852.4, "value": 3981.25 },
    { "name": "WELCORP", "quantity": 9, "avgCost": 545.45, "ltp": 824.75, "invested": 4909.05, "value": 7422.75 }
];

console.log(`Holdings bridge loaded: ${window.holdingsBridge.length} stocks`);
