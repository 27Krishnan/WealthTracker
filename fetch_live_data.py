import os
import time
import json
import warnings
import pandas as pd
import yfinance as yf
import requests
import re
from datetime import datetime

# Silence yfinance/pandas deprecation warnings
warnings.filterwarnings("ignore")
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 

# Paths
HOLDINGS_FILE = r"e:\MY Networth\holdings.csv"
MANUAL_SYMBOLS_FILE = r"e:\MY Networth\manual_symbols.txt"
OUTPUT_FILE = r"e:\MY Networth\live_prices.json"
JS_BRIDGE = r"e:\MY Networth\live_prices_bridge.js"

# Mapping for full names to tickers (Keep existing map)
TICKER_MAP = {
    "INDIAN RAILWAY FIN CORP LTD": "IRFC", "INDIAN RAILWAY FIN": "IRFC", "IRFC": "IRFC",
    "INDIAN RENEW. ENG.DEV. AGY LTD": "IREDA", "INDIAN RENEW": "IREDA", "IREDA": "IREDA",
    "JUPITER LIFE LINE HOSP. LTD": "JLHL", "NATIONAL SECURITIES DEP LTD": "NSDL.BO",
    "GK ENERGY LTD": "GKENERGY", "DEVYANI INTERNATIONAL LIMITED": "DEVYANI",
    "BANWIR": "BANSALWIRE", "DEVIN": "DEVYANI", "INDR": "IRFC", "INDREN": "IREDA",
    "IRMENE": "IRMENERGY", "JUPLIF": "JLHL", "NATSEC": "NSDL.BO",
    "TATSTE": "TATASTEEL", "TATA STEEL": "TATASTEEL", "TATA STEEL LIMITED": "TATASTEEL", "TATASTEEL": "TATASTEEL",
    "GKENEL": "GKENERGY", "LENSKART SOLUTIONS LIMITED": "LENSKART", "LENSKART": "LENSKART",
    "IRM ENERGY LIMITED": "IRMENERGY", "VODAFONE IDEA": "IDEA", "VODAFONE IDEA LIMITED": "IDEA",
    "ELIN ELECTRONICS": "ELIN", "ELIN ELECTRONICS LIMITED": "ELIN",
    "BANSAL WIRE INDUSTRIES LIMITED": "BANSALWIRE", "BANSAL WIRE": "BANSALWIRE"
}

SCRAPE_MAP = {
    "SGBJUN31I-GB": "https://www.moneycontrol.com/india/stockpricequote/finance-investment/sovereigngoldbonds250srify2023-24/SGB54",
    "SGBJUN31I": "https://www.moneycontrol.com/india/stockpricequote/finance-investment/sovereigngoldbonds250srify2023-24/SGB54",
    "SGBJUN31.NS": "https://www.moneycontrol.com/india/stockpricequote/finance-investment/sovereigngoldbonds250srify2023-24/SGB54"
}

# Manual Dividends (Overwrites Yahoo Finance if 0 or missing)
MANUAL_DIVIDENDS = {
    "IREDA.NS": 0.48, # Final Dividend 2024
    "IREDA": 0.48,
    "TATASTEEL.NS": 3.60, # TTM Dividend
    "TATASTEEL": 3.60,
    "TATSTE": 3.60
}

def scrape_price(url):
    try:
        headers = { 'User-Agent': 'Mozilla/5.0' }
        r = requests.get(url, headers=headers, timeout=5)
        text = r.text
        ltp = 0
        match = re.search(r'id="nsecp".*?rel="([\d\.]+)"', text)
        if match: ltp = float(match.group(1))
        else:
            match = re.search(r'class="inprice1_nsecp".*?>([\d,]+\.?\d*)<', text)
            if match: ltp = float(match.group(1).replace(',', ''))
        
        if ltp > 0:
            prev_close = ltp 
            match_prev = re.search(r'Previous Close.*?<td[^>]*>\s*([\d,]+\.?\d*)\s*</td>', text, re.DOTALL | re.IGNORECASE)
            if match_prev:
                try: prev_close = float(match_prev.group(1).replace(',', ''))
                except: pass
            return { "ltp": ltp, "prevClose": prev_close }
    except Exception as e:
        print(f"Scrape Error {url}: {e}")
    return None

def get_symbols():
    symbols = set()
    # 1. Get from Dhan CSV
    try:
        if os.path.exists(HOLDINGS_FILE):
            df = pd.read_csv(HOLDINGS_FILE)
            col = next((c for c in df.columns if c.lower() in ['instrument', 'symbol', 'name', 'stock']), None)
            if col: symbols.update([str(s).strip() for s in df[col].dropna() if len(str(s)) > 1])
    except: pass
        
    # 2. Get from Broker Files
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        for f in os.listdir(base_dir):
            if f.startswith('~$') or f == os.path.basename(OUTPUT_FILE) or f == 'holdings.csv': continue
            path = os.path.join(base_dir, f)
            if f.endswith('.xlsx') or f.endswith('.xls') or f.endswith('.csv'):
                try:
                    if f.endswith('.csv'):
                        try: raw_df = pd.read_csv(path, header=None, nrows=20)
                        except: raw_df = pd.read_csv(path, header=None, nrows=20, encoding='latin1')
                    else: raw_df = pd.read_excel(path, header=None, nrows=20)
                    
                    header_idx = -1
                    potential_headers = ['company', 'company name', 'stock', 'symbol', 'instrument']
                    for i, row in raw_df.iterrows():
                        row_vals = [str(x).lower().replace(' ', '').strip() for x in row if pd.notna(x)]
                        if any(h.replace(' ', '') in row_vals for h in potential_headers):
                            header_idx = i; break
                    
                    if header_idx != -1:
                        if f.endswith('.csv'):
                            try: df = pd.read_csv(path, skiprows=header_idx)
                            except: df = pd.read_csv(path, skiprows=header_idx, encoding='latin1')
                        else: df = pd.read_excel(path, skiprows=header_idx)
                        col = next((c for c in df.columns if str(c).lower().replace(' ', '').strip() in [h.replace(' ', '') for h in potential_headers]), None)
                        if col: symbols.update([str(s).strip() for s in df[col].dropna() if len(str(s)) > 1])
                except: pass
    except: pass

    # 3. Get from manual_symbols.txt
    try:
        if os.path.exists(MANUAL_SYMBOLS_FILE):
            with open(MANUAL_SYMBOLS_FILE, 'r') as f:
                for line in f:
                    if line.strip() and not line.startswith('#'): symbols.add(line.strip())
    except: pass
            
    return sorted([s for s in symbols if s.lower() not in ['company', 'symbol', 'instrument', 'name', 'total']])

def sync_prices():
    symbols = get_symbols()
    if not symbols: return

    yahoo_to_originals = {}
    scrape_tasks = {}

    for s in symbols:
        if s in SCRAPE_MAP:
            scrape_tasks[s] = SCRAPE_MAP[s]
            continue
        ticker = TICKER_MAP.get(s, s)
        yahoo_sym = f"{ticker}.NS" if "." not in ticker else ticker
        if yahoo_sym not in yahoo_to_originals: yahoo_to_originals[yahoo_sym] = []
        yahoo_to_originals[yahoo_sym].append(s)

    price_map = {}
    
    # 1. Scrape Custom
    if scrape_tasks:
        print(f"Scraping {len(scrape_tasks)} symbols...")
        for sym, url in scrape_tasks.items():
            data = scrape_price(url)
            if data:
                data['symbol'] = sym
                price_map[sym] = data

    # 2. Fetch Yahoo Bulk
    yahoo_symbols = list(yahoo_to_originals.keys())
    if yahoo_symbols:
        try:
            print(f"[{time.strftime('%H:%M:%S')}] Bulk fetching {len(yahoo_symbols)} symbols...")
            
            # Use threads=True for faster downloading
            df = yf.download(yahoo_symbols, period="1y", interval="1d", actions=True, progress=False, threads=True)
            
            # Handle Single vs MultiIndex columns
            is_multi = isinstance(df.columns, pd.MultiIndex)
            
            for yahoo_sym in yahoo_symbols:
                try:
                    # Extract Data for Ticker
                    if is_multi:
                        if yahoo_sym not in df.columns.levels[1]: continue
                        ticker_df = df.xs(yahoo_sym, axis=1, level=1)
                    else:
                        # If only 1 ticker was requested, structure is flat
                        ticker_df = df
                        
                    if ticker_df.empty: continue

                    # Get Last Price (Close or Adj Close)
                    # Use 'Close' for LTP to match broker expectation better than Adj Close
                    last_row = ticker_df.iloc[-1]
                    prev_row = ticker_df.iloc[-2] if len(ticker_df) > 1 else last_row
                    
                    ltp = float(last_row['Close'])
                    prev_close = float(prev_row['Close'])
                    
                    # Calculate Dividend Rate (Sum of last 1y dividends)
                    # 'Dividends' column might contain NaN, fill 0
                    div_rate = float(ticker_df['Dividends'].fillna(0).sum())
                    div_yield = (div_rate / ltp * 100) if ltp > 0 else 0
                    
                    # Manual Dividend Override
                    if yahoo_sym in MANUAL_DIVIDENDS:
                        div_rate = MANUAL_DIVIDENDS[yahoo_sym]
                        div_yield = (div_rate / ltp * 100) if ltp > 0 else 0
                        print(f"  Override Div for {yahoo_sym}: {div_rate}")
                    
                    data = {
                        "ltp": round(ltp, 2),
                        "prevClose": round(prev_close, 2),
                        "divRate": round(div_rate, 2),
                        "divYield": round(div_yield, 2),
                        "symbol": yahoo_sym
                    }

                    # Map back to all original names
                    for name in yahoo_to_originals[yahoo_sym]:
                        price_map[name] = data
                    # Also store by ticker
                    price_map[yahoo_sym.replace('.NS', '')] = data
                    
                except Exception as e:
                    pass # Skip individual ticker errors
                    
        except Exception as e:
            print(f"Bulk Fetch Error: {e}")

    if price_map:
        output_data = { "lastUpdated": time.strftime('%H:%M:%S'), "prices": price_map, "source": "Yahoo Finance" }
        with open(OUTPUT_FILE, 'w') as f: json.dump(output_data, f, indent=4)
        with open(JS_BRIDGE, 'w') as f: f.write(f"window.priceDataBridge = {json.dumps(output_data, indent=4)};")
        print(f"✓ Updated prices for {len(price_map)} assets.")
    else:
        print("No data fetched.")

if __name__ == "__main__":
    sync_prices()
