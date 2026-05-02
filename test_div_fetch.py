import yfinance as yf
import pandas as pd

def check_div(symbol):
    print(f"Checking {symbol}...")
    ticker = yf.Ticker(symbol)
    info = ticker.info
    print(f"  dividendRate: {info.get('dividendRate')}")
    print(f"  dividendYield: {info.get('dividendYield')}")
    try:
        hist = ticker.dividends
        print(hist.tail(5))
        one_year_ago = pd.Timestamp.now('UTC') - pd.Timedelta(days=365)
        last_year_divs = hist[hist.index >= one_year_ago]
        print(f"  Sum last year: {last_year_divs.sum()}")
    except Exception as e:
        print(e)

check_div("TATASTEEL.NS")
