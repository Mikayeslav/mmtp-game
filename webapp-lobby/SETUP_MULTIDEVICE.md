# Running the Game on Multiple Devices

## Quick Setup

### On Your Computer (Host):

1. **Start the server on all network interfaces** (not just localhost):
   ```powershell
   cd E:\MMtp\webapp-lobby
   python -m http.server 8000 --bind 0.0.0.0
   ```

2. **Find your local IP address** (if you don't know it):
   ```powershell
   ipconfig | findstr /i "IPv4"
   ```
   Your IP is: **192.168.1.24**

3. **Allow firewall access** (if Windows Firewall blocks it):
   - Windows will prompt you automatically, click "Allow access"
   - Or manually: Windows Defender Firewall → Allow an app → Python → Check both Private/Public

### On Another Device (Phone/Tablet/Other Computer):

1. **Make sure both devices are on the same Wi-Fi network**

2. **Open a web browser** and go to:
   ```
   http://192.168.1.24:8000
   ```

3. **Join the game:**
   - Enter your name
   - Enter the 4-digit room code from the host
   - IP should auto-fill to `192.168.1.24` (or enter it manually)
   - Click "Join"

## Troubleshooting

### Can't connect from another device?

1. **Check firewall:**
   - Windows Firewall might be blocking Python
   - Allow Python through firewall (see above)

2. **Check network:**
   - Both devices must be on the same Wi-Fi network
   - Try pinging: `ping 192.168.1.24` from the other device

3. **Check server is running:**
   - Make sure you used `--bind 0.0.0.0` (not just `python -m http.server 8000`)
   - Check the server console for errors

4. **Try different port:**
   - If port 8000 is blocked, try: `python -m http.server 8080 --bind 0.0.0.0`
   - Then access: `http://192.168.1.24:8080`

### Your IP address changed?

- Your local IP might change if you reconnect to Wi-Fi
- Run `ipconfig` again to get the new IP
- Update the join IP on the other device

## Alternative: Using ngrok (Internet Access)

If you want to play over the internet (not just local network):

1. **Install ngrok:** https://ngrok.com/download
2. **Start your server:** `python -m http.server 8000`
3. **Start ngrok:** `ngrok http 8000`
4. **Share the ngrok URL** (e.g., `https://abc123.ngrok.io`) with the other player
5. **Note:** This requires both players to have internet access

## Quick Start Script

Create a file `start-server.bat` in `E:\MMtp\webapp-lobby`:

```batch
@echo off
echo Starting game server on all network interfaces...
echo Your local IP: 
ipconfig | findstr /i "IPv4"
echo.
echo Server starting at http://0.0.0.0:8000
echo Other devices can connect using your IP address above
echo.
python -m http.server 8000 --bind 0.0.0.0
pause
```

Then just double-click `start-server.bat` to start!
