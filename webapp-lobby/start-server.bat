@echo off
echo ========================================
echo   MMtp Game Server (Node.js + WebSocket)
echo ========================================
echo.
echo Finding your local IP address...
ipconfig | findstr /i "IPv4"
echo.

:: Check if node_modules exists
if not exist "server\node_modules" (
    echo Installing server dependencies...
    cd server
    npm install
    cd ..
    echo.
)

echo Starting MMtp server with real-time multiplayer...
echo.
echo Server will be available at:
echo   - This computer: http://localhost:3000
echo   - Other devices:  http://YOUR_IP:3000 (see IP above)
echo.
echo Press Ctrl+C to stop the server
echo.
node server\index.js
