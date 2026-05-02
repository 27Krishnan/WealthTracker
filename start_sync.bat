@echo off
:loop
cls
echo ==========================================
echo Starting WealthTracker Live Sync
echo ==========================================
echo Running Dhan API Sync...
python "e:\MY Networth\fetch_live_data.py"
echo.
echo Running Mutual Fund PDF Extraction...
python "e:\MY Networth\parse_mf_pdf.py"
echo.
echo Fetching Live MF NAVs...
python "e:\MY Networth\fetch_mf_nav.py"
echo.
echo Sync Complete. Waiting 5 minutes...
timeout /t 300
goto loop
