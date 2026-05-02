import json
import os
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime

# --- CONFIGURATION ---
CREDENTIALS_FILE = 'credentials.json' # You need to download this from Google Cloud Console
SHEET_NAME = 'WealthTracker_Data'      # The name of your Google Sheet
# ---------------------

def sync_to_sheets():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Starting Google Sheets Sync...")
    
    # 1. Load local data
    data_file = 'mf_data.json'
    if not os.path.exists(data_file):
        print(f"Error: {data_file} not found.")
        return

    with open(data_file, 'r') as f:
        mf_data = json.load(f)

    # 2. Authenticate with Google
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"Error: {CREDENTIALS_FILE} not found. Please follow instructions to setup Google Sheets API.")
        return

    try:
        scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
        creds = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_FILE, scope)
        client = gspread.authorize(creds)
        
        # 3. Open or Create Sheet
        try:
            sheet = client.open(SHEET_NAME).sheet1
        except gspread.exceptions.SpreadsheetNotFound:
            print(f"Creating new spreadsheet: {SHEET_NAME}")
            sh = client.create(SHEET_NAME)
            # Share with your email if needed: sh.share('your-email@gmail.com', perm_type='user', role='writer')
            sheet = sh.sheet1

        # 4. Prepare Data for Sheet
        header = ["Fund Name", "Folio", "Invested", "Value", "Units", "NAV", "Last Updated", "Monthly SIP", "SIP Date"]
        rows = [header]
        
        for fund, info in mf_data.items():
            rows.append([
                info.get('fund_name', fund),
                info.get('folio', '-'),
                info.get('invested', 0),
                info.get('value', 0),
                info.get('units', 0),
                info.get('nav', 0),
                info.get('last_updated', '-'),
                info.get('monthly_sip', 0),
                info.get('sip_date', '-')
            ])

        # 5. Clear and Update Sheet
        sheet.clear()
        sheet.update('A1', rows)
        
        print(f"✓ Successfully synced {len(rows)-1} funds to Google Sheets!")
        print(f"Sheet URL: https://docs.google.com/spreadsheets/d/{client.open(SHEET_NAME).id}")

    except Exception as e:
        print(f"Error during sync: {e}")

if __name__ == "__main__":
    sync_to_sheets()
