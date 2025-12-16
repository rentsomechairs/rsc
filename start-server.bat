@echo off
set PORT=5500
echo.
echo Starting Rent Some Chairs server on http://localhost:%PORT%/
echo (Close this window to stop the server)
echo.
start "" http://localhost:%PORT%/
python -m http.server %PORT%
pause
