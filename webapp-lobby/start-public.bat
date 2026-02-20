@echo off
echo ========================================
echo   MMtp Game Server — PUBLIC MODE
echo   (Anyone can join from any network!)
echo ========================================
echo.

:: Check if node_modules exists
if not exist "server\node_modules" (
    echo Installing server dependencies...
    cd server
    npm install
    cd ..
    echo.
)

echo Starting MMtp server with public tunnel...
echo.
echo A public URL will be generated — share it with friends!
echo They just open it in their phone browser to play.
echo.
echo Press Ctrl+C to stop the server
echo.
node server\index.js --public
